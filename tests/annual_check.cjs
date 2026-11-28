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

  if(process.env.TTC_TEST_RESUME==='1') { console.log('ANNUAL_RESTART_OK'); return; }
  const a=(await api('/api/settings',{activities:[{name:'Jahrestraining',hourly_rate_cents:101}]},'PUT')).activities[0];
  await api('/api/trainings',{training_date:'2025-01-02',activity_type_id:a.id,hours:3,status:'completed'});
  await api('/api/invoices',{year:2025,month:1,invoice_date:'2026-02-01'});
  await js(`document.querySelector('[data-view-link=annual]').click()`);
  await until(()=>js(`!document.querySelector('#annual-pdf').disabled`),'annual ready');
  assert.equal(await js(`document.querySelector('#annual-year').value`),String(new Date().getFullYear()));
  await js(`document.querySelector('#annual-year').value='2025';document.querySelector('#annual-year').dispatchEvent(new Event('change'))`);
  await until(()=>js(`!document.querySelector('#annual-pdf').disabled && document.querySelector('#annual-total').textContent==='3,03 €'`),'saved cents');
  assert.equal(await js(`document.querySelectorAll('#annual-months tr').length`),12);
  // Exercise both download buttons without opening native save dialogs.
  await js(`window.__downloads=[];window.__createURL=URL.createObjectURL;URL.createObjectURL=blob=>{window.__downloads.push(blob);return window.__createURL(blob)};window.__anchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__downloadName=this.download};void 0`);
  for(const format of ['csv','pdf']) {
    await js(`document.querySelector('#annual-${format}').click()`);
    await until(()=>js(`!document.querySelector('#annual-${format}').disabled && window.__downloadName==='Jahresuebersicht-2025.${format}'`),'download '+format);
    const bytes=await js(`window.__downloads.at(-1).arrayBuffer().then(buffer=>Array.from(new Uint8Array(buffer)))`);
    if(format==='csv') assert.match(Buffer.from(bytes).toString('utf8'),/Jahressumme;3,03/);
    else assert.ok(Buffer.from(bytes).subarray(0,4).equals(Buffer.from('%PDF')));
  }
  await js(`URL.createObjectURL=window.__createURL;HTMLAnchorElement.prototype.click=window.__anchorClick;void 0`);
  // An older year's response must never replace a newer selection.
  await js(`window.__realFetch=window.fetch;window.fetch=(url,options)=>url==='/api/annual-overview/2025'?new Promise(resolve=>{window.__releaseAnnual=()=>window.__realFetch(url,options).then(resolve)}):window.__realFetch(url,options);document.querySelector('#annual-reload').click();document.querySelector('#annual-year').value=String(new Date().getFullYear());document.querySelector('#annual-year').dispatchEvent(new Event('change'))`);
  await until(()=>js(`!document.querySelector('#annual-pdf').disabled && document.querySelector('#annual-total').textContent==='0,00 €'`),'new year');
  await js(`window.__releaseAnnual();window.fetch=window.__realFetch;void 0`);
  await pause();
  assert.equal(await js(`document.querySelector('#annual-total').textContent`),'0,00 €');
  await js(`document.querySelector('#annual-year').value='2025';document.querySelector('#annual-year').dispatchEvent(new Event('change'))`);
  await until(()=>js(`!document.querySelector('#annual-pdf').disabled && document.querySelector('#annual-total').textContent==='3,03 €'`),'restore year');
  await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT,'annual.png'),(await contents.capturePage()).toPNG());
  await js(`window.__originalFetch=window.fetch;window.fetch=(url,options)=>url.startsWith('/api/annual-overview/')?Promise.resolve(new Response('{}',{status:503})):window.__originalFetch(url,options);document.querySelector('#annual-reload').click()`);
  await until(()=>js(`document.querySelector('#annual-message').textContent.includes('erneut versuchen')`),'error');
  assert.equal(await js(`document.querySelector('#annual-table').hidden && document.querySelector('#annual-csv').disabled`),true);
  await js(`window.fetch=window.__originalFetch;document.querySelector('#annual-reload').click()`);
  await until(()=>js(`!document.querySelector('#annual-pdf').disabled`),'retry');
  const second=await api('/api/profiles',{name:'Leere Jahresübersicht'});
  await js(`document.querySelector('#active-profile').add(new Option('Leere Jahresübersicht','${second.id}'));document.querySelector('#active-profile').value='${second.id}';document.querySelector('#active-profile').dispatchEvent(new Event('change'));document.querySelector('#confirm-profile-switch').click()`);
  await until(()=>js(`document.querySelector('#active-profile').value==='${second.id}' && !document.querySelector('#annual-pdf').disabled && document.querySelector('#annual-message').textContent.includes('keine endgültigen')`),'profile isolation');
  assert.equal(await js(`document.querySelector('#annual-total').textContent`),'0,00 €');
  console.log('ANNUAL_OK');
}
run().then(()=>app.quit()).catch(error=>{console.error(error.stack);app.exit(1);});
