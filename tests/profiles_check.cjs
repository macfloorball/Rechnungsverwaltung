'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {app, BrowserWindow, dialog} = require('electron');
app.setPath('userData', process.env.TTC_DATA_DIRECTORY);
app.setPath('sessionData', process.env.TTC_DATA_DIRECTORY);
dialog.showErrorBox = (_title, message) => { throw Error(message); };
require('./electron/main.cjs');
const pause = () => new Promise(resolve=>setTimeout(resolve,40));
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
  const loaded=()=>until(()=>js(`!document.querySelector('#active-profile').disabled && !document.querySelector('#save-organization-settings').disabled && document.querySelector('#calendar').getAttribute('aria-busy')==='false'`),'profile data');
  await loaded();
  async function reload(action) {
    const finished=new Promise(resolve=>contents.once('did-finish-load',resolve));
    await action(); await finished; await loaded();
  }
  const selected=()=>js(`document.querySelector('#active-profile').value`);
  const switchTo=identifier=>reload(()=>js(`window.confirm=()=>true; document.querySelector('#active-profile').value=${JSON.stringify(String(identifier))};document.querySelector('#active-profile').dispatchEvent(new Event('change'));`));
  if(process.env.TTC_TEST_RESUME==='1') {
    assert.equal(await selected(),'2');
    assert.equal(await js(`document.querySelector('#active-profile').selectedOptions[0].textContent`),'Firma neu');
    assert.equal(await js(`document.querySelector('[name="issuer_first_name"]').value`),'B gespeichert');
    console.log('PROFILES_RESTART_OK');return;
  }
  assert.equal(await selected(),'1');
  // Actual UI creation and keyboard focus; creation never silently switches drafts.
  await js(`window.prompt=()=> 'Firma XY'; document.querySelector('#create-profile').click();`);
  await until(()=>js(`document.querySelector('#active-profile').options.length===2`),'profile created');
  assert.equal(await selected(),'1');
  assert.equal(await js('document.activeElement.id'),'active-profile');
  await js(`document.querySelector('#next-month').click()`);
  await until(()=>js(`document.querySelector('#calendar').getAttribute('aria-busy')==='false'`),'month loaded');
  const month=await js(`document.querySelector('#invoice-month').value`);
  await js(`document.querySelector('[data-view-link="invoice"]').click();document.querySelector('[name="issuer_first_name"]').value='A Entwurf';window.confirm=()=>false;document.querySelector('#active-profile').value='2';document.querySelector('#active-profile').dispatchEvent(new Event('change'));`);
  assert.equal(await selected(),'1');
  assert.equal(await js(`document.querySelector('[name="issuer_first_name"]').value`),'A Entwurf');
  // Save in flight keeps A, and cannot be applied to B. Delay transport before send.
  await js(`window.__nativeFetch=window.fetch;window.fetch=(url,options)=>url==='/api/organization/settings' && options?.method==='PUT' ? new Promise(resolve=>setTimeout(()=>resolve(window.__nativeFetch(url,options)),700)) : window.__nativeFetch(url,options);document.querySelector('[name="issuer_first_name"]').value='A gespeichert';document.querySelector('#organization-settings-form').requestSubmit();`);
  await pause();
  await js(`window.confirm=()=>true;document.querySelector('#active-profile').value='2';document.querySelector('#active-profile').dispatchEvent(new Event('change'));`);
  assert.equal(await selected(),'1');
  assert.match(await js(`document.querySelector('#profile-message').textContent`),/Speicherung läuft/);
  await until(()=>js(`!document.querySelector('#organization-settings-success').hidden`),'A save done');
  // Hold an A read; replace its entire document before resolving it.
  await js(`window.fetch=window.__nativeFetch; window.__lateTimer=setTimeout(()=>{document.querySelector('[name="issuer_first_name"]').value='late A';},1000);fetch('/api/organization/settings',{headers:{'X-Profile-ID':'1'}}).then(r=>r.json()).then(()=>new Promise(resolve=>setTimeout(resolve,900))).then(()=>{window.__lateA=true;});void 0;`);
  await switchTo(2);
  assert.equal(await js(`document.querySelector('[name="issuer_first_name"]').value`),'');
  assert.equal(await js(`document.querySelector('#invoice-month').value`),month);
  assert.equal(await js(`document.querySelector('[data-view]:not([hidden])').dataset.view`),'invoice');
  await new Promise(resolve=>setTimeout(resolve,1100));
  assert.equal(await js('Boolean(window.__lateA)'),false);
  assert.equal(await js(`document.querySelector('[name="issuer_first_name"]').value`),'');
  await js(`document.querySelector('[name="issuer_first_name"]').value='B gespeichert';document.querySelector('#organization-settings-form').requestSubmit();`);
  await until(()=>js(`!document.querySelector('#organization-settings-success').hidden`),'B save');
  await js(`window.prompt=()=> 'Firma neu';document.querySelector('#rename-profile').click();`);
  await until(()=>js(`document.querySelector('#active-profile').selectedOptions[0].textContent==='Firma neu'`),'rename');
  await switchTo(1);
  assert.equal(await js(`document.querySelector('[name="issuer_first_name"]').value`),'A gespeichert');
  // Unknown remembered profile resets predictably after restore/restart.
  await reload(()=>js(`localStorage.setItem('ttc.activeProfile','9999');location.reload();`));
  assert.equal(await selected(),'1');
  // Visible bootstrap error: unloaded profile views must stay locked.
  const origin=contents.getURL();
  contents.session.webRequest.onBeforeRequest({urls:[`${origin}api/profiles`]},(_d,callback)=>callback({cancel:true}));
  await reloadError();
  async function reloadError() {
    const finished=new Promise(resolve=>contents.once('did-finish-load',resolve));contents.reload();await finished;
    await until(()=>js(`document.querySelector('#profile-message').textContent.includes('fetch') || document.querySelector('#profile-message').textContent.includes('laden')`),'visible profile error');
  }
  assert.equal(await js(`document.querySelector('#main-content').hidden && document.querySelector('#active-profile').disabled`),true);
  contents.session.webRequest.onBeforeRequest(null);
  await reload(()=>{contents.reload();});
  await switchTo(2);
  win.setMinimumSize(0,0); win.setSize(520,740); await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(await js("innerWidth"),520);
  assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'),true);
  await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT,'profiles.png'),(await contents.capturePage()).toPNG());
  console.log('PROFILES_OK');
}
run().then(()=>app.quit()).catch(error=>{console.error(error.stack);app.exit(1);});
