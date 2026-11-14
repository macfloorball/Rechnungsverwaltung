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
