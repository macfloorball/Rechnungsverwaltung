'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({ busy=false, delayReady=false }={}) {
  let spawns=0;let stops=0;let failures=0;let resolveReady;let rejectReady;
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
      if(name==='./startup.cjs')return {waitForFrontend:()=>delayReady?new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;}):Promise.resolve()};
      return require(name);
    },
  });
  const backend=module.exports.createBackend({config:{mode:'development',url:'http://127.0.0.1:8000/'},root:__dirname,env:{},onFailure:()=>{failures++;}});
  return {backend,child,spawns:()=>spawns,stops:()=>stops,failures:()=>failures,ready:()=>resolveReady(),timeout:()=>rejectReady(Error('readiness timeout'))};
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

test('database startup failures produce a fixed actionable message', async () => {
  for (const code of ['missing', 'locked', 'corrupt', 'access', 'schema']) {
    const f = fixture({delayReady:true});
    const start = f.backend.start();
    await new Promise(setImmediate);
    f.child.databaseError = code;
    f.child.emit('exit', 1);
    await assert.rejects(start, /Datenbank/);
    await f.backend.stop();
  }
});


test('reload worker database errors remain actionable when its supervisor stays alive', async () => {
  const f = fixture({delayReady:true});
  const start = f.backend.start();
  await new Promise(setImmediate);
  f.child.databaseError = 'corrupt';
  f.timeout();
  await assert.rejects(start, /Datenbank.*beschädigt/);
  await f.backend.stop();
});

test('Dokumentenfehler liefern beim Start und nach Reload feste Handlungsanweisungen', async () => {
  for (const code of ['missing', 'access', 'space', 'exists', 'changed', 'invalid', 'unsupported', 'io']) {
    for (const reload of [false, true]) {
      const f = fixture({delayReady:true});
      const start = f.backend.start();
      await new Promise(setImmediate);
      f.child.documentError = code;
      if (reload) f.timeout();
      else f.child.emit('exit', 1);
      await assert.rejects(start, error => {
        assert.match(error.message, /Dokument|Datei/);
        assert.doesNotMatch(error.message, /private|Traceback|Python-Pakete/);
        return true;
      });
      await f.backend.stop();
    }
  }
});
