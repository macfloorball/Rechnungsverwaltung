'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateService, createDesktopUpdates } = require('./updates.cjs');
const { updateFixture } = require('../tests/update_fixture.cjs');

function service(f, extra = {}) {
  return createUpdateService({ config: f.config, now: () => f.now, getToken: async () => f.token,
    transportFactory: () => f.transport, minimumIntervalMs: 0, ...extra });
}

test('manual detection returns only verified version and signed notes; no package is downloaded', async () => {
  const f = updateFixture();
  const ids = [], asset = f.transport.asset;
  f.transport.asset = async (id) => { ids.push(id); return asset(id); };
  const s = service(f);
  const status = await s.check();
  assert.equal(status.state, 'available');
  assert.equal(status.availableVersion, '0.2.0');
  assert.equal(status.releaseNotes, 'Signed release notes <b>as text</b>');
  assert.deepEqual(ids, [30, 40]);
  assert.equal(JSON.stringify(status).includes(f.token), false);
  assert.equal(JSON.stringify(status).includes('https://'), false);
  const copy = s.getCandidate(); copy.manifestBytes.fill(0);
  assert.notDeepEqual(s.getCandidate().manifestBytes, copy.manifestBytes);
  assert.ok(Object.isFrozen(s.getCandidate().manifest));
});

test('parallel startup and manual requests share exactly one pending check', async () => {
  const f = updateFixture();
  let resolve, calls = 0;
  f.transport.releases = () => { calls++; return new Promise((done) => { resolve = done; }); };
  const s = service(f), first = s.check(), second = s.check();
  assert.equal(first, second);
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  resolve([f.feedRelease]);
  assert.equal((await first).state, 'available');
});

test('missing private access reports authentication required without making a network call', async () => {
  const f = updateFixture();
  const s = service(f, { getToken: async () => null, transportFactory: () => { throw Error('must not connect'); } });
  assert.equal((await s.check()).state, 'authentication_required');
  assert.equal(s.getCandidate(), null);
});

test('network failures are sanitized and a later retry can succeed', async () => {
  const f = updateFixture();
  f.transport.releases = async () => { throw Error(`DNS /secret/path ${f.token}`); };
  const s = service(f);
  const status = await s.check();
  assert.equal(status.error.code, 'NETWORK');
  assert.equal(JSON.stringify(status).includes(f.token), false);
  assert.equal(JSON.stringify(status).includes('/secret'), false);
  f.transport.releases = async () => [f.feedRelease];
  assert.equal((await s.check()).state, 'available');
});

test('invalid signatures never offer an update and current/newer installed versions cannot downgrade', async () => {
  const f = updateFixture();
  f.transport.asset = async (id) => id === 30 ? f.bytes : Buffer.alloc(64);
  assert.equal((await service(f).check()).error.code, 'INVALID_SIGNATURE');
  f.transport.asset = async () => { throw Error('must not fetch old metadata'); };
  assert.equal((await service(f, { getHighestVersion: () => '0.3.0' }).check()).state, 'up_to_date');
});

test('total deadline also covers hung credential access and stop cancels an in-flight request', async () => {
  const f = updateFixture();
  const s = service(f, { getToken: () => new Promise(() => {}), timeoutMs: 15 });
  assert.equal((await s.check()).error.code, 'TIMEOUT');
  const next = service(f, { getToken: () => new Promise(() => {}) });
  const request = next.check();
  next.stop();
  assert.equal((await request).state, 'disabled');
  assert.equal(next.getCandidate(), null);
});

test('automatic checks are delayed, recurrent, bounded and disposed without keeping Node alive', async () => {
  const f = updateFixture(), jobs = new Map(); let id = 0;
  const timers = { setTimeout(fn, delay) { const handle = { id: ++id, unref() {} }; jobs.set(handle, { fn, delay }); return handle; }, clearTimeout(handle) { jobs.delete(handle); } };
  const s = service(f, { timers, random: () => 0.5 });
  s.start(); s.start();
  assert.equal(jobs.size, 1);
  const [first, job] = [...jobs][0];
  assert.equal(job.delay, 3000); jobs.delete(first); job.fn();
  await s.check();
  assert.ok([...jobs.values()].some((entry) => entry.delay === 6 * 3600000));
  s.stop(); s.stop();
  assert.equal(jobs.size, 0);
});

test('disabled development builds never read credentials or start timers; initialization has no I/O', async () => {
  const f = updateFixture();
  const controller = createDesktopUpdates({ app: { isPackaged: false, getVersion: () => '0.1.0', getPath: () => '/not/accessed' }, metadata: f.metadata });
  controller.credentials.getToken = () => { throw Error('not used'); };
  controller.service.start();
  assert.equal((await controller.service.check()).state, 'disabled');
  controller.service.stop();
});

test('manual polling is throttled and expired candidates are no longer returned for installation', async () => {
  const f = updateFixture(); let now = f.now, calls = 0;
  const releases = f.transport.releases;
  f.transport.releases = () => { calls++; return releases(); };
  const s = service(f, { now: () => now, minimumIntervalMs: 30000 });
  await s.check(); await s.check();
  assert.equal(calls, 1);
  now += 91 * 86400000;
  assert.equal(s.getCandidate(), null);
});

test('throwing or rejecting status listeners cannot fail the app or update check', async () => {
  const f = updateFixture(), s = service(f);
  const dispose = s.subscribe(async () => { throw Error('unhandled listener failure'); });
  s.subscribe(() => { throw Error('synchronous listener failure'); });
  assert.equal((await s.check()).state, 'available');
  await new Promise(setImmediate);
  dispose(); s.stop();
});

test('changing access cancels old checks and resets throttling without reviving stale offers', async () => {
  const f = updateFixture(); let resolve;
  f.transport.releases = () => new Promise((done) => { resolve = done; });
  const s = service(f, { minimumIntervalMs: 30000 });
  const pending = s.check();
  await new Promise(setImmediate);
  await s.invalidate();
  await pending;
  assert.equal(s.getStatus().state, 'idle');
  assert.equal(s.getCandidate(), null);
  f.transport.releases = async () => [f.feedRelease];
  assert.equal((await s.check()).state, 'available');
  resolve([f.feedRelease]);
  await new Promise(setImmediate);
  assert.equal(s.getStatus().state, 'available');
  assert.equal(s.getCandidate().manifest.version, '0.2.0');
  s.stop();
});

test('timeout during version-history lookup cannot make a late network request', async () => {
  const f = updateFixture(); let resolve, calls = 0;
  f.transport.releases = async () => { calls++; return [f.feedRelease]; };
  const s = service(f, { getHighestVersion: () => new Promise(done => { resolve = done; }), timeoutMs: 15 });
  assert.equal((await s.check()).error.code, 'TIMEOUT');
  resolve('0.1.0'); await new Promise(setImmediate);
  assert.equal(calls, 0); assert.equal(s.getCandidate(), null);
});

test('background checks do not invalidate an offer during a busy download or installation', async () => {
  const f = updateFixture(); let busy = false, calls = 0;
  const releases = f.transport.releases;
  f.transport.releases = () => { calls++; return releases(); };
  const s = service(f, { canCheck: () => !busy });
  await s.check(); busy = true;
  assert.equal((await s.check()).state, 'available');
  assert.equal(calls, 1); assert.ok(s.getCandidate());
});

test('DNS, refused connections and resets produce safe errors without retaining an install candidate', async () => {
  for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET']) {
    const f = updateFixture();
    f.transport.releases = async () => { throw Object.assign(Error('private token and diagnostic path'), { code }); };
    const s = service(f), result = await s.check();
    assert.equal(result.error.code, 'NETWORK');
    assert.equal(JSON.stringify(result).includes('diagnostic'), false);
    assert.equal(s.getCandidate(), null); s.stop();
  }
});
