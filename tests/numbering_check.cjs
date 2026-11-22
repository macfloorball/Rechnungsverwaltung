'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {app, BrowserWindow, dialog} = require('electron');
app.setPath('userData', process.env.TTC_DATA_DIRECTORY);
app.setPath('sessionData', process.env.TTC_DATA_DIRECTORY);
dialog.showErrorBox = (_title, message) => { throw Error(message); };
require('./electron/main.cjs');
const pause = () => new Promise(resolve => setTimeout(resolve,40));
async function until(check,label) {
  for(let n=0;n<400;n++) { const value=await check(); if(value)return value; await pause(); }
  throw Error(`Timeout: ${label}`);
}
async function run() {
  await app.whenReady();
  const win=await until(()=>BrowserWindow.getAllWindows()[0],'window');
  const contents=win.webContents;
  const js=code=>contents.executeJavaScript(code,true);
  await until(()=>!contents.isLoading() && contents.getURL().startsWith('http:'),'frontend');
  await until(()=>js(`!document.querySelector('#active-profile').disabled && !document.querySelector('#save-organization-settings').disabled`),'loaded');
  const origin = new URL('/', contents.getURL()).href;
  async function api(url, body, method='POST') {
    const response=await fetch(new URL(url,origin),{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    assert.ok(response.ok, await response.clone().text());
    return response.status===204 ? null : response.json();
  }
  if(process.env.TTC_TEST_RESUME==='1') {
    const invoices=await api('/api/invoices',undefined,'GET');
    assert.deepEqual(invoices.map(invoice=>invoice.invoice_number).sort(),['2026-01','2026-02','2026-03']);
    assert.equal((await api('/api/organization/invoice-counter/2026',undefined,'GET')).invoice_number,'2026-04');
    console.log('NUMBERING_RESTART_OK');return;
  }
  const a=(await api('/api/settings',{activities:[{name:'Isoliertes Testtraining',hourly_rate_cents:1500}]},'PUT')).activities[0];
  await api('/api/organization/settings',{name:'Historischer Testverein',invoice_number_prefix:'RE'},'PUT');
  for(const month of [1,2,3]) await api('/api/trainings',{training_date:`2025-0${month}-02`,activity_type_id:a.id,hours:1,status:'completed'});
  await api('/api/invoices',{year:2025,month:1,invoice_date:'2026-01-02'});
  const wrong=await api('/api/invoices',{year:2025,month:2,invoice_date:'2026-02-02',invoice_number:'2026-04'});
  await js(`document.querySelector('[data-view-link=invoice]').click(); document.querySelector('#reload-invoices').click(); document.querySelector('#counter-year').value='2026';document.querySelector('#counter-load').click();`);
  await until(()=>js(`document.querySelector('#counter-message').textContent.includes('Lücken') && document.querySelectorAll('#counter-records button').length===2`),'gap explanation');
  await js(`document.querySelector('#counter-records [data-correct-invoice="${wrong.id}"]').click()`);
  await until(()=>js(`document.querySelector('#invoice-number-dialog').open`),'correction dialog');
  assert.equal(await js('document.activeElement.id'),'corrected-invoice-number');
  await new Promise(resolve=>setTimeout(resolve,200));
  await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT,'number-correction-dialog.png'),(await contents.capturePage()).toPNG());
  await js(`document.querySelector('#cancel-number-correction').click()`);
  assert.equal((await api('/api/invoices',undefined,'GET')).find(invoice=>invoice.id===wrong.id).invoice_number,'2026-04');
  await js(`document.querySelector('#counter-records [data-correct-invoice="${wrong.id}"]').click();document.querySelector('#corrected-invoice-number').value='2026-02';document.querySelector('#confirm-number-correction').checked=true;document.querySelector('#invoice-number-form').requestSubmit();`);
  await until(()=>js(`!document.querySelector('#invoice-number-dialog').open && document.querySelector('#counter-message').textContent.includes('2026-03')`),'corrected and counter refreshed');
  const pdf=await fetch(new URL(`/api/invoices/${wrong.id}/pdf`,origin));
  assert.ok(pdf.ok);
  await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT,'corrected.pdf'),Buffer.from(await pdf.arrayBuffer()));
  // Actual renderer preview, manual override, invalidation and finalization.
  await js(`document.querySelector('[data-view-link=calendar]').click();document.dispatchEvent(new CustomEvent('calendar-month-changed',{detail:{year:2025,month:3}}));document.querySelector('#invoice-date').value='2026-03-02';document.querySelector('#invoice-date').dispatchEvent(new Event('input'));document.querySelector('#invoice-preview-form').requestSubmit();`);
  await until(()=>js(`!document.querySelector('#invoice-preview').hidden`),'automatic preview');
  assert.match(await js(`document.querySelector('#invoice-preview-details').textContent`),/Automatischer Vorschlag: 2026-03/);
  await js(`document.querySelector('#manual-invoice-number').value='RE-2026-03';document.querySelector('#manual-invoice-number').dispatchEvent(new Event('input'));`);
  assert.equal(await js(`document.querySelector('#create-invoice').disabled`),true);
  await js(`document.querySelector('#invoice-preview-form').requestSubmit()`);
  await until(()=>js(`!document.querySelector('#invoice-preview').hidden`),'manual preview');
  assert.match(await js(`document.querySelector('#invoice-preview-details').textContent`),/Manuelle Rechnungsnummer: RE-2026-03/);
  await js(`document.querySelector('#create-invoice').click()`);
  await until(()=>js(`!document.querySelector('#open-invoice-pdf').hidden`),'manual saved');
  const third=(await api('/api/invoices',undefined,'GET')).find(invoice=>invoice.month===3);
  assert.equal(third.invoice_number,'RE-2026-03');
  await api(`/api/invoices/${third.id}`,undefined,'DELETE');
  await js(`document.querySelector('[data-view-link=invoice]').click();document.querySelector('#counter-load').click()`);
  await until(()=>js(`!document.querySelector('#counter-save').disabled`),'release available');
  await js(`document.querySelector('#invoice-counter-form').requestSubmit()`);
  assert.match(await js(`document.querySelector('#counter-message').textContent`),/ausdrücklich bestätigen/);
  await js(`document.querySelector('#counter-confirm-reuse').checked=true;document.querySelector('#invoice-counter-form').requestSubmit()`);
  await until(()=>js(`document.querySelector('#counter-message').textContent.includes('Nächste automatische Nummer: 2026-03') && document.querySelector('#counter-save').disabled`),'released explicitly');
  assert.equal((await api('/api/invoices',{year:2025,month:3,invoice_date:'2026-03-02'})).invoice_number,'2026-03');
  await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT,'numbering.png'),(await contents.capturePage()).toPNG());
  console.log('NUMBERING_OK');
}
run().then(()=>app.quit()).catch(error=>{console.error(error.stack);app.exit(1);});
