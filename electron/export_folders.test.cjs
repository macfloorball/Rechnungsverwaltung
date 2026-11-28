'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {createExportFolders} = require('./export_folders.cjs');

test('per-profile export choice persists; cancellation, reset, collisions and unavailable folders are safe', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-export-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const folder = path.join(root, 'PDF'); fs.mkdirSync(folder);
  let canceled = false; const errors = [];
  const window = new EventEmitter(); window.isDestroyed=()=>false;
  window.webContents={session:new EventEmitter()};
  const options={directory:path.join(root,'data'),getWindow:()=>window,dialog:{showOpenDialog:async()=>({canceled,filePaths:canceled?[]:[folder]}),showMessageBox:async(_w,error)=>errors.push(error)}};
  let service=createExportFolders(options);
  assert.equal(await service.choose(1),folder);
  service=createExportFolders(options);
  assert.equal(service.get(1),folder); assert.equal(service.get(2),'');
  canceled=true;assert.equal(await service.choose(1),folder);
  service.attach(window,'http://127.0.0.1:8000/');
  const targets=[];
  function download(url, contents=window.webContents){
    const item=new EventEmitter();item.getURL=()=>url;item.getFilename=()=> 'Rechnung.pdf';item.setSavePath=(value)=>targets.push(value);
    const event={preventDefault(){this.prevented=true;}};
    window.webContents.session.emit('will-download',event,item,contents);return {event,item};
  }
  const url='http://127.0.0.1:8000/api/invoices/1/pdf?profile_id=1';
  download(url);download(url);
  assert.equal(targets.length,2);assert.notEqual(targets[0],targets[1]);
  assert.equal(path.dirname(targets[0]),folder);
  download(url,{});download(url.replace('8000','8001'));download(url.replace('profile_id=1','profile_id=2'));
  assert.equal(targets.length,2);
  fs.rmdirSync(folder);assert.equal(download(url).event.prevented,true);assert.equal(errors.length,1);
  service.clear(1);assert.equal(createExportFolders(options).get(1),'');
  window.emit('closed');assert.equal(window.webContents.session.listenerCount('will-download'),0);
});
