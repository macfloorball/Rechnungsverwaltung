'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const callbacks={};let window;let options;
  class Window extends EventEmitter {
    constructor(value) {
      super();options=value;window=this;
      this.webContents=new EventEmitter();
      this.webContents.session={
        setPermissionRequestHandler(fn){callbacks.permission=fn;},
        setPermissionCheckHandler(fn){callbacks.check=fn;},
        webRequest:{onBeforeRequest(fn){callbacks.request=fn;},onHeadersReceived(fn){callbacks.headers=fn;}},
      };
      this.webContents.setWindowOpenHandler=fn=>{callbacks.open=fn;};
    }
    loadURL(){return Promise.resolve();}
    isDestroyed(){return false;}
  }
  const module={exports:{}};
  vm.runInNewContext(readFileSync(path.join(__dirname,'window.cjs'),'utf8'),{
    require(name){
      if(name==='electron')return {BrowserWindow:Window,screen:{getCursorScreenPoint:()=>({x:0,y:0}),getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1920,height:1080}})}};
      if(name==='./identity.cjs')return require('./identity.cjs');
      return require(name);
    },__dirname,module,console,URL,
  });
  module.exports.createMainWindow('http://127.0.0.1:8000/',()=>{});
  return {callbacks,window,options};
}

test('renderer, preload, permissions and new windows are restricted',()=>{
  const {callbacks:c,options:o,window:w}=fixture();
  for(const key of ['contextIsolation','sandbox','webSecurity'])assert.equal(o.webPreferences[key],true);
  for(const key of ['nodeIntegration','nodeIntegrationInWorker','nodeIntegrationInSubFrames','webviewTag','allowRunningInsecureContent','experimentalFeatures','navigateOnDragDrop'])assert.equal(o.webPreferences[key],false);
  assert.ok(path.isAbsolute(o.webPreferences.preload));
  assert.equal(c.check(),false);
  c.permission(null,'camera',allowed=>assert.equal(allowed,false));
  assert.equal(c.open({url:'https://example.org'}).action,'deny');
  let blocked=false;w.webContents.emit('will-attach-webview',{preventDefault(){blocked=true;}});
  assert.ok(blocked);
});

test('only local resources and the known main document are allowed',()=>{
  const {callbacks:c,window:w}=fixture();
  function request(url,type){let cancel;c.request({url,resourceType:type},r=>{cancel=r.cancel;});return cancel;}
  assert.equal(request('http://127.0.0.1:8000/js/app.js','script'),false);
  assert.equal(request('http://127.0.0.1:8000/api/settings','xhr'),false);
  for(const url of ['https://example.org','file:///etc/passwd','data:text/html,test','javascript:alert(1)',
    'http://127.0.0.1.evil.test:8000/','http://127.0.0.1:8001/', 'http://user:pass@127.0.0.1:8000/']) {
    assert.equal(request(url,'xhr'),true,url);
  }
  assert.equal(request('http://127.0.0.1:8000/','subFrame'),true);
  assert.equal(request('http://127.0.0.1:8000/api/settings','mainFrame'),true);
  assert.equal(request('http://127.0.0.1:8000/#calendar','mainFrame'),false);
  for(const name of ['will-navigate','will-redirect']) {
    for(const url of ['https://example.org','file:///tmp/test','http://127.0.0.1:8000/api/settings']) {
      let blocked=false;w.webContents.emit(name,{preventDefault(){blocked=true;}},url);assert.ok(blocked);
    }
    let blocked=false;w.webContents.emit(name,{preventDefault(){blocked=true;}},'http://127.0.0.1:8000/#calendar');assert.equal(blocked,false);
  }
});

test('CSP forbids inline/eval, frames and plugins without dropping server policies',()=>{
  const {callbacks:c}=fixture();let headers;
  c.headers({url:'http://127.0.0.1:8000/',resourceType:'mainFrame',responseHeaders:{'content-security-policy':["upgrade-insecure-requests"],'X-Test':['kept']}},r=>{headers=r.responseHeaders;});
  const policies=headers['Content-Security-Policy'];
  assert.equal(policies.length,2);
  assert.equal(policies[0],'upgrade-insecure-requests');
  for(const expected of ["script-src 'self'","connect-src 'self'","object-src 'none'","frame-src 'none'","base-uri 'none'"])assert.ok(policies[1].includes(expected));
  assert.ok(!policies[1].includes('unsafe-'));
  assert.equal(headers['X-Test'][0],'kept');
});
