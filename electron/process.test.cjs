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

test('preload exposes only named update methods without generic IPC', () => {
  let exposed;
  run('preload.cjs', (name) => {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld: (key, api) => { exposed = { key, api }; } } };
  });
  assert.equal(exposed.key, 'ttcDesktop');
  assert.equal(exposed.api.apiVersion, 1);
  assert.deepEqual(Object.keys(exposed.api), ['apiVersion', 'getVersion', 'getUpdateStatus', 'checkForUpdates', 'acknowledgeUpdate', 'deferUpdate', 'requestUpdate', 'cancelUpdateDownload', 'installUpdate', 'setUpdateAccessToken', 'clearUpdateAccessToken', 'onUpdateStatus']);
  assert.equal(typeof exposed.api.getVersion, 'function');
  assert.ok(Object.isFrozen(exposed.api));
});

test('main owns one window, clears closed reference and quits on Windows', async () => {
  const app = new EventEmitter();
  let ready;
  app.whenReady = () => new Promise((resolve) => { ready = resolve; });
  app.isReady = () => true;
  app.requestSingleInstanceLock = () => true;
  app.getAppPath = () => __dirname;
  app.getPath = () => '/test/user-data';
  let quit = 0;
  app.quit = () => {
    let prevented=false;
    app.emit('before-quit',{preventDefault(){prevented=true;}});
    if (!prevented) quit++;
  };
  let backendStarts=0;let backendStops=0;
  const exits = [];
  app.exit = (code) => exits.push(code);
  const proc = new EventEmitter();
  proc.platform = 'win32'; proc.env = {}; proc.argv = [];
  const windows = [];
  run('main.cjs', (name) => {
    if (name === 'electron') return { app, dialog: { showErrorBox: () => {} } };
    if (name === './updates.cjs') return { createDesktopUpdates: () => ({ service: { start() {}, stop() {} } }) };
    if (name === './ipc.cjs') return { registerAppIPC: () => () => {} };
    if (name === './identity.cjs') return { APP_NAME: 'TTC Rechnungsverwaltung', configureIdentity: () => {} };
    if (name === './backend.cjs') return { createBackend: (options) => {
      assert.equal(options.env.TTC_DATA_DIRECTORY, '/test/user-data');
      return {start:async()=>{backendStarts++;},stop:async()=>{backendStops++;return false;}};
    } };
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
  app.emit('window-all-closed');
  app.quit();
  await new Promise(setImmediate);
  assert.equal(quit, 1);
  assert.equal(backendStarts,1);assert.equal(backendStops,1);
  proc.emit('unhandledRejection', new Error('test failure'));
  assert.deepEqual(exits, []);
  proc.emit('uncaughtException', new Error('second failure'));
  assert.deepEqual(exits, []);
});

test('a secondary Electron instance never starts a backend', () => {
  const app = new EventEmitter();
  let quit = 0;
  app.requestSingleInstanceLock = () => false;
  app.quit = () => { quit++; };
  const proc = new EventEmitter();
  run('main.cjs', (name) => {
    if (name === 'electron') return { app };
    if (name === './identity.cjs') return { configureIdentity() {}, APP_NAME: 'Test' };
    if (name === './backend.cjs') return { createBackend() { throw Error('secondary instance must not start backend'); } };
    return {};
  }, { process: proc });
  assert.equal(quit, 1);
});

for (const scenario of ['startup-failure', 'runtime-failure', 'cleanup-failure', 'forced-cleanup']) {
  test(`main handles ${scenario} with exactly one backend shutdown and failure exit`, async () => {
    const app = new EventEmitter();
    app.requestSingleInstanceLock = () => true;
    app.isReady = () => true;
    app.getAppPath = () => __dirname;
  app.getPath = () => '/test/user-data';
    app.whenReady = async () => {};
    let shutdowns = 0;
    let prompts = 0;
    let onFailure;
    const exits = [];
    app.exit = code => exits.push(code);
    app.quit = () => { app.emit('before-quit', { preventDefault() {} }); };
    const proc = new EventEmitter();
    proc.platform = 'win32'; proc.env = {}; proc.argv = [];
    run('main.cjs', name => {
      if (name === 'electron') return { app, dialog: { showErrorBox() { prompts++; } } };
      if (name === './identity.cjs') return { APP_NAME: 'Test', configureIdentity() {} };
      if (name === './config.cjs') return { getDesktopConfig: () => ({ url: 'http://127.0.0.1:8000/' }) };
      if (name === './updates.cjs') return { createDesktopUpdates: () => ({ service: { start() {}, stop() {} } }) };
      if (name === './ipc.cjs') return { registerAppIPC: () => () => {} };
      if (name === './window.cjs') return { createMainWindow: () => new EventEmitter() };
      if (name === './backend.cjs') return { createBackend(options) {
        onFailure = options.onFailure;
        return {
          async start() { if (scenario === 'startup-failure') throw new Error('start failed'); },
          async stop() {
            shutdowns++;
            if (scenario === 'cleanup-failure') throw new Error('cleanup failed');
            return scenario === 'forced-cleanup';
          },
        };
      } };
      throw new Error(name);
    }, { process: proc });
    await new Promise(setImmediate);
    if (scenario !== 'startup-failure') {
      if (scenario === 'runtime-failure') onFailure(new Error('backend failed'));
      else app.quit();
      app.quit();
      await new Promise(setImmediate);
    }
    assert.equal(shutdowns, 1);
    assert.deepEqual(exits, [1]);
    assert.equal(prompts, ['startup-failure', 'runtime-failure'].includes(scenario) ? 1 : 0);
  });
}

for (const scenario of ['factory', 'start']) {
  test(`optional update ${scenario} failure leaves main window and backend usable`, async () => {
    const app = new EventEmitter(), proc = new EventEmitter();
    let windows = 0, stops = 0, updateStops = 0;
    const messages = [], exits = [], logs = [];
    Object.assign(app, { requestSingleInstanceLock: () => true, whenReady: async () => {},
      getAppPath: () => __dirname, getPath: () => '/unused-test-profile', exit: (code) => exits.push(code),
      quit() { app.emit('before-quit', { preventDefault() {} }); } });
    Object.assign(proc, { platform: 'linux', env: {}, argv: [] });
    run('main.cjs', (name) => {
      if (name === 'electron') return { app, dialog: { showErrorBox: (...args) => messages.push(args) } };
      if (name === './identity.cjs') return { APP_NAME: 'Test', configureIdentity() {} };
      if (name === './config.cjs') return { getDesktopConfig: () => ({ url: 'http://127.0.0.1:8000/' }) };
      if (name === './ipc.cjs') return { registerAppIPC: () => () => {} };
      if (name === './backend.cjs') return { createBackend: () => ({ start: async () => {}, stop: async () => { stops++; return false; } }) };
      if (name === './window.cjs') return { createMainWindow: () => { windows++; return new EventEmitter(); } };
      if (name === './updates.cjs') return { createDesktopUpdates() {
        assert.equal(windows, 1, 'window opens before update initialization');
        if (scenario === 'factory') throw Error('secret token /private/path');
        return { service: { start() { throw Error('secret token /private/path'); }, stop() { updateStops++; } } };
      } };
      throw Error(name);
    }, { process: proc, console: { error: (...args) => logs.push(args.join(' ')) } });
    await new Promise(setImmediate);
    assert.equal(windows, 1);
    assert.equal(stops, 0);
    assert.deepEqual(exits, []);
    assert.deepEqual(messages, []);
    assert.equal(logs.join('\n').includes('secret token'), false);
    app.quit();
    await new Promise(setImmediate);
    assert.equal(stops, 1);
    assert.equal(updateStops, scenario === 'start' ? 1 : 0);
  });
}
