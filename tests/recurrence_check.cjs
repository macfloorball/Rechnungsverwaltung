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
  // Real native controls must remain usable inside narrow day cards and every view.
  window.setMinimumSize(320, 400);
  for (const width of [360, 700, 900, 1440, 1920]) {
    window.setSize(width, 900);
    await new Promise(resolve => setTimeout(resolve, 100));
    await js(`document.querySelector('[data-plan-start]').scrollIntoView({block:'center'})`);
    const layout = await js(`(() => {
      const date = document.querySelector('[data-plan-start]');
      const row = date.closest('.weekly-plan-row');
      const bounds = row.getBoundingClientRect();
      return {
        dateWidth: date.getBoundingClientRect().width,
        dateHeight: date.getBoundingClientRect().height,
        fits: [...row.querySelectorAll('input,select,button')].filter(el => el.checkVisibility()).every(el => {
          const rect = el.getBoundingClientRect();
          return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
        }),
        pageFits: document.documentElement.scrollWidth <= innerWidth,
      };
    })()`);
    assert.ok(layout.dateWidth >= 190 && layout.dateHeight >= 40, JSON.stringify({width, ...layout}));
    assert.ok(layout.fits && layout.pageFits, JSON.stringify({width, ...layout}));
    await fs.writeFile(path.join(output, `controls-weekly-${width}.png`), (await contents.capturePage()).toPNG());
  }
  window.setSize(540, 900);
  await new Promise(resolve => setTimeout(resolve, 150));
  await js(`document.querySelector('[data-plan-start]').scrollIntoView({block:'center'}); document.activeElement.blur()`);
  const datePoint = await js(`(() => { const r = document.querySelector('[data-plan-start]').getBoundingClientRect(); return {x:Math.round(r.x + r.width / 2), y:Math.round(r.y + r.height / 2)}; })()`);
  contents.sendInputEvent({type:'mouseMove', ...datePoint});
  await new Promise(resolve => setTimeout(resolve, 100));
  await fs.writeFile(path.join(output, 'controls-hover.png'), (await contents.capturePage()).toPNG());
  await js(`document.querySelector('[data-plan-start]').showPicker()`);
  await new Promise(resolve => setTimeout(resolve, 150));
  await fs.writeFile(path.join(output, 'controls-native-picker.png'), (await contents.capturePage()).toPNG());
  contents.sendInputEvent({type:'keyDown', keyCode:'Escape'});
  contents.sendInputEvent({type:'keyUp', keyCode:'Escape'});
  await js(`document.querySelector('[data-plan-start]').disabled = true`);
  assert.equal(await js(`document.querySelector('[data-plan-start]').willValidate`), false);
  await new Promise(resolve => setTimeout(resolve, 100));
  await fs.writeFile(path.join(output, 'controls-disabled.png'), (await contents.capturePage()).toPNG());
  await js(`const date = document.querySelector('[data-plan-start]'); date.disabled = false; date.value = ''; date.setAttribute('aria-invalid', 'true'); date.focus();`);
  assert.equal(await js(`document.querySelector('[data-plan-start]').checkValidity()`), false);
  assert.equal(await js(`getComputedStyle(document.querySelector('[data-plan-start]')).borderTopColor`), 'rgb(166, 53, 53)', 'Invalid styling must take precedence over hover and focus');
  await new Promise(resolve => setTimeout(resolve, 100));
  await fs.writeFile(path.join(output, 'controls-invalid.png'), (await contents.capturePage()).toPNG());
  await js(`document.querySelector('[data-plan-start]').removeAttribute('aria-invalid'); document.querySelector('[data-plan-start]').value = '2032-12-02'`);
  for (const width of [360, 1440]) {
    window.setSize(width, 900);
    await new Promise(resolve => setTimeout(resolve, 100));
    for (const view of ['calendar', 'archive', 'annual', 'invoice', 'activities', 'management']) {
      await js(`document.querySelector('[data-view-link="${view}"]').click(); document.querySelector('#view-${view}').scrollIntoView({block:'start'})`);
      await new Promise(resolve => setTimeout(resolve, 150));
      await fs.writeFile(path.join(output, `controls-${view}-${width}.png`), (await contents.capturePage()).toPNG());
      assert.equal(await js(`document.documentElement.scrollWidth <= innerWidth`), true, `${view} at ${width}px`);
      const fieldSelector = {calendar:'#invoice-date', invoice:'#organization-logo-file', management:'#backup-directory'}[view];
      if (fieldSelector) {
        await js(`document.querySelector('${fieldSelector}').scrollIntoView({block:'center'})`);
        await new Promise(resolve => setTimeout(resolve, 100));
        await fs.writeFile(path.join(output, `controls-${view}-fields-${width}.png`), (await contents.capturePage()).toPNG());
      }
    }
  }
  await js(`document.querySelector('[data-view-link="weekly"]').click(); document.querySelector('[data-plan-start]').scrollIntoView({block:'center'})`);
  window.maximize();
  await until(() => window.isMaximized(), 'maximized window');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await js(`document.documentElement.scrollWidth <= innerWidth`), true);
  await fs.writeFile(path.join(output, 'controls-maximized.png'), (await contents.capturePage()).toPNG());
  console.log('RECURRENCE_OK');
}
run().then(()=>app.quit()).catch(error=>{console.error(error.stack);app.exit(1);});
