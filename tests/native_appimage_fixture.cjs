'use strict';
// Copied ONLY into isolated acceptance images, never production packages.
// Feed transport and confirmation are test adapters. Signature/download,
// controller, real backend, FUSE probe, helper, replacement and restart are real.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const metadata = require('../package.json');
assert.equal(metadata.desktopNativeAcceptance, true);
const file = process.env.TTC_NATIVE_UPDATE_FIXTURE;
const fixture = JSON.parse(fs.readFileSync(file));
const scenario = fixture.scenario || 'success';
let faultActive = true, transfers = 0;
const root = path.dirname(file), output = path.join(root, 'native-result.json');
const digest = b => createHash('sha256').update(b).digest('hex');
const wait = ms => new Promise(r => setTimeout(r, ms));
app.setPath('userData', path.join(root, 'profile'));
app.setPath('sessionData', path.join(root, 'profile'));
let backendReady = false, updates;
const backendModule = require('./backend.cjs'), originalBackend = backendModule.createBackend;
backendModule.createBackend = options => {
  const backend = originalBackend(options), start = backend.start;
  backend.start = async () => { await start(); backendReady = true; };
  return backend;
};
const transport = require('./update_transport.cjs');
transport.createUpdateTransport = () => ({
  releases: async () => {
    if (faultActive && scenario === 'offline') throw Error('isolated offline test');
    return [fixture.release];
  }, release: async () => fixture.release,
  asset: async id => {
    const bytes = Buffer.from(id === 30 ? fixture.manifest : fixture.signature, 'base64');
    if (faultActive && scenario === 'signature' && id === 40) bytes[0] ^= 1;
    return bytes;
  },
  async streamAsset(id, size, consume) {
    assert.equal(id, 20); transfers++;
    const stat = await fsp.stat(fixture.imageB); assert.equal(stat.size, size);
    let first = true;
    for await (const chunk of fs.createReadStream(fixture.imageB)) {
      if (faultActive && scenario === 'hash' && first) chunk[0] ^= 1;
      await consume(chunk);
      if (faultActive && scenario === 'interrupted') throw Error('isolated interrupted transport');
      first = false;
    }
  },
});
const linux = require('./linux_update.cjs'), originalInstaller = linux.createLinuxInstaller;
linux.createLinuxInstaller = options => originalInstaller({ ...options, dialog: { showMessageBox: async () => ({ response: faultActive && scenario === 'cancel-install' ? 0 : 1 }) } });
const updateModule = require('./updates.cjs'), originalUpdates = updateModule.createDesktopUpdates;
updateModule.createDesktopUpdates = options => { updates = originalUpdates(options); return updates; };
async function request(method, endpoint, body) {
  const response = await fetch(process.env.TTC_DESKTOP_PRODUCTION_URL + endpoint, { method,
    headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  assert.ok(response.ok, `${method} ${endpoint}: ${response.status}`);
  return response.headers.get('content-type')?.includes('application/json') ? response.json() : Buffer.from(await response.arrayBuffer());
}
async function run() {
  const deadline = Date.now() + 60000;
  while (!backendReady || !updates || !BrowserWindow.getAllWindows().some(w => !w.webContents.isLoading())) {
    assert.ok(Date.now() < deadline, 'native application ready timeout'); await wait(100);
  }
  const mount = process.env.APPDIR;
  await linux.probeAppImage({ app });
  if (app.getVersion() === '0.1.0') {
    await request('PUT', '/api/organization/settings', { recipient_name: 'Native A to B', invoice_number_prefix: 'NATIVE' });
    const activity = (await request('PUT', '/api/settings', { activities: [{ name: 'Test', hourly_rate_cents: 1500 }] })).activities[0];
    await request('POST', '/api/trainings', { training_date: '2020-01-15', activity_type_id: activity.id, hours: 2, status: 'completed' });
    const invoice = await request('POST', '/api/invoices', { year: 2020, month: 1 });
    const pdf = await request('GET', `/api/invoices/${invoice.id}/pdf`);
    assert.ok(pdf.subarray(0, 5).equals(Buffer.from('%PDF-')));
    fs.writeFileSync(path.join(root, 'expected.json'), JSON.stringify({ invoice, pdfSha256: digest(pdf), mountA: mount }));
    async function download() {
      updates.controller.request('0.1.1');
      while (updates.downloader.isBusy()) { assert.ok(Date.now() < deadline, 'download timeout'); await wait(100); }
    }
    let status = await updates.controller.check();
    if (['offline', 'signature'].includes(scenario)) {
      assert.equal(status.state, 'error');
      assert.equal(status.error.code, scenario === 'offline' ? 'NETWORK' : 'INVALID_SIGNATURE');
      assert.equal(transfers, 0);
    } else {
      assert.equal(status.state, 'available');
      updates.controller.acknowledge('0.1.1');
      if (scenario === 'defer') {
        updates.controller.defer('0.1.1');
        assert.equal(updates.controller.getStatus().deferred, true);
        assert.equal(transfers, 0);
        assert.equal(updates.downloader.getStatus(), null);
      } else {
        await download();
        if (['hash', 'interrupted'].includes(scenario)) {
          assert.equal(updates.downloader.getStatus().state, 'error');
          assert.equal(updates.downloader.getStatus().error.code, scenario === 'hash' ? 'DOWNLOAD_HASH' : 'NETWORK');
          assert.equal(updates.installer.canInstall('0.1.1'), false);
          assert.deepEqual(await fsp.readdir(path.join(root, 'profile/updates/downloads')), []);
        } else {
          assert.equal(updates.downloader.getStatus().state, 'downloaded');
          assert.equal(updates.installer.canInstall('0.1.1'), true);
          if (scenario === 'cancel-install') {
            await updates.controller.install('0.1.1');
            assert.notEqual(updates.installer.getStatus()?.state, 'install_handoff');
            assert.equal(updates.installer.canInstall('0.1.1'), true);
          }
          if (['read-only', 'writable-directory', 'hardlink'].includes(scenario)) {
            const link = path.join(root, 'linked.AppImage');
            try {
              if (scenario === 'hardlink') await fsp.link(process.env.APPIMAGE, link);
              else await fsp.chmod(root, scenario === 'read-only' ? 0o500 : 0o777);
              await updates.controller.install('0.1.1');
              assert.equal(updates.installer.getStatus().error.code, 'INSTALL_UNAVAILABLE');
            } finally {
              await fsp.chmod(root, 0o700);
              if (scenario === 'hardlink') await fsp.unlink(link);
            }
          }
        }
      }
    }
    if (scenario !== 'success') {
      assert.equal(digest(fs.readFileSync(process.env.APPIMAGE)), fixture.imageASha256);
      assert.equal(digest(await request('GET', `/api/invoices/${invoice.id}/pdf`)), digest(pdf));
      assert.equal((await request('GET', '/api/organization/settings')).next_invoice_number, 2);
      // Explicit manual retry, without weakening trust or waiting for the periodic timer.
      faultActive = false;
      await updates.service.invalidate();
      status = await updates.controller.check(); assert.equal(status.state, 'available');
      await download();
      assert.equal(updates.downloader.getStatus().state, 'downloaded');
    }
    await updates.controller.install('0.1.1');
    assert.equal(updates.installer.getStatus().state, 'install_handoff');
  } else {
    assert.equal(app.getVersion(), '0.1.1');
    const expected = JSON.parse(fs.readFileSync(path.join(root, 'expected.json')));
    assert.notEqual(mount, expected.mountA);
    const settings = await request('GET', '/api/organization/settings');
    assert.equal(settings.recipient_name, 'Native A to B'); assert.equal(settings.next_invoice_number, 2);
    assert.equal(digest(await request('GET', `/api/invoices/${expected.invoice.id}/pdf`)), expected.pdfSha256);
    assert.equal(digest(fs.readFileSync(path.join(root, 'documents', expected.invoice.pdf_path))), expected.pdfSha256);
    assert.equal((fs.statSync(process.env.APPIMAGE).mode & 0o700), 0o700);
    assert.equal(digest(fs.readFileSync(process.env.APPIMAGE)), fixture.imageBSha256);
    app.once('will-quit', () => fs.writeFileSync(output, JSON.stringify({ passed: true, scenario, version: app.getVersion(), mountB: mount,
      expected, pid: process.pid, realFuse: true, realHelper: true, feedAndConfirmation: 'test adapters' }, null, 2)));
    app.quit();
  }
}
setImmediate(() => run().catch(error => {
  fs.writeFileSync(output, JSON.stringify({ passed: false, error: error.stack }, null, 2)); app.quit();
}));
