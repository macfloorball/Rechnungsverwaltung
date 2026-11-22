'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the production renderer with a small DOM fixture. The integration test
// additionally checks the real archive, backend, CSS and Electron window.
function invoiceUI(create) {
  class Element {
    constructor() {
      this.hidden = true;
      this.disabled = false;
      this.textContent = '';
      this.value = '';
      this.events = {};
      this.attributes = {};
      this.children = [];
    }
    addEventListener(name, handler) { this.events[name] = handler; }
    setAttribute(name, value) { this.attributes[name] = value; }
    reportValidity() { return true; }
    replaceChildren() { this.children = []; }
    append(...children) { this.children.push(...children); }
    get firstElementChild() { return this.children[0]; }
  }
  const document = new EventTarget();
  const elements = new Map();
  document.querySelector = selector => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  document.createElement = () => new Element();
  const button = document.querySelector('#create-invoice');
  button.textContent = 'Rechnung erstellen und speichern';
  let posts = 0;
  let events = 0;
  document.addEventListener('invoice-created', () => { events++; });
  const source = fs.readFileSync(path.join(__dirname, '../frontend/js/invoice.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export function initializeInvoicePreview', 'function initializeInvoicePreview');
  vm.runInNewContext(source + '\ninitializeInvoicePreview();', {
    document, Event, Intl, Date, Error, profileUrl: url => url,
    HTMLElement: Element, HTMLFormElement: Element, HTMLInputElement: Element,
    HTMLButtonElement: Element, HTMLTableSectionElement: Element,
    HTMLTableCellElement: Element, HTMLAnchorElement: Element,
    fetch: async (url, options) => {
      if (url === '/api/invoices') {
        posts++;
        return create(options);
      }
      const period = JSON.parse(options.body);
      return { ok: true, json: async () => ({ ...period, invoice_number: period.invoice_number || '2026-01', total_amount_cents: 3000,
        items: [{ description: 'Training', training_date: '2026-11-01', hours: 2, amount_cents: 3000 }] }) };
    },
  });
  const get = selector => document.querySelector(selector);
  return {
    get, button,
    posts: () => posts, events: () => events,
    click: () => button.events.click(),
    preview: async (period = '2026-11') => {
      get('#invoice-month').value = period;
      get('#invoice-month').events.input();
      await get('#invoice-preview-form').events.submit({ preventDefault() {} });
    },
  };
}

const success = () => ({ ok: true, json: async () => ({ id: 7, year: 2026, month: 11 }) });

test('saving finishes visibly, notifies the archive and ignores repeated clicks', async () => {
  let finish;
  const ui = invoiceUI(() => new Promise(resolve => { finish = resolve; }));
  await ui.preview();
  const pending = ui.click();
  assert.equal(ui.button.attributes['aria-busy'], 'true');
  assert.equal(ui.button.textContent, 'Rechnung wird gespeichert …');
  assert.equal(ui.get('#invoice-month').disabled, true);
  assert.equal(ui.get('#load-invoice-preview').disabled, true);
  await ui.get('#invoice-preview-form').events.submit({ preventDefault() {} });
  assert.equal(ui.get('#invoice-month').disabled, true);
  assert.equal(ui.button.textContent, 'Rechnung wird gespeichert …');
  await ui.click();
  assert.equal(ui.posts(), 1);
  finish(success());
  await pending;
  assert.equal(ui.button.attributes['aria-busy'], 'false');
  assert.equal(ui.button.textContent, 'Rechnung gespeichert');
  assert.equal(ui.button.disabled, true);
  assert.equal(ui.get('#invoice-month').disabled, false);
  assert.equal(ui.get('#load-invoice-preview').disabled, false);
  assert.equal(ui.get('#open-invoice-pdf').href, '/api/invoices/7/pdf');
  assert.equal(ui.get('#open-invoice-pdf').hidden, false);
  assert.equal(ui.events(), 1);
  await ui.click();
  assert.equal(ui.posts(), 1);
  await ui.preview('2026-12');
  assert.equal(ui.button.disabled, false);
  assert.equal(ui.button.textContent, 'Rechnung erstellen und speichern');
  assert.equal(ui.get('#open-invoice-pdf').hidden, true);
});

for (const [name, create, message] of [
  ['HTTP detail', async () => ({ ok: false, status: 503, json: async () => ({ detail: 'Dokument konnte nicht gespeichert werden.' }) }), /Dokument konnte nicht gespeichert/],
  ['HTTP non-JSON', async () => ({ ok: false, status: 500, json: async () => { throw Error('not JSON'); } }), /HTTP 500/],
  ['network', async () => { throw Error('Verbindung unterbrochen'); }, /Verbindung unterbrochen/],
  ['invalid success JSON', async () => ({ ok: true, json: async () => { throw Error('Ungültige Serverantwort'); } }), /Ungültige Serverantwort/],
  ['duplicate', async () => ({ ok: false, status: 409, json: async () => ({ detail: 'Für diesen Monat wurde bereits eine Rechnung erstellt' }) }), /bereits eine Rechnung/],
]) {
  test(`${name}: error is visible, busy state ends and retry works`, async () => {
    let fail = true;
    const ui = invoiceUI(options => fail ? create(options) : success());
    await ui.preview();
    await ui.click();
    assert.equal(ui.get('#invoice-create-error').hidden, false);
    assert.match(ui.get('#invoice-create-error').textContent, message);
    assert.equal(ui.button.attributes['aria-busy'], 'false');
    assert.equal(ui.button.disabled, false);
    assert.equal(ui.button.textContent, 'Rechnung erstellen und speichern');
    assert.equal(ui.get('#invoice-month').disabled, false);
    assert.equal(ui.get('#load-invoice-preview').disabled, false);
    assert.equal(ui.events(), 0);
    fail = false;
    await ui.click();
    assert.equal(ui.get('#invoice-create-error').hidden, true);
    assert.equal(ui.button.textContent, 'Rechnung gespeichert');
    assert.equal(ui.events(), 1);
  });
}

test('manual local invoice date survives preview and save; editing invalidates preview', async () => {
  let saved;
  const ui = invoiceUI(options => { saved = JSON.parse(options.body); return success(); });
  const today = new Date();
  assert.equal(ui.get('#invoice-date').value, `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`);
  ui.get('#invoice-date').value = '2027-01-01';
  await ui.preview('2026-11');
  await ui.click();
  assert.equal(saved.invoice_date, '2027-01-01');
  await ui.preview();
  ui.get('#invoice-date').events.input();
  assert.equal(ui.button.disabled, true);
  assert.equal(ui.get('#invoice-preview').hidden, true);
});


test('manual number is optional, explicit and invalidates a previous preview', async () => {
  let saved;
  const ui = invoiceUI(options => { saved = JSON.parse(options.body); return success(); });
  await ui.preview();
  ui.get('#manual-invoice-number').value = 'RE-2026-04';
  ui.get('#manual-invoice-number').events.input();
  assert.equal(ui.button.disabled, true);
  assert.match(ui.get('#invoice-number-mode').textContent, /Manuelle/);
  await ui.preview();
  await ui.click();
  assert.equal(saved.invoice_number, 'RE-2026-04');
});
