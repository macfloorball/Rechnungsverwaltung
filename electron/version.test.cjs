'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseVersion, compareVersions, versionFromTag, assertUpgrade, validateReleaseMetadata } = require('./version.cjs');

test('portable SemVer policy rejects ambiguous versions and Windows overflows', () => {
  assert.deepEqual(parseVersion('0.1.0'), [0, 1, 0]);
  assert.deepEqual(parseVersion('65535.65535.65535'), [65535, 65535, 65535]);
  for (const value of [null, undefined, 1, {}, '', '1.2', '1.2.3.4', 'v1.2.3', '01.2.3',
    '1.02.3', '1.2.03', '-1.2.3', ' 1.2.3', '1.2.3\n', '1.2.3-rc.1', '1.2.3+build',
    '65536.0.0', '0.65536.0', '0.0.65536', '9007199254740993.0.0']) {
    assert.throws(() => parseVersion(value), undefined, String(value));
  }
});

test('version order is numeric across patch, minor and major boundaries', () => {
  const ordered = ['0.0.0', '0.1.9', '0.1.10', '0.2.0', '0.10.0', '1.0.0', '10.0.0'];
  for (let i = 0; i < ordered.length; i++) {
    assert.equal(compareVersions(ordered[i], ordered[i]), 0);
    for (let j = i + 1; j < ordered.length; j++) {
      assert.equal(compareVersions(ordered[i], ordered[j]), -1);
      assert.equal(compareVersions(ordered[j], ordered[i]), 1);
    }
  }
});

test('only desktop-vX.Y.Z tags are eligible', () => {
  assert.equal(versionFromTag('desktop-v1.2.3'), '1.2.3');
  for (const tag of [null, 'v1.2.3', '1.2.3', 'refs/tags/desktop-v1.2.3', 'desktop-v1.2.3-beta', 'desktop-v1.2.3/other']) {
    assert.throws(() => versionFromTag(tag));
  }
});

test('upgrades reject same version, downgrades and replay below a remembered high watermark', () => {
  assertUpgrade('0.1.9', '0.1.10');
  assertUpgrade('0.9.0', '1.0.0');
  for (const args of [['1.0.0', '1.0.0'], ['1.0.0', '0.9.0'], ['1.0.0', '1.1.0', '1.2.0'], ['1.0.0', '1.2.0', '1.2.0']]) {
    assert.throws(() => assertUpgrade(...args), /neuer/);
  }
});

test('release channel and provenance must agree with the actual package version', () => {
  const release = { formatVersion: 1, version: '1.2.3', channel: 'stable', tag: 'desktop-v1.2.3', commit: 'a'.repeat(40) };
  assert.equal(validateReleaseMetadata(release, '1.2.3'), release);
  for (const change of [{ version: '1.2.4' }, { tag: 'desktop-v1.2.4' }, { channel: 'beta' },
    { commit: null }, { commit: 'HEAD' }, { formatVersion: 2 }, { channel: 'development' }]) {
    assert.throws(() => validateReleaseMetadata({ ...release, ...change }, '1.2.3'));
  }
  assert.throws(() => validateReleaseMetadata(null, '1.2.3'));
  validateReleaseMetadata({ ...release, channel: 'development', tag: null, commit: null }, '1.2.3');
});
