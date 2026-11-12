'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function run(file, requireMock, globals = {}) {
  vm.runInNewContext(readFileSync(path.join(__dirname, file), 'utf8'), {
    require: requireMock, console, __dirname, ...globals,
  }, { filename: file });
}

test('preload exposes only metadata and the named version method', () => {
  let exposed;
  run('preload.cjs', (name) => {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld: (key, api) => { exposed = { key, api }; } } };
  });
  assert.equal(exposed.key, 'ttcDesktop');
  assert.equal(exposed.api.apiVersion, 1);
  assert.deepEqual(Object.keys(exposed.api), ['apiVersion', 'getVersion']);
  assert.equal(typeof exposed.api.getVersion, 'function');
  assert.ok(Object.isFrozen(exposed.api));
});

test('main owns one window, clears closed reference and quits on Windows', async () => {
  const app = new EventEmitter();
  let ready;
  app.whenReady = () => new Promise((resolve) => { ready = resolve; });
  app.isReady = () => true;
  let quit = 0;
  app.quit = () => { quit++; };
  const exits = [];
  app.exit = (code) => exits.push(code);
  const proc = new EventEmitter();
  proc.platform = 'win32'; proc.env = {}; proc.argv = [];
  const windows = [];
  run('main.cjs', (name) => {
    if (name === 'electron') return { app, dialog: { showErrorBox: () => {} } };
    if (name === './ipc.cjs') return { registerAppIPC: () => () => {} };
    if (name === './identity.cjs') return { APP_NAME: 'TTC Rechnungsverwaltung', configureIdentity: () => {} };
    if (name === './startup.cjs') return { waitForFrontend: async () => {} };
    if (name === './config.cjs') return require('./config.cjs');
    if (name === './window.cjs') return { createMainWindow: () => {
      const win = new EventEmitter();
      win.isDestroyed = () => false;
      win.isMinimized = () => true;
      win.restore = () => { win.restored = true; };
      win.focus = () => { win.focused = true; };
      windows.push(win);
      return win;
    } };
    throw Error(name);
  }, { process: proc });
  ready(); await new Promise(setImmediate);
  assert.equal(windows.length, 1);
  app.emit('activate');
  assert.equal(windows.length, 1);
  assert.ok(windows[0].focused);
  assert.ok(windows[0].restored);
  windows[0].emit('closed'); app.emit('activate');
  assert.equal(windows.length, 2);
  app.emit('window-all-closed'); assert.equal(quit, 1);
  proc.emit('unhandledRejection', new Error('test failure'));
  assert.deepEqual(exits, [1]);
  proc.emit('uncaughtException', new Error('second failure'));
  assert.deepEqual(exits, [1]);
});
