'use strict';

// Opt-in driver copied into a disposable application by test_desktop_invoice.py.
// The actual main, preload, renderer and managed Python backend run unchanged.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, shell, dialog } = require('electron');

const root = app.getAppPath();
const output = process.env.TTC_TEST_OUTPUT;
assert.equal(path.dirname(output), path.dirname(root));
app.setPath('userData', process.env.TTC_DATA_DIRECTORY);
app.setPath('sessionData', process.env.TTC_DATA_DIRECTORY);
const handoffs = [];
const errors = [];
let expectedWriteFailure = false;
// Exercise the real URL-validation/window-open handler, but keep test links out
// of the user's browser. Native browser rendering/printing remains manual QA.
shell.openExternal = async (url) => { handoffs.push(url); };
dialog.showErrorBox = (_title, message) => { errors.push(message); };
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', (event) => {
    if (expectedWriteFailure && /Failed to load resource.*503/.test(event.message)) return;
    if (event.level === 'error') errors.push(event.message);
  });
});

require('./electron/main.cjs');

async function until(check, description) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    assert.deepEqual(errors, [], errors.join('\n'));
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout: ${description}`);
}

async function run() {
  await app.whenReady();
  const window = await until(() => BrowserWindow.getAllWindows()[0], 'main window');
  const contents = window.webContents;
  await until(() => !contents.isLoading() && contents.getURL().startsWith('http:'), 'frontend load');
  const js = code => contents.executeJavaScript(code, true);
  await until(() => js('Boolean(window.ttcDesktop && document.querySelector("#invoice-month")?.value)'), 'preload and renderer');
  const preferences = contents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(await js('typeof require'), 'undefined');
  assert.equal((await js('window.ttcDesktop.getVersion()')).ok, true);

  await js(`(async () => {
    async function request(url, body) {
      const response = await fetch(url, {method: url === '/api/settings' ? 'PUT' : 'POST',
        headers: {'Content-Type':'application/json'}, body:JSON.stringify(body)});
      if (!response.ok) throw Error('Test setup HTTP ' + response.status);
      return response.json();
    }
    const settings = await request('/api/settings', {activities:[{name:'Electron Testtraining',hourly_rate_cents:1500}]});
    for (const status of ['completed','planned']) {
      await request('/api/trainings', {training_date:'2020-01-15',activity_type_id:settings.activities[0].id,hours:2,status});
    }
    const month = document.querySelector('#invoice-month');
    month.value='2020-01'; month.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#invoice-preview-form').requestSubmit();
  })()`);
  const previewReady = `!document.querySelector('#invoice-preview').hidden &&
    document.querySelector('#invoice-preview-form').getAttribute('aria-busy') === 'false'`;
  await until(() => js(previewReady), 'invoice preview');
  assert.equal(await js('document.querySelectorAll("#invoice-items tr").length'), 1);
  assert.match(await js('document.querySelector("#invoice-items").textContent'), /Electron Testtraining/);
  assert.match(await js('document.querySelector("#invoice-total").textContent'), /30,00/);
  assert.equal(await js('document.querySelector("#create-invoice").disabled'), false);
  await js(`(async () => {
    document.querySelector('#invoice-preview').scrollIntoView({behavior:'instant',block:'center'});
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  await fs.writeFile(path.join(output, 'preview.png'), (await contents.capturePage()).toPNG());

  const directory = process.env.TTC_DOCUMENT_DIRECTORY || path.join(process.env.TTC_DATA_DIRECTORY, 'documents');
  // A file in place of the document directory must produce a visible, useful
  // error and allow retry after the obstruction is removed.
  await fs.writeFile(directory, 'test obstruction');
  expectedWriteFailure = true;
  await js('document.querySelector("#create-invoice").click()');
  await until(() => js(`!document.querySelector('#invoice-create-error').hidden &&
    !document.querySelector('#create-invoice').disabled`), 'visible write error');
  const failureText = await js('document.querySelector("#invoice-create-error").textContent');
  assert.match(failureText, /nicht gespeichert.*ungültig/);
  assert.equal(failureText.includes(directory), false);
  await fs.unlink(directory);
  expectedWriteFailure = false;
  await js('document.querySelector("#create-invoice").click()');
  await until(() => js('!document.querySelector("#open-invoice-pdf").hidden'), 'finalization');
  const url = await js('document.querySelector("#open-invoice-pdf").href');
  assert.match(url, /\/api\/invoices\/[1-9]\d*\/pdf$/);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/pdf/);
  assert.match(response.headers.get('content-disposition'), /inline/);
  const pdf = Buffer.from(await response.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const filename = 'Rechnung_TTC_2020-01.pdf';
  assert.deepEqual(await fs.readFile(path.join(directory, filename)), pdf);
  await fs.writeFile(path.join(output, filename), pdf);

  await js('document.querySelector("#open-invoice-pdf").click()');
  await until(() => handoffs.length === 1, 'validated browser handoff');
  assert.equal(handoffs[0], url);
  const downloaded = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Download timeout')), 15000);
    contents.session.once('will-download', (_event, item) => {
      try {
        assert.equal(item.getURL(), url);
        assert.equal(item.getFilename(), filename);
        item.setSavePath(path.join(output, 'download.pdf'));
        item.once('done', (_event, state) => {
          clearTimeout(timer);
          if (state === 'completed') resolve();
          else reject(Error(`Download ${state}`));
        });
      } catch (error) { clearTimeout(timer); reject(error); }
    });
  });
  await js('document.querySelector("#download-invoice-pdf").click()');
  await downloaded;
  assert.deepEqual(await fs.readFile(path.join(output, 'download.pdf')), pdf);

  // A new preview must not replace or modify the already finalized PDF.
  await js('document.querySelector("#invoice-preview-form").requestSubmit()');
  await until(() => js(previewReady), 'renewed preview');
  assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), pdf);
  const loaded = new Promise(resolve => contents.once('did-finish-load', resolve));
  contents.reload();
  await loaded;
  await until(() => js('Boolean(document.querySelector("#invoice-month")?.value)'), 'renderer reload');
  await js('document.querySelector("#reload-invoices").click()');
  await until(() => js('Boolean(document.querySelector("#saved-invoices-rows a[target=_blank]"))'), 'invoice archive');
  await js('document.querySelector("#saved-invoices-rows a[target=_blank]").click()');
  await until(() => handoffs.length === 2, 'archive browser handoff');
  assert.deepEqual(handoffs, [url, url]);
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  assert.equal(contents.getURL(), new URL('/', url).href);
  assert.deepEqual(errors, []);
  console.log('DESKTOP_PDF_CHECK ' + JSON.stringify({previewRows:1,totalCents:3000,handoffs:2,pdfBytes:pdf.length,errorRecovery:true}));
}

const watchdog = setTimeout(() => {
  console.error('Desktop invoice check exceeded time limit');
  process.exitCode = 1;
  app.quit();
}, 60000);
run().catch(error => {
  console.error(error.stack);
  process.exitCode = 1;
}).finally(() => {
  clearTimeout(watchdog);
  app.quit(); // Production shutdown stops its own backend through the control pipe.
});
