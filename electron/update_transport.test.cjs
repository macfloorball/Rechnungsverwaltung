'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateTransport } = require('./update_transport.cjs');
const { createUpdateService } = require('./updates.cjs');
const { updateFixture } = require('../tests/update_fixture.cjs');

test('private GitHub API discovery integrates with the real signature verifier using bounded GETs only', async () => {
  const f = updateFixture(), urls = [];
  const fetchImpl = async (url, options) => {
    urls.push(url);
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, `Bearer ${f.token}`);
    assert.equal(options.credentials, 'omit');
    if (url.endsWith('/releases/assets/30')) return new Response(f.bytes);
    if (url.endsWith('/releases/assets/40')) return new Response(f.signature);
    if (url.includes('/releases?')) return Response.json([f.feedRelease]);
    return Response.json({ id: f.config.repositoryId, full_name: f.config.repository, private: true, archived: false });
  };
  const service = createUpdateService({ config: f.config, getToken: async () => f.token, now: () => f.now,
    transportFactory: (options) => createUpdateTransport({ ...options, fetchImpl }) });
  assert.equal((await service.check()).state, 'available');
  assert.equal(urls.length, 4);
  assert.equal(urls.some((url) => url.includes('/latest')), false);
  assert.equal(urls.some((url) => url.includes('/assets/10') || url.includes('/assets/20')), false);
});

test('private credentials are stripped on CDN redirects and forbidden redirect hosts are never contacted', async () => {
  const f = updateFixture();
  const calls = [];
  let transport = createUpdateTransport({ config: f.config, token: f.token, signal: new AbortController().signal,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return calls.length === 1
      ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/manifest' } }) : new Response(f.bytes); } });
  await transport.asset(30, 65536);
  assert.equal(calls[1].options.headers.Authorization, undefined);
  let connections = 0;
  transport = createUpdateTransport({ config: f.config, token: f.token, signal: new AbortController().signal,
    fetchImpl: async () => { connections++; return new Response(null, { status: 302, headers: { location: 'https://attacker.invalid/manifest' } }); } });
  await assert.rejects(transport.asset(30, 65536), /UNTRUSTED_SOURCE/);
  assert.equal(connections, 1);
});

test('missing access, API rate limits, oversized metadata and changed repository identity fail safely', async () => {
  const f = updateFixture();
  for (const [response, code] of [
    [new Response('', { status: 401 }), 'AUTH_REQUIRED'], [new Response('', { status: 404 }), 'AUTH_REQUIRED'],
    [new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }), 'RATE_LIMIT'],
    [new Response('', { status: 403, headers: { 'retry-after': '60' } }), 'RATE_LIMIT'],
    [Response.json({ id: 1, full_name: f.config.repository, private: true }), 'SOURCE_CHANGED'],
  ]) {
    const transport = createUpdateTransport({ config: f.config, token: f.token, signal: new AbortController().signal, fetchImpl: async () => response });
    await assert.rejects(transport.releases(), new RegExp(code));
  }
  const transport = createUpdateTransport({ config: f.config, token: f.token, signal: new AbortController().signal,
    fetchImpl: async () => new Response(Buffer.alloc(65537)) });
  await assert.rejects(transport.asset(30, 65536), /INVALID_METADATA/);
});

test('streaming keeps credentials on the fixed GitHub API, strips them at CDN and rejects unsafe redirects', async () => {
  const f = updateFixture(), payload = Buffer.from('verified-stream-fixture'), calls = [];
  const transport = createUpdateTransport({ config: f.config, token: f.token, signal: new AbortController().signal,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/package?signed=ephemeral' } })
        : new Response(payload, { headers: { 'content-length': String(payload.length) } });
    } });
  const parts = [];
  await transport.streamAsset(20, payload.length, async (part) => parts.push(part));
  assert.deepEqual(Buffer.concat(parts), payload);
  assert.equal(calls[0].url, `https://api.github.com/repos/${f.config.repository}/releases/assets/20`);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${f.token}`);
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.credentials, 'omit');
  for (const location of ['http://release-assets.githubusercontent.com/package', 'https://attacker.invalid/package',
    'https://user@objects.githubusercontent.com/package', 'https://api.github.com/repos/other/repo/releases/assets/20',
    'https://release-assets.githubusercontent.com:444/package', 'https://objects.githubusercontent.com/package#fragment']) {
    let count = 0;
    const unsafe = createUpdateTransport({ config: f.config, token: f.token, signal: new AbortController().signal,
      fetchImpl: async () => { count++; return new Response(null, { status: 302, headers: { location } }); } });
    await assert.rejects(unsafe.streamAsset(20, 20, async () => {}), /UNTRUSTED_SOURCE/);
    assert.equal(count, 1);
  }
});

test('metadata deadlines cancel a stalled reader and HTTP failures discard unread bodies', async () => {
  const f = updateFixture(); let cancelled = 0;
  const controller = new AbortController();
  const transport = createUpdateTransport({ config: f.config, signal: controller.signal,
    fetchImpl: async () => new Response(new ReadableStream({ start(c) { c.enqueue(Buffer.from('{')); }, cancel() { cancelled++; } })) });
  const pending = transport.releases();
  await new Promise(setImmediate); controller.abort(Error('deadline'));
  await assert.rejects(pending);
  assert.equal(cancelled, 1);
  const rejected = createUpdateTransport({ config: f.config, signal: new AbortController().signal,
    fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 401 }) });
  await assert.rejects(rejected.releases(), /AUTH_REQUIRED/);
  assert.equal(cancelled, 2);
});
