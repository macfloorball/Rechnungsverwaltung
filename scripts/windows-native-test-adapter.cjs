'use strict';
// Injected only into disposable stable test packages. Overrides feed transport,
// user consent and profile location. Uses real downloader, backend and NSIS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { app, BrowserWindow } = require('electron');
const { desktopUpdateTrust } = require('../package.json');
assert.equal(desktopUpdateTrust.repository, 'macfloorball/ttc-isolated-windows-fixture');
const root = process.env.TTC_WINDOWS_NATIVE_FIXTURE;
assert.ok(root && path.isAbsolute(root));
const [a, b] = JSON.parse(fs.readFileSync(path.join(root, 'builds.json'))).packages;
assert.ok([a.version, b.version].includes(app.getVersion()));
const profile = path.join(root, 'profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);
const onB = app.getVersion() === b.version;
const firstB = onB && !fs.existsSync(path.join(root, 'native-result.json'));
const journalPath = path.join(profile, 'updates/windows-install-state.json');
const observedJournal = firstB ? JSON.parse(fs.readFileSync(journalPath)) : null;
if (firstB) {
  assert.equal(observedJournal.phase, 'installed');
  assert.equal(observedJournal.version, b.version);
  assert.equal(observedJournal.previousVersion, a.version);
}
const bytes = fs.readFileSync(path.join(root, 'desktop-update.json'));
const signature = fs.readFileSync(path.join(root, 'desktop-update.json.sig'));
const manifest = JSON.parse(bytes);
assert.equal(manifest.keyId, desktopUpdateTrust.keyId);
const asset = (id, name, size) => ({ id, name, size, state: 'uploaded' });
const feed = { id: 100, draft: false, prerelease: false, tag_name: b.tag, target_commitish: b.commit,
  published_at: manifest.publishedAt, assets: manifest.artifacts.map(p => asset(p.assetId, p.fileName, p.size)).concat([
    asset(30, 'desktop-update.json', bytes.length), asset(40, 'desktop-update.json.sig', signature.length),
    asset(50, 'RELEASE_NOTES.md', 1), asset(60, 'SHA256SUMS', 1),
  ]) };
const write = (name, value) => fs.writeFileSync(path.join(root, `${name}.json`), JSON.stringify(value, null, 2));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (onB) {
  const backend = require('./backend.cjs');
  const createBackend = backend.createBackend;
  backend.createBackend = (...args) => {
    const instance = createBackend(...args);
    const stop = instance.stop;
    instance.stop = async () => {
      const forced = await stop();
      write(firstB ? 'native-shutdown' : 'native-restart-shutdown', { forced, pid: process.pid });
      return forced;
    };
    return instance;
  };
}
let transfers = 0;
require('./update_transport.cjs').createUpdateTransport = () => ({
  releases: async () => [feed], release: async () => feed,
  asset: async id => id === 30 ? bytes : signature,
  async streamAsset(id, size, consume) {
    assert.equal(id, 10); assert.equal(size, b.size); transfers++;
    for await (const chunk of fs.createReadStream(b.path)) await consume(chunk);
  },
});
const windows = require('./windows_update.cjs');
const createInstaller = windows.createWindowsInstaller;
let confirmations = 0;
windows.createWindowsInstaller = options => createInstaller({ ...options,
  dialog: { showMessageBox: async () => ({ response: confirmations++ === 0 ? 0 : 1 }) },
});
const updatesModule = require('./updates.cjs');
const createUpdates = updatesModule.createDesktopUpdates;
let updates;
updatesModule.createDesktopUpdates = options => { updates = createUpdates(options); return updates; };
async function request(method, endpoint, body) {
  const response = await fetch(new URL(endpoint, process.env.TTC_DESKTOP_PRODUCTION_URL), {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
  });
  assert.ok(response.ok, `${method} ${endpoint}: ${response.status}`);
  return response.headers.get('content-type')?.includes('application/json') ? response.json() : Buffer.from(await response.arrayBuffer());
}
async function until(check, name) {
  const deadline = Date.now() + 60000;
  while (!check()) {
    assert.ok(Date.now() < deadline, `${name} timeout`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
async function run() {
  await until(() => updates && BrowserWindow.getAllWindows().some(window => !window.webContents.isLoading()), 'app');
  assert.equal((await request('GET', '/api/health')).status, 'ok');
  const docs = process.env.TTC_DOCUMENT_DIRECTORY || path.join(process.env.TTC_DATA_DIRECTORY, 'documents');
  if (app.getVersion() === a.version) {
    await request('PUT', '/api/organization/settings', { recipient_name: 'Windows native update test', invoice_number_prefix: 'NATIVE' });
    const activity = (await request('PUT', '/api/settings', { activities: [{ name: 'Test Training', hourly_rate_cents: 1500 }] })).activities[0];
    const training = await request('POST', '/api/trainings', { training_date: '2020-01-15', activity_type_id: activity.id, hours: 2, status: 'completed' });
    const invoice = await request('POST', '/api/invoices', { year: 2020, month: 1 });
    assert.equal(invoice.total_amount_cents, 3000);
    const pdf = await request('GET', `/api/invoices/${invoice.id}/pdf`);
    assert.ok(pdf.subarray(0, 5).equals(Buffer.from('%PDF-')));
    const backupDir = path.join(root, 'backup'); fs.mkdirSync(backupDir, { recursive: true });
    const backup = (await request('POST', '/api/backups', { directory: backupDir })).path;
    const expected = { invoice, training, activity, docs, documentFiles: fs.readdirSync(docs).sort(), pdfSha: hash(pdf),
      backup, backupSha: hash(fs.readFileSync(backup)), pid: process.pid };
    assert.equal(hash(fs.readFileSync(path.join(docs, invoice.pdf_path))), expected.pdfSha);
    write('expected', expected);
    const offer = await updates.controller.check();
    assert.equal(offer.currentVersion, a.version);
    assert.equal(offer.availableVersion, b.version);
    assert.equal(offer.releaseNotes, manifest.releaseNotes);
    updates.controller.defer(b.version);
    assert.equal(transfers, 0);
    assert.equal(updates.downloader.getStatus(), null);
    updates.controller.request(b.version);
    await until(() => !updates.downloader.isBusy(), 'download');
    assert.equal(transfers, 1);
    assert.equal(updates.downloader.getStatus().state, 'downloaded');
    assert.equal(hash(fs.readFileSync(updates.downloader.getVerified().file)), b.sha256);
    await updates.controller.install(b.version);
    assert.equal(confirmations, 1);
    assert.equal(updates.installer.getStatus(), null);
    assert.equal((await request('GET', '/api/organization/settings')).next_invoice_number, 2);
    await updates.controller.install(b.version);
    const handoff = updates.installer.getStatus();
    write('handoff', { handoff, confirmations, transfers });
    assert.equal(handoff.state, 'install_handoff', JSON.stringify(handoff));
  } else {
    const expected = JSON.parse(fs.readFileSync(path.join(root, 'expected.json')));
    assert.notEqual(process.pid, expected.pid);
    assert.equal(docs, expected.docs);
    const installed = firstB ? null : JSON.parse(fs.readFileSync(path.join(root, 'native-result.json')));
    const expectedFiles = firstB ? expected.documentFiles : [...expected.documentFiles, installed.nextPdf];
    assert.deepEqual(fs.readdirSync(docs).sort(), expectedFiles.sort());
    const settings = await request('GET', '/api/organization/settings');
    assert.equal(settings.recipient_name, 'Windows native update test');
    assert.equal(settings.next_invoice_number, firstB ? 2 : 3);
    const savedActivity = (await request('GET', '/api/settings')).activities.find(item => item.id === expected.activity.id);
    assert.equal(savedActivity.name, expected.activity.name);
    assert.equal(savedActivity.hourly_rate_cents, expected.activity.hourly_rate_cents);
    const invoice = (await request('GET', '/api/invoices')).find(item => item.id === expected.invoice.id);
    assert.equal(invoice.invoice_number, expected.invoice.invoice_number);
    assert.equal(invoice.total_amount_cents, expected.invoice.total_amount_cents);
    assert.equal(hash(await request('GET', `/api/invoices/${invoice.id}/pdf`)), expected.pdfSha);
    assert.equal(hash(fs.readFileSync(path.join(docs, invoice.pdf_path))), expected.pdfSha);
    assert.equal(hash(fs.readFileSync(expected.backup)), expected.backupSha);
    if (firstB) await request('POST', '/api/trainings', { training_date: '2020-02-15', activity_type_id: expected.activity.id, hours: 1, status: 'completed' });
    const next = firstB ? await request('POST', '/api/invoices', { year: 2020, month: 2 })
      : (await request('GET', '/api/invoices')).find(item => item.year === 2020 && item.month === 2);
    assert.match(next.invoice_number, /-0002$/);
    const nextPdfSha = hash(fs.readFileSync(path.join(docs, next.pdf_path)));
    assert.equal(hash(await request('GET', `/api/invoices/${next.id}/pdf`)), nextPdfSha);
    if (installed) assert.equal(nextPdfSha, installed.nextPdfSha);
    await until(() => !fs.existsSync(journalPath), 'journal recovery');
    write(firstB ? 'native-result' : 'native-restart', {
      passed: true, from: a.version, to: b.version, pdfSha: expected.pdfSha, backupSha: expected.backupSha,
      previousNumber: invoice.invoice_number, nextNumber: next.invoice_number,
      nextPdf: next.pdf_path, nextPdfSha,
      previousPid: expected.pid, pid: process.pid, parentPid: process.ppid, observedJournal,
    });
    app.quit();
  }
}
setImmediate(() => run().catch(error => { write(onB && !firstB ? 'native-restart' : 'native-result', { passed: false, error: error.stack }); app.quit(); }));
