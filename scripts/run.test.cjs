'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const { launchConfig, checkPort, stopTree, spawnBackend } = require('./run.cjs');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('installed build uses embedded Python exclusively and rejects missing runtime', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-embedded-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'packaged-runtime.json'), '{}');
  assert.throws(() => launchConfig('desktop-production', { TTC_PYTHON: '/other/python' }, root, 'win32'), /Laufzeit fehlt/);
  const directory = path.join(root, 'runtime', 'python');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'python.exe'), 'fixture');
  assert.equal(launchConfig('desktop-production', { TTC_PYTHON: '/other/python' }, root, 'win32').python, path.join(directory, 'python.exe'));
});

test('Linux package uses isolated bundled Python instead of host overrides', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-linux-launch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'packaged-runtime.json'), '{}');
  assert.throws(() => launchConfig('desktop-production', {}, root, 'linux'), /Laufzeit fehlt/);
  const python = path.join(root, 'runtime', 'python', 'bin', 'python3.13');
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, 'fixture');
  const config = launchConfig('desktop-production', { TTC_PYTHON: '/untrusted/python' }, root, 'linux');
  assert.equal(config.python, python);
  assert.deepEqual(config.args.slice(0, 3), ['-I', '-B', '-c']);
  assert.equal(config.args[4], root);
  assert.equal(config.args[5], 'backend.main:app');
});

test('development uses one Uvicorn service and the development address', () => {
  const config = launchConfig('desktop-dev', { TTC_DESKTOP_URL: 'http://127.0.0.1:8123', TTC_FRONTEND_DIRECTORY: 'wrong' });
  assert.equal(config.url, 'http://127.0.0.1:8123/');
  assert.ok(config.args.includes('--reload'));
  assert.ok(config.frontend.endsWith('frontend'));
});
test('production ignores development URL and uses build without reload', () => {
  const config = launchConfig('desktop-production', { TTC_DESKTOP_URL: 'http://127.0.0.1:9999', TTC_DESKTOP_PRODUCTION_URL: 'http://127.0.0.1:8124' });
  assert.equal(config.url, 'http://127.0.0.1:8124/');
  assert.ok(!config.args.includes('--reload'));
  assert.ok(config.buildDirectory.endsWith(require('node:path').join('dist', 'frontend')));
  assert.equal(launchConfig('desktop-production', { TTC_DESKTOP_URL: 'http://127.0.0.1:9999' }).url, 'http://127.0.0.1:8000/');
  assert.throws(() => launchConfig('unknown'), /Startmodus erforderlich/);
  assert.throws(() => launchConfig('desktop-production', { TTC_DESKTOP_PRODUCTION_URL: 'https://example.org' }), /lokale HTTP-Origin/);
});
test('web start uses source files; reload only in development', () => {
  assert.ok(!launchConfig('web').args.includes('--reload'));
  assert.ok(launchConfig('web-dev').args.includes('--reload'));
  assert.equal(launchConfig('web').desktop, false);
});
test('occupied port is rejected and never taken over', async () => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await assert.rejects(checkPort(`http://127.0.0.1:${server.address().port}`), /Port ist belegt/); }
  finally { await new Promise((resolve) => server.close(resolve)); }
});
test('managed process can be terminated', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
  await once(child, 'spawn');
  const ended = once(child, 'exit');
  await stopTree(child); await ended;
  assert.ok(child.signalCode || child.exitCode !== null);
});

test('cooperative shutdown waits for an active operation and is idempotent', async () => {
  const child = spawn(process.execPath, ['-e', `process.stdin.once('data',()=>setTimeout(()=>process.exit(0),150));`],
    { detached: true, stdio: ['pipe','ignore','ignore'] });
  child.managedBackend = true;
  child.stdin.on('error',()=>{});
  await once(child,'spawn');
  const first = stopTree(child, {graceMs: 2000});
  assert.equal(stopTree(child), first);
  assert.equal(await first, false);
  assert.equal(child.exitCode,0);
  assert.equal(await stopTree(child),false);
});

test('unresponsive backend has a bounded shutdown and reports escalation', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume();setInterval(()=>{},1000)'],
    { detached: true, stdio: ['pipe','ignore','ignore'] });
  child.managedBackend = true;
  child.stdin.on('error',()=>{});
  await once(child,'spawn');
  assert.equal(await stopTree(child,{graceMs:100,terminateMs:100}),true);
});

test('Dokumenten-Startmarker werden auch über mehrere Ausgabeblöcke erkannt', async () => {
  const child = spawnBackend({
    python: process.execPath, frontend: __dirname,
    args: ['-e', `process.stderr.write('TTC_DOC'); setTimeout(() => {
      process.stderr.write('UMENT_ERROR:space\\nTTC_DOCUMENT_ERROR:unknown\\n');
    }, 20);`],
  }, __dirname, process.env);
  await once(child, 'close');
  assert.equal(child.documentError, 'space');
  assert.equal(child.databaseError, undefined);
});
