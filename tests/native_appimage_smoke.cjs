'use strict';
// Opt-in native check. Uses an unchanged development AppImage, real FUSE and
// sandboxed Electron. Temporary profile/data only; no signing or release changes.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { probeAppImage } = require('../electron/linux_update.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
async function evaluate(url, expression) {
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(Error('CDP timeout')); }, 10000);
    const finish = (error, value) => { clearTimeout(timer); socket.close(); error ? reject(error) : resolve(value); };
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })));
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id === 1) finish(message.error || message.result?.exceptionDetails, message.result?.result?.value);
    });
    socket.addEventListener('error', () => finish(Error('CDP error')));
  });
}
async function main() {
  assert.equal(process.platform, 'linux'); assert.notEqual(process.getuid(), 0);
  const rpm = process.argv[2] === '--rpm';
  const source = path.resolve(process.argv[rpm ? 3 : 2]);
  if (!rpm) assert.ok((await fs.stat('/dev/fuse')).isCharacterDevice(), '/dev/fuse required');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ttc-native-appimage-'));
  await fs.chmod(root, 0o700);
  const image = rpm ? source : path.join(root, 'TTC.AppImage');
  if (!rpm) { await fs.copyFile(source, image); await fs.chmod(image, 0o700); }
  const data = path.join(root, 'data'), documents = path.join(root, 'documents');
  const state = { sourceSha256: hash(await fs.readFile(source)), cycles: [] };
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TTC_') && !key.startsWith('APPIMAGE')
    && !key.startsWith('PYTHON') && !['APPDIR', 'ARGV0', 'OWD', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  Object.assign(environment, { XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'),
    TTC_DATA_DIRECTORY: data, TTC_DOCUMENT_DIRECTORY: documents, TTC_LEGACY_DATABASE: path.join(root, 'no-legacy.db') });
  let expected;
  for (let cycle = 0; cycle < 2; cycle++) {
    const backendPort = await port(), debugPort = await port();
    const origin = `http://127.0.0.1:${backendPort}`;
    const log = await fs.open(path.join(root, `cycle-${cycle}.log`), 'wx', 0o600);
    const child = spawn(image, [`--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1'], {
      env: { ...environment, TTC_DESKTOP_PRODUCTION_URL: origin }, cwd: root, stdio: ['ignore', log.fd, log.fd] });
    const exited = new Promise((resolve, reject) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', reject); });
    const request = async (method, endpoint, body) => {
      const response = await fetch(origin + endpoint, { method, body: body === undefined ? undefined : JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000) });
      assert.ok(response.ok, `${method} ${endpoint}: ${response.status}`);
      return response.headers.get('content-type')?.includes('application/json') ? response.json() : Buffer.from(await response.arrayBuffer());
    };
    try {
      const deadline = Date.now() + 45000;
      let target;
      while (Date.now() < deadline) {
        assert.equal(child.exitCode, null, `AppImage exited; evidence: ${root}`);
        try {
          await request('GET', '/api/health');
          const tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
          target = tabs.find(tab => tab.type === 'page' && tab.url.startsWith(origin));
          if (target) break;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(target, `Native startup failed; evidence: ${root}`);
      const executable = await fs.readlink(`/proc/${child.pid}/exe`), mount = path.dirname(executable);
      const metadata = JSON.parse(await fs.readFile(path.join(mount, 'resources/app/package.json')));
      assert.equal(metadata.desktopUpdateTrust.enabled, false, 'native smoke only accepts development trust');
      const mountInfo = await fs.readFile(`/proc/${child.pid}/mountinfo`, 'utf8');
      await fs.writeFile(path.join(root, `mount-${cycle}.txt`), mountInfo.split('\n').filter(line => line.includes(mount)).join('\n'));
      if (!rpm) {
      const capability = await probeAppImage({ mountInfo: async () => mountInfo, app: { isPackaged: true, getAppPath: () => path.join(mount, 'resources/app'), getPath: () => executable },
        env: { APPIMAGE: image, APPDIR: mount } });
      assert.equal(capability.target, image);
      } else {
        assert.equal(metadata.ttcDistribution, 'rpm');
        require('../electron/installation.cjs').validateInstallation(path.join(mount, 'resources/app'), true, 'linux');
      }
      const pageDeadline = Date.now() + 10000;
      while (!await evaluate(target.webSocketDebuggerUrl, "typeof window.ttcDesktop?.getVersion === 'function' && document.readyState === 'complete'")) {
        assert.ok(Date.now() < pageDeadline, 'packaged preload must become ready');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const version = await evaluate(target.webSocketDebuggerUrl, 'window.ttcDesktop.getVersion()');
      assert.equal(version.ok, true);
      if (rpm) {
        const updates = await evaluate(target.webSocketDebuggerUrl, 'window.ttcDesktop.getUpdateStatus()');
        assert.equal(updates.ok, true);
        assert.equal(updates.value.state, 'disabled');
        assert.equal(updates.value.reason, 'package_manager');
      }
      if (cycle === 0) {
        await request('PUT', '/api/organization/settings', { recipient_name: 'Native FUSE Test', invoice_number_prefix: 'FUSE' });
        const activity = (await request('PUT', '/api/settings', { activities: [{ name: 'Test Training', hourly_rate_cents: 1500 }] })).activities[0];
        await request('POST', '/api/trainings', { training_date: '2020-01-15', activity_type_id: activity.id, hours: 2, status: 'completed' });
        const invoice = await request('POST', '/api/invoices', { year: 2020, month: 1 });
        const pdf = await request('GET', `/api/invoices/${invoice.id}/pdf`);
        assert.ok(pdf.subarray(0, 5).equals(Buffer.from('%PDF-')));
        expected = { invoiceId: invoice.id, pdfPath: invoice.pdf_path, pdfSha256: hash(pdf) };
      } else {
        const settings = await request('GET', '/api/organization/settings');
        assert.equal(settings.recipient_name, 'Native FUSE Test');
        assert.equal(settings.next_invoice_number, 2);
        assert.equal(hash(await request('GET', `/api/invoices/${expected.invoiceId}/pdf`)), expected.pdfSha256);
        assert.equal(hash(await fs.readFile(path.join(documents, expected.pdfPath))), expected.pdfSha256);
      }
      state.cycles.push({ version, mount, realFuseCapability: !rpm, packageManager: rpm ? 'dnf' : null, invoice: expected });
      await evaluate(target.webSocketDebuggerUrl, 'setTimeout(() => window.close(), 50); true');
      const timeout = setTimeout(() => child.kill('SIGTERM'), 20000);
      const result = await exited; clearTimeout(timeout);
      assert.equal(result.code, 0, 'normal window close must finish cleanly');
      await assert.rejects(fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) }));
    } finally {
      if (child.exitCode === null && child.signalCode === null) { const forced = setTimeout(() => child.kill('SIGKILL'), 5000); child.kill('SIGTERM'); await exited; clearTimeout(forced); }
      await log.close();
    }
  }
  await fs.writeFile(path.join(root, 'result.json'), JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(`${rpm ? 'NATIVE_RPM_SMOKE passed: DNF update mode' : 'NATIVE_APPIMAGE_SMOKE passed: FUSE'}, sandbox, PDF persistence, clean shutdown/restart; evidence: ${root}`);
}
main().catch(error => { console.error(error.stack || JSON.stringify(error)); process.exitCode = 1; });
