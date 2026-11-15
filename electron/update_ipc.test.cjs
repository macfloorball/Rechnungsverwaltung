'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerAppIPC, CHECK_UPDATES_CHANNEL, GET_UPDATE_STATUS_CHANNEL } = require('./ipc.cjs');

test('manual update IPC requires the exact trusted main frame, accepts no arguments and disposes all handlers', async () => {
  const handlers = new Map();
  const frame = { url: 'http://127.0.0.1:8000/' }, sender = { mainFrame: frame, isDestroyed: () => false };
  const window = { webContents: sender, isDestroyed: () => false };
  let checks = 0;
  const status = { state: 'up_to_date', currentVersion: '0.1.0' };
  const service = { getStatus: () => status, check: async () => { checks++; return status; } };
  const dispose = registerAppIPC({ app: { getVersion: () => '0.1.0' },
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), removeHandler: (channel) => handlers.delete(channel) },
    getMainWindow: () => window, getFrontendURL: () => 'http://127.0.0.1:8000/', getUpdateService: () => service });
  const check = handlers.get(CHECK_UPDATES_CHANNEL), event = { sender, senderFrame: frame };
  assert.deepEqual(await check(event), { ok: true, value: status });
  assert.deepEqual(handlers.get(GET_UPDATE_STATUS_CHANNEL)(event), { ok: true, value: status });
  assert.equal(check(event, 'https://attacker.invalid').error.code, 'INVALID_ARGUMENT');
  assert.equal(check({ sender, senderFrame: { url: frame.url } }).error.code, 'FORBIDDEN');
  frame.url = 'https://attacker.invalid';
  assert.equal(check(event).error.code, 'FORBIDDEN');
  frame.url = 'http://127.0.0.1:8000/';
  service.check = async () => { throw Error('private token'); };
  assert.equal(JSON.stringify(await check(event)).includes('private token'), false);
  assert.equal(checks, 1);
  dispose(); dispose();
  assert.equal(handlers.size, 0);
});
