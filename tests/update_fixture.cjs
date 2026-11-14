'use strict';
const { releaseFixture } = require('./release_fixture.cjs');
const { signedManifest } = require('../scripts/release_bundle.cjs');
const { configuration } = require('../electron/update_manifest.cjs');

function updateFixture(platform = 'linux') {
  const { policy, privateKey } = releaseFixture();
  const now = Date.parse('2026-11-14T12:00:00Z');
  const metadata = { version: '0.1.0', desktopAppId: 'de.mac-floorball.ttc-rechnungsverwaltung',
    ttcDistribution: platform === 'linux' ? 'appimage' : 'installer',
    desktopRelease: { formatVersion: 1, version: '0.1.0', channel: 'stable', tag: 'desktop-v0.1.0', commit: 'a'.repeat(40) },
    desktopUpdateTrust: { enabled: true, ...policy },
  };
  const config = configuration(metadata, { packaged: true, currentVersion: '0.1.0', platform, arch: 'x64' });
  const release = { formatVersion: 1, version: '0.2.0', channel: 'stable', tag: 'desktop-v0.2.0', commit: 'c'.repeat(40) };
  const receipt = { status: 'Valid', version: '0.2.0', certificateSha256: policy.windows.certificateSha256,
    publisherSubject: policy.windows.publisherSubject, timestamped: true };
  const packages = [
    { platform: 'win32', arch: 'x64', packageFormat: 'nsis', assetId: 10,
      fileName: 'ttc-rechnungsverwaltung-0.2.0-windows-x64-setup.exe', size: 1000001, sha256: 'd'.repeat(64), windowsSignature: receipt },
    { platform: 'linux', arch: 'x64', packageFormat: 'appimage', assetId: 20,
      fileName: 'ttc-rechnungsverwaltung-0.2.0-linux-x64.AppImage', size: 1000001, sha256: 'e'.repeat(64) },
  ];
  const { bytes, signature } = signedManifest(policy, release, packages, 'Signed release notes <b>as text</b>', privateKey, new Date(now));
  const assets = [...packages.map((file) => ({ id: file.assetId, name: file.fileName, size: file.size, state: 'uploaded' })),
    { id: 30, name: 'desktop-update.json', size: bytes.length, state: 'uploaded' },
    { id: 40, name: 'desktop-update.json.sig', size: signature.length, state: 'uploaded' },
    { id: 50, name: 'RELEASE_NOTES.md', size: 100, state: 'uploaded' }, { id: 60, name: 'SHA256SUMS', size: 500, state: 'uploaded' }];
  const feedRelease = { id: 100, draft: false, prerelease: false, tag_name: release.tag,
    published_at: new Date(now).toISOString(), target_commitish: release.commit, assets };
  const transport = { releases: async () => [feedRelease], asset: async (id) => id === 30 ? bytes : signature };
  return { policy, metadata, config, release, privateKey, now, packages, bytes, signature, feedRelease, transport,
    token: 'github_pat_ephemeral_fixture_only' };
}
module.exports = { updateFixture };
