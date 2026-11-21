'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {app, BrowserWindow, dialog} = require('electron');
app.setPath('userData', process.env.TTC_DATA_DIRECTORY);
app.setPath('sessionData', process.env.TTC_DATA_DIRECTORY);
dialog.showErrorBox = (_title, message) => { throw Error(message); };
require('./electron/main.cjs');
const output = process.env.TTC_TEST_OUTPUT;
async function until(check, label) {
  for (let n=0; n<400; n++) { const value=await check(); if(value) return value; await new Promise(resolve=>setTimeout(resolve,40)); }
  throw Error(`Timeout: ${label}`);
}
async function run() {
  await app.whenReady();
  const window = await until(()=>BrowserWindow.getAllWindows()[0], 'window');
  const contents = window.webContents;
  const js = code=>contents.executeJavaScript(code,true);
  await until(()=>!contents.isLoading() && contents.getURL().startsWith('http:'), 'page');
  await until(()=>js(`document.querySelector('#weekly-plan-days')?.children.length===7 && !document.querySelector('#save-weekly-plan').disabled`), 'ready');
  const origin=contents.getURL();
  async function api(url,method,body) {
    const response=await fetch(new URL(url,origin), {method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    assert.ok(response.ok, `${url}: ${response.status}`);
    return response.json();
  }
  await js(`document.querySelector('[data-view-link="weekly"]').click()`);
  if(process.env.TTC_TEST_RESUME==='1') {
    assert.equal(await js(`document.querySelector('[data-plan-repeat]').value`),'2');
    assert.equal(await js(`document.querySelector('[data-plan-start]').value`),'2032-12-02');
    assert.deepEqual((await api('/api/calendar/2032/12')).days.filter(d=>d.trainings.length).map(d=>d.date), ['2032-12-02','2032-12-16','2032-12-30']);
    console.log('RECURRENCE_RESTART_OK'); return;
  }
  const settings=await api('/api/settings','PUT',{activities:[{name:'Training',hourly_rate_cents:1500}]});
  const activity=settings.activities[0].id;
  await api('/api/weekly-plan','PUT',[{weekday:3,activity_type_id:activity,hours:2}]);
  await api('/api/calendar/2032/12');
  await new Promise(resolve=>{contents.once('did-finish-load',resolve); contents.reload();});
  await until(()=>js(`document.querySelector('[data-plan-repeat]') && !document.querySelector('#save-weekly-plan').disabled`),'plan reload');
  await js(`document.querySelector('[data-view-link="weekly"]').click();
    document.querySelector('[data-plan-repeat]').value='2';
    document.querySelector('[data-plan-repeat]').dispatchEvent(new Event('change'));`);
  assert.equal(await js(`document.querySelector('[data-plan-start]').required && !document.querySelector('[data-plan-start]').parentElement.hidden`),true);
  assert.equal(await js(`document.querySelector('[data-plan-start]').value`),'');
  // A valid date with the wrong weekday must preserve the draft and show the API error.
  await js(`document.querySelector('[data-plan-start]').value='2032-12-03'; document.querySelector('#weekly-plan-form').requestSubmit()`);
  await until(()=>js(`!document.querySelector('#weekly-plan-error').hidden`),'weekday error');
  assert.match(await js(`document.querySelector('#weekly-plan-error').textContent`),/Wochentag/);
  assert.equal(await js(`document.querySelector('[data-plan-start]').value`),'2032-12-03');
  await fs.writeFile(path.join(output,'recurrence-error.png'),(await contents.capturePage()).toPNG());
  await js(`document.querySelector('[data-plan-start]').value='2032-12-02'; document.querySelector('#weekly-plan-form').requestSubmit()`);
  await until(()=>js(`!document.querySelector('#weekly-plan-success').hidden`),'saved');
  assert.match(await js(`document.querySelector('#weekly-plan-success').textContent`),/entfernt.*Ausnahmen/);
  assert.deepEqual((await api('/api/calendar/2032/12')).days.filter(d=>d.trainings.length).map(d=>d.date), ['2032-12-02','2032-12-16','2032-12-30']);
  // Simulated save failure retains recurrence and date, with no success claim.
  await js(`window.originalFetch=window.fetch; window.fetch=(url,options)=>url==='/api/weekly-plan' && options?.method==='PUT' ? Promise.resolve(new Response(JSON.stringify({detail:'Testfehler'}),{status:503,headers:{'Content-Type':'application/json'}})) : window.originalFetch(url,options);
    document.querySelector('#weekly-plan-form').requestSubmit();`);
  await until(()=>js(`!document.querySelector('#weekly-plan-error').hidden`),'API error');
  assert.equal(await js(`document.querySelector('#weekly-plan-success').hidden`),true);
  assert.equal(await js(`document.querySelector('[data-plan-start]').value`),'2032-12-02');
  await js(`window.fetch=window.originalFetch; document.querySelector('#weekly-plan-form').requestSubmit()`);
  await until(()=>js(`!document.querySelector('#weekly-plan-success').hidden`),'repeat save');
  assert.match(await js(`document.querySelector('#weekly-plan-success').textContent`),/0 Termine ergänzt, 0 entfernt/);
  await js(`document.querySelector('[data-plan-repeat]').focus(); window.scrollTo({top:document.querySelector('[data-plan-repeat]').getBoundingClientRect().top + scrollY - 200,behavior:'instant'})`);
  contents.sendInputEvent({type:'keyDown',keyCode:'Tab'});
  contents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
  assert.equal(await js(`document.activeElement.matches('[data-plan-start]')`),true);
  assert.equal(await js(`document.documentElement.scrollWidth <= innerWidth`),true);
  await new Promise(resolve=>setTimeout(resolve,150));
  await fs.writeFile(path.join(output,'recurrence.png'),(await contents.capturePage()).toPNG());
  window.setMinimumSize(400,400);
  window.setSize(540,900);
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(await js(`document.documentElement.scrollWidth <= innerWidth`),true);
  await fs.writeFile(path.join(output,'recurrence-mobile.png'),(await contents.capturePage()).toPNG());
  console.log('RECURRENCE_OK');
}
run().then(()=>app.quit()).catch(error=>{console.error(error.stack);app.exit(1);});
