'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sign } = require('node:crypto');
const { releaseFixture } = require('../tests/release_fixture.cjs');
const { updateFixture } = require('../tests/update_fixture.cjs');
const { validatePolicy } = require('../scripts/release_policy.cjs');
const { configuration, validateManifest } = require('./update_manifest.cjs');
const { signedManifest } = require('../scripts/release_bundle.cjs');
const { windowsMode, validWindowsReceipt } = require('./windows_trust.cjs');
const unsigned = { mode: 'ed25519-only', certificateSha1: null, certificateSha256: null, publisherSubject: null, timestampUrl: null };
const receipt = (version) => ({ status: 'NotSigned', certificateSha256: null, publisherSubject: null, timestamped: false, version });

test('only an explicit mode authorizes unsigned Windows packages', () => {
  assert.equal(windowsMode({}), 'authenticode-required');
  assert.equal(validWindowsReceipt(receipt('1.0.0'), {}, '1.0.0'), false);
  const { policy } = releaseFixture();
  validatePolicy({ ...policy, windows: unsigned });
  for (const windows of [{ ...unsigned, mode: 'fallback' }, { ...unsigned, certificateSha256: 'a'.repeat(64) }, { mode: null }]) {
    assert.throws(() => validatePolicy({ ...policy, windows }));
  }
  assert.throws(() => validatePolicy({ ...policy, windows: { mode: null } }));
  for (const status of ['Valid', 'HashMismatch', 'NotTrusted', 'UnknownError']) {
    assert.equal(validWindowsReceipt({ ...receipt('1.0.0'), status }, unsigned, '1.0.0'), false);
  }
});

for (const platform of ['linux', 'win32']) test(`${platform}: Ed25519-only manifest stays bound to installed trust`, () => {
  const f = updateFixture(platform);
  const policy = { ...f.policy, windows: unsigned };
  const metadata = { ...f.metadata, desktopUpdateTrust: { enabled: true, ...policy } };
  const config = configuration(metadata, { packaged: true, currentVersion: metadata.version, platform, arch: 'x64' });
  const packages = f.packages.map((p) => p.platform === 'win32' ? { ...p, windowsSignature: receipt(f.release.version) } : p);
  const signed = signedManifest(policy, f.release, packages, '', f.privateKey, new Date(f.now));
  assert.equal(validateManifest(signed.bytes, signed.signature, config, f.feedRelease, f.now).version, f.release.version);
  // Even a correctly Ed25519-signed feed cannot relax a strict client's Windows policy.
  assert.throws(() => validateManifest(signed.bytes, signed.signature, f.config, f.feedRelease, f.now));
  assert.throws(() => validateManifest(f.bytes, f.signature, config, f.feedRelease, f.now));
  assert.throws(() => validateManifest(signed.bytes, Buffer.alloc(64), config, f.feedRelease, f.now), /INVALID_SIGNATURE/);
  assert.throws(() => validateManifest(signed.bytes, signed.signature, config, f.feedRelease, f.now + 91 * 86400000), /EXPIRED/);
  const tampered = JSON.parse(signed.bytes);
  tampered.artifacts[0].windowsSignature.status = 'HashMismatch';
  const bytes = Buffer.from(JSON.stringify(tampered));
  assert.throws(() => validateManifest(bytes, sign(null, bytes, f.privateKey), config, f.feedRelease, f.now));
  assert.throws(() => signedManifest(policy, f.release, f.packages, '', f.privateKey, new Date(f.now)));
});
