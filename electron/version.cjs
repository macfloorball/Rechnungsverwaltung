'use strict';

// Supported release policy: SemVer core only. Prereleases/build suffixes are
// deliberately excluded: NSIS compares numeric versions, not SemVer suffixes.
// Development is a separate channel, never inferred from a branch name.
function parseVersion(value) {
  if (typeof value !== 'string' || value.trim() !== value || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw Error('Desktop-Version muss X.Y.Z ohne Präfix, führende Nullen oder Versionszusatz sein.');
  }
  const parts = value.split('.').map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part) || part > 65535)) {
    throw Error('Desktop-Versionskomponenten dürfen für Windows höchstens 65535 betragen.');
  }
  return parts;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function versionFromTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('desktop-v')) {
    throw Error('Desktop-Release benötigt einen Tag im Format desktop-vX.Y.Z.');
  }
  const version = tag.slice('desktop-v'.length);
  parseVersion(version);
  return version;
}

function assertUpgrade(current, available, highest = current) {
  if (compareVersions(available, current) <= 0 || compareVersions(available, highest) <= 0) {
    throw Error('Desktop-Update muss neuer als die installierte Version und der Versionshöchststand sein.');
  }
}

function validateReleaseMetadata(release, packageVersion) {
  parseVersion(packageVersion);
  if (!release || release.formatVersion !== 1 || release.version !== packageVersion) {
    throw Error('Desktop-Paketversion und Release-Metadaten stimmen nicht überein.');
  }
  if (release.channel === 'stable') {
    if (versionFromTag(release.tag) !== packageVersion || typeof release.commit !== 'string' || release.commit.length !== 40
        || !/^[a-f0-9]{40}$/.test(release.commit)) {
      throw Error('Stabiler Desktop-Build benötigt passenden Release-Tag und Quellcommit.');
    }
  } else if (release.channel !== 'development' || release.tag !== null || release.commit !== null) {
    throw Error('Ungültiger Desktop-Release-Kanal.');
  }
  return release;
}

module.exports = { parseVersion, compareVersions, versionFromTag, assertUpgrade, validateReleaseMetadata };
