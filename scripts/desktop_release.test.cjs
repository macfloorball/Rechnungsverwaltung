'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { checkReleaseVersion, getDesktopRelease, assertPackageRelease } = require('./desktop_release.cjs');
const { installerConfig } = require('./installer_config.cjs');

function fixture(t, withGit = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const metadata = { version: '1.2.3', desktopAppId: 'de.mac-floorball.ttc-rechnungsverwaltung', devDependencies: { electron: '45.3.1' } };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(metadata));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: metadata.version, packages: { '': { version: metadata.version } } }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull } }).trim();
  if (withGit) {
    git('init', '--quiet');
    git('add', '.');
    git('-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture');
    git('tag', 'desktop-v1.2.3');
  }
  return { root, metadata, git };
}

test('stable release version must exceed every other desktop release tag', () => {
  checkReleaseVersion('1.2.3', 'desktop-v1.2.3', ['desktop-v0.9.0', 'desktop-v1.2.2', 'desktop-v1.2.3']);
  assert.throws(() => checkReleaseVersion('1.2.3', 'desktop-v1.2.2', []), /stimmen/);
  assert.throws(() => checkReleaseVersion('1.2.3', 'desktop-v1.2.3', ['desktop-v1.3.0']), /neuer/);
  assert.throws(() => checkReleaseVersion('1.2.3', 'desktop-v1.2.3', ['desktop-v01.0.0']));
});

test('untagged builds are explicitly development builds and package-lock must agree', (t) => {
  const { root } = fixture(t);
  assert.deepEqual(getDesktopRelease(root, { tag: null }), { formatVersion: 1, version: '1.2.3', channel: 'development', tag: null, commit: null });
  for (const lock of [{ version: '1.2.2', packages: { '': { version: '1.2.3' } } }, { version: '1.2.3', packages: { '': { version: '1.2.4' } } }]) {
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock));
    assert.throws(() => getDesktopRelease(root, { tag: null }), /inkonsistent/);
  }
});

test('release build requires an actual matching tag at a clean HEAD and rejects downgrade history', (t) => {
  const { root, git } = fixture(t, true);
  const options = { tag: 'desktop-v1.2.3' };
  const release = getDesktopRelease(root, options);
  assert.equal(release.channel, 'stable');
  assert.equal(release.commit, git('rev-parse', 'HEAD'));
  assert.throws(() => getDesktopRelease(root, { tag: '' }));
  assert.throws(() => getDesktopRelease(root, { tag: 'desktop-v1.2.4' }), /stimmen/);
  git('tag', '-d', 'desktop-v1.2.3');
  assert.throws(() => getDesktopRelease(root, options));
  git('tag', 'desktop-v1.2.3');
  git('tag', 'desktop-v2.0.0');
  assert.throws(() => getDesktopRelease(root, options), /neuer/);
  git('tag', '-d', 'desktop-v2.0.0');
  const extra = path.join(root, 'unexpected.txt');
  fs.writeFileSync(extra, 'untracked');
  assert.throws(() => getDesktopRelease(root, options), /sauberen/);
  git('add', '.');
  assert.throws(() => getDesktopRelease(root, options), /sauberen/);
  git('-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'new head');
  assert.throws(() => getDesktopRelease(root, options), /ausgecheckten/);
});

test('installer version and packaged metadata derive from the same release; development artifacts are labelled', (t) => {
  const { root, metadata } = fixture(t);
  const release = getDesktopRelease(root, { tag: null });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ ...metadata, desktopRelease: release }));
  assertPackageRelease(root, release);
  const config = installerConfig(root, metadata, release);
  assert.equal(config.extraMetadata.version, release.version);
  assert.equal(config.buildVersion, '1.2.3.0');
  assert.match(config.artifactName, /-development-setup/);
  const stable = { ...release, channel: 'stable', tag: 'desktop-v1.2.3', commit: 'a'.repeat(40) };
  assert.doesNotMatch(installerConfig(root, metadata, stable).artifactName, /development/);
  assert.throws(() => assertPackageRelease(root, stable), /geprüften/);
  assert.throws(() => installerConfig(root, { ...metadata, version: '1.2.4' }, release), /stimmen/);
});

test('a shallow checkout cannot authorize a stable release', (t) => {
  const { root } = fixture(t, true);
  const shallow = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-shallow-release-'));
  t.after(() => fs.rmSync(shallow, { recursive: true, force: true }));
  execFileSync('git', ['clone', '--quiet', '--depth=1', pathToFileURL(root).href, shallow], { timeout: 10000 });
  assert.throws(() => getDesktopRelease(shallow, { tag: 'desktop-v1.2.3' }), /vollständige Git-Historie/);
});
