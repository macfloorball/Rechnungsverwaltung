'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateController } = require('./update_controller.cjs');

function fixture() {
  let status = { state: 'available', currentVersion: '0.1.0', availableVersion: '0.2.0', requiresAuthentication: true, releaseNotes: 'Signed notes' };
  let candidate = { manifest: { version: '0.2.0' } }, observer;
  const writes = [];
  const service = { getStatus: () => status, getCandidate: () => candidate, check: async () => status,
    subscribe(fn) { observer = fn; return () => { observer = null; }; },
    async invalidate() { status = { ...status, state: 'idle', availableVersion: null }; candidate = null; observer?.(); } };
  const credentials = { setToken: async (token) => { writes.push(token); }, clear: async () => { writes.push('clear'); } };
  return { controller: createUpdateController({ service, credentials }), credentials, writes,
    set(next, offer = candidate) { status = { ...status, ...next }; candidate = offer; observer?.(); },
    disposed: () => observer === null };
}

test('automatic prompts are acknowledged in Main for the entire session; manual access remains available', () => {
  const f = fixture();
  assert.equal(f.controller.getStatus().promptVersion, '0.2.0');
  f.controller.acknowledge('0.2.0');
  assert.equal(f.controller.getStatus().promptVersion, null);
  const dispose = f.controller.subscribe(() => {});
  dispose();
  assert.equal(f.controller.getStatus().availableVersion, '0.2.0');
  f.controller.defer('0.2.0');
  assert.equal(f.controller.getStatus().deferred, true);
  f.set({ availableVersion: '0.3.0' }, { manifest: { version: '0.3.0' } });
  assert.equal(f.controller.getStatus().promptVersion, '0.3.0');
  f.controller.dispose(); assert.equal(f.disposed(), true);
});

test('stale consent and unavailable downloads are rejected without storing an installation instruction', () => {
  const f = fixture();
  assert.equal(f.controller.getStatus().canDownload, false);
  assert.throws(() => f.controller.request('0.1.0'), /UPDATE_CHANGED/);
  assert.throws(() => f.controller.request('0.2.0'), /DOWNLOAD_UNAVAILABLE/);
  f.set({}, null);
  assert.equal(f.controller.getStatus().error.code, 'UPDATE_CHANGED');
  assert.throws(() => f.controller.request('0.2.0'), /UPDATE_CHANGED/);
});

test('credential changes expose no token in status and invalidate cached update decisions', async () => {
  const f = fixture(), token = 'github_pat_ephemeral_fixture_only';
  const result = await f.controller.setAccess(token);
  assert.equal(result.state, 'idle');
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.deepEqual(f.writes, [token]);
  f.set({ requiresAuthentication: false });
  await assert.rejects(f.controller.setAccess(token), /CREDENTIALS_NOT_REQUIRED/);
  await f.controller.clearAccess();
  assert.equal(f.writes.at(-1), 'clear');
});

test('parallel credential writes are rejected rather than queued through the renderer', async () => {
  const f = fixture(); let resolve;
  f.credentials.setToken = () => new Promise((done) => { resolve = done; });
  const first = f.controller.setAccess('github_pat_ephemeral_fixture_only');
  await assert.rejects(f.controller.clearAccess(), /UPDATE_BUSY/);
  resolve(); await first;
});
