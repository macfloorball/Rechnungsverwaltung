'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { prepareWindowsSource } = require('./package_windows.cjs');
const { releaseFixture } = require('../tests/release_fixture.cjs');

test('Windows package contains runtime source and build, but no user or development data', async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'ttc-package-test-'));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const root = path.join(fixture, 'source');
  const target = path.join(fixture, 'package');
  for (const name of ['electron/assets', 'backend', 'frontend/js', 'data', 'rechnungen', 'node_modules', '.venv', 'scripts']) {
    await fs.mkdir(path.join(root, name), { recursive: true });
  }
  const files = {
    'package.json': JSON.stringify({ name:'ttc-rechnungsverwaltung',productName:'TT Rechnungsverwaltung',version:'0.1.0',author:'mac-floorball',desktopAppId:'de.mac-floorball.ttc-rechnungsverwaltung',main:'electron/main.cjs',devDependencies:{electron:'45.3.1'} }),
    'scripts/run.cjs':'// runtime launcher', 'scripts/managed_server.py':'# lifecycle adapter',
    'scripts/package_windows.cjs':'// excluded build tool', 'scripts/private.env':'PRIVATE',
    'electron/main.cjs':'// main', 'electron/example.test.cjs':'// test',
    'electron/assets/app-icon.ico':'icon', 'electron/assets/app-icon.png':'icon','electron/assets/app-icon.svg':'icon',
    'backend/main.py':'# backend', 'backend/paths.py':'# paths', 'backend/storage_import.py':'# import', 'backend/storage_errors.py':'# errors', 'backend/private.db':'PRIVATE', 'backend/private.before-migration.sqlite3':'PRIVATE', 'frontend/index.html':'<script src="js/app.js"></script>', 'frontend/js/app.js':'// frontend',
    'data/ttc.db':'PRIVATE', 'rechnungen/private.pdf':'PRIVATE', '.env':'PRIVATE', 'requirements.txt':'fastapi',
  };
  for (const [name, value] of Object.entries(files)) await fs.writeFile(path.join(root, name), value);
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ version: '0.1.0', packages: { '': { version: '0.1.0' } } }));
  await prepareWindowsSource(root, target);
  const entries = await fs.readdir(target, { recursive: true });
  for (const expected of ['electron/main.cjs', 'backend/main.py','backend/paths.py','backend/storage_import.py','backend/storage_errors.py','dist/frontend/index.html','dist/frontend/desktop-build.json','requirements.txt','scripts/run.cjs','scripts/managed_server.py']) {
    assert.ok(entries.includes(expected.split('/').join(path.sep)), expected);
  }
  for (const excluded of ['data','rechnungen','backend/private.db','backend/private.before-migration.sqlite3','.env','node_modules','.venv','electron/example.test.cjs','scripts/package_windows.cjs','scripts/private.env']) {
    assert.ok(!entries.includes(excluded.split('/').join(path.sep)), excluded);
  }
  assert.equal(JSON.parse(await fs.readFile(path.join(target,'package.json'),'utf8')).devDependencies,undefined);
  const packaged = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'));
  assert.equal(packaged.desktopAppId, 'de.mac-floorball.ttc-rechnungsverwaltung');
  assert.equal(packaged.author, 'mac-floorball');
  assert.deepEqual(packaged.desktopRelease, { formatVersion: 1, version: packaged.version, channel: 'development', tag: null, commit: null });
  assert.deepEqual(packaged.desktopUpdateTrust, { enabled: false });
  const stable = { ...packaged.desktopRelease, channel: 'stable', tag: 'desktop-v0.1.0', commit: 'a'.repeat(40) };
  const releaseTarget = path.join(fixture, 'release-package');
  await assert.rejects(prepareWindowsSource(root, releaseTarget, stable));
  const { policy } = releaseFixture();
  await fs.writeFile(path.join(root, 'desktop-release-policy.json'), JSON.stringify(policy));
  await prepareWindowsSource(root, releaseTarget, stable);
  const production = JSON.parse(await fs.readFile(path.join(releaseTarget, 'package.json'), 'utf8'));
  assert.deepEqual(production.desktopRelease, stable);
  assert.equal(production.desktopUpdateTrust.keyId, policy.keyId);
  assert.equal(JSON.stringify(production).includes('PRIVATE KEY'), false);
  assert.equal((await fs.readdir(releaseTarget)).includes('desktop-release-policy.json'), false);
  await assert.rejects(prepareWindowsSource(root, releaseTarget, { ...stable, version: '0.2.0' }), /stimmen/);
});
