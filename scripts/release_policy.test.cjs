'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { validatePolicy, loadPolicy, buildTrust } = require('./release_policy.cjs');
const { signingKey, signedManifest } = require('./release_bundle.cjs');
const { authenticode } = require('./windows_signing.cjs');
const { releaseFixture } = require('../tests/release_fixture.cjs');

test('disabled policies block stable builds while development needs no secrets', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-disabled-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'desktop-release-policy.json'), JSON.stringify({ formatVersion: 1, enabled: false }));
  assert.throws(() => loadPolicy(root), /gesperrt/);
  assert.deepEqual(buildTrust(root, { channel: 'development' }), { enabled: false });
  assert.throws(() => buildTrust(root, { channel: 'stable' }), /gesperrt/);
});

test('release policy rejects missing trust roots, weak keys and unsigned Windows configuration', () => {
  const { policy } = releaseFixture();
  validatePolicy(policy);
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' });
  for (const patch of [{ enabled: false }, { publicKeyPem: null }, { publicKeyPem: rsa }, { keyId: 'bad' },
    { repository: 'https://github.com/owner/repo' }, { repositoryId: 0 }, { visibility: 'internal' },
    { manifestLifetimeDays: 0 }, { manifestLifetimeDays: 366 }, { windows: null },
    { windows: { ...policy.windows, timestampUrl: 'http://timestamp.example.invalid' } },
    { windows: { ...policy.windows, certificateSha256: null } }]) assert.throws(() => validatePolicy({ ...policy, ...patch }));
});

test('only the private key matching the pinned public key can sign releases', () => {
  const { policy, privatePem } = releaseFixture();
  signingKey(privatePem, policy);
  assert.throws(() => signingKey(releaseFixture().privatePem, policy), /passt nicht/);
  assert.throws(() => signingKey(null, policy), /fehlt/);
});

test('manifest signatures bind exact bytes, repository, packages and release notes', () => {
  const { policy, privateKey } = releaseFixture();
  const { verify, createPublicKey } = require('node:crypto');
  const release = { formatVersion: 1, version: '1.2.3', channel: 'stable', tag: 'desktop-v1.2.3', commit: 'c'.repeat(40) };
  const packages = [{ platform: 'win32', assetId: 10, arch: 'x64', packageFormat: 'nsis',
    fileName: 'ttc-rechnungsverwaltung-1.2.3-windows-x64-setup.exe', size: 1000001, sha256: 'd'.repeat(64),
    windowsSignature: { status: 'Valid', timestamped: true, version: release.version, certificateSha256: policy.windows.certificateSha256, publisherSubject: policy.windows.publisherSubject } },
  { platform: 'linux', assetId: 11, arch: 'x64', packageFormat: 'appimage',
    fileName: 'ttc-rechnungsverwaltung-1.2.3-linux-x64.AppImage', size: 1000001, sha256: 'e'.repeat(64) }];
  const { bytes, signature } = signedManifest(policy, release, packages, 'Reviewed changes', privateKey, new Date('2026-11-14T12:00:00Z'));
  assert.equal(verify(null, bytes, createPublicKey(policy.publicKeyPem), signature), true);
  const parsed = JSON.parse(bytes);
  assert.equal(parsed.repositoryId, policy.repositoryId);
  assert.equal(parsed.artifacts[0].url, `https://api.github.com/repos/${policy.repository}/releases/assets/10`);
  assert.equal(parsed.expiresAt, '2027-02-12T12:00:00.000Z');
  assert.equal(verify(null, Buffer.from(bytes.toString().replace('Reviewed changes', 'Tampered changes')), createPublicKey(policy.publicKeyPem), signature), false);
  assert.throws(() => signedManifest(policy, release, packages.slice(0, 1), '', privateKey));
  assert.throws(() => signedManifest(policy, { ...release, channel: 'development', tag: null, commit: null }, packages, '', privateKey));
  assert.throws(() => signedManifest(policy, release, packages, '', releaseFixture().privateKey), /Selbstverifikation/);
});

test('native Authenticode verification cannot be bypassed on Linux', { skip: process.platform === 'win32' }, () => {
  assert.throws(() => authenticode('/tmp/fixture.exe', releaseFixture().policy), /benötigen Windows/);
});
