'use strict';
// Real Electron/Chromium, isolated profile, synthetic mouse strokes only.
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
  for (let i=0; i<400; i++) { const result = await check(); if (result) return result; await pause(); }
  throw Error(`Timeout: ${label}`);
}
async function run() {
  await app.whenReady();
  const win = await until(() => BrowserWindow.getAllWindows()[0], 'window');
  const contents = win.webContents;
  const js = code => contents.executeJavaScript(code, true);
  await until(() => !contents.isLoading() && contents.getURL().startsWith('http:'), 'frontend');
  await until(() => js('!!document.querySelector(".signature-thumbnail")'), 'signature module');
  const origin = new URL('/', contents.getURL());
  async function api(url, body, method='GET') {
    const response = await fetch(new URL(url, origin), {method, headers:{'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {})});
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  }
  if (process.env.TTC_TEST_RESUME === '1') {
    const signature = await api('/api/organization/signature');
    assert.ok(signature.data_base64);
    const invoices = await api('/api/invoices');
    const saved = await api(`/api/invoices/${invoices[0].id}/signature`);
    assert.equal(saved.signature.x_mm, 60);
    console.log('SIGNATURES_RESTART_OK'); return;
  }
  await js('document.querySelector("[data-view-link=invoice]").click()');
  await until(() => js('!document.querySelector("#save-organization-settings").disabled'), 'settings');
  await js(`document.querySelector('[name=issuer_first_name]').value='Test';document.querySelector('[name=issuer_last_name]').value='Beispiel';document.querySelector('#organization-settings-form').requestSubmit()`);
  await until(() => js('!document.querySelector("#organization-settings-success").hidden'), 'saved name');
  await js('document.querySelector("[data-draw]").click()');
  async function drag(selector, dx, dy) {
    win.focus(); await pause();
    await js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const box = await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    const x=Math.round(box.x), y=Math.round(box.y);
    contents.sendInputEvent({type:'mouseMove',x,y});
    contents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1}); await pause();
    for (let step=1;step<=10;step++) { contents.sendInputEvent({type:'mouseMove',x:x+Math.round(dx*step/10),y:y+Math.round(dy*step/10),button:'left'}); await pause(); }
    contents.sendInputEvent({type:'mouseUp',x:x+dx,y:y+dy,button:'left',clickCount:1});
    await pause();
  }
  await drag('.signature-dialog canvas',100,-35);
  await drag('.signature-dialog canvas',60,25);
  await js('document.querySelector("[data-undo]").click();document.querySelector("[data-save]").click()');
  await until(() => js('!document.querySelector(".signature-dialog").open'), 'saved drawn signature');
  // Exercise PNG import through the real file input, not only drawing/API upload.
  await js(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=400;canvas.height=100;
    const ctx=canvas.getContext('2d');ctx.beginPath();ctx.moveTo(10,70);ctx.lineTo(80,20);ctx.lineTo(380,30);ctx.stroke();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const transfer=new DataTransfer();transfer.items.add(new File([blob],'synthetic.png',{type:'image/png'}));
    const input=document.querySelector('.organization-settings-group input[type=file][accept="image/png,.png"]');
    input.files=transfer.files;input.dispatchEvent(new Event('change'));
  })()`);
  await until(async()=> (await api('/api/organization/signature')).image_width===400,'PNG import');
  const profile = await api('/api/organization/signature');
  assert.ok(profile.data_base64);
  const activity = (await api('/api/settings',{activities:[{name:'Künstliches Testtraining',hourly_rate_cents:1500}]},'PUT')).activities[0];
  await api('/api/trainings',{training_date:'2025-01-02',activity_type_id:activity.id,hours:2,status:'completed'},'POST');
  await js(`document.querySelector('[data-view-link=calendar]').click();document.querySelector('#invoice-month').value='2025-01';document.querySelector('#invoice-date').value='2025-01-31';document.querySelector('#invoice-preview-form').requestSubmit()`);
  await until(() => js('!!document.querySelector(".signature-overlay") && !document.querySelector("#create-invoice").disabled'), 'PDF render under CSP');
  // The same gesture at half zoom must still update stored millimetres.
  await js(`const zoom=document.querySelector('.signature-preview-editor input[type=range]');zoom.value='50';zoom.dispatchEvent(new Event('input'))`);
  const before = Number(await js('document.querySelector("#invoice-preview .signature-fields input[type=number]").value'));
  await drag('#invoice-preview .signature-overlay',25,0);
  await until(() => js('!document.querySelector("#create-invoice").disabled'), 'drag re-render');
  const after=Number(await js('document.querySelector("#invoice-preview .signature-fields input[type=number]").value'));
  if (after <= before) await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT,'gesture-failure.png'),(await contents.capturePage()).toPNG());
  assert.ok(after > before, `Drag: ${before} -> ${after}`);
  await drag('#invoice-preview .signature-resize',10,0);
  await until(() => js('!document.querySelector("#create-invoice").disabled'), 'resize re-render');
  assert.equal((await api('/api/organization/signature')).x_mm, profile.x_mm);
  await js(`const fields=document.querySelectorAll('#invoice-preview .signature-fields input[type=number]');fields[0].value='60';fields[0].dispatchEvent(new Event('input'))`);
  await until(() => js('!document.querySelector("#create-invoice").disabled'), 'numeric layout');
  await js(`Array.from(document.querySelectorAll('#invoice-preview button')).find(b=>b.textContent==='Als Profilstandard speichern').click()`);
  await until(async () => (await api('/api/organization/signature')).x_mm === 60, 'explicit profile standard');
  await js(`const field=document.querySelector('#invoice-preview .signature-fields input[type=number]');field.value='75';field.dispatchEvent(new Event('input'))`);
  await until(() => js('!document.querySelector("#create-invoice").disabled'), 'individual layout');
  await js(`Array.from(document.querySelectorAll('#invoice-preview button')).find(b=>b.textContent==='Auf Profilstandard zurücksetzen').click()`);
  await until(() => js('document.querySelector("#invoice-preview .signature-fields input[type=number]").value === "60" && !document.querySelector("#create-invoice").disabled'), 'reset to standard');
  await js('document.querySelector("#create-invoice").click()');
  await until(() => js('!document.querySelector("#open-invoice-pdf").hidden'), 'saved invoice');
  const invoice=(await api('/api/invoices'))[0];
  const saved=await api(`/api/invoices/${invoice.id}/signature`);
  assert.equal(saved.signature.x_mm,60);
  assert.equal(saved.signature.name,'Test Beispiel');
  const original=Buffer.from(await (await fetch(new URL(`/api/invoices/${invoice.id}/pdf`,origin))).arrayBuffer());
  await api('/api/organization/signature', {enabled:false,x_mm:25,y_mm:245,width_mm:50}, 'PUT');
  assert.deepEqual(Buffer.from(await (await fetch(new URL(`/api/invoices/${invoice.id}/pdf`,origin))).arrayBuffer()),original);
  await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT,'signatures.png'),(await contents.capturePage()).toPNG());
  console.log('SIGNATURES_OK');
}
run().then(() => app.quit()).catch(error => {console.error(error);app.exit(1);});
