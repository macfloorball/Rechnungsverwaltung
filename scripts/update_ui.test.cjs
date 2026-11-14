'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(initial = {}, enabled = true) {
  class Element {
    constructor(id) { this.id = id; this.hidden = false; this.disabled = false; this.textContent = ''; this.open = false; this.value = ''; this.attributes = new Map(); this.events = new Map(); }
    addEventListener(type, fn, options = {}) {
      const handlers = this.events.get(type) || new Set(); handlers.add(fn); this.events.set(type, handlers);
      options.signal?.addEventListener('abort', () => handlers.delete(fn), { once: true });
    }
    async emit(type, event = { preventDefault() {} }) { await Promise.all([...(this.events.get(type) || [])].map((fn) => fn(event))); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); if (name === 'value') this.value = ''; }
    closest() { return get('notes-details'); }
    showModal() { this.open = true; this.shows = (this.shows || 0) + 1; }
    close() { this.open = false; void document.emit('close'); }
    focus() { document.activeElement = this; }
  }
  const elements = new Map();
  const get = (id) => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  const document = new Element('document');
  document.documentElement = get('html'); document.defaultView = { addEventListener() {} };
  document.getElementById = get;
  document.querySelector = (selector) => selector === 'dialog[open]'
    ? [...elements.values()].find((node) => node.id.endsWith('dialog') && node.open) || null
    : [...elements.values()].find((node) => node.attributes.get('aria-busy') === 'true') || null;
  get('desktop-updates').hidden = true;
  let status = { state: 'idle', currentVersion: '0.1.0', availableVersion: null, promptVersion: null,
    requiresAuthentication: true, repository: 'owner/private', canDownload: false, error: null, ...initial };
  const calls = []; let subscriber;
  const api = { apiVersion: 1,
    getUpdateStatus: async () => ({ ok: true, value: status }),
    checkForUpdates: async () => ({ ok: true, value: status }),
    acknowledgeUpdate: async (version) => { calls.push(['ack', version]); status = { ...status, promptVersion: null }; return { ok: true, value: status }; },
    deferUpdate: async (version) => { calls.push(['later', version]); return { ok: true, value: status }; },
    requestUpdate: async (version) => { calls.push(['now', version]); return { ok: true, value: status }; },
    setUpdateAccessToken: async (token) => { calls.push(['token', token]); return { ok: true, value: status }; },
    clearUpdateAccessToken: async () => { calls.push(['clear']); return { ok: true, value: status }; },
    onUpdateStatus(fn) { subscriber = fn; return () => { subscriber = null; }; },
  };
  const source = fs.readFileSync(path.join(__dirname, '../frontend/js/updates.js'), 'utf8').replace('export function', 'function');
  const context = vm.createContext({ document, window: { ttcDesktop: enabled ? api : undefined }, AbortController, Promise, WeakMap, Set,
    MutationObserver: class { observe() {} disconnect() {} } });
  const dispose = vm.runInContext(source + '\ninitializeDesktopUpdates();', context);
  return { get, api, calls, dispose, document,
    publish(patch) { status = { ...status, ...patch }; subscriber?.(status); },
    text: () => [...elements.values()].map((node) => node.textContent).join('\n') };
}
const flush = async () => { await new Promise(setImmediate); };
const available = { state: 'available', availableVersion: '0.2.0', promptVersion: '0.2.0', releaseNotes: '<img src=x onerror=alert(1)>\nSigned notes' };

test('web frontend stays hidden without Electron and does not register a credential form', () => {
  const ui = fixture({}, false);
  assert.equal(ui.get('desktop-updates').hidden, true);
  assert.equal(ui.calls.length, 0);
});

test('available version dialog uses plain text, correct wording, safe capability and session suppression', async () => {
  const ui = fixture(available); await ui.dispose.ready; await flush();
  assert.equal(ui.get('desktop-update-dialog').open, true);
  assert.equal(ui.get('desktop-update-dialog-title').textContent, 'Update verfügbar – Version 0.2.0');
  assert.equal(ui.get('desktop-update-notes').textContent, available.releaseNotes);
  assert.equal(ui.get('desktop-update-now').disabled, true);
  await ui.get('desktop-update-later').emit('click'); await flush();
  assert.equal(ui.get('desktop-update-dialog').open, false);
  assert.deepEqual(ui.calls.at(-1), ['later', '0.2.0']);
  ui.publish(available); await flush();
  assert.equal(ui.get('desktop-update-dialog').shows, 1);
  await ui.get('show-desktop-update').emit('click'); await flush();
  assert.equal(ui.get('desktop-update-dialog').shows, 2);
  ui.dispose();
});

test('automatic prompt waits while another dialog is open', async () => {
  const ui = fixture(); ui.get('training-dialog').open = true;
  await ui.dispose.ready; ui.publish(available); await flush();
  assert.equal(ui.get('desktop-update-dialog').open, false);
  ui.get('training-dialog').close(); await flush();
  assert.equal(ui.get('desktop-update-dialog').open, true);
  ui.dispose();
});

test('future download capability requests only the displayed version and progress needs real numeric data', async () => {
  const ui = fixture({ ...available, canDownload: true }); await ui.dispose.ready; await flush();
  await ui.get('desktop-update-now').emit('click'); await flush();
  assert.deepEqual(ui.calls.at(-1), ['now', '0.2.0']);
  ui.publish({ state: 'downloading', download: { receivedBytes: 250, totalBytes: 1000 } });
  assert.equal(ui.get('desktop-update-progress').hidden, false);
  assert.equal(ui.get('desktop-update-progress-bar').value, 25);
  ui.publish({ download: { receivedBytes: 0, totalBytes: 0 } });
  assert.equal(ui.get('desktop-update-progress-text').textContent, 'Update wird heruntergeladen …');
  ui.dispose();
});

test('credential fields clear before IPC completes and raw transport errors never echo secrets', async () => {
  const ui = fixture(); await ui.dispose.ready;
  const secret = 'github_pat_ephemeral_fixture_only'; let reject;
  ui.api.setUpdateAccessToken = () => new Promise((_resolve, fail) => { reject = fail; });
  ui.get('desktop-update-token').value = secret;
  const pending = ui.get('desktop-update-access-form').emit('submit');
  assert.equal(ui.get('desktop-update-token').value, '');
  reject(Error(secret)); await pending; await flush();
  assert.equal(ui.text().includes(secret), false);
  assert.ok(ui.get('desktop-update-access-message').textContent);
  ui.dispose();
});

test('manual IPC failures stay visible and user input is removed during disposal', async () => {
  const ui = fixture(); await ui.dispose.ready;
  ui.api.checkForUpdates = async () => { throw Error('sensitive stack'); };
  await ui.get('check-desktop-updates').emit('click'); await flush();
  assert.equal(ui.get('desktop-update-error').hidden, false);
  assert.equal(ui.text().includes('sensitive stack'), false);
  ui.get('desktop-update-token').value = 'github_pat_ephemeral_fixture_only';
  ui.dispose(); ui.dispose();
  assert.equal(ui.get('desktop-update-token').value, '');
});
