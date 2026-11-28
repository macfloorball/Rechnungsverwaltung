'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {app, BrowserWindow, dialog} = require('electron');
app.setPath('userData', process.env.TTC_DATA_DIRECTORY);
app.setPath('sessionData', process.env.TTC_DATA_DIRECTORY);
const output = process.env.TTC_TEST_OUTPUT;
dialog.showErrorBox = (_title, message) => { throw Error(message); };
dialog.showOpenDialog = async()=>({canceled:false,filePaths:[path.join(output,'exports')]});
require('./electron/main.cjs');
async function until(check, label) {
  for(let n=0;n<400;n++){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,40));}
  throw Error(`Timeout: ${label}`);
}
async function run(){
  await app.whenReady();
  const window=await until(()=>BrowserWindow.getAllWindows()[0],'window');
  window.setMinimumSize(320,480);window.show();window.focus();
  const contents=window.webContents;
  const js=code=>contents.executeJavaScript(code,true);
  await until(()=>!contents.isLoading()&&contents.getURL().startsWith('http:'),'page');
  const ready=()=>js(`document.querySelector('#weekly-plan-days')?.children.length===7 && !document.querySelector('#save-weekly-plan').disabled && !document.querySelector('#complete-month').disabled`);
  await until(ready,'ready');
  const origin=contents.getURL();
  async function api(url,method='GET',body){
    const response=await fetch(new URL(url,origin),{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    assert.ok(response.ok, `${url}: ${response.status} ${await response.clone().text()}`);return response.json();
  }
  const note='Gemäß §19 Abs.1 UStG enthält der Rechnungsbetrag keine Umsatzsteuer.\nZweite Zeile mit frei bearbeitbaren Informationen.';
  const navigate=view=>js(`document.querySelector('[data-view-link="${view}"]').click()`);
  if(process.env.TTC_TEST_RESUME==='1'){
    assert.equal(await js(`document.querySelector('[name=additional_tax_info]').value`),note);
    assert.equal(await js(`window.ttcDesktop.getInvoiceExportFolder(1).then(r=>r.value)`),path.join(output,'exports'));
    console.log('ISSUE81_RESTART_OK');return;
  }
  const settings=await api('/api/settings','PUT',{activities:[{name:'Training mit einer sehr langen Tätigkeitsbezeichnung für die kompakte Darstellung',hourly_rate_cents:1500}]});
  const id=settings.activities[0].id;
  await api('/api/weekly-plan','PUT',[0,0,0,1,2,2,4].map(weekday=>({weekday,activity_type_id:id,hours:2})));
  await new Promise(resolve=>{contents.once('did-finish-load',resolve);contents.reload();});
  await until(ready,'reload');
  await navigate('weekly');
  for(const width of [1800,980,480]){
    window.setSize(width,1000);await new Promise(r=>setTimeout(r,120));
    const sizes=await js(`Array.from(document.querySelectorAll('.weekly-plan-day'),el=>({height:el.getBoundingClientRect().height,scroll:el.scrollWidth,width:el.clientWidth,rows:Array.from(el.querySelectorAll('.weekly-plan-row'),r=>r.getBoundingClientRect().height)}))`);
    assert.ok(sizes[0].height>sizes[1].height+100,JSON.stringify(sizes));
    assert.ok(sizes.every(s=>s.scroll<=s.width+1),JSON.stringify(sizes));
    assert.ok(sizes[0].rows.every(h=>Math.abs(h-sizes[1].rows[0])<2));
    await fs.writeFile(path.join(output,`issue81-week-${width}.png`),(await contents.capturePage()).toPNG());
  }
  window.setSize(1400,1000);
  await navigate('activities');
  await js(`document.querySelector('#add-activity').click()`);
  assert.equal(await js(`document.querySelector('#activity-settings-rows tr:last-child button').classList.contains('secondary-button')`),true);
  await js(`document.querySelector('#activity-settings-rows tr:last-child button').focus()`);
  contents.sendInputEvent({type:'keyDown',keyCode:'Return'});contents.sendInputEvent({type:'char',keyCode:'\r'});contents.sendInputEvent({type:'keyUp',keyCode:'Return'});
  await until(()=>js(`document.querySelectorAll('#activity-settings-rows tr').length===1`),'discard');
  assert.equal(await js(`document.activeElement.id`),'add-activity');
  await navigate('calendar');
  await js(`document.querySelector('#complete-month').focus();document.querySelector('#complete-month').click()`);
  assert.equal(await js(`document.activeElement.textContent.trim()`),'Abbrechen');
  await fs.writeFile(path.join(output,'issue81.png'),(await contents.capturePage()).toPNG());
  contents.sendInputEvent({type:'keyDown',keyCode:'Tab'});contents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
  assert.equal(await js(`document.activeElement.value`),'confirm');
  contents.sendInputEvent({type:'keyDown',keyCode:'Tab'});contents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
  await until(()=>js(`document.activeElement.value==='cancel'`),'tab wraps inside modal');
  contents.sendInputEvent({type:'keyDown',keyCode:'Escape'});contents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await until(()=>js(`!document.querySelector('#complete-month-dialog').open && document.activeElement.id==='complete-month'`),'escape focus');
  await new Promise(r=>setTimeout(r,80));
  await js(`document.querySelector('#complete-month').click();document.querySelector('#complete-month-dialog button[value=cancel]').click()`);
  await until(()=>js(`!document.querySelector('#complete-month-dialog').open && document.activeElement.id==='complete-month'`),'cancel focus');
  await new Promise(r=>setTimeout(r,80));
  assert.equal(await js(`document.querySelector('#calendar-success').hidden`),true);
  await js(`document.querySelector('#complete-month').click();document.querySelector('#complete-month-dialog button[value=confirm]').focus()`);
  contents.sendInputEvent({type:'keyDown',keyCode:'Return'});contents.sendInputEvent({type:'char',keyCode:'\r'});contents.sendInputEvent({type:'keyUp',keyCode:'Return'});
  await until(()=>js(`!document.querySelector('#calendar-success').hidden && !document.querySelector('#complete-month').disabled`),'confirmed');
  await navigate('invoice');
  await js(`document.querySelector('[name=additional_tax_info]').value=${JSON.stringify(note)};document.querySelector('[name=additional_tax_info]').form.requestSubmit()`);
  await until(async()=> (await api('/api/organization/settings')).additional_tax_info===note,'saved tax notice');
  await fs.mkdir(path.join(output,'exports'),{recursive:true});
  await until(()=>js(`!document.querySelector('#choose-invoice-export').disabled`),'settings unlocked');
  await js(`document.querySelector('#choose-invoice-export').click()`);
  await until(()=>js(`document.querySelector('#invoice-export-path').textContent.includes('exports')`),'chosen folder');
  await api('/api/calendar/2025/1');
  // A separate month with a completed manual entry gives predictable PDF content.
  await api('/api/trainings','POST',{training_date:'2025-01-02',activity_type_id:id,hours:2,status:'completed'});
  const preview=await api('/api/invoices/preview','POST',{year:2025,month:1,render_pdf:true});
  await fs.writeFile(path.join(output,'issue81-preview.pdf'),Buffer.from(preview.pdf_base64,'base64'));
  await navigate('calendar');
  await js(`document.querySelector('#invoice-month').value='2025-01';document.querySelector('#invoice-month').dispatchEvent(new Event('input'));document.querySelector('#invoice-preview-form').requestSubmit()`);
  await until(()=>js(`!document.querySelector('#invoice-preview').hidden && document.querySelector('#invoice-tax-notice').textContent===${JSON.stringify(note)}`),'visible tax notice');
  await js(`document.querySelector('#invoice-tax-notice').scrollIntoView({block:'center',behavior:'instant'})`);
  await new Promise(r=>setTimeout(r,150));
  await fs.writeFile(path.join(output,'issue81-tax-preview.png'),(await contents.capturePage()).toPNG());
  const invoice=await api('/api/invoices','POST',{year:2025,month:1});
  const pdfURL=new URL(`/api/invoices/${invoice.id}/pdf?profile_id=1`,origin).href;
  const downloaded=new Promise(resolve=>contents.session.once('will-download',(_e,item)=>item.once('done',(_e,state)=>resolve(state))));
  await js(`(()=>{const a=document.createElement('a');a.href=${JSON.stringify(pdfURL)};a.download='Rechnung.pdf';document.body.append(a);a.click();a.remove();})()`);
  assert.equal(await downloaded,'completed');
  assert.equal((await fs.readdir(path.join(output,'exports'))).filter(name=>name.endsWith('.pdf')).length,1);
  console.log('ISSUE81_OK');
}
run().then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1);});
