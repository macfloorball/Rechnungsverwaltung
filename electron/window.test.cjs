'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('closing during load does not reopen the window or report a spurious load failure', async () => {
  let rejectLoad;
  let window;
  const errors=[];
  class Window extends EventEmitter {
    constructor() {
      super(); window=this; this.destroyed=false; this.shown=false;
      this.webContents=new EventEmitter();
      this.webContents.session={setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}}};
      this.webContents.setWindowOpenHandler=()=>{};
    }
    loadURL(){return new Promise((_resolve,reject)=>{rejectLoad=reject;});}
    isDestroyed(){return this.destroyed;}
    show(){this.shown=true;}
  }
  const module={exports:{}};
  vm.runInNewContext(readFileSync(path.join(__dirname,'window.cjs'),'utf8'),{
    require(name){
      if(name==='electron')return {BrowserWindow:Window,screen:{getCursorScreenPoint:()=>({x:0,y:0}),getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1920,height:1080}})}};
      if(name==='./identity.cjs')return require('./identity.cjs');
      return require(name);
    },__dirname,module,console,URL,
  });
  module.exports.createMainWindow('http://127.0.0.1:8000/',error=>errors.push(error));
  window.destroyed=true;
  window.emit('closed');window.emit('ready-to-show');
  window.webContents.emit('did-fail-load',{},-2,'','',true);
  rejectLoad(new Error('window closed'));
  await new Promise(setImmediate);
  assert.equal(window.shown,false);
  assert.equal(errors.length,0);
});
