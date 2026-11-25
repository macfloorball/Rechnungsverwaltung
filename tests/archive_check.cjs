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
    console.log('ARCHIVE_RESTART_OK'); return;
  }
  const a=(await api('/api/settings',{activities:[{name:'Archivtraining',hourly_rate_cents:1500}]},'PUT')).activities[0];
  await api('/api/organization/settings',{recipient_name:'Historischer Verein'},'PUT');
  for(const month of [1,12]) {
    await api('/api/trainings',{training_date:`2025-${String(month).padStart(2,'0')}-02`,activity_type_id:a.id,hours:1,status:'completed'});
    await api('/api/invoices',{year:2025,month,invoice_date:`2026-01-${month===1?'02':'03'}`});
  }
  await api('/api/organization/settings',{recipient_name:'Neuer Verein'},'PUT');
  await js(`document.querySelector('[data-view-link=archive]').click();document.querySelector('#reload-invoices').click();`);
  await until(()=>js(`!document.querySelector('#reload-invoices').disabled`),'archive load');
  assert.equal(await js(`document.querySelector('#archive-year').value`),String(new Date().getFullYear()));
  await js(`document.querySelector('#archive-year').value='2025';document.querySelector('#archive-year').dispatchEvent(new Event('change'));`);
  assert.equal(await js(`document.querySelectorAll('#saved-invoices-rows tr').length`),2);
  assert.match(await js(`document.querySelector('#saved-invoices-rows tr').textContent`),/Dezember 2025/);
  assert.match(await js(`document.querySelector('#saved-invoices-rows').textContent`),/Historischer Verein/);
  assert.doesNotMatch(await js(`document.querySelector('#saved-invoices-rows').textContent`),/Neuer Verein/);
  assert.equal(await js(`document.querySelectorAll('#saved-invoices-rows a[href*="profile_id=1"]').length`),4);
  await js(`document.querySelector('#archive-search').value='2026-01';document.querySelector('#archive-search').dispatchEvent(new Event('input'));`);
  assert.equal(await js(`document.querySelectorAll('#saved-invoices-rows tr').length`),1);
  await js(`document.querySelector('#archive-search').value='HISTORISCHER';document.querySelector('#archive-search').dispatchEvent(new Event('input'));document.querySelector('#archive-month').value='12';document.querySelector('#archive-month').dispatchEvent(new Event('change'));`);
  assert.equal(await js(`document.querySelectorAll('#saved-invoices-rows tr').length`),1);
  await js(`document.querySelector('#next-month').click()`);
  assert.equal(await js(`document.querySelectorAll('#saved-invoices-rows tr').length`),1);
  await js(`document.querySelector('#archive-search').value='Keine Treffer';document.querySelector('#archive-search').dispatchEvent(new Event('input'));`);
  assert.equal(await js(`document.querySelector('#saved-invoices-empty').hidden`),false);
  await js(`document.querySelector('#archive-search').value='';document.querySelector('#archive-search').dispatchEvent(new Event('input'));`);
  await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT,'archive.png'),(await contents.capturePage()).toPNG());

  await js(`window.__originalFetch=window.fetch;window.fetch=(url,options)=>url==='/api/invoices'?Promise.resolve(new Response(JSON.stringify({detail:'Archiv vorübergehend nicht verfügbar'}),{status:503})):window.__originalFetch(url,options);document.querySelector('#reload-invoices').click();`);
  await until(()=>js(`!document.querySelector('#saved-invoices-error').hidden`),'archive failure');
  assert.equal(await js(`document.querySelectorAll('#saved-invoices-rows tr').length`),0);
  await js(`window.fetch=window.__originalFetch;document.querySelector('#reload-invoices').click();`);
  await until(()=>js(`!document.querySelector('#reload-invoices').disabled && document.querySelectorAll('#saved-invoices-rows tr').length===1`),'archive retry');
  const second=await api('/api/profiles',{name:'Leeres Archivprofil'});
  await js(`window.confirm=()=>true;document.querySelector('#active-profile').add(new Option('Leeres Archivprofil','${second.id}'));document.querySelector('#active-profile').value='${second.id}';document.querySelector('#active-profile').dispatchEvent(new Event('change'));`);
  await until(()=>js(`document.querySelector('#active-profile').value==='${second.id}' && !document.querySelector('#reload-invoices').disabled && !document.querySelector('#saved-invoices-empty').hidden`),'profile archive isolation');
  assert.equal(await js(`document.querySelectorAll('#saved-invoices-rows a, #saved-invoices-rows button').length`),0);
  console.log('ARCHIVE_OK');
}
run().then(()=>app.quit()).catch(error=>{console.error(error.stack);app.exit(1);});
