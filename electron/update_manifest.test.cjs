'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sign } = require('node:crypto');
const { configuration, validateManifest, strictJSON, newestRelease } = require('./update_manifest.cjs');
const { updateFixture } = require('../tests/update_fixture.cjs');

test('only installed stable packages with a pinned Ed25519 root enable update checks', () => {
  const f = updateFixture();
  for (const patch of [{ packaged: false }, { arch: 'arm64' }, { platform: 'darwin' }]) {
    assert.equal(configuration(f.metadata, { packaged: true, currentVersion: '0.1.0', platform: 'linux', arch: 'x64', ...patch }).enabled, false);
  }
  assert.throws(() => configuration({ ...f.metadata, desktopUpdateTrust: { ...f.metadata.desktopUpdateTrust, keyId: 'wrong' } },
    { packaged: true, currentVersion: '0.1.0', platform: 'linux', arch: 'x64' }));
});

test('publisher-produced manifests verify for both supported platforms', () => {
  for (const platform of ['linux', 'win32']) {
    const f = updateFixture(platform);
    const result = validateManifest(f.bytes, f.signature, f.config, f.feedRelease, f.now);
    assert.equal(result.version, '0.2.0');
    assert.ok(Object.isFrozen(result.artifacts[0].windowsSignature));
    assert.ok(Object.isFrozen(result.artifacts));
  }
});

test('modified bytes or a signature from another key are rejected before parsing', () => {
  const f = updateFixture();
  assert.throws(() => validateManifest(Buffer.from('not JSON'), f.signature, f.config, f.feedRelease, f.now), /INVALID_SIGNATURE/);
  assert.throws(() => validateManifest(f.bytes, updateFixture().signature, f.config, f.feedRelease, f.now), /INVALID_SIGNATURE/);
});

test('duplicate and escaped duplicate JSON keys and excessive nesting are rejected', () => {
  for (const raw of ['{"version":1,"version":2}', '{"version":1,"\\u0076ersion":2}', '[{"a":1,"a":2}]', '['.repeat(20) + '0' + ']'.repeat(20)]) {
    assert.throws(() => strictJSON(Buffer.from(raw)));
  }
  assert.deepEqual(strictJSON(Buffer.from('{"a": ["comma,:{}", true, null, -1.2e2]}')), { a: ['comma,:{}', true, null, -120] });
});

test('even correctly signed wrong sources, expired metadata or swapped platform packages are rejected', () => {
  const f = updateFixture();
  for (const change of [
    (data) => { data.repositoryId++; }, (data) => { data.channel = 'beta'; },
    (data) => { data.version = '0.1.0'; }, (data) => { data.expiresAt = new Date(f.now - 1).toISOString(); },
    (data) => { data.artifacts[0].url = 'https://attacker.invalid/setup.exe'; },
    (data) => { data.artifacts[1].platform = 'win32'; }, (data) => { data.artifacts[0].windowsSignature.timestamped = false; },
    (data) => { data.artifacts[1].assetId = 999; }, (data) => { data.artifacts[0].arch = 'arm64'; },
  ]) {
    const data = JSON.parse(f.bytes);
    change(data);
    const bytes = Buffer.from(JSON.stringify(data));
    assert.throws(() => validateManifest(bytes, sign(null, bytes, f.privateKey), f.config, f.feedRelease, f.now));
  }
});

test('discovery uses numeric desktop versions, ignores drafts, prereleases, web tags and downgrades', () => {
  const f = updateFixture();
  const version = (tag, patch = {}) => ({ ...f.feedRelease, tag_name: tag, ...patch });
  const rows = [version('v10.0.0'), version('desktop-v9.0.0', { draft: true }), version('desktop-v8.0.0', { prerelease: true }),
    version('desktop-v7.0.0-beta'), version('desktop-v0.1.0'), version('desktop-v0.2.9'), version('desktop-v0.2.10')];
  assert.equal(newestRelease(rows, '0.1.0').tag_name, 'desktop-v0.2.10');
  assert.equal(newestRelease(rows, '0.3.0'), null);
  assert.throws(() => newestRelease([f.feedRelease, f.feedRelease], '0.1.0'));
});


test('RPM installs delegate updates to DNF and cannot enable the AppImage updater', () => {
  const metadata = { version: '0.1.1', desktopAppId: 'de.mac-floorball.ttc-rechnungsverwaltung',
    ttcDistribution: 'rpm', desktopUpdateTrust: { enabled: false },
    desktopRelease: { formatVersion: 1, version: '0.1.1', channel: 'development', tag: null, commit: null },
    rpmRelease: { formatVersion: 1, version: '0.1.1', release: 1, channel: 'stable', tag: 'rpm-v0.1.1-1', commit: 'a'.repeat(40) } };
  const options = { packaged: true, currentVersion: '0.1.1', platform: 'linux', arch: 'x64' };
  assert.deepEqual(configuration(metadata, options), { enabled: false, reason: 'package_manager' });
  assert.throws(() => configuration({ ...metadata, desktopUpdateTrust: { enabled: true } }, options));
  assert.throws(() => configuration({ ...metadata, rpmRelease: { ...metadata.rpmRelease, tag: 'desktop-v0.1.1' } }, options));
  assert.equal(configuration(metadata, { ...options, platform: 'win32' }).enabled, false);
});
