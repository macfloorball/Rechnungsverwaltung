'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildFrontend } = require('../scripts/build_frontend.cjs');
const { waitForFrontend } = require('./startup.cjs');
const { getDesktopConfig } = require('./config.cjs');

test('production selects repository-relative build and configurable loopback origin', () => {
  const config = getDesktopConfig({ TTC_DESKTOP_PRODUCTION_URL: 'http://127.0.0.1:8123', TTC_DESKTOP_URL: 'http://127.0.0.1:9999' }, ['--desktop-production']);
  assert.equal(config.mode, 'production');
  assert.equal(config.url, 'http://127.0.0.1:8123/');
  assert.equal(config.buildDirectory, path.join(__dirname, '..', 'dist', 'frontend'));
});

test('build preserves static resources; readiness retries and checks build identity', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ttc-build-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'frontend', 'js'), { recursive: true });
  await fs.writeFile(path.join(root, 'frontend', 'index.html'), '<script src="js/app.js"></script>');
  await fs.writeFile(path.join(root, 'frontend', 'js', 'app.js'), '// unchanged');
  const manifest = await buildFrontend(root);
  assert.equal(await fs.readFile(path.join(root, 'dist/frontend/js/app.js'), 'utf8'), '// unchanged');
  assert.deepEqual(await buildFrontend(root), manifest);
  const config = { mode: 'production', url: 'http://127.0.0.1:8123/', buildDirectory: path.join(root, 'dist/frontend') };
  let calls = 0;
  let wrongBuild = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (++calls === 1) throw Error('server not ready');
    const body = url.pathname === '/api/health' ? JSON.stringify({ status: 'ok' })
      : url.pathname === '/desktop-build.json' ? JSON.stringify(wrongBuild ? { buildId: 'wrong' } : manifest)
      : url.pathname === '/' ? '<script src="js/app.js"></script>' : 'asset';
    return new Response(body);
  });
  await waitForFrontend(config, { timeoutMs: 500, intervalMs: 1 });
  assert.ok(calls > 5);
  wrongBuild = true;
  await assert.rejects(waitForFrontend(config, { timeoutMs: 20, intervalMs: 1 }), /Frontend-Build nicht erreichbar/);
  await fs.rm(config.buildDirectory, { recursive: true });
  await assert.rejects(waitForFrontend(config), /Frontend-Build fehlt/);
});

test('unreachable server produces a sanitized, actionable error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw Error('private data'); });
  await assert.rejects(waitForFrontend({ mode: 'development', url: 'http://127.0.0.1:8123/' },
    { timeoutMs: 20, intervalMs: 1 }), /Entwicklungsserver oder API nicht erreichbar/);
});
