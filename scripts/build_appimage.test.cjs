'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { appImageConfig } = require('./build_appimage.cjs');
const { getDesktopRelease } = require('./desktop_release.cjs');

test('AppImage schema preserves sandbox, app identity and development-only publication policy', async () => {
  const root = path.join(__dirname, '..');
  const metadata = require('../package.json');
  const config = appImageConfig(root, metadata, getDesktopRelease(root, { tag: null }));
  const { validateConfiguration } = require('app-builder-lib/out/util/config/config.js');
  await validateConfiguration(config, { isEnabled: false });
  assert.equal(config.appId, metadata.desktopAppId);
  assert.equal(config.publish, null);
  assert.deepEqual(config.appImage.executableArgs, []);
  assert.equal(config.toolsets.appimage, '1.0.3');
  assert.deepEqual(config.linux.target, [{ target: 'AppImage', arch: ['x64'] }]);
  assert.match(config.artifactName, /development/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'build', 'linux', 'AppRun'), 'utf8'), /--no-sandbox|--disable-setuid-sandbox/);
});
