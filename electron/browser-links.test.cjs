'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {invoicePDFURL,openInvoicePDF}=require('./browser-links.cjs');
const origin='http://127.0.0.1:8000/';

test('only exact invoice PDF URLs on the configured loopback origin are accepted',()=>{
  assert.equal(invoicePDFURL(origin+'api/invoices/12/pdf',origin),origin+'api/invoices/12/pdf');
  assert.equal(invoicePDFURL('http://[::1]:8123/api/invoices/1/pdf','http://[::1]:8123/'),'http://[::1]:8123/api/invoices/1/pdf');
  for(const url of [
    'https://example.org/api/invoices/1/pdf','file:///tmp/test.pdf','javascript:alert(1)',
    'http://127.0.0.1:8001/api/invoices/1/pdf','http://127.0.0.1.evil.test:8000/api/invoices/1/pdf',
    origin+'api/invoices/0/pdf',origin+'api/invoices/1/pdf?redirect=evil',origin+'api/invoices/1/pdf#test',
    origin+'api/invoices/../settings',origin+'api/invoices/%31/pdf',origin+'api/settings',
    'http://user:pass@127.0.0.1:8000/api/invoices/1/pdf',
  ])assert.equal(invoicePDFURL(url,origin),null,url);
});
test('browser handoff is limited to validated URLs and reports sanitized failures',async()=>{
  const urls=[];let errors=0;
  const shell={openExternal:async url=>{urls.push(url);}};
  assert.equal(openInvoicePDF('https://example.org',origin,shell,()=>errors++),false);
  assert.equal(openInvoicePDF(origin+'api/invoices/1/pdf',origin,shell,()=>errors++),true);
  await new Promise(setImmediate);
  assert.deepEqual(urls,[origin+'api/invoices/1/pdf']);assert.equal(errors,0);
  shell.openExternal=()=>{throw Error('private error');};
  openInvoicePDF(origin+'api/invoices/1/pdf',origin,shell,()=>errors++);
  await new Promise(setImmediate);assert.equal(errors,1);
});


test('profile PDF handoff accepts only one explicit positive profile ID',()=>{
  assert.equal(invoicePDFURL(origin+'api/invoices/12/pdf?profile_id=2',origin),origin+'api/invoices/12/pdf?profile_id=2');
  for (const query of ['?profile_id=0', '?profile_id=-1', '?profile_id=abc', '?profile_id=2&profile_id=1', '?profile_id=2&redirect=evil', '?profile_id=2/../1']) {
    assert.equal(invoicePDFURL(origin+'api/invoices/12/pdf'+query,origin),null);
  }
});

test('archived invoices have narrowly scoped local PDF links', () => {
  const origin = 'http://127.0.0.1:8000/';
  const url = origin + 'api/archived-profiles/2/invoices/12/pdf';
  assert.equal(invoicePDFURL(url, origin), url);
  for (const suffix of ['api/archived-profiles/0/invoices/12/pdf','api/archived-profiles/2/invoices/0/pdf','api/archived-profiles/2/invoices/12/pdf?redirect=evil','api/archived-profiles/2/invoices/12/signature']) {
    assert.equal(invoicePDFURL(origin + suffix, origin), null);
  }
});
