'use strict';
const { parseVersion, validateReleaseMetadata } = require('./version.cjs');
function validateRpmMetadata(metadata) {
  const release = metadata.rpmRelease;
  parseVersion(metadata.version);
  validateReleaseMetadata(metadata.desktopRelease, metadata.version);
  if (metadata.ttcDistribution !== 'rpm' || metadata.desktopAppId !== 'de.mac-floorball.ttc-rechnungsverwaltung'
      || metadata.desktopUpdateTrust?.enabled !== false || metadata.desktopRelease?.channel !== 'development'
      || !release || release.formatVersion !== 1 || release.version !== metadata.version
      || !Number.isSafeInteger(release.release) || release.release < 1 || release.release > 65535) {
    throw Error('Ungültige RPM-Paketidentität.');
  }
  if (release.channel === 'stable') {
    if (release.tag !== `rpm-v${release.version}-${release.release}` || !/^[a-f0-9]{40}$/.test(release.commit || '')) throw Error('RPM-Quellstand fehlt.');
  } else if (release.channel !== 'development' || release.tag !== null || release.commit !== null) throw Error('Ungültiger RPM-Kanal.');
  return release;
}
module.exports = { validateRpmMetadata };
