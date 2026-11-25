'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, dialog, shell } = require('electron');
app.setPath('userData', process.env.TTC_DATA_DIRECTORY);
app.setPath('sessionData', process.env.TTC_DATA_DIRECTORY);
dialog.showErrorBox = (_title, message) => { throw Error(message); };
const handoffs=[]; shell.openExternal = async url => { handoffs.push(url); };
require('./electron/main.cjs');
const pause=()=>new Promise(resolve=>setTimeout(resolve,40));
async function until(check,label) {
  for(let i=0;i<400;i++){const result=await check();if(result)return result;await pause();}
  throw Error(`Timeout: ${label}`);
}
async function run(){
  await app.whenReady();
  const win=await until(()=>BrowserWindow.getAllWindows()[0],'window');
  const contents=win.webContents;
  const js=code=>contents.executeJavaScript(code,true);
  await until(()=>!contents.isLoading() && contents.getURL().startsWith('http:'),'frontend');
  await until(()=>js('!document.querySelector("#active-profile").disabled'),'profiles');
  const origin=new URL('/',contents.getURL());
  async function api(url,body,method='GET'){
    const response=await fetch(new URL(url,origin),{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    assert.ok(response.ok,await response.clone().text());return response.json();
  }
  if(process.env.TTC_TEST_RESUME!=='1'){
    const encoded=await js(`(()=>{const canvas=document.createElement('canvas');canvas.width=300;canvas.height=90;const c=canvas.getContext('2d');c.beginPath();c.moveTo(10,60);c.lineTo(100,20);c.lineTo(280,70);c.stroke();return canvas.toDataURL('image/png').split(',')[1]})()`);
    await api('/api/organization/signature',{data_base64:encoded},'POST');
    const activity=(await api('/api/settings',{activities:[{name:'Synthetisches Archivtraining',hourly_rate_cents:1000}]},'PUT')).activities[0];
    await api('/api/trainings',{training_date:'2025-01-02',activity_type_id:activity.id,hours:2,status:'completed'},'POST');
    const invoice=await api('/api/invoices',{year:2025,month:1,invoice_date:'2025-01-31'},'POST');
    const pdf=Buffer.from(await(await fetch(new URL(`/api/invoices/${invoice.id}/pdf`,origin))).arrayBuffer());
    await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT,'archived.pdf'),pdf);
    await api('/api/profiles',{name:'Weiter aktiv'},'POST');
    const finished=new Promise(resolve=>contents.once('did-finish-load',resolve));contents.reload();await finished;
    await until(()=>js('!document.querySelector("#active-profile").disabled'),'profiles refreshed');
    await js('document.querySelector("#delete-profile").click()');
    await until(()=>js('document.querySelector("#profile-delete-dialog").open'),'deletion summary');
    assert.match(await js('document.querySelector("#profile-delete-summary").textContent'),/Rechnungen.*schreibgeschützten Archiv/);
    const deleted=new Promise(resolve=>contents.once('did-finish-load',resolve));
    await js('document.querySelector("#confirm-profile-delete").click()');await deleted;
  }
  await until(()=>js('document.querySelector("#active-profile").value === "2" && !document.querySelector("#active-profile").disabled'),'active fallback');
  assert.deepEqual((await api('/api/profiles')).map(p=>p.id),[2]);
  const invoices=await api('/api/archived-profiles/1/invoices');assert.equal(invoices.length,1);
  const archivedURL=new URL(`/api/archived-profiles/1/invoices/${invoices[0].id}/pdf`,origin).href;
  assert.deepEqual(Buffer.from(await(await fetch(archivedURL)).arrayBuffer()),await fs.readFile(path.join(process.env.TTC_TEST_OUTPUT,'archived.pdf')));
  await js('document.querySelector("[data-view-link=management]").click();document.querySelector("#reload-archived-profiles").click()');
  await until(()=>js('document.querySelectorAll("#archived-profiles-list button").length === 1'),'archive list');
  await js('document.querySelector("#archived-profiles-list button").click()');
  await until(()=>js('!!document.querySelector("#archived-profile-invoices a[target=_blank]")'),'archive invoices');
  assert.equal(await js('document.querySelectorAll("#archived-profile-invoices button").length'),0);
  await js('document.querySelector("#archived-profile-invoices a[target=_blank]").click()');
  await until(()=>handoffs.length===1,'safe archived PDF handoff');assert.equal(handoffs[0],archivedURL);
  await js('document.querySelector("#archived-profiles-title").scrollIntoView({block:"center"})');await pause();
  await fs.writeFile(path.join(process.env.TTC_TEST_OUTPUT,'archive.png'),(await contents.capturePage()).toPNG());
  console.log(process.env.TTC_TEST_RESUME==='1'?'ARCHIVE_RESTART_OK':'ARCHIVE_OK');
}
run().then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1);});
