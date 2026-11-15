'use strict';

// Opt-in driver copied into a disposable application by test_desktop_invoice.py.
// The actual main, preload, renderer and managed Python backend run unchanged.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { app, BrowserWindow, shell, dialog } = require('electron');

const root = app.getAppPath();
const output = process.env.TTC_TEST_OUTPUT;
assert.equal(path.dirname(output), path.dirname(root));
app.setPath('userData', process.env.TTC_DATA_DIRECTORY);
app.setPath('sessionData', process.env.TTC_DATA_DIRECTORY);
const handoffs = [];
const errors = [];
const recipient = {
  recipient_name: "TTC O'Brien & Söhne <Verein>",
  recipient_street: 'Äußere Straße 7',
  recipient_postal_code: '01234',
  recipient_city: 'Köln',
  recipient_email: '',
};
let expectedHTTPFailure = null;
// Exercise the real URL-validation/window-open handler, but keep test links out
// of the user's browser. Native browser rendering/printing remains manual QA.
shell.openExternal = async (url) => { handoffs.push(url); };
dialog.showErrorBox = (_title, message) => { errors.push(message); };
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', (event) => {
    if (expectedHTTPFailure && new RegExp(`Failed to load resource.*${expectedHTTPFailure}`).test(event.message)) return;
    if (event.level === 'error') errors.push(event.message);
  });
});

if (process.env.TTC_TEST_OFFLINE_NAMESPACE) {
  const updates = require('./electron/updates.cjs');
  const { createUpdateController } = require('./electron/update_controller.cjs');
  updates.createDesktopUpdates = () => {
    // Explicit test configuration; real fetch/DNS, no production token or package.
    const config = { enabled: true, currentVersion: '0.1.0', platform: 'linux', arch: 'x64',
      repository: 'example/ttc-offline-fixture', repositoryId: 1, visibility: 'public' };
    const service = updates.createUpdateService({ config, timeoutMs: 1500, minimumIntervalMs: 0 });
    return { service, controller: createUpdateController({ service, credentials: {} }) };
  };
}
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
  if (process.env.TTC_TEST_OFFLINE_NAMESPACE) {
    assert.equal(await fs.readlink('/proc/self/ns/net'), process.env.TTC_TEST_OFFLINE_NAMESPACE);
    for (const host of ['192.0.2.1', '2001:db8::1']) {
      await new Promise((resolve, reject) => {
        const connection = net.connect({host, port:443});
        connection.setTimeout(1000, () => connection.destroy(new Error('Offline probe timed out')));
        connection.once('connect', () => connection.destroy(new Error('External network unexpectedly reachable')));
        connection.once('error', error => {
          connection.destroy();
          try { assert.equal(error.code, 'ENETUNREACH'); resolve(); }
          catch (failure) { reject(failure); }
        });
      });
    }
    console.log('DESKTOP_OFFLINE_CHECK ' + JSON.stringify({namespace:process.env.TTC_TEST_OFFLINE_NAMESPACE, ipv4:false, ipv6:false}));
  }
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
  const updateStatus = await js('window.ttcDesktop.getUpdateStatus()');
  assert.equal(updateStatus.ok, true);
  if (process.env.TTC_TEST_OFFLINE_NAMESPACE) {
    const checked = await js('window.ttcDesktop.checkForUpdates()');
    assert.equal(checked.value.state, 'error');
    assert.ok(['NETWORK', 'TIMEOUT'].includes(checked.value.error.code));
    console.log('Real offline update request failed safely; continuing invoice/data checks');
  } else {
    assert.equal(updateStatus.value.state, 'disabled');
    assert.equal((await js('window.ttcDesktop.checkForUpdates()')).value.state, 'disabled');
  }
  assert.equal(await js('typeof window.ttcDesktop.getToken'), 'undefined');
  await until(() => js('!document.getElementById("desktop-updates").hidden'), 'desktop update controls');
  assert.equal(await js('document.getElementById("desktop-update-token").disabled'), true);

  const origin = new URL('/', contents.getURL()).href;
  const directory = process.env.TTC_DOCUMENT_DIRECTORY || path.join(process.env.TTC_DATA_DIRECTORY, 'documents');
  const recipientValues = `Object.fromEntries(${JSON.stringify(Object.keys(recipient))}.map(name =>
    [name, document.querySelector('#organization-settings-form').elements.namedItem(name).value]))`;
  await until(() => js('Boolean(document.querySelector(\'#organization-settings-form input[name="invoice_number_prefix"]\').value)'), 'organization settings loaded');
  if (process.env.TTC_TEST_RESUME === '1') {
    assert.deepEqual(await js(recipientValues), recipient);
    const settings = await (await fetch(new URL('/api/organization/settings', origin))).json();
    for (const [key, value] of Object.entries(recipient)) assert.equal(settings[key], value);
    console.log('DESKTOP_RECIPIENT_CHECK restart');
    const calendarState = JSON.parse(await fs.readFile(path.join(output, 'calendar-state.json'), 'utf8'));
    assert.deepEqual(await (await fetch(new URL('/api/weekly-plan', origin))).json(), calendarState.plan);
    const monthPath = `/api/calendar/${calendarState.year}/${calendarState.month}`;
    assert.deepEqual(await (await fetch(new URL(monthPath, origin))).json(), calendarState.calendar);
    await until(() => js('document.querySelectorAll(".weekly-plan-row").length === 1'), 'weekly plan after restart');
    assert.equal(await js('document.querySelector("[data-plan-hours]").value'), '3');
    assert.equal(await js('document.querySelector("[data-plan-active]").checked'), false);
    console.log('DESKTOP_CALENDAR_CHECK restart');
    assert.deepEqual(new Set(calendarState.calendar.days.flatMap(day => day.trainings.map(training => training.status))),
      new Set(['planned','completed','cancelled']));
    console.log('DESKTOP_STATUS_CHECK restart');
    const invoices = await (await fetch(new URL('/api/invoices', origin))).json();
    assert.equal(invoices.length, 2);
    const january = invoices.find(invoice => invoice.year === 2020 && invoice.month === 1);
    assert.equal(january.total_amount_cents, 6000);
    const url = new URL(`/api/invoices/${january.id}/pdf`, origin).href;
    const pdf = Buffer.from(await (await fetch(url)).arrayBuffer());
    assert.deepEqual(pdf, await fs.readFile(path.join(output, 'recreated.pdf')));
    assert.deepEqual(pdf, await fs.readFile(path.join(directory, 'Rechnung_TTC_2020-01.pdf')));
    const february = invoices.find(invoice => invoice.year === 2020 && invoice.month === 2);
    assert.equal(february.total_amount_cents, 1500);
    assert.deepEqual(Buffer.from(await (await fetch(new URL(`/api/invoices/${february.id}/pdf`, origin))).arrayBuffer()),
      await fs.readFile(path.join(output, 'other-invoice.pdf')));
    const organization = await (await fetch(new URL('/api/organization/settings', origin))).json();
    assert.equal(organization.next_invoice_number, 4);
    await js('document.querySelector("#reload-invoices").click()');
    await until(() => js(`Boolean(document.querySelector('#saved-invoices-rows a[href="/api/invoices/${january.id}/pdf"][target=_blank]'))`), 'archive after restart');
    await js(`document.querySelector('#saved-invoices-rows a[href="/api/invoices/${january.id}/pdf"][target=_blank]').click()`);
    await until(() => handoffs.length === 1, 'PDF handoff after restart');
    assert.deepEqual(handoffs, [url]);
    console.log('DESKTOP_FINAL_CHECK restart');
    if (process.env.TTC_TEST_CRASH === '1') {
      process.stdout.write('DESKTOP_CRASH_READY\n', () => process.kill(process.pid, 'SIGKILL'));
      await new Promise(() => {});
    }
    console.log('DESKTOP_PDF_RESUME ' + JSON.stringify({invoices:2,totalCents:6000,handoffs:1}));
    return;
  }

  await until(() => js('Boolean(document.querySelector("[data-new-date]"))'), 'empty calendar ready');
  await js('document.querySelector("[data-new-date]").click()');
  await until(() => js('document.querySelector("#training-dialog").open && !document.querySelector("#training-error").hidden'), 'missing activity message');
  assert.match(await js('document.querySelector("#training-error").textContent'), /keine Tätigkeitsarten/);
  assert.equal(await js('document.querySelector("#save-training-edit").disabled'), true);
  await js('document.querySelector("#cancel-training-edit").click()');
  await until(() => js('!document.querySelector("#saved-invoices-empty").hidden'), 'empty invoice archive');
  console.log('DESKTOP_EMPTY_CHECK saved');

  const originalSettings = await (await fetch(new URL('/api/organization/settings', origin))).json();
  await js(`const form = document.querySelector('#organization-settings-form');
    form.elements.namedItem('recipient_email').value = 'ungueltig';
    form.requestSubmit();`);
  assert.equal(await js('document.querySelector(\'#organization-settings-form input[name="recipient_email"]\').checkValidity()'), false);
  assert.deepEqual(await (await fetch(new URL('/api/organization/settings', origin))).json(), originalSettings);
  async function saveRecipient(values) {
    await js(`(() => {
      const form = document.querySelector('#organization-settings-form');
      for (const [name, value] of Object.entries(${JSON.stringify(values)})) form.elements.namedItem(name).value = value;
      document.querySelector('#organization-settings-success').hidden = true;
      form.requestSubmit();
    })()`);
    await until(() => js('!document.querySelector("#organization-settings-success").hidden && !document.querySelector("#save-organization-settings").disabled'), 'recipient saved');
    assert.equal(await js('document.querySelector("#organization-settings-error").hidden'), true);
  }
  await saveRecipient(Object.fromEntries(Object.entries({...recipient, recipient_email:'kontakt@example.org'})
    .map(([key, value]) => [key, `  ${value}  `])));
  assert.deepEqual(await js(recipientValues), {...recipient, recipient_email:'kontakt@example.org'});
  await saveRecipient({recipient_email:''});
  const savedSettings = await (await fetch(new URL('/api/organization/settings', origin))).json();
  for (const [key, value] of Object.entries(recipient)) assert.equal(savedSettings[key], value);
  assert.equal(savedSettings.name, originalSettings.name);
  assert.equal(savedSettings.next_invoice_number, originalSettings.next_invoice_number);
  await new Promise(resolve => {
    contents.once('did-finish-load', resolve);
    contents.reload();
  });
  await until(() => js(`JSON.stringify(${recipientValues}) === ${JSON.stringify(JSON.stringify(recipient))}`), 'recipient persisted in form');
  console.log('DESKTOP_RECIPIENT_CHECK saved');

  // Exercise the existing plan form and appointment dialog, without status actions.
  const calendarActivity = (await (await fetch(new URL('/api/settings', origin), {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({activities:[{name:'GUI Wochenplan',hourly_rate_cents:1200}]}),
  })).json()).activities[0];
  await new Promise(resolve => { contents.once('did-finish-load', resolve); contents.reload(); });
  await until(() => js('document.querySelectorAll(".weekly-plan-day").length === 7 && document.querySelector("#calendar").getAttribute("aria-busy") === "false"'), 'calendar and plan ready');
  const firstDate = await js('document.querySelector("#calendar article[aria-label]").getAttribute("aria-label")');
  const [year, month] = firstDate.split('-').map(Number);
  const calendarURL = new URL(`/api/calendar/${year}/${month}`, origin);
  async function savePlan() {
    await js('document.querySelector("#weekly-plan-success").hidden = true; document.querySelector("#weekly-plan-form").requestSubmit()');
    await until(() => js('!document.querySelector("#weekly-plan-success").hidden && !document.querySelector("#save-weekly-plan").disabled && document.querySelector("#calendar").getAttribute("aria-busy") === "false"'), 'weekly plan saved');
    assert.equal(await js('document.querySelector("#weekly-plan-error").hidden'), true);
  }
  await js(`for (const weekday of [0,6]) {
    const day = document.querySelector('.weekly-plan-day[data-weekday="'+weekday+'"]');
    day.querySelector('[data-add-plan-entry]').click();
    day.querySelector('[data-plan-activity]').value = '${calendarActivity.id}';
    day.querySelector('[data-plan-hours]').value = '2';
  }`);
  await savePlan();
  const generatedCalendar = await (await fetch(calendarURL)).json();
  const generatedIds = generatedCalendar.days.flatMap(day => day.trainings.map(training => training.id));
  assert.ok(generatedIds.length >= 8);
  await js('document.querySelector(\'.weekly-plan-day[data-weekday="0"] [data-plan-hours]\').value = "3"');
  await savePlan();
  assert.deepEqual(await (await fetch(calendarURL)).json(), generatedCalendar);
  await js(`document.querySelector('.weekly-plan-day[data-weekday="0"] [data-plan-active]').checked = false;
    document.querySelector('.weekly-plan-day[data-weekday="6"] [data-remove-plan-entry]').click();`);
  await savePlan();
  const plan = await (await fetch(new URL('/api/weekly-plan', origin))).json();
  assert.equal(plan.length, 1);
  assert.equal(plan[0].is_active, 0);
  assert.equal(plan[0].hours, 3);
  const retained = await (await fetch(calendarURL)).json();
  assert.deepEqual(retained.days.flatMap(day => day.trainings.map(training => training.id)), generatedIds);

  const openNew = async () => {
    await js(`document.querySelector('[data-new-date="${firstDate}"]').click()`);
    await until(() => js('document.querySelector("#training-dialog").open && !document.querySelector("#save-training-edit").disabled'), 'appointment dialog');
  };
  await openNew();
  await js('document.querySelector("#training-note").value = "Nicht speichern"; document.querySelector("#cancel-training-edit").click()');
  assert.deepEqual(await (await fetch(calendarURL)).json(), retained);
  await openNew();
  await js(`document.querySelector('#training-activity').value = '${calendarActivity.id}';
    document.querySelector('#training-hours').value = '2';
    document.querySelector('#training-note').value = 'GUI Kalendertermin';
    document.querySelector('#training-form').requestSubmit();`);
  await until(() => js('!document.querySelector("#training-dialog").open && document.querySelector("#calendar").getAttribute("aria-busy") === "false"'), 'new appointment saved');
  const manual = (await (await fetch(calendarURL)).json()).days.flatMap(day => day.trainings).find(training => training.note === 'GUI Kalendertermin');
  assert.ok(manual);
  assert.equal(manual.hours, 2);
  const inactiveResponse = await fetch(new URL('/api/settings', origin), {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({activities:[{id:calendarActivity.id,name:calendarActivity.name,hourly_rate_cents:1200,is_active:false}]}),
  });
  assert.equal(inactiveResponse.status, 200);
  await js(`Array.from(document.querySelectorAll('[data-training]')).find(button => JSON.parse(button.dataset.training).id === ${manual.id}).click()`);
  await until(() => js('!document.querySelector("#save-training-edit").disabled'), 'appointment editor ready');
  await js(`document.querySelector('#training-hours').value = '';
    document.querySelector('#training-note').value = 'GUI Termin geändert';
    document.querySelector('#training-form').requestSubmit();`);
  await until(() => js('!document.querySelector("#training-dialog").open && document.querySelector("#calendar").getAttribute("aria-busy") === "false"'), 'appointment edit saved');
  const calendar = await (await fetch(calendarURL)).json();
  const editedManual = calendar.days.flatMap(day => day.trainings).find(training => training.id === manual.id);
  assert.equal(editedManual.hours, null);
  assert.equal(editedManual.note, 'GUI Termin geändert');
  assert.equal(editedManual.status, manual.status);
  await js('document.querySelector("#next-month").click()');
  await until(() => js(`document.querySelector('#calendar').getAttribute('aria-busy') === 'false' && document.querySelector('#calendar article[aria-label]').getAttribute('aria-label') !== '${firstDate}'`), 'next calendar month');
  await js('document.querySelector("#previous-month").click()');
  await until(() => js(`document.querySelector('#calendar').getAttribute('aria-busy') === 'false' && document.querySelector('#calendar article[aria-label]').getAttribute('aria-label') === '${firstDate}'`), 'return to calendar month');
  assert.deepEqual(await (await fetch(calendarURL)).json(), calendar);

  const trainingButton = id => `Array.from(document.querySelectorAll('[data-training]')).find(button => JSON.parse(button.dataset.training).id === ${id})`;
  const waitStatus = (id, status) => until(() => js(`(() => {
    const button = ${trainingButton(id)};
    return button && JSON.parse(button.dataset.training).status === '${status}'
      && document.querySelector('#calendar').getAttribute('aria-busy') === 'false';
  })()`), `appointment ${id}: ${status}`);
  const clickCompletion = id => js(`${trainingButton(id)}.parentElement.querySelector('[data-training-completion]').click()`);
  const clickCancelled = id => js(`${trainingButton(id)}.parentElement.querySelector('[data-training-cancelled]').click()`);
  // Force a real API storage failure; only the disposable test database moves.
  const database = path.join(process.env.TTC_DATA_DIRECTORY, 'ttc.db');
  const heldDatabase = path.join(output, 'temporarily-unavailable.db');
  expectedHTTPFailure = 503;
  await fs.rename(database, heldDatabase);
  try {
    await clickCompletion(manual.id);
    await until(() => js(`!document.querySelector('#calendar-error').hidden &&
      !${trainingButton(manual.id)}.parentElement.querySelector('[data-training-completion]').disabled`), 'failed status save');
    assert.equal(await js(`${trainingButton(manual.id)}.parentElement.querySelector('[data-training-completion]').checked`), false);
  } finally {
    await fs.rename(heldDatabase, database);
    expectedHTTPFailure = null;
  }
  assert.deepEqual(await (await fetch(calendarURL)).json(), calendar);
  await clickCompletion(manual.id);
  await waitStatus(manual.id, 'completed');
  assert.equal(await js('document.querySelector("#calendar-error").hidden'), true);
  await clickCompletion(manual.id);
  await waitStatus(manual.id, 'planned');
  await clickCancelled(manual.id);
  await waitStatus(manual.id, 'cancelled');
  assert.equal(await js(`${trainingButton(manual.id)}.parentElement.querySelector('[data-training-completion]').disabled`), true);
  assert.equal(await js(`${trainingButton(manual.id)}.parentElement.querySelector('[data-training-cancelled]').disabled`), true);
  await js(`${trainingButton(manual.id)}.click()`);
  await until(() => js('!document.querySelector("#save-training-edit").disabled'), 'cancelled appointment editor');
  await js(`const status = document.querySelector('#training-status'); status.value = 'planned';
    status.dispatchEvent(new Event('change', {bubbles:true})); document.querySelector('#training-form').requestSubmit();`);
  await waitStatus(manual.id, 'planned');
  await clickCancelled(manual.id);
  await waitStatus(manual.id, 'cancelled');

  const cancelledGenerated = calendar.days.flatMap(day => day.trainings).find(training => training.weekly_plan_id === plan[0].id);
  await clickCancelled(cancelledGenerated.id);
  await waitStatus(cancelledGenerated.id, 'cancelled');
  const beforeCompletion = await (await fetch(calendarURL)).json();
  await js('window.confirm = () => false; document.querySelector("#complete-month").click()');
  assert.deepEqual(await (await fetch(calendarURL)).json(), beforeCompletion);
  const eligible = beforeCompletion.days.flatMap(day => day.trainings)
    .filter(training => training.weekly_plan_id === plan[0].id && training.status === 'planned');
  assert.ok(eligible.length > 0);
  async function completeMonth(count) {
    await js('window.confirm = () => true; document.querySelector("#calendar-success").hidden = true; document.querySelector("#complete-month").click()');
    await until(() => js('!document.querySelector("#calendar-success").hidden && !document.querySelector("#complete-month").disabled && document.querySelector("#calendar").getAttribute("aria-busy") === "false"'), 'month completion');
    assert.match(await js('document.querySelector("#calendar-success").textContent'), new RegExp(`^${count} Termin`));
  }
  await completeMonth(eligible.length);
  await completeMonth(0);
  const finalCalendar = await (await fetch(calendarURL)).json();
  const eligibleIds = new Set(eligible.map(training => training.id));
  for (const training of finalCalendar.days.flatMap(day => day.trainings)) {
    const before = beforeCompletion.days.flatMap(day => day.trainings).find(item => item.id === training.id);
    assert.deepEqual(training, {...before, status:eligibleIds.has(training.id) ? 'completed' : before.status});
  }
  console.log('DESKTOP_STATUS_CHECK saved');
  await fs.writeFile(path.join(output, 'calendar-state.json'), JSON.stringify({year,month,plan,calendar:finalCalendar}));
  console.log('DESKTOP_CALENDAR_CHECK saved');

  const previewReady = `!document.querySelector('#invoice-preview').hidden &&
    document.querySelector('#invoice-preview-form').getAttribute('aria-busy') === 'false'`;
  async function startPreview(period) {
    const loading = await js(`(() => {
      const month = document.querySelector('#invoice-month');
      month.value = '${period}'; month.dispatchEvent(new Event('input', {bubbles:true}));
      document.querySelector('#invoice-preview-form').requestSubmit();
      return {
        busy:document.querySelector('#invoice-preview-form').getAttribute('aria-busy') === 'true',
        monthDisabled:month.disabled,
        submitDisabled:document.querySelector('#load-invoice-preview').disabled,
        createDisabled:document.querySelector('#create-invoice').disabled,
        loadingVisible:!document.querySelector('#invoice-preview-status').hidden,
      };
    })()`);
    assert.deepEqual(loading, {busy:true,monthDisabled:true,submitDisabled:true,createDisabled:true,loadingVisible:true});
  }
  async function loadPreview(period) {
    await startPreview(period);
    await until(() => js(previewReady), 'preview loaded');
    assert.equal(await js('document.querySelector("#invoice-month").disabled || document.querySelector("#load-invoice-preview").disabled'), false);
  }
  const sequenceBeforePreview = (await (await fetch(new URL('/api/organization/settings', origin))).json()).next_invoice_number;
  for (const [period, title] of [['0001-01', 'Januar 1'], ['0099-12', 'Dezember 99'], ['2020-03', 'März 2020']]) {
    await loadPreview(period);
    const actualTitle = await js('document.querySelector("#invoice-period-title").textContent');
    assert.ok(actualTitle.endsWith(title), actualTitle);
    assert.equal(await js('document.querySelectorAll("#invoice-items tr").length'), 0);
    assert.equal(await js('document.querySelector("#invoice-empty").hidden'), false);
    assert.equal(await js('document.querySelector("#create-invoice").disabled'), true);
  }
  const zeroActivity = (await (await fetch(new URL('/api/settings', origin), {
    method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({activities:[{name:'GUI Kostenfrei <Prüfung>',hourly_rate_cents:0}]}),
  })).json()).activities.find(activity => activity.name === 'GUI Kostenfrei <Prüfung>');
  const zeroTraining = await fetch(new URL('/api/trainings', origin), {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({training_date:'2020-03-15',activity_type_id:zeroActivity.id,status:'completed'}),
  });
  assert.equal(zeroTraining.status, 201);
  await loadPreview('2020-03');
  assert.equal(await js('document.querySelectorAll("#invoice-items tr").length'), 1);
  assert.equal(await js('document.querySelector("#invoice-items th").textContent'), 'GUI Kostenfrei <Prüfung>');
  assert.equal(await js('document.querySelector("#invoice-items tr").children[2].textContent'), '–');
  assert.match(await js('document.querySelector("#invoice-total").textContent'), /0,00/);
  assert.equal(await js('document.querySelector("#invoice-empty").hidden'), true);
  assert.equal(await js('document.querySelector("#create-invoice").disabled'), false);
  assert.deepEqual(await (await fetch(new URL('/api/invoices', origin))).json(), []);
  assert.equal((await (await fetch(new URL('/api/organization/settings', origin))).json()).next_invoice_number, sequenceBeforePreview);
  const previewDocuments = await fs.readdir(directory).catch(error => {
    assert.equal(error.code, 'ENOENT');
    return [];
  });
  assert.deepEqual(previewDocuments, []);

  expectedHTTPFailure = 503;
  await fs.rename(database, heldDatabase);
  try {
    await startPreview('2020-03');
    await until(() => js(`!document.querySelector('#invoice-preview-error').hidden &&
      document.querySelector('#invoice-preview-form').getAttribute('aria-busy') === 'false'`), 'preview save error');
    assert.equal(await js('document.querySelector("#invoice-preview").hidden && document.querySelector("#create-invoice").disabled'), true);
    assert.equal(await js('document.querySelector("#invoice-month").disabled || document.querySelector("#load-invoice-preview").disabled'), false);
  } finally {
    await fs.rename(heldDatabase, database);
    expectedHTTPFailure = null;
  }
  await loadPreview('2020-03');
  assert.equal(await js('document.querySelector("#invoice-preview-error").hidden'), true);
  console.log('DESKTOP_PREVIEW_CHECK saved');

  const seed = await js(`(async () => {
    async function request(url, body) {
      const response = await fetch(url, {method: url === '/api/settings' ? 'PUT' : 'POST',
        headers: {'Content-Type':'application/json'}, body:JSON.stringify(body)});
      if (!response.ok) throw Error('Test setup HTTP ' + response.status);
      return response.json();
    }
    const settings = await request('/api/settings', {activities:[{name:'Electron Testtraining',hourly_rate_cents:1500}]});
    const invoiceActivity = settings.activities.find(activity => activity.name === 'Electron Testtraining');
    if (!invoiceActivity) throw Error('Invoice test activity missing');
    let completedId;
    for (const status of ['completed','planned','cancelled']) {
      const training = await request('/api/trainings', {training_date:'2020-01-15',activity_type_id:invoiceActivity.id,hours:2,status});
      if (status === 'completed') completedId = training.id;
    }
    for (const training_date of ['2019-12-31', '2020-04-01']) {
      await request('/api/trainings', {training_date,activity_type_id:invoiceActivity.id,hours:99,status:'completed'});
    }
    const month = document.querySelector('#invoice-month');
    month.value='2020-01'; month.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#invoice-preview-form').requestSubmit();
    return {completedId,activityId:invoiceActivity.id};
  })()`);
  await until(() => js(previewReady), 'invoice preview');
  assert.equal(await js('document.querySelectorAll("#invoice-items tr").length'), 1);
  assert.match(await js('document.querySelector("#invoice-items").textContent'), /Electron Testtraining/);
  assert.match(await js('document.querySelector("#invoice-total").textContent'), /30,00/);
  assert.equal(await js('document.querySelector("#create-invoice").disabled'), false);
  for (const status of ['planned', 'cancelled']) {
    const changed = await fetch(new URL(`/api/trainings/${seed.completedId}`, origin), {
      method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status}),
    });
    assert.equal(changed.status, 200);
    await loadPreview('2020-01');
    assert.equal(await js('document.querySelectorAll("#invoice-items tr").length'), 0);
    assert.equal(await js('document.querySelector("#invoice-empty").hidden'), false);
    assert.equal(await js('document.querySelector("#create-invoice").disabled'), true);
  }
  assert.equal((await fetch(new URL(`/api/trainings/${seed.completedId}`, origin), {
    method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'completed'}),
  })).status, 200);
  await loadPreview('2020-01');
  assert.equal(await js('document.querySelectorAll("#invoice-items tr").length'), 1);
  assert.match(await js('document.querySelector("#invoice-total").textContent'), /30,00/);
  console.log('DESKTOP_BILLABLE_CHECK saved');
  await js(`(async () => {
    document.querySelector('#invoice-preview').scrollIntoView({behavior:'instant',block:'center'});
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  await fs.writeFile(path.join(output, 'preview.png'), (await contents.capturePage()).toPNG());

  await js(`(async () => {
    const response = await fetch('/api/trainings/${seed.completedId}', {method:'PUT',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({hours:3})});
    if (!response.ok) throw Error('Training update failed');
    document.querySelector('#invoice-preview-form').requestSubmit();
  })()`);
  await until(() => js(previewReady), 'updated preview');
  assert.match(await js('document.querySelector("#invoice-total").textContent'), /45,00/);
  // A file in place of the document directory must produce a visible, useful
  // error and allow retry after the obstruction is removed.
  await fs.writeFile(directory, 'test obstruction');
  expectedHTTPFailure = 503;
  await js('document.querySelector("#create-invoice").click()');
  await until(() => js(`!document.querySelector('#invoice-create-error').hidden &&
    !document.querySelector('#create-invoice').disabled`), 'visible write error');
  const failureText = await js('document.querySelector("#invoice-create-error").textContent');
  assert.match(failureText, /nicht gespeichert.*ungültig/);
  assert.equal(failureText.includes(directory), false);
  await fs.unlink(directory);
  expectedHTTPFailure = null;
  await js(`(() => {
    const button = document.querySelector('#create-invoice');
    button.click(); button.click();
  })()`);
  await until(() => js('!document.querySelector("#open-invoice-pdf").hidden'), 'finalization');
  const url = await js('document.querySelector("#open-invoice-pdf").href');
  assert.match(url, /\/api\/invoices\/[1-9]\d*\/pdf$/);
  const invoiceId = Number(new URL(url).pathname.split('/')[3]);
  // The archive must update in the same renderer, without reload or restart.
  await until(() => js(`Boolean(document.querySelector('#saved-invoices-rows a[href="/api/invoices/${invoiceId}/pdf"][target=_blank]'))`), 'archive immediately after finalization');
  assert.equal(await js('document.querySelector("#create-invoice").getAttribute("aria-busy")'), 'false');
  assert.equal(await js('document.querySelector("#create-invoice").textContent'), 'Rechnung gespeichert');
  assert.equal(await js('getComputedStyle(document.querySelector("#create-invoice")).cursor'), 'default');
  const originalInvoice = (await (await fetch(new URL('/api/invoices', url))).json()).find(invoice => invoice.id === invoiceId);
  assert.equal(originalInvoice.total_amount_cents, 4500);
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
  assert.equal(await js('document.querySelector("#create-invoice").disabled'), true);
  await loadPreview('2020-03');
  assert.equal(await js('document.querySelector("#open-invoice-pdf").hidden && document.querySelector("#download-invoice-pdf").hidden'), true);
  await loadPreview('2020-01');
  assert.equal(await js('document.querySelector("#open-invoice-pdf").hidden && document.querySelector("#download-invoice-pdf").hidden'), true);
  assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), pdf);

  // Change the source after finalization: only the new preview may change.
  await js(`(async () => {
    const response = await fetch('/api/trainings/${seed.completedId}', {method:'PUT',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({hours:4})});
    if (!response.ok) throw Error('Training update failed');
    document.querySelector('#invoice-preview-form').requestSubmit();
  })()`);
  await until(() => js(previewReady), 'renewed preview');
  assert.match(await js('document.querySelector("#invoice-total").textContent'), /60,00/);
  assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), pdf);
  expectedHTTPFailure = 409;
  await js('document.querySelector("#create-invoice").click()');
  await until(() => js(`!document.querySelector('#invoice-create-error').hidden &&
    !document.querySelector('#create-invoice').disabled`), 'duplicate invoice rejection');
  assert.match(await js('document.querySelector("#invoice-create-error").textContent'), /bereits/);
  expectedHTTPFailure = null;
  assert.deepEqual(await fs.readFile(path.join(directory, filename)), pdf);
  const loaded = new Promise(resolve => contents.once('did-finish-load', resolve));
  contents.reload();
  await loaded;
  await until(() => js('Boolean(document.querySelector("#invoice-month")?.value)'), 'renderer reload');
  await js('document.querySelector("#reload-invoices").click()');
  await until(() => js('Boolean(document.querySelector("#saved-invoices-rows a[target=_blank]"))'), 'invoice archive');
  await js('document.querySelector("#saved-invoices-rows a[target=_blank]").click()');
  await until(() => handoffs.length === 2, 'archive browser handoff');
  assert.deepEqual(handoffs, [url, url]);

  const other = await js(`(async () => {
    const training = await fetch('/api/trainings', {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({training_date:'2020-02-15',activity_type_id:${seed.activityId},hours:1,status:'completed'})});
    if (!training.ok) throw Error('Second month setup failed');
    const invoice = await fetch('/api/invoices', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({year:2020,month:2})});
    if (invoice.status !== 201) throw Error('Second invoice setup failed');
    return invoice.json();
  })()`);
  const otherUrl = new URL(`/api/invoices/${other.id}/pdf`, url).href;
  const otherPDF = Buffer.from(await (await fetch(otherUrl)).arrayBuffer());
  await fs.writeFile(path.join(output, 'other-invoice.pdf'), otherPDF);
  await js('document.querySelector("#reload-invoices").click()');
  await until(() => js('document.querySelectorAll("#saved-invoices-rows tr").length === 2'), 'two archived invoices');
  // Controlled answers test both confirmation paths without opening native dialogs.
  await js(`window.__confirmCount = 0; window.confirm = () => { window.__confirmCount++; return false; };
    document.querySelector('[data-delete-invoice="${invoiceId}"]').click()`);
  assert.equal(await js('window.__confirmCount'), 1);
  assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), pdf);
  const numberBeforeDelete = (await (await fetch(new URL('/api/organization/settings', origin))).json()).next_invoice_number;
  expectedHTTPFailure = 503;
  await fs.rename(database, heldDatabase);
  try {
    await js(`window.confirm = () => { window.__confirmCount++; return true; };
      document.querySelector('[data-delete-invoice="${invoiceId}"]').click()`);
    await until(() => js(`!document.querySelector('#saved-invoices-error').hidden &&
      !document.querySelector('[data-delete-invoice="${invoiceId}"]').disabled`), 'failed invoice deletion');
  } finally {
    await fs.rename(heldDatabase, database);
    expectedHTTPFailure = null;
  }
  assert.equal(await js('window.__confirmCount'), 2);
  assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), pdf);
  assert.equal((await (await fetch(new URL('/api/organization/settings', origin))).json()).next_invoice_number, numberBeforeDelete);
  await js(`window.confirm = () => { window.__confirmCount++; return true; };
    document.querySelector('[data-delete-invoice="${invoiceId}"]').click()`);
  await until(() => js(`!document.querySelector('[data-delete-invoice="${invoiceId}"]')`), 'confirmed invoice deletion');
  assert.equal(await js('window.__confirmCount'), 3);
  assert.equal(await js('document.querySelector("#saved-invoices-error").hidden'), true);
  assert.equal((await fetch(url)).status, 404);
  await assert.rejects(fs.stat(path.join(directory, filename)), {code:'ENOENT'});
  assert.deepEqual(Buffer.from(await (await fetch(otherUrl)).arrayBuffer()), otherPDF);
  assert.deepEqual(await fs.readFile(path.join(directory, 'Rechnung_TTC_2020-02.pdf')), otherPDF);

  await js(`const month = document.querySelector('#invoice-month'); month.value='2020-01';
    month.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('#invoice-preview-form').requestSubmit()`);
  await until(() => js(previewReady), 'preview after deletion');
  assert.equal(await js('document.querySelectorAll("#invoice-items tr").length'), 1);
  assert.match(await js('document.querySelector("#invoice-total").textContent'), /60,00/);
  // Saving succeeded even if the subsequent archive request fails. Keep the
  // success state and duplicate guard; the archive offers its existing retry.
  await js(`(() => {
    const originalFetch = window.fetch;
    window.fetch = (...args) => {
      if (args[0] === '/api/invoices' && (!args[1] || args[1].method === 'GET')) {
        window.fetch = originalFetch;
        return Promise.resolve(new Response(JSON.stringify({detail:'Rechnungsliste vorübergehend nicht verfügbar.'}),
          {status:503,headers:{'Content-Type':'application/json'}}));
      }
      return originalFetch(...args);
    };
  })()`);
  await js('document.querySelector("#create-invoice").click()');
  await until(() => js('!document.querySelector("#open-invoice-pdf").hidden'), 'refinalization');
  await until(() => js('!document.querySelector("#saved-invoices-error").hidden'), 'archive refresh error after saving');
  assert.match(await js('document.querySelector("#saved-invoices-error").textContent'), /vorübergehend nicht verfügbar/);
  assert.equal(await js('document.querySelector("#create-invoice").getAttribute("aria-busy")'), 'false');
  assert.equal(await js('document.querySelector("#create-invoice").textContent'), 'Rechnung gespeichert');
  assert.equal(await js('document.querySelector("#create-invoice").disabled && document.querySelector("#invoice-create-error").hidden'), true);
  assert.equal(await js('document.querySelector("#reload-invoices").disabled'), false);
  await js('document.querySelector("#reload-invoices").click()');
  await until(() => js('document.querySelectorAll("#saved-invoices-rows tr").length === 2 && !document.querySelector("#reload-invoices").disabled'), 'archive retry after saving');
  assert.equal(await js('document.querySelector("#saved-invoices-error").hidden'), true);
  const recreatedUrl = await js('document.querySelector("#open-invoice-pdf").href');
  const recreated = Buffer.from(await (await fetch(recreatedUrl)).arrayBuffer());
  assert.equal(recreated.subarray(0,5).toString(), '%PDF-');
  assert.notDeepEqual(recreated, pdf);
  assert.deepEqual(await fs.readFile(path.join(directory, filename)), recreated);
  assert.deepEqual(await fs.readFile(path.join(output, 'download.pdf')), pdf);
  await fs.writeFile(path.join(output, 'recreated.pdf'), recreated);
  const invoices = await (await fetch(new URL('/api/invoices', url))).json();
  assert.equal(invoices.length, 2);
  const january = invoices.find(invoice => invoice.year === 2020 && invoice.month === 1);
  assert.equal(january.total_amount_cents, 6000);
  assert.notEqual(january.invoice_number, originalInvoice.invoice_number);
  assert.equal((await (await fetch(new URL('/api/organization/settings', url))).json()).next_invoice_number, 4);
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  assert.equal(contents.getURL(), new URL('/', url).href);
  assert.deepEqual(errors, []);
  expectedHTTPFailure = 503;
  await js(`document.querySelector('#backup-directory').value='relative'; document.querySelector('#create-backup').click()`);
  await until(() => js(`!document.querySelector('#create-backup').disabled && document.querySelector('#backup-message').textContent.includes('fehlgeschlagen')`), 'invalid backup target');
  expectedHTTPFailure = null;
  await js(`document.querySelector('#backup-directory').value=${JSON.stringify(path.join(output, 'backups'))}; document.querySelector('#create-backup').click()`);
  await until(() => js(`!document.querySelector('#create-backup').disabled && document.querySelector('#backup-message').textContent.startsWith('Sicherung erstellt:')`), 'complete backup UI');
  const exportDownload = new Promise((resolve, reject) => {
    contents.session.once('will-download', (_event, item) => {
      item.setSavePath(path.join(output, 'export.zip'));
      item.once('done', (_done, state) => state === 'completed' ? resolve() : reject(new Error(state)));
    });
  });
  await js(`document.querySelector('#export-data').click()`);
  await exportDownload;
  await until(() => js(`!document.querySelector('#export-data').disabled`), 'export UI');
  assert.ok((await fs.stat(path.join(output, 'export.zip'))).size > 1000);
  console.log('DESKTOP_BACKUP_CHECK saved');
  console.log('DESKTOP_FINAL_CHECK saved');
  console.log('DESKTOP_PDF_CHECK ' + JSON.stringify({previewRows:1,totalCents:4500,handoffs:2,
    pdfBytes:pdf.length,errorRecovery:true,lifecycle:true,refinalizedTotalCents:6000}));
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
