'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { installerConfig } = require('./installer_config.cjs');
const metadata = require('../package.json');
const { releaseFixture } = require('../tests/release_fixture.cjs');

test('installer options match the pinned electron-builder schema', async () => {
  const { validateConfiguration } = require('app-builder-lib/out/util/config/config.js');
  await validateConfiguration(installerConfig(path.join(__dirname, '..'), metadata), { isEnabled: false });
});

test('stable signing settings match the pinned schema and require code signatures', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-signing-schema-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { policy } = releaseFixture();
  fs.writeFileSync(path.join(root, 'desktop-release-policy.json'), JSON.stringify(policy));
  const config = installerConfig(root, metadata, { formatVersion: 1, version: metadata.version,
    channel: 'stable', tag: `desktop-v${metadata.version}`, commit: 'c'.repeat(40) });
  const { validateConfiguration } = require('app-builder-lib/out/util/config/config.js');
  await validateConfiguration(config, { isEnabled: false });
  assert.equal(config.forceCodeSigning, true);
  assert.equal(config.win.signExecutable, true);
  assert.deepEqual(config.win.signtoolOptions.signingHashAlgorithms, ['sha256']);
});

test('NSIS installs per user without elevation or deleting user profiles', () => {
  const config = installerConfig('/project', metadata);
  assert.equal(config.appId, 'de.mac-floorball.ttc-rechnungsverwaltung');
  assert.equal(metadata.author, 'mac-floorball');
  assert.equal(config.productName, 'TTC Rechnungsverwaltung');
  assert.equal(metadata.version, '0.1.0');
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.allowElevation, false);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.equal(config.nsis.allowToChangeInstallationDirectory, false);
  assert.equal(config.nsis.createDesktopShortcut, 'always');
  assert.equal(config.nsis.createStartMenuShortcut, true);
  assert.equal(config.nsis.shortcutName, metadata.productName);
  assert.equal(config.publish, null);
  assert.equal(config.directories.output, path.join('/project', 'dist', 'installer'));
  assert.deepEqual(config.win.target, [{ target: 'nsis', arch: ['x64'] }]);
});
