'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('navigation keeps mounted drafts, marks one active view and focuses its title without requests', () => {
  const names = ['calendar', 'invoice', 'weekly', 'activities', 'management'];
  let focused = null;
  const views = names.map(name => ({dataset:{view:name}, hidden:name !== 'calendar',
    draft:{value:`draft ${name}`}, querySelector(){return {focus(){focused = name;}};}}));
  const links = names.map(name => ({dataset:{viewLink:name}, attributes:name === 'calendar' ? {'aria-current':'page'} : {},
    setAttribute(key,value){this.attributes[key]=value;}, removeAttribute(key){delete this.attributes[key];},
    closest(){return this;}}));
  let onClick;
  const nav = {querySelectorAll:()=>links, contains:link=>links.includes(link), addEventListener(type, handler){assert.equal(type,'click');onClick=handler;}};
  const document = {querySelector:()=>nav, querySelectorAll:()=>views};
  const source = fs.readFileSync(path.join(__dirname,'../frontend/js/navigation.js'),'utf8').replace('export function','function');
  vm.runInNewContext(source+'\ninitializeNavigation();', {document,window:{scrollTo(){}},fetch(){assert.fail('Navigation must not request data');}});
  for (let turn=0;turn<20;turn++) for (const [index,link] of links.entries()) {
    let prevented=false;
    onClick({target:link,preventDefault(){prevented=true;}});
    assert.equal(prevented,true);
    assert.deepEqual(views.filter(view=>!view.hidden),[views[index]]);
    assert.deepEqual(links.filter(item=>item.attributes['aria-current']==='page'),[link]);
    if (turn || index) assert.equal(focused,names[index]);
    views.forEach((view,i)=>assert.equal(view.draft.value,`draft ${names[i]}`));
  }
});

test('view controls have unique IDs, with invoice and calendar in one view', () => {
  const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(ids.length,new Set(ids).size,'duplicate DOM IDs');
  const calendar=html.slice(html.indexOf('<div id="view-calendar"'),html.indexOf('<div id="view-invoice"'));
  assert.ok(calendar.indexOf('id="calendar"')<calendar.indexOf('id="invoice-preview-form"'));
  for(const id of ['calendar','invoice-preview-form','saved-invoices-rows','create-invoice','download-invoice-pdf']) assert.ok(calendar.includes(`id="${id}"`),id);
  for(const [view,form] of [['invoice','organization-settings-form'],['weekly','weekly-plan-form'],['activities','activity-settings-form'],['management','create-backup']]) {
    const section=html.slice(html.indexOf(`<div id="view-${view}"`) + 1).split(/<div id="view-/)[0];
    assert.match(section.split('>')[0],/ hidden$/);
    assert.ok(section.includes(`id="${form}"`));
  }
  assert.match(html,/<nav[^>]*aria-label="Hauptnavigation"/);
  assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
  assert.match(fs.readFileSync(path.join(__dirname,'../frontend/css/style.css'),'utf8'),/\[hidden\]\s*\{\s*display: none !important/);
});
