'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { githubAPI } = require('./github_api.cjs');
const { sha256 } = require('./release_bundle.cjs');

test('private asset credentials never follow the GitHub CDN redirect', async () => {
  const calls = [];
  const bytes = Buffer.from('verified upload');
  const api = githubAPI('test-credential', async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset' } })
      : new Response(bytes);
  });
  await api.verifyAsset('owner/repository', { id: 1 }, { size: bytes.length, sha256: sha256(bytes) });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-credential');
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls[0].options.redirect, 'manual');
});

test('foreign redirects and tampered uploads are rejected', async () => {
  for (const location of ['http://release-assets.githubusercontent.com/asset', 'https://attacker.invalid/asset', 'https://user:password@objects.githubusercontent.com/asset']) {
    let calls = 0;
    const api = githubAPI('test', async () => { calls++; return new Response(null, { status: 302, headers: { location } }); });
    await assert.rejects(api.verifyAsset('owner/repository', { id: 1 }, { size: 3, sha256: sha256(Buffer.from('abc')) }), /umleitung/i);
    assert.equal(calls, 1);
  }
  const api = githubAPI('test', async () => new Response('bad'));
  await assert.rejects(api.verifyAsset('owner/repository', { id: 1 }, { size: 3, sha256: sha256(Buffer.from('abc')) }), /Prüfsumme/);
});

test('API errors omit response bodies and authenticated API requests never auto-redirect', async () => {
  const api = githubAPI('test', async (_url, options) => {
    assert.equal(options.redirect, 'error');
    return new Response('private-secret-response', { status: 403 });
  });
  await assert.rejects(api.request('GET', '/repos/owner/repo'), (error) => error.status === 403 && !error.message.includes('secret'));
  assert.throws(() => githubAPI(''));
});

test('repository archive collection remains bounded and returns only verified bytes', async () => {
  const bytes = Buffer.from('small signed repository archive'); let calls = 0;
  const api = githubAPI('test', async () => { calls++; return new Response(bytes); });
  assert.deepEqual(await api.verifyAsset('owner/repository', { id: 1 }, { size: bytes.length, sha256: sha256(bytes) }, true), bytes);
  for (const size of [64 * 1024 * 1024 + 1, NaN, -1]) await assert.rejects(api.verifyAsset('owner/repository', { id: 1 }, { size, sha256: sha256(bytes) }, true));
  assert.equal(calls, 1);
});
