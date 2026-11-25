'use strict';
// All application and document writes are confined to pytest's temporary profile.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {app, BrowserWindow, dialog} = require('electron');
app.setPath('userData', process.env.TTC_DATA_DIRECTORY);
app.setPath('sessionData', process.env.TTC_DATA_DIRECTORY);
dialog.showErrorBox = (_title, message) => { throw Error(message); };
require('./electron/main.cjs');
const output = process.env.TTC_TEST_OUTPUT;
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
async function until(check, label) {
  for (let attempt=0;attempt<400;attempt++) { const value=await check(); if(value) return value; await pause(); }
  throw Error(`Timeout: ${label}`);
}
async function run() {
  await app.whenReady();
  const window = await until(()=>BrowserWindow.getAllWindows()[0], 'window');
  const contents = window.webContents;
  const js = code => contents.executeJavaScript(code,true);
  await until(()=>!contents.isLoading() && contents.getURL().startsWith('http:'), 'page');
  await until(()=>js(`document.querySelector('#weekly-plan-days')?.children.length === 7 &&
    !document.querySelector('#save-organization-settings').disabled && document.querySelector('#calendar').getAttribute('aria-busy') === 'false'`),'initial data');
  const origin = contents.getURL();
  async function api(url, method, body) {
    const response = await fetch(new URL(url,origin),{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    assert.ok(response.ok,`${url}: ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  async function navigate(view) {
    await js(`document.querySelector('[data-view-link="${view}"]').click()`);
    assert.equal(await js(`document.querySelectorAll('[data-view]:not([hidden])').length`),1);
    assert.equal(await js(`document.querySelector('[data-view]:not([hidden])').dataset.view`),view);
    assert.equal(await js(`document.querySelector('[aria-current="page"]').dataset.viewLink`),view);
    assert.equal(await js('document.activeElement.id'),`view-${view}-title`);
  }
  assert.equal(await js(`document.querySelector('[data-view]:not([hidden])').dataset.view`),'calendar');
  if(process.env.TTC_TEST_RESUME==='1') {
    assert.equal((await api('/api/organization/settings')).issuer_first_name,'Gespeichert');
    const activities=(await api('/api/settings')).activities;
    assert.equal(activities[0].name,'Navigation Training');
    assert.equal(activities[0].hourly_rate_cents,1750);
    const plan=await api('/api/weekly-plan');
    assert.equal(plan.length,1); assert.equal(plan[0].hours,3);
    assert.equal(await js(`document.querySelector('[data-plan-hours]').value`),'3');
    console.log('NAVIGATION_RESTART_OK'); return;
  }
  // Count network activity only after initial loads have settled.
  await js(`window.__requests=[]; window.__fetch=window.fetch;
    window.fetch=(...args)=>{window.__requests.push([args[0],args[1]?.method||'GET']); return window.__fetch(...args);}; void 0;`);
  await navigate('invoice');
  await js(`document.querySelector('[name="issuer_first_name"]').value='Entwurf';`);
  for(let turn=0;turn<4;turn++) for(const view of ['weekly','activities','management','calendar','invoice']) await navigate(view);
  assert.equal(await js(`document.querySelector('[name="issuer_first_name"]').value`),'Entwurf');
  assert.equal(await js('window.__requests.length'),0);
  // Actual keyboard activation and focus, plus Tab must never enter a hidden view.
  await js(`document.querySelector('[data-view-link="weekly"]').focus()`);
  contents.sendInputEvent({type:'keyDown',keyCode:'Return'}); contents.sendInputEvent({type:'keyUp',keyCode:'Return'});
  await until(()=>js(`document.activeElement.id==='view-weekly-title'`),'keyboard navigation');
  for(let step=0;step<14;step++) {
    contents.sendInputEvent({type:'keyDown',keyCode:'Tab'}); contents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
    await pause();
    assert.equal(await js(`Boolean(document.activeElement.closest('[data-view][hidden]'))`),false);
  }
  await navigate('activities');
  await js(`document.querySelector('#add-activity').click();
    document.querySelector('#activity-settings-rows input[type=text]').value='Navigation Training';
    document.querySelector('#activity-settings-rows input[type=number]').value='17.50';
    document.querySelector('#activity-settings-form').requestSubmit();`);
  await until(()=>js(`!document.querySelector('#activity-settings-success').hidden`),'activity save');
  await navigate('weekly');
  await js(`document.querySelector('[data-weekday="0"] [data-add-plan-entry]').click();
    document.querySelector('[data-plan-hours]').value='3';`);
  await navigate('activities');
  await js(`document.querySelector('#activity-settings-rows input[type=text]').value='Navigation Training';
    document.querySelector('#activity-settings-success').hidden=true;
    document.querySelector('#activity-settings-form').requestSubmit();`);
  await until(()=>js(`!document.querySelector('#activity-settings-success').hidden`),'activity resave');
  assert.equal(await js(`document.querySelector('[data-plan-hours]').value`),'3');
  assert.deepEqual(await api('/api/weekly-plan'),[],'activity save must not persist a draft plan');
  assert.equal((await api('/api/organization/settings')).issuer_first_name,'','activity save must not persist invoice draft');
  await navigate('weekly');
  await js(`document.querySelector('#weekly-plan-form').requestSubmit()`);
  await until(()=>js(`!document.querySelector('#weekly-plan-success').hidden`),'weekly save');
  assert.equal((await api('/api/weekly-plan'))[0].hours,3);
  await navigate('invoice');
  // An API error leaves all input values; navigation preserves its visible message.
  await js(`window.fetch=(...args)=>args[0]==='/api/organization/settings' && args[1]?.method==='PUT'
    ? Promise.resolve(new Response(JSON.stringify({detail:'Testfehler: Speichern nicht möglich'}),{status:503,headers:{'Content-Type':'application/json'}}))
    : window.__fetch(...args);
    document.querySelector('#organization-settings-form').requestSubmit();`);
  await until(()=>js(`!document.querySelector('#organization-settings-error').hidden`),'invoice save error');
  await navigate('calendar'); await navigate('invoice');
  assert.equal(await js(`document.querySelector('[name="issuer_first_name"]').value`),'Entwurf');
  assert.match(await js(`document.querySelector('#organization-settings-error').textContent`),/Testfehler/);
  await js(`window.fetch=window.__fetch;
    document.querySelector('[name="issuer_first_name"]').value='Gespeichert';
    document.querySelector('#organization-settings-form').requestSubmit();`);
  await until(()=>js(`!document.querySelector('#organization-settings-success').hidden`),'invoice save retry');
  assert.equal((await api('/api/settings')).activities[0].hourly_rate_cents,1750);
  assert.equal((await api('/api/weekly-plan'))[0].hours,3);
  // Failed independent saves keep the draft controls and their error in their own view.
  for (const [view, url, form, input, value, error] of [
    ['weekly','/api/weekly-plan','#weekly-plan-form','[data-plan-hours]','4','#weekly-plan-error'],
    ['activities','/api/settings','#activity-settings-form','#activity-settings-rows input[type=number]','99.99','#activity-settings-error'],
  ]) {
    await navigate(view);
    await js(`document.querySelector(${JSON.stringify(input)}).value=${JSON.stringify(value)};
      window.fetch=(...args)=>args[0]===${JSON.stringify(url)} && args[1]?.method==='PUT'
        ? Promise.resolve(new Response(JSON.stringify({detail:'Testfehler'}),{status:503,headers:{'Content-Type':'application/json'}})) : window.__fetch(...args);
      document.querySelector(${JSON.stringify(form)}).requestSubmit();`);
    await until(()=>js(`!document.querySelector(${JSON.stringify(error)}).hidden`),'independent save error');
    await navigate('management'); await navigate(view);
    assert.equal(await js(`document.querySelector(${JSON.stringify(input)}).value`),value);
    await js('window.fetch=window.__fetch; void 0');
  }
  assert.equal((await api('/api/settings')).activities[0].hourly_rate_cents,1750);
  assert.equal((await api('/api/weekly-plan'))[0].hours,3);
  // Logo uploads change only logo fields, retaining unrelated invoice drafts.
  await navigate('invoice');
  await js(`document.querySelector('[name="issuer_first_name"]').value='Logo Entwurf';
    const transfer=new DataTransfer();
    transfer.items.add(new File([new Uint8Array([1])],'test.png',{type:'image/png'}));
    document.querySelector('#organization-logo-file').files=transfer.files;
    window.fetch=(...args)=>args[0]==='/api/organization/logo'
      ? Promise.resolve(new Response(JSON.stringify({logo_available:true,logo_enabled:true}),{status:200,headers:{'Content-Type':'application/json'}})) : window.__fetch(...args);
    document.querySelector('#upload-organization-logo').click();`);
  await until(()=>js(`document.querySelector('#organization-settings-success').textContent.includes('Logo wurde hochgeladen')`),'logo action');
  assert.equal(await js(`document.querySelector('[name="issuer_first_name"]').value`),'Logo Entwurf');
  assert.equal((await api('/api/organization/settings')).issuer_first_name,'Gespeichert');
  await js('window.fetch=window.__fetch; void 0');
  // Slow response must never restore a previous month's preview, nor steal focus.
  await navigate('calendar');
  await until(()=>js(`document.querySelector('#calendar').getAttribute('aria-busy')==='false'`),'calendar settled');
  const month=await js(`document.querySelector('#invoice-month').value`);
  await js(`window.fetch=(...args)=>args[0]==='/api/invoices/preview' ? new Promise(resolve=>{
    window.__resolvePreview=()=>resolve(new Response(JSON.stringify({year:${Number(month.slice(0,4))},month:${Number(month.slice(5))},items:[],total_amount_cents:0}),{status:200,headers:{'Content-Type':'application/json'}}));
    }) : window.__fetch(...args);
    document.querySelector('#invoice-preview-form').requestSubmit();
    document.querySelector('#previous-month').click();`);
  await until(()=>js(`document.querySelector('#invoice-month').value!==${JSON.stringify(month)}`),'month synchronized');
  const selected=await js(`document.querySelector('#invoice-month').value`);
  await navigate('invoice');
  await js(`document.querySelector('[name="issuer_first_name"]').focus(); window.__resolvePreview();`);
  await until(()=>js(`document.querySelector('#invoice-preview-form').getAttribute('aria-busy')==='false'`),'late preview settled');
  assert.equal(await js(`document.querySelector('#invoice-preview').hidden`),true);
  assert.equal(await js(`document.activeElement.name`),'issuer_first_name');
  await navigate('calendar');
  assert.equal(await js(`document.querySelector('#invoice-month').value`),selected);
  await js('window.fetch=window.__fetch; void 0');
  // Final invoices remain visible when the calendar month changes.
  const [year,monthNumber]=selected.split('-').map(Number);
  const activity=(await api('/api/settings')).activities[0];
  await api('/api/trainings','POST',{training_date:`${selected}-15`,activity_type_id:activity.id,hours:1,status:'completed'});
  await api('/api/invoices/preview','POST',{year,month:monthNumber});
  await js(`document.querySelector('#reload-invoices').click()`);
  await until(()=>js(`!document.querySelector('#reload-invoices').disabled`),'draft list');
  assert.equal(await js(`document.querySelectorAll('#saved-invoices-rows tr').length`),0);
  await api('/api/invoices','POST',{year,month:monthNumber});
  await js(`document.querySelector('#archive-year').add(new Option('${year}','${year}'));document.querySelector('#archive-year').value='${year}';`);
  await js(`document.querySelector('#reload-invoices').click()`);
  await until(()=>js(`document.querySelectorAll('#saved-invoices-rows tr').length===1`),'final list');
  await js(`document.querySelector('#next-month').click()`);
  await until(()=>js(`document.querySelector('#invoice-month').value!==${JSON.stringify(selected)}`),'next month');
  assert.equal(await js(`document.querySelectorAll('#saved-invoices-rows tr').length`),1);
  // Initial failures lock unloaded forms, offer retry and never blank saved records.
  await js(`window.__fetch=window.fetch;
    window.fetch=(...args)=>args[0]==='/api/settings' || args[0]==='/api/organization/settings'
      ? Promise.resolve(new Response(JSON.stringify({detail:'Laden fehlgeschlagen'}),{status:503,headers:{'Content-Type':'application/json'}})) : window.__fetch(...args); void 0;`);
  // Test fresh initialization with a one-shot main-process interception on reload.
  contents.session.webRequest.onBeforeRequest({urls:[`${origin}api/settings`,`${origin}api/organization/settings`]},(_details,callback)=>callback({cancel:true}));
  await new Promise(resolve=>{contents.once('did-finish-load',resolve); contents.reload();});
  await until(()=>js(`!document.querySelector('#organization-settings-error').hidden && !document.querySelector('#activity-settings-error').hidden`),'initial failure');
  assert.equal(await js(`document.querySelector('#save-organization-settings').disabled && document.querySelector('#save-activity-settings').disabled && document.querySelector('#save-weekly-plan').disabled`),true);
  contents.session.webRequest.onBeforeRequest(null);
  await navigate('invoice');
  await js(`document.querySelector('#organization-settings-form').nextElementSibling.click()`);
  await until(()=>js(`!document.querySelector('#save-organization-settings').disabled`),'organization load retry');
  assert.equal(await js(`document.querySelector('[name="issuer_first_name"]').value`),'Gespeichert');
  await navigate('weekly');
  await js(`document.querySelector('#weekly-plan-form').nextElementSibling.click()`);
  await until(()=>js(`!document.querySelector('#save-weekly-plan').disabled && document.querySelector('[data-plan-hours]')?.value==='3'`),'plan load retry');
  await navigate('calendar');
  await fs.writeFile(path.join(output,'navigation.png'),(await contents.capturePage()).toPNG());
  assert.equal(BrowserWindow.getAllWindows().length,1);
  console.log('NAVIGATION_OK');
}
run().then(()=>app.quit()).catch(error=>{console.error(error.stack);app.exit(1);});
