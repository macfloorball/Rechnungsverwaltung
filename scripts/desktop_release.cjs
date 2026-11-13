'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseVersion, versionFromTag, assertUpgrade, validateReleaseMetadata } = require('../electron/version.cjs');

function checkReleaseVersion(version, tag, previousTags) {
  parseVersion(version);
  if (versionFromTag(tag) !== version) throw Error('Release-Tag und Desktop-Paketversion stimmen nicht überein.');
  for (const previousTag of previousTags) {
    if (previousTag === tag) continue; // The checked tag already exists at HEAD.
    assertUpgrade(versionFromTag(previousTag), version);
  }
}

function readPackage(root) {
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  parseVersion(metadata.version);
  if (metadata.version !== lock.version || metadata.version !== lock.packages?.['']?.version) {
    throw Error('Desktop-Version in package.json und package-lock.json ist inkonsistent.');
  }
  return metadata;
}

function getDesktopRelease(root, { tag = process.env.TTC_DESKTOP_RELEASE_TAG ?? null } = {}) {
  const metadata = readPackage(root);
  const release = { formatVersion: 1, version: metadata.version, channel: 'development', tag: null, commit: null };
  if (tag !== null) {
    // No shell interpolation, no remote access, and only exact refs are resolved.
    versionFromTag(tag);
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (git('rev-parse', '--is-shallow-repository') !== 'false') throw Error('Desktop-Release benötigt vollständige Git-Historie.');
    const tags = git('tag', '--list', 'desktop-v*').split('\n').filter(Boolean);
    checkReleaseVersion(metadata.version, tag, tags);
    const commit = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
    if (commit !== git('rev-parse', 'HEAD')) throw Error('Desktop-Release-Tag zeigt nicht auf den ausgecheckten Commit.');
    if (git('status', '--porcelain', '--untracked-files=normal')) throw Error('Desktop-Release benötigt einen sauberen Arbeitsbaum.');
    Object.assign(release, { channel: 'stable', tag, commit });
  }
  return Object.freeze(validateReleaseMetadata(release, metadata.version));
}

function assertPackageRelease(root, release) {
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  validateReleaseMetadata(metadata.desktopRelease, metadata.version);
  validateReleaseMetadata(release, metadata.version);
  for (const key of ['formatVersion', 'version', 'channel', 'tag', 'commit']) {
    if (metadata.desktopRelease[key] !== release[key]) throw Error('Paket stammt nicht aus dem geprüften Desktop-Build.');
  }
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 0 && (args.length !== 2 || args[0] !== '--tag' || !args[1])) {
      throw Error('Aufruf: desktop_release.cjs [--tag desktop-vX.Y.Z]');
    }
    const release = getDesktopRelease(path.join(__dirname, '..'), args.length ? { tag: args[1] } : {});
    console.log(JSON.stringify(release, null, 2));
  } catch (error) {
    console.error(`Desktop-Versionsprüfung fehlgeschlagen: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { checkReleaseVersion, readPackage, getDesktopRelease, assertPackageRelease };
