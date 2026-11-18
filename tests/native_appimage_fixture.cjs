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
  releases: async () => [fixture.release], release: async () => fixture.release,
  asset: async id => Buffer.from(id === 30 ? fixture.manifest : fixture.signature, 'base64'),
  async streamAsset(id, size, consume) {
    assert.equal(id, 20);
    const stat = await fsp.stat(fixture.imageB); assert.equal(stat.size, size);
    for await (const chunk of fs.createReadStream(fixture.imageB)) await consume(chunk);
  },
});
const linux = require('./linux_update.cjs'), originalInstaller = linux.createLinuxInstaller;
linux.createLinuxInstaller = options => originalInstaller({ ...options, dialog: { showMessageBox: async () => ({ response: 1 }) } });
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
    const status = await updates.controller.check(); assert.equal(status.state, 'available');
    updates.controller.acknowledge('0.1.1'); updates.controller.request('0.1.1');
    while (updates.downloader.isBusy()) { assert.ok(Date.now() < deadline, 'download timeout'); await wait(100); }
    assert.equal(updates.downloader.getStatus().state, 'downloaded');
    assert.equal(updates.installer.canInstall('0.1.1'), true);
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
    app.once('will-quit', () => fs.writeFileSync(output, JSON.stringify({ passed: true, version: app.getVersion(), mountB: mount,
      expected, pid: process.pid, realFuse: true, realHelper: true, feedAndConfirmation: 'test adapters' }, null, 2)));
    app.quit();
  }
}
setImmediate(() => run().catch(error => {
  fs.writeFileSync(output, JSON.stringify({ passed: false, error: error.stack }, null, 2)); app.quit();
}));
