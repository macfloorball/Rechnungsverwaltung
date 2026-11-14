'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { registerAppIPC, ACK_UPDATE_CHANNEL, DEFER_UPDATE_CHANNEL, REQUEST_UPDATE_CHANNEL,
  SET_UPDATE_ACCESS_CHANNEL, CLEAR_UPDATE_ACCESS_CHANNEL, UPDATE_STATUS_CHANNEL, INSTALL_UPDATE_CHANNEL } = require('./ipc.cjs');

test('all UI actions validate frame and payload; event delivery is restricted and disposed', async () => {
  const handlers = new Map(), sent = [], calls = [];
  const frame = { url: 'http://127.0.0.1:8000/' };
  const sender = { mainFrame: frame, isDestroyed: () => false, send: (...args) => sent.push(args) };
  const window = { webContents: sender, isDestroyed: () => false }, event = { sender, senderFrame: frame };
  let callback, detached = false;
  const controller = { getStatus: () => ({}), check: async () => ({}),
    acknowledge: async (version) => calls.push(version), defer: async (version) => calls.push(version),
    request: async (version) => calls.push(version), install: async (version) => calls.push(version), setAccess: async (token) => calls.push(token), clearAccess: async () => calls.push('clear'),
    subscribe(fn) { callback = fn; return () => { detached = true; }; } };
  const dispose = registerAppIPC({ app: { getVersion: () => '0.1.0' }, getMainWindow: () => window,
    getFrontendURL: () => 'http://127.0.0.1:8000/', getUpdateService: () => controller, getUpdateController: () => controller,
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: (name) => handlers.delete(name) } });
  for (const channel of [ACK_UPDATE_CHANNEL, DEFER_UPDATE_CHANNEL, REQUEST_UPDATE_CHANNEL, INSTALL_UPDATE_CHANNEL, SET_UPDATE_ACCESS_CHANNEL, CLEAR_UPDATE_ACCESS_CHANNEL]) {
    assert.equal(handlers.get(channel)({ sender, senderFrame: { url: frame.url } }, '0.2.0').error.code, 'FORBIDDEN');
  }
  assert.equal(handlers.get(REQUEST_UPDATE_CHANNEL)(event, { path: '/tmp/setup.exe' }).error.code, 'INVALID_ARGUMENT');
  assert.equal(handlers.get(INSTALL_UPDATE_CHANNEL)(event, { path: '/tmp/setup.exe' }).error.code, 'INVALID_ARGUMENT');
  assert.equal((await handlers.get(INSTALL_UPDATE_CHANNEL)(event, '0.2.0')).ok, true);
  assert.equal(handlers.get(SET_UPDATE_ACCESS_CHANNEL)(event, 'line\nbreak').error.code, 'INVALID_ARGUMENT');
  assert.equal(handlers.get(CLEAR_UPDATE_ACCESS_CHANNEL)(event, '/private/file').error.code, 'INVALID_ARGUMENT');
  assert.equal((await handlers.get(DEFER_UPDATE_CHANNEL)(event, '0.2.0')).ok, true);
  controller.setAccess = async () => { throw Error('raw secret token'); };
  assert.equal(JSON.stringify(await handlers.get(SET_UPDATE_ACCESS_CHANNEL)(event, 'github_pat_test_only_not_real')).includes('raw secret'), false);
  dispose.bindUpdates(controller);
  callback({ state: 'available' });
  assert.equal(sent[0][0], UPDATE_STATUS_CHANNEL);
  frame.url = 'https://attacker.invalid/';
  callback({ state: 'available' });
  assert.equal(sent.length, 1);
  dispose(); dispose();
  assert.equal(detached, true); assert.equal(handlers.size, 0);
});

test('preload event subscriptions omit Electron events and expose an idempotent unsubscribe', async () => {
  let api, listener, removed = 0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8'), {
    require(name) { assert.equal(name, 'electron'); return {
      contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
      ipcRenderer: { on(channel, fn) { assert.equal(channel, UPDATE_STATUS_CHANNEL); listener = fn; },
        removeListener(channel, fn) { assert.equal(channel, UPDATE_STATUS_CHANNEL); assert.equal(fn, listener); removed++; },
        async invoke() { throw Error('should not invoke invalid arguments'); } },
    }; },
  });
  let args;
  const off = api.onUpdateStatus((...values) => { args = values; });
  const status = { state: 'available' };
  listener({ sender: 'private-electron-event' }, status);
  assert.deepEqual(args, [status]);
  off(); off(); assert.equal(removed, 1);
  assert.equal((await api.requestUpdate('https://attacker.invalid')).error.code, 'INVALID_ARGUMENT');
  assert.equal((await api.setUpdateAccessToken('short')).error.code, 'INVALID_ARGUMENT');
  assert.equal(api.invoke, undefined); assert.equal(api.on, undefined);
});
