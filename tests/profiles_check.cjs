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
  await until(()=>win.isVisible(),'visible app window');
  win.focus(); contents.focus();
  await until(()=>js('document.hasFocus()'),'focused renderer');
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
    // The last remaining profile explains why deletion is unavailable.
    await js(`fetch('/api/profiles/1/deletion').then(r=>r.json()).then(body=>fetch('/api/profiles/1',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).then(r=>{if(!r.ok)throw Error('delete first failed')})`);
    await js(`document.querySelector('#delete-profile').click()`);
    await until(()=>js(`document.querySelector('#profile-delete-dialog').open`),'last-profile dialog');
    assert.equal(await js(`document.querySelector('#confirm-profile-delete').disabled`),true);
    assert.match(await js(`document.querySelector('#profile-delete-error').textContent`),/letzte Profil/);
    await js(`document.querySelector('#cancel-profile-delete').click()`);
    console.log('PROFILES_RESTART_OK');return;
  }
  assert.equal(await selected(),'1');
  const originalName = await js(`document.querySelector('#active-profile').selectedOptions[0].textContent`);
  const originalInvoices = await js(`fetch('/api/invoices',{headers:{'X-Profile-ID':'1'}}).then(r=>r.json())`);
  // Actual UI creation and keyboard focus; creation never silently switches drafts.
  const click = async selector => {
    await js(`window.__testClick=false;document.querySelector(${JSON.stringify(selector)}).addEventListener('click',()=>{window.__testClick=true},{once:true});void 0;`);
    const rect = await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    contents.sendInputEvent({type:'mouseDown',...rect,button:'left',clickCount:1});
    contents.sendInputEvent({type:'mouseUp',...rect,button:'left',clickCount:1});
    await until(()=>js('window.__testClick'),'native click delivered: '+selector);
    await pause();
  };
  const key = async keyCode => {
    contents.sendInputEvent({type:'keyDown',keyCode});
    if (keyCode === 'Return') contents.sendInputEvent({type:'char',keyCode:'\r'});
    contents.sendInputEvent({type:'keyUp',keyCode});
    await pause();
  };
  const isOpen = () => js(`document.querySelector('#profile-name-dialog').open`);
  const setName = value => js(`document.querySelector('#profile-name').value=${JSON.stringify(value)}`);
  await js(`document.querySelector('[data-view-link="invoice"]').click();document.querySelector('[name="issuer_first_name"]').value='Entwurf bleibt';`);
  await click('#create-profile');
  assert.equal(await isOpen(),true);
  assert.equal(await js('document.activeElement.id'),'profile-name');
  assert.equal(await js(`document.querySelector('#profile-name').value`),'');
  await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT,'profile-create-dialog.png'),(await contents.capturePage()).toPNG());
  await click('#cancel-profile-name');
  assert.equal(await isOpen(),false);
  await until(()=>js("document.activeElement.id==='create-profile'"),'focus returned to create-profile');
  await click('#create-profile'); await key('Escape');
  assert.equal(await isOpen(),false);
  await click('#create-profile');
  for (const invalid of ['   ', 'x'.repeat(101)]) {
    await setName(invalid); await click('#save-profile-name');
    assert.equal(await isOpen(),true);
    assert.equal(await js(`document.querySelector('#profile-name-error').hidden`),false);
  }
  // Real dialog, injected transport failures only: preserve input and retry.
  await setName('');
  await click('#profile-name');
  contents.insertText('Firma XY');
  await until(()=>js(`document.querySelector('#profile-name').value==='Firma XY'`),'typed name');
  for (const failure of ["Promise.reject(new TypeError('offline'))", "Promise.resolve(new Response('',{status:422}))"]) {
    await js(`window.__fetch=window.fetch;window.fetch=(url,options)=>url==='/api/profiles' && options?.method==='POST' ? ${failure} : window.__fetch(url,options);void 0;`);
    await click('#save-profile-name');
    await until(()=>js(`!document.querySelector('#profile-name-error').hidden`),'visible save failure');
    assert.equal(await isOpen(),true);
    assert.equal(await js(`document.querySelector('#profile-name').value`),'Firma XY');
    await js(`window.fetch=window.__fetch;void 0;`);
  }
  await js(`window.__writes=0;window.__fetch=window.fetch;window.fetch=(url,options)=>url==='/api/profiles' && options?.method==='POST' ? (window.__writes++,new Promise(resolve=>setTimeout(()=>resolve(window.__fetch(url,options)),300))) : window.__fetch(url,options);void 0;`);
  await click('#save-profile-name');
  await js(`document.querySelector('#profile-name-form').requestSubmit();document.querySelector('#cancel-profile-name').click()`);
  await key('Escape');
  assert.equal(await isOpen(),true);
  assert.equal(await js(`document.querySelector('#active-profile').disabled`),true);
  await until(()=>js(`document.querySelector('#active-profile').options.length===2`),'profile created');
  assert.equal(await selected(),'1');
  await until(()=>js("document.activeElement.id==='create-profile'"),'focus returned to create-profile');
  assert.equal(await js('window.__writes'),1);
  assert.equal(await js(`document.querySelector('[name="issuer_first_name"]').value`),'Entwurf bleibt');
  await js(`window.fetch=window.__fetch;void 0;`);
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
  await click('#rename-profile');
  assert.equal(await js(`document.querySelector('#profile-name').value`),'Firma XY');
  assert.equal(await js(`document.querySelector('#profile-name').selectionEnd-document.querySelector('#profile-name').selectionStart`),8);
  win.setMinimumSize(0,0); win.setSize(520,740); await pause();
  await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT,'profile-dialog.png'),(await contents.capturePage()).toPNG());
  assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'),true);
  await setName('Firma neu'); await click('#profile-name'); await key('Return');
  await until(()=>js(`document.querySelector('#active-profile').selectedOptions[0].textContent==='Firma neu'`),'rename');
  await until(()=>js("document.activeElement.id==='rename-profile'"),'focus returned to rename-profile');
  await click('#rename-profile'); await click('#cancel-profile-name');
  await switchTo(1);
  assert.equal(await js(`document.querySelector('#active-profile').selectedOptions[0].textContent`),originalName);
  assert.deepEqual(await js(`fetch('/api/invoices',{headers:{'X-Profile-ID':'1'}}).then(r=>r.json())`),originalInvoices);
  assert.equal(await js(`document.querySelector('[name="issuer_first_name"]').value`),'A gespeichert');
  // Real deletion dialog: cancellation, concrete impact, active-profile fallback.
  await click('#create-profile'); await setName('Delete me'); await click('#save-profile-name');
  await until(()=>js(`document.querySelector('#active-profile').options.length===3`),'third profile');
  await switchTo(3);
  await click('#delete-profile');
  await until(()=>js(`document.querySelector('#profile-delete-dialog').open`),'delete dialog');
  assert.match(await js(`document.querySelector('#profile-delete-summary').textContent`),/Delete me.*Termine.*Rechnungen.*PDFs/);
  assert.equal(await js('document.activeElement.id'),'cancel-profile-delete');
  await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT,'profile-delete-dialog.png'),(await contents.capturePage()).toPNG());
  await click('#cancel-profile-delete');
  assert.equal(await selected(),'3');
  assert.equal(await js(`document.querySelector('#active-profile').options.length`),3);
  await click('#delete-profile');
  await until(()=>js(`document.querySelector('#profile-delete-dialog').open`),'delete dialog again');
  await reload(()=>js(`document.querySelector('#confirm-profile-delete').click()`));
  assert.equal(await selected(),'1');
  assert.equal(await js(`document.querySelector('#active-profile').options.length`),2);
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
