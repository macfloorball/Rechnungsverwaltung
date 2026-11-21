'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// Isolate the calendar's request/error handling; the actual desktop flow is
// additionally exercised with the browser DOM in the graphical integration test.
function calendar(fetch, lineEnding) {
  function node(){return {hidden:true,disabled:false,textContent:'',events:{},attributes:{},
    addEventListener(name,fn){this.events[name]=fn;},
    setAttribute(name,value){this.attributes[name]=value;},
    append(){},replaceChildren(...children){this.children=children;}};}
  const elements=new Map();
  const document={querySelector(selector){if(!elements.has(selector))elements.set(selector,node());return elements.get(selector);},addEventListener(){},dispatchEvent(){},createElement:node};
  const source=fs.readFileSync(path.join(__dirname,'../frontend/js/calendar.js'),'utf8')
    .replace(/\r?\n/g,lineEnding)
    .replace(/^import .*;\r?\n/,'').replace('export function initializeCalendar','function initializeCalendar');
  vm.runInNewContext(source+'\ninitializeCalendar();',{
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    document,fetch,bindTrainingEditor(){},window:{confirm:()=>false},Intl,Date,Error,
  });
  return elements;
}

for(const [ending,lineEnding] of [['LF','\n'],['CRLF','\r\n']])
for(const kind of ['HTTP','network'])test(`calendar shows ${kind} failures and recovers on retry (${ending})`,async()=>{
  let fail=true;
  const elements=calendar(async()=>{
    if(fail){if(kind==='network')throw Error('Verbindung unterbrochen');return {ok:false,status:503};}
    return {ok:true,json:async()=>({year:2026,month:11,days:[]})};
  },lineEnding);
  await new Promise(setImmediate);
  const message=elements.get('#calendar-error');
  assert.equal(message.hidden,false);
  assert.match(message.textContent,kind==='HTTP'?/HTTP 503/:/Verbindung unterbrochen/);
  assert.equal(elements.get('#calendar').attributes['aria-busy'],'false');
  assert.equal(elements.get('#next-month').disabled,false);
  fail=false;elements.get('#next-month').events.click();
  await new Promise(setImmediate);
  assert.equal(message.hidden,true);
  assert.ok(elements.get('#calendar').children.length>0);
});
