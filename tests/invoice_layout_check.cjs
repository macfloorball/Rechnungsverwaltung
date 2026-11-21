'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, dialog } = require('electron');
app.setPath('userData', process.env.TTC_DATA_DIRECTORY);
app.setPath('sessionData', process.env.TTC_DATA_DIRECTORY);
dialog.showErrorBox = (_title, message) => { throw Error(message); };
require('./electron/main.cjs');
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
async function until(check, label) {
  for (let i = 0; i < 400; i++) { const result = await check(); if (result) return result; await pause(); }
  throw Error(`Timeout: ${label}`);
}
async function run() {
  await app.whenReady();
  const win = await until(() => BrowserWindow.getAllWindows()[0], 'window');
  const contents = win.webContents;
  const js = code => contents.executeJavaScript(code, true);
  await until(() => !contents.isLoading() && contents.getURL().startsWith('http:'), 'frontend');
  await until(() => js('!document.querySelector("#save-organization-settings").disabled && !document.querySelector("#counter-save").disabled'), 'settings');
  if (process.env.TTC_TEST_RESUME === '1') {
    assert.equal(await js('document.querySelector("[name=tax_id]").value'), 'ID gespeichert');
    console.log('INVOICE_LAYOUT_RESTART_OK'); return;
  }
  await js('document.querySelector("[data-view-link=invoice]").click()');
  assert.match(await js('document.querySelector("#invoice-date").value'), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(await js('document.querySelectorAll("[name=payment_due_days], [name=invoice_number_prefix]").length'), 0);
  await js(`document.querySelector('[name=recipient_salutation]').value='Herr';document.querySelector('[name=recipient_contact_name]').value='Max Mustermann';document.querySelector('[name=tax_id]').value='ID gespeichert';document.querySelector('[name=iban]').value='GB82 WEST 1234 5698 7654 32';document.querySelector('#organization-settings-form').requestSubmit();`);
  await until(() => js('!document.querySelector("#organization-settings-success").hidden'), 'save tax');
  assert.equal(await js('document.querySelector("[name=iban]").value'), 'GB82 WEST 1234 5698 7654 32');
  await js(`document.querySelector('#counter-year').value='2026';document.querySelector('#counter-year').dispatchEvent(new Event('input'));document.querySelector('#counter-load').click()`);
  await until(() => js('!document.querySelector("#counter-save").disabled'), 'counter loaded');
  await js(`document.querySelector('#counter-next').value='100';document.querySelector('#invoice-counter-form').requestSubmit()`);
  await until(() => js('document.querySelector("#counter-message").textContent === "Nummernkreis gespeichert."'), 'counter saved');
  await js('document.querySelector("[name=recipient_contact_name]").scrollIntoView({block:"center"})');
  await pause();
  await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT, 'recipient-contact.png'), (await contents.capturePage()).toPNG());
  const origin = new URL('/', contents.getURL()).href;
  async function api(url, body, method = 'POST') {
    const response = await fetch(new URL(url, origin), { method, headers: {'Content-Type':'application/json'}, body: body ? JSON.stringify(body) : undefined });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  }
  const activity = (await api('/api/settings', {activities:[{name:'Training mit mehrzeiliger Beschreibung für die Prüfung des Rechnungslayouts',hourly_rate_cents:1500}]}, 'PUT')).activities[0];
  for (const month of [1,2,3,4]) await api('/api/trainings', {training_date:`2025-0${month}-02`,activity_type_id:activity.id,hours:2,status:'completed'});
  for (const [index, variant] of ['short','long','empty'].entries()) {
    const fields = variant === 'empty' ? {tax_id:'',iban:'',account_holder:'',bank_name:'',tax_number:'',vat_id:'',name:''}
      : {tax_id:variant === 'long' ? 'Steuerkennung'.repeat(7) : '12345678901',
         name:variant === 'long' ? 'Verein mit einem sehr langen Namen und mehreren Abteilungen '.repeat(3) : 'Beispielverein',
         account_holder:variant === 'long' ? 'Kontoinhaber mit langem Namen '.repeat(6) : 'Max Beispiel',
         bank_name:variant === 'long' ? 'Internationale Bank '.repeat(8) : 'Beispielbank',
         iban:'GB82 WEST 1234 5698 7654 32'};
    await api('/api/organization/settings', fields, 'PUT');
    const period = {year:2025,month:index+1,invoice_date:'2026-01-02'};
    for(let i=0;i<2;i++) assert.equal((await api('/api/invoices/preview',period)).invoice_number, `2026-${100+index}`);
    const invoice = await api('/api/invoices', period);
    assert.equal(invoice.invoice_number, `2026-${100+index}`);
    const pdf = await fetch(new URL(`/api/invoices/${invoice.id}/pdf`, origin));
    assert.ok(pdf.ok);
    await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT, `${variant}.pdf`), Buffer.from(await pdf.arrayBuffer()));
  }
  await js(`document.querySelector('#counter-next').value='100';document.querySelector('#invoice-counter-form').requestSubmit()`);
  await until(() => js('document.querySelector("#counter-message").textContent.includes("frühestens")'), 'counter collision');
  assert.equal(await js('document.querySelector("#counter-next").value'), '100');
  await js('document.querySelector("#counter-load").click()');
  await until(() => js('document.querySelector("#counter-next").value === "103"'), 'counter refresh');
  await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT, 'invoice_layout.png'), (await contents.capturePage()).toPNG());
  await api('/api/organization/settings', {tax_id:'ID gespeichert'}, 'PUT');
  await js(`document.dispatchEvent(new CustomEvent('calendar-month-changed',{detail:{year:2025,month:4}}));document.querySelector('#invoice-date').value='2027-01-01';document.querySelector('#invoice-date').dispatchEvent(new Event('input'));document.querySelector('#invoice-preview-form').requestSubmit()`);
  await until(() => js('!document.querySelector("#invoice-preview").hidden'), 'preview');
  assert.match(await js('document.querySelector("#invoice-preview-details").textContent'), /Steuer ID: ID gespeichert/);
  assert.match(await js('document.querySelector("#invoice-preview-details").textContent'), /Rechnungsdatum: 2027-01-01/);
  assert.equal((await api('/api/organization/settings', undefined, 'GET')).recipient_contact_name, 'Max Mustermann');
  await js('document.querySelector("[data-view-link=calendar]").click()');
  await pause();
  await js('document.querySelector("#invoice-preview-form").scrollIntoView({block:"start"})');
  await pause();
  assert.equal(await js('document.querySelector("#invoice-preview-form").scrollWidth <= document.querySelector("#invoice-preview-form").clientWidth'), true);
  await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT, 'invoice_layout-preview.png'), (await contents.capturePage()).toPNG());
  await js('document.querySelector("#create-invoice").click()');
  await until(() => js('!document.querySelector("#open-invoice-pdf").hidden'), 'manual date saved');
  const saved = (await api('/api/invoices', undefined, 'GET')).find(invoice => invoice.month === 4);
  assert.equal(saved.invoice_date, '2027-01-01');
  assert.equal(saved.invoice_number, '2027-01');
  const manualPdf = await fetch(new URL(`/api/invoices/${saved.id}/pdf`, origin));
  assert.ok(manualPdf.ok);
  await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT, 'manual-date.pdf'), Buffer.from(await manualPdf.arrayBuffer()));
  console.log('INVOICE_LAYOUT_OK');
}
run().then(() => app.quit()).catch(error => {console.error(error);app.exit(1);});
