'use strict';
// Ephemeral keys and simulated certificates exclusively for offline unit tests.
const { generateKeyPairSync } = require('node:crypto');
const { keyFingerprint } = require('../scripts/release_policy.cjs');

function releaseFixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  return { privateKey, privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }), policy: {
    formatVersion: 1, enabled: true, repository: 'macfloorball/Rechnungsverwaltung', repositoryId: 1447003404,
    visibility: 'private', environment: 'desktop-release', publicKeyPem, keyId: keyFingerprint(publicKeyPem), manifestLifetimeDays: 90,
    windows: { certificateSha1: 'a'.repeat(40), certificateSha256: 'b'.repeat(64),
      publisherSubject: 'CN=Offline Test Fixture', timestampUrl: 'https://timestamp.example.invalid' },
  } };
}
module.exports = { releaseFixture };
