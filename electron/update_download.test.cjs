'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createUpdateDownloader } = require('./update_download.cjs');
const { createUpdateService } = require('./updates.cjs');
const { createUpdateController } = require('./update_controller.cjs');
const { createUpdateTransport } = require('./update_transport.cjs');
const { signedManifest } = require('../scripts/release_bundle.cjs');
const { updateFixture } = require('../tests/update_fixture.cjs');

async function fixture(t, platform = 'linux', options = {}) {
  const f = updateFixture(platform), payload = Buffer.alloc(1000001, 42);
  f.packages.find((a) => a.platform === platform).sha256 = createHash('sha256').update(payload).digest('hex');
  const packet = signedManifest(f.policy, f.release, f.packages, 'Signed download fixture', f.privateKey, new Date(f.now));
  f.bytes = packet.bytes; f.signature = packet.signature;
  f.feedRelease.assets.find((a) => a.id === 30).size = f.bytes.length;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'ttc-download-'));
  const cache = path.join(profile, 'updates', 'downloads');
  const calls = [], statuses = [];
  const holder = { response: () => new Response(new ReadableStream({ start(controller) {
    holder.now += 101;
    controller.enqueue(payload.subarray(0, 400000)); controller.enqueue(payload.subarray(400000)); controller.close();
  } }), { headers: { 'content-length': String(payload.length) } }), now: f.now };
  const fetchImpl = async (url, request) => {
    calls.push({ url, request });
    if (url.endsWith('/assets/30')) return new Response(f.bytes);
    if (url.endsWith('/assets/40')) return new Response(f.signature);
    if (url.includes('/assets/')) return holder.response();
    if (url.endsWith('/releases/100')) return Response.json(f.feedRelease);
    if (url.includes('/releases?')) return Response.json([f.feedRelease]);
    return Response.json({ id: f.config.repositoryId, full_name: f.config.repository, private: true, archived: false });
  };
  const transportFactory = (args) => createUpdateTransport({ ...args, fetchImpl });
  const service = createUpdateService({ config: f.config, getToken: async () => f.token, now: () => holder.now, transportFactory, minimumIntervalMs: 0 });
  assert.equal((await service.check()).state, 'available');
  const downloader = createUpdateDownloader({ config: f.config, profile, getCandidate: service.getCandidate,
    getToken: async () => f.token, now: () => holder.now, transportFactory, ...options });
  downloader.subscribe((status) => statuses.push(status));
  t.after(async () => { await downloader.stop(); service.stop(); await fs.rm(profile, { recursive: true, force: true }); });
  return { f, payload, profile, cache, calls, statuses, holder, service, downloader,
    controller: createUpdateController({ service, credentials: { clear: async () => {}, setToken: async () => {} }, downloader }) };
}
async function settled(downloader) {
  const until = Date.now() + 3000;
  while (downloader.isBusy()) { if (Date.now() > until) throw Error('download did not settle'); await new Promise((r) => setTimeout(r, 5)); }
  return downloader.getStatus();
}
async function empty(f) { assert.deepEqual(await fs.readdir(f.cache).catch((e) => { if (e.code === 'ENOENT') return []; throw e; }), []); }
async function receiving(f, bytes) {
  const deadline = Date.now() + 3000;
  while (f.downloader.getStatus()?.download?.receivedBytes !== bytes) {
    assert.equal(f.downloader.isBusy(), true, 'download ended before receiving the partial payload');
    assert.ok(Date.now() < deadline, 'partial download did not start');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('consent streams a signed Linux package into private storage, verifies disk bytes and exposes no paths over IPC', async (t) => {
  const f = await fixture(t);
  assert.equal(f.controller.getStatus().canDownload, true);
  assert.equal(f.calls.some((a) => a.url.endsWith('/assets/20')), false);
  const initial = f.controller.request('0.2.0');
  assert.equal(initial.state, 'downloading');
  assert.throws(() => f.controller.request('0.2.0'), /DOWNLOAD_BUSY/);
  assert.equal((await settled(f.downloader)).state, 'downloaded');
  const verified = f.downloader.getVerified();
  assert.deepEqual(await fs.readFile(verified.file), f.payload);
  assert.equal((await fs.stat(verified.file)).mode & 0o111, 0);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(verified.file)).mode & 0o077, 0);
    assert.equal((await fs.stat(verified.slot)).mode & 0o077, 0);
  }
  assert.equal(f.statuses.some((s) => s?.download?.receivedBytes === 400000), true);
  assert.equal(f.statuses.some((s) => s?.download?.phase === 'verifying'), true);
  const publicStatus = JSON.stringify(f.controller.getStatus());
  for (const forbidden of [f.profile, f.f.token, 'assetId', 'https://', 'manifestBytes']) assert.equal(publicStatus.includes(forbidden), false);
  await f.downloader.reset(); await empty(f);
});

test('Windows selects only the signed NSIS asset; download never executes it', async (t) => {
  const f = await fixture(t, 'win32');
  f.controller.request('0.2.0');
  assert.equal((await settled(f.downloader)).state, 'downloaded');
  assert.match(f.downloader.getVerified().file, /windows-x64-setup\.exe$/);
  assert.equal(f.calls.some((a) => a.url.endsWith('/assets/10')), true);
  assert.equal(f.calls.some((a) => a.url.endsWith('/assets/20')), false);
});

for (const [name, response, code] of [
  ['truncated body', () => new Response(Buffer.alloc(1000000, 42)), 'DOWNLOAD_SIZE'],
  ['excess body', () => new Response(Buffer.alloc(1000002, 42)), 'DOWNLOAD_SIZE'],
  ['wrong signed digest', () => new Response(Buffer.alloc(1000001, 43)), 'DOWNLOAD_HASH'],
  ['wrong content length', () => new Response('bad', { headers: { 'content-length': '3' } }), 'DOWNLOAD_SIZE'],
  ['partial HTTP response', () => new Response('', { status: 206 }), 'DOWNLOAD_SIZE'],
  ['encoded payload', () => new Response('', { headers: { 'content-encoding': 'gzip' } }), 'DOWNLOAD_SIZE'],
  ['broken stream', () => new Response(new ReadableStream({ start(c) { c.enqueue(Buffer.alloc(50)); c.error(Error('secret network stack')); } })), 'NETWORK'],
]) test(`${name} is rejected and all partial files are removed`, async (t) => {
  const f = await fixture(t); f.holder.response = response;
  f.controller.request('0.2.0');
  const result = await settled(f.downloader);
  assert.equal(result.error.code, code); assert.equal(f.downloader.getVerified(), null);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  await empty(f);
  // Explicit manual recheck is the only retry; a clean new stream succeeds.
  f.holder.response = () => new Response(f.payload);
  await f.controller.check(); f.controller.request('0.2.0');
  assert.equal((await settled(f.downloader)).state, 'downloaded');
});

test('space shortage and redirected cache directories fail before package retrieval', async (t) => {
  const f = await fixture(t, 'linux', { statfs: async () => ({ bavail: 1n, bsize: 1n }) });
  f.controller.request('0.2.0');
  assert.equal((await settled(f.downloader)).error.code, 'DOWNLOAD_SPACE');
  assert.equal(f.calls.some((a) => a.url.endsWith('/assets/20')), false); await empty(f);
  const other = await fixture(t);
  await fs.mkdir(path.join(other.profile, 'updates'), { mode: 0o700 });
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ttc-download-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'keep'), 'sentinel');
  await fs.symlink(outside, other.cache, process.platform === 'win32' ? 'junction' : 'dir');
  other.controller.request('0.2.0');
  assert.equal((await settled(other.downloader)).error.code, 'DOWNLOAD_STORAGE');
  assert.equal(await fs.readFile(path.join(outside, 'keep'), 'utf8'), 'sentinel');
});

test('unsigned, expired, stale and downgraded consent never fetches a package', async (t) => {
  const f = await fixture(t);
  assert.throws(() => f.controller.request('0.1.0'), /UPDATE_CHANGED/);
  const original = f.service.getCandidate();
  for (const candidate of [
    { ...original, signature: Buffer.alloc(64) },
    { ...original, manifestBytes: Buffer.from('{}') },
  ]) {
    const dl = createUpdateDownloader({ config: f.f.config, profile: f.profile, getCandidate: () => candidate, now: () => f.f.now });
    assert.throws(() => dl.start('0.2.0'), /INVALID_SIGNATURE/);
    await dl.stop();
  }
  f.holder.now += 366 * 86400000;
  assert.throws(() => f.controller.request('0.2.0'), /UPDATE_CHANGED/);
  assert.equal(f.calls.some((a) => a.url.endsWith('/assets/20')), false);
});

test('release mutation or expiry during streaming discards the complete file', async (t) => {
  const f = await fixture(t);
  f.holder.response = () => { f.holder.now += 366 * 86400000; return new Response(f.payload); };
  f.controller.request('0.2.0');
  assert.equal((await settled(f.downloader)).error.code, 'EXPIRED_METADATA'); await empty(f);
  const changed = await fixture(t);
  changed.f.feedRelease.draft = true;
  changed.controller.request('0.2.0');
  assert.equal((await settled(changed.downloader)).error.code, 'INVALID_METADATA'); await empty(changed);
  assert.equal(changed.calls.some((a) => a.url.endsWith('/assets/20')), false);
});

test('hung access has a bounded deadline and shutdown aborts a stalled stream with cleanup', async (t) => {
  const f = await fixture(t, 'linux', { getToken: () => new Promise(() => {}), timeoutMs: 25, idleTimeoutMs: 15 });
  f.controller.request('0.2.0');
  assert.equal((await settled(f.downloader)).error.code, 'DOWNLOAD_TIMEOUT'); await empty(f);
  const stalled = await fixture(t, 'linux', { idleTimeoutMs: 100 });
  let cancelled = false;
  stalled.holder.response = () => new Response(new ReadableStream({ start(c) { c.enqueue(Buffer.alloc(50)); }, cancel() { cancelled = true; } }));
  stalled.controller.request('0.2.0');
  // The real stream reader must also settle on cancellation, not retain a lock.
  await new Promise((r) => setTimeout(r, 25));
  await stalled.downloader.stop();
  assert.equal(stalled.downloader.getStatus(), null);
  assert.equal(cancelled, true); await empty(stalled);
});

test('disabled trust never starts I/O and stale private session slots are cleaned on a fresh attempt', async (t) => {
  const f = await fixture(t);
  const disabled = createUpdateDownloader({ config: { enabled: false }, profile: f.profile, getCandidate: () => { throw Error('must not read'); } });
  assert.throws(() => disabled.start('0.2.0'), /DOWNLOAD_UNAVAILABLE/); await disabled.stop();
  await fs.mkdir(f.cache, { recursive: true, mode: 0o700 });
  await fs.chmod(path.join(f.profile, 'updates'), 0o700);
  await fs.mkdir(path.join(f.cache, 'download-AbC123'), { mode: 0o700 });
  await fs.writeFile(path.join(f.cache, 'download-AbC123', 'package.part'), 'interrupted');
  f.controller.request('0.2.0');
  assert.equal((await settled(f.downloader)).state, 'downloaded');
  assert.equal((await fs.readdir(f.cache)).includes('download-AbC123'), false);
});

test('hash is checked against bytes reread from disk, including modifications after a valid stream chunk', async (t) => {
  const f = await fixture(t);
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  f.holder.response = () => new Response(new ReadableStream({ start(c) {
    c.enqueue(f.payload.subarray(0, 400000));
    gate.then(() => { c.enqueue(f.payload.subarray(400000)); c.close(); });
  } }));
  f.controller.request('0.2.0');
  const deadline = Date.now() + 2000;
  while (!f.statuses.some((s) => s?.download?.receivedBytes === 400000)) {
    if (Date.now() > deadline) throw Error('first chunk not written');
    await new Promise((r) => setTimeout(r, 5));
  }
  const [slot] = await fs.readdir(f.cache);
  const file = await fs.open(path.join(f.cache, slot, 'package.part'), 'r+');
  await file.write(Buffer.from([0]), 0, 1, 0); await file.close();
  finish();
  assert.equal((await settled(f.downloader)).error.code, 'DOWNLOAD_HASH'); await empty(f);
});

test('total deadline limits active transfers too, and a credential removal cancels without a second request', async (t) => {
  const f = await fixture(t, 'linux', { timeoutMs: 40, idleTimeoutMs: 1000 });
  f.holder.response = () => new Response(new ReadableStream({ start(c) { c.enqueue(f.payload.subarray(0, 20)); } }));
  f.controller.request('0.2.0');
  assert.equal((await settled(f.downloader)).error.code, 'DOWNLOAD_TIMEOUT'); await empty(f);
  const other = await fixture(t);
  other.holder.response = () => new Response(new ReadableStream({ start(c) { c.enqueue(other.payload.subarray(0, 20)); } }));
  other.controller.request('0.2.0');
  await receiving(other, 20);
  await other.controller.clearAccess();
  assert.equal(other.controller.getStatus().state, 'idle'); await empty(other);
  assert.equal(other.calls.filter((a) => a.url.endsWith('/assets/20')).length, 1);
});

test('user cancellation removes partial bytes, keeps local status usable and requires a fresh retry', async (t) => {
  const f = await fixture(t); let cancelled = false;
  f.holder.response = () => new Response(new ReadableStream({ start(c) { c.enqueue(f.payload.subarray(0, 20)); }, cancel() { cancelled = true; } }));
  f.controller.request('0.2.0');
  await receiving(f, 20);
  const status = await f.controller.cancel('0.2.0');
  assert.equal(status.state, 'cancelled'); assert.equal(status.error, null);
  assert.equal(cancelled, true); await empty(f);
  await assert.rejects(f.controller.cancel('0.1.0'), /UPDATE_CHANGED/);
  f.holder.response = () => new Response(f.payload);
  await f.controller.check(); f.controller.request('0.2.0');
  assert.equal((await settled(f.downloader)).state, 'downloaded');
});

test('a restart discards interrupted cache slots without touching credentials or personal files', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.cache, 'download-AbC123'), { recursive: true, mode: 0o700 });
  await fs.chmod(path.dirname(f.cache), 0o700);
  await fs.writeFile(path.join(f.cache, 'download-AbC123/package.part'), 'interrupted');
  const credentials = path.join(f.profile, 'updates/github-access.enc');
  await fs.writeFile(credentials, 'encrypted sentinel');
  await fs.writeFile(path.join(f.profile, 'personal.db'), 'unchanged');
  await f.downloader.recover();
  await empty(f);
  assert.equal(await fs.readFile(credentials, 'utf8'), 'encrypted sentinel');
  assert.equal(await fs.readFile(path.join(f.profile, 'personal.db'), 'utf8'), 'unchanged');
  assert.equal(f.downloader.getVerified(), null);
});

test('a killed downloader leaves no resumable trust and the next instance cleans its partial package', async (t) => {
  const { spawn } = require('node:child_process');
  const f = await fixture(t);
  await fs.mkdir(path.join(f.profile, 'updates'), { mode: 0o700 });
  await fs.writeFile(path.join(f.profile, 'updates/github-access.enc'), 'encrypted sentinel');
  await fs.writeFile(path.join(f.profile, 'personal.db'), 'untouched');
  const worker = String.raw`
    const {updateFixture}=require('./tests/update_fixture.cjs');
    const {createUpdateService}=require('./electron/updates.cjs');
    const {createUpdateDownloader}=require('./electron/update_download.cjs');
    (async()=>{
      const f=updateFixture();
      const service=createUpdateService({config:f.config,now:()=>f.now,getToken:async()=>f.token,transportFactory:()=>f.transport});
      await service.check();
      const downloader=createUpdateDownloader({config:f.config,profile:process.argv[1],now:()=>f.now,getToken:async()=>f.token,getCandidate:service.getCandidate,
        transportFactory:()=>({release:async()=>f.feedRelease,streamAsset:async(_id,_size,consume)=>{await consume(Buffer.alloc(100));process.stdout.write('PARTIAL_READY');await new Promise(()=>{});}})});
      downloader.start('0.2.0');
    })().catch(()=>process.exit(1));`;
  const child = spawn(process.execPath, ['-e', worker, f.profile], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('partial not written')), 5000);
    child.once('error', reject); child.once('exit', () => { clearTimeout(timer); reject(Error('worker exited early')); });
    child.stdout.on('data', data => { output += data; if (output.includes('PARTIAL_READY')) { clearTimeout(timer); resolve(); } });
  });
  const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exited;
  assert.equal((await fs.readdir(f.cache)).length, 1);
  await f.downloader.recover(); await empty(f);
  assert.equal(f.downloader.getVerified(), null);
  assert.equal(await fs.readFile(path.join(f.profile, 'updates/github-access.enc'), 'utf8'), 'encrypted sentinel');
  assert.equal(await fs.readFile(path.join(f.profile, 'personal.db'), 'utf8'), 'untouched');
});

test('synchronous status observers cannot start a second download before the first pending task is registered', async (t) => {
  const f = await fixture(t); let attempted = false, code;
  f.downloader.subscribe(status => {
    if (attempted || status?.state !== 'downloading') return;
    attempted = true;
    try { f.downloader.start('0.2.0'); } catch (error) { code = error.code; }
  });
  f.controller.request('0.2.0');
  assert.equal((await settled(f.downloader)).state, 'downloaded');
  assert.equal(code, 'DOWNLOAD_BUSY');
  assert.equal(f.calls.filter(c => c.url.endsWith('/assets/20')).length, 1);
});

test('a write callback finishing after cancellation cannot resurrect progress or a completed package', async (t) => {
  let finish, entered;
  const gate = new Promise(resolve => { finish = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, 'linux', { write: async (handle, ...args) => {
    const result = await handle.write(...args); entered(); await gate; return result;
  } });
  f.controller.request('0.2.0'); await started;
  assert.equal((await f.controller.cancel('0.2.0')).state, 'cancelled');
  finish(); await new Promise(setImmediate);
  assert.equal(f.downloader.getStatus().state, 'cancelled');
  assert.equal(f.downloader.isBusy(), false); assert.equal(f.downloader.getVerified(), null); await empty(f);
});
