'use strict';
// Test-only driver: real window, backend, controller, IPC and renderer; ephemeral
// signed metadata, an in-memory credential provider and no external downloads.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, dialog } = require('electron');
const { updateFixture } = require('./tests/update_fixture.cjs');
const { signedManifest } = require('./scripts/release_bundle.cjs');
const updates = require('./electron/updates.cjs');
const { createUpdateController } = require('./electron/update_controller.cjs');

const root = app.getAppPath(), output = process.env.TTC_TEST_OUTPUT;
assert.equal(path.dirname(output), path.dirname(root));
app.setPath('userData', process.env.TTC_DATA_DIRECTORY);
app.setPath('sessionData', process.env.TTC_DATA_DIRECTORY);
const f = updateFixture();
const notes = '<img src=x onerror="window.__updatePwned=true">\nEin signierter Testhinweis – kein produktiver Release.';
const packet = signedManifest(f.policy, f.release, f.packages, notes, f.privateKey, new Date(f.now));
f.feedRelease.assets.find((asset) => asset.id === 30).size = packet.bytes.length;
f.transport.asset = async (id) => id === 30 ? packet.bytes : packet.signature;
let controller, service, token = f.token;
const errors = [];
dialog.showErrorBox = (_title, message) => errors.push(message);
updates.createDesktopUpdates = () => {
  service = updates.createUpdateService({ config: f.config, getToken: async () => token,
    transportFactory: () => f.transport, now: () => f.now, minimumIntervalMs: 0 });
  // Deterministic UI fixture: driver controls status changes, not the 3s timer.
  service.start = () => {};
  const credentials = { setToken: async (value) => { token = value; }, clear: async () => { token = null; } };
  controller = createUpdateController({ service, credentials });
  return { service, credentials, controller };
};
require('./electron/main.cjs');

async function until(check, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    assert.deepEqual(errors, []);
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error(`Timeout: ${label}`);
}

(async () => {
  await app.whenReady();
  let window;
  await until(() => (window = BrowserWindow.getAllWindows()[0]), 'window');
  const contents = window.webContents;
  const js = (source) => contents.executeJavaScript(source, true);
  await until(() => !contents.isLoading() && contents.getURL().startsWith('http:'), 'page');
  await until(() => js('!document.getElementById("desktop-updates").hidden && document.getElementById("desktop-current-version").textContent === "0.1.0" && !document.querySelector(\'[aria-busy="true"]\')'), 'update controls');
  await js('document.getElementById("training-dialog").showModal(); document.getElementById("training-note").value = "Ungespeicherte Testnotiz";');
  assert.equal((await service.check()).state, 'available');
  await until(() => js('document.getElementById("desktop-update-status").textContent.includes("0.2.0")'), 'available status');
  assert.equal(await js('document.getElementById("desktop-update-dialog").open'), false);
  assert.equal(await js('document.getElementById("training-note").value'), 'Ungespeicherte Testnotiz');
  await js('document.getElementById("training-dialog").close()');
  await until(() => js('document.getElementById("desktop-update-dialog").open'), 'queued update dialog');
  assert.equal(await js('document.getElementById("desktop-update-dialog-title").textContent'), 'Update verfügbar – Version 0.2.0');
  assert.equal(await js('document.getElementById("desktop-update-notes").querySelector("img")'), null);
  assert.equal(await js('Boolean(window.__updatePwned)'), false);
  assert.equal(await js('document.getElementById("desktop-update-now").disabled'), true);
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await fs.writeFile(path.join(output, 'update-dialog.png'), (await contents.capturePage()).toPNG());
  await js('document.getElementById("desktop-update-later").click()');
  await until(() => !controller.getStatus().promptVersion && controller.getStatus().deferred, 'deferred decision');
  await service.check();
  assert.equal(await js('document.getElementById("desktop-update-dialog").open'), false);
  const finished = new Promise((resolve) => contents.once('did-finish-load', resolve));
  contents.reload(); await finished;
  await until(() => js('!document.getElementById("show-desktop-update").hidden && !document.querySelector(\'[aria-busy="true"]\')'), 'restored controls');
  assert.equal(await js('document.getElementById("desktop-update-dialog").open'), false);
  await js('document.getElementById("show-desktop-update").click()');
  await until(() => js('document.getElementById("desktop-update-dialog").open'), 'manual dialog');
  await js('document.getElementById("desktop-update-dialog").dispatchEvent(new Event("cancel", { cancelable: true }))');
  await until(() => js('!document.getElementById("desktop-update-dialog").open'), 'escape acts as later');
  const raw = 'github_pat_native_UI_fixture_only';
  await js(`document.getElementById("desktop-update-access").open = true; document.getElementById("desktop-update-token").value = ${JSON.stringify(raw)}; document.getElementById("desktop-update-access-form").requestSubmit();`);
  assert.equal(await js('document.getElementById("desktop-update-token").value'), '');
  await until(() => token === raw, 'private token Main IPC');
  assert.equal(await js(`document.body.textContent.includes(${JSON.stringify(raw)})`), false);
  const status = await js('window.ttcDesktop.getUpdateStatus()');
  assert.equal(JSON.stringify(status).includes(raw), false);
  await until(() => js('!document.getElementById("clear-desktop-update-access").disabled'), 'credential action settled');
  await js('document.getElementById("clear-desktop-update-access").click()');
  await until(() => token === null, 'clear access');
  console.log('DESKTOP_UPDATE_UI_CHECK passed: dialog, plain notes, queued prompt, defer, reload, credentials');
  app.quit();
})().catch((error) => { console.error(error.stack); app.exit(1); });
