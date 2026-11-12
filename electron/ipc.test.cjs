'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { registerAppIPC, GET_VERSION_CHANNEL } = require('./ipc.cjs');

function fixture() {
  let handler;let calls=0;let removed=0;
  const frame={url:'http://127.0.0.1:8000/#calendar'};
  const sender={mainFrame:frame,isDestroyed:()=>false};
  const window={webContents:sender,isDestroyed:()=>false};
  const app={getVersion:()=>{calls++;return '0.1.0';}};
  const dispose=registerAppIPC({ipcMain:{handle(channel,fn){assert.equal(channel,GET_VERSION_CHANNEL);handler=fn;},removeHandler(channel){assert.equal(channel,GET_VERSION_CHANNEL);removed++;}},app,getMainWindow:()=>window,getFrontendURL:()=> 'http://127.0.0.1:8000/'});
  return {app,frame,sender,window,invoke:(event={sender,senderFrame:frame},...args)=>handler(event,...args),dispose,calls:()=>calls,removed:()=>removed};
}

test('version request from current main frame succeeds and handler disposes once',()=>{
  const f=fixture();assert.deepEqual(f.invoke(),{ok:true,value:'0.1.0'});
  assert.equal(f.calls(),1);
  f.dispose();f.dispose();assert.equal(f.removed(),1);
});
test('foreign windows, subframes, missing frames and destroyed windows are rejected',()=>{
  const f=fixture();
  for(const event of [{sender:{},senderFrame:f.frame},{sender:f.sender,senderFrame:{url:f.frame.url}},{sender:f.sender,senderFrame:null}]) {
    assert.equal(f.invoke(event).error.code,'FORBIDDEN');
  }
  f.window.isDestroyed=()=>true;
  assert.equal(f.invoke().error.code,'FORBIDDEN');assert.equal(f.calls(),0);
});
test('untrusted origins, paths, credentials and arguments cannot invoke app methods',()=>{
  const f=fixture();
  for(const url of ['https://example.org','file:///tmp/test','http://127.0.0.1:8001/', 'http://127.0.0.1:8000/api/settings', 'http://127.0.0.1:8000/?x=1','http://user:pass@127.0.0.1:8000/']) {
    f.frame.url=url;assert.equal(f.invoke().error.code,'FORBIDDEN',url);
  }
  f.frame.url='http://127.0.0.1:8000/';
  for(const value of [undefined,null,'channel',{path:'/private'}])assert.equal(f.invoke(undefined,value).error.code,'INVALID_ARGUMENT');
  assert.equal(f.calls(),0);
});
test('main errors do not leak exception messages or stacks',()=>{
  const f=fixture();f.app.getVersion=()=>{throw Error('private path /secret');};
  const result=f.invoke();assert.equal(result.error.code,'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(result).includes('secret'));
});
test('preload fixes channel, validates arguments and sanitizes transport failures',async()=>{
  let api;let calls=0;let fail=false;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'preload.cjs'),'utf8'),{
    require(name){assert.equal(name,'electron');return {
      contextBridge:{exposeInMainWorld(_key,value){api=value;}},
      ipcRenderer:{async invoke(channel,...args){calls++;assert.equal(channel,GET_VERSION_CHANNEL);assert.equal(args.length,0);if(fail)throw Error('private transport detail');return {ok:true,value:'0.1.0'};}},
    };},
  });
  assert.equal((await api.getVersion()).value,'0.1.0');
  assert.equal((await api.getVersion('arbitrary-channel')).error.code,'INVALID_ARGUMENT');
  assert.equal(calls,1);
  fail=true;const result=await api.getVersion();
  assert.equal(result.error.code,'IPC_UNAVAILABLE');assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal(api.invoke,undefined);assert.equal(api.send,undefined);assert.equal(api.on,undefined);
});
