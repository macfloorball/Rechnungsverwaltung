'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({ busy=false, delayReady=false }={}) {
  let spawns=0;let stops=0;let failures=0;let resolveReady;
  const child=new EventEmitter();
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'backend.cjs'),'utf8'),{
    module,Promise,Error,require(name){
      if(name==='node:fs')return {existsSync:()=>true};
      if(name==='../scripts/run.cjs')return {
        launchConfig:()=>({url:'http://127.0.0.1:8000/'}),validateFrontend(){},
        async checkPort(){if(busy)throw Error('Port belegt');},
        spawnBackend(){spawns++;return child;},async stopTree(){stops++;return false;},
      };
      if(name==='./startup.cjs')return {waitForFrontend:()=>delayReady?new Promise(resolve=>{resolveReady=resolve;}):Promise.resolve()};
      return require(name);
    },
  });
  const backend=module.exports.createBackend({config:{mode:'development',url:'http://127.0.0.1:8000/'},root:__dirname,env:{},onFailure:()=>{failures++;}});
  return {backend,child,spawns:()=>spawns,stops:()=>stops,failures:()=>failures,ready:()=>resolveReady()};
}

test('start and shutdown are idempotent and ownership is kept in the backend controller',async()=>{
  const f=fixture();const first=f.backend.start();assert.equal(f.backend.start(),first);await first;
  assert.equal(f.spawns(),1);const stop=f.backend.stop();assert.equal(f.backend.stop(),stop);await stop;
  f.child.emit('exit',0);assert.equal(f.stops(),1);assert.equal(f.failures(),0);
});
test('a port conflict never starts or stops an external backend',async()=>{
  const f=fixture({busy:true});await assert.rejects(f.backend.start(),/Port belegt/);await f.backend.stop();
  assert.equal(f.spawns(),0);assert.equal(f.stops(),0);
});
test('quit while checking the port prevents a late spawn',async()=>{
  const f=fixture();const start=f.backend.start();await f.backend.stop();await start;assert.equal(f.spawns(),0);
});
test('spawn failures abort startup and runtime crashes are reported',async()=>{
  const f=fixture({delayReady:true});const start=f.backend.start();await new Promise(setImmediate);
  f.child.emit('error',Error('private detail'));await assert.rejects(start,/Python-Pfad/);await f.backend.stop();
  const running=fixture();await running.backend.start();running.child.emit('exit',1);assert.equal(running.failures(),1);await running.backend.stop();
});
