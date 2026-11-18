'use strict';
const fs = require('node:fs');
const { windowsMode } = require('../electron/windows_trust.cjs');
const path = require('node:path');
const { createPublicKey, createHash } = require('node:crypto');

function keyFingerprint(publicKeyPem) {
  if (typeof publicKeyPem !== 'string' || !publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----') || publicKeyPem.includes('PRIVATE')) {
    throw Error('Ein öffentlicher Ed25519-Schlüssel im SPKI-PEM-Format ist erforderlich.');
  }
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw Error('Update-Schlüssel muss Ed25519 verwenden.');
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}

function validatePolicy(policy) {
  if (!policy || policy.formatVersion !== 1 || policy.enabled !== true) {
    throw Error('Produktive Desktop-Releases sind gesperrt. Release-Infrastruktur einrichten und Richtlinie ausdrücklich freigeben.');
  }
  if (typeof policy.repository !== 'string' || policy.repository.trim() !== policy.repository || policy.repository.length > 200
      || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(policy.repository) || ['.', '..'].includes(policy.repository.split('/')[1])
      || !Number.isSafeInteger(policy.repositoryId) || policy.repositoryId <= 0 || !['private', 'public'].includes(policy.visibility)
      || policy.environment !== 'desktop-release') throw Error('Ungültige Release-Quelle.');
  if (policy.keyId !== keyFingerprint(policy.publicKeyPem)) throw Error('Update-Schlüssel und Fingerprint stimmen nicht überein.');
  if (!Number.isInteger(policy.manifestLifetimeDays) || policy.manifestLifetimeDays < 1 || policy.manifestLifetimeDays > 365) {
    throw Error('Manifestgültigkeit muss zwischen 1 und 365 Tagen liegen.');
  }
  const win = policy.windows;
  if (windowsMode(win) === 'ed25519-only') return policy;
  if (!win || typeof win.certificateSha1 !== 'string' || win.certificateSha1.length !== 40 || !/^[a-f0-9]{40}$/.test(win.certificateSha1)
      || typeof win.certificateSha256 !== 'string' || win.certificateSha256.length !== 64 || !/^[a-f0-9]{64}$/.test(win.certificateSha256)
      || typeof win.publisherSubject !== 'string' || !win.publisherSubject.trim() || /[\r\n\0]/.test(win.publisherSubject)) {
    throw Error('Vertrauenswürdiges Windows-Code-Signing-Zertifikat ist nicht eingerichtet.');
  }
  const timestamp = new URL(win.timestampUrl);
  if (timestamp.protocol !== 'https:' || timestamp.username || timestamp.password || timestamp.hash) throw Error('HTTPS-Zeitstempeldienst ist erforderlich.');
  return policy;
}

function loadPolicy(root) {
  return validatePolicy(JSON.parse(fs.readFileSync(path.join(root, 'desktop-release-policy.json'), 'utf8')));
}

function buildTrust(root, release) {
  if (release.channel !== 'stable') return Object.freeze({ enabled: false });
  const policy = loadPolicy(root);
  return Object.freeze({ enabled: true, repository: policy.repository, repositoryId: policy.repositoryId,
    visibility: policy.visibility, keyId: policy.keyId, publicKeyPem: policy.publicKeyPem,
    windows: { mode: windowsMode(policy.windows), certificateSha256: policy.windows.certificateSha256, publisherSubject: policy.windows.publisherSubject } });
}
module.exports = { keyFingerprint, validatePolicy, loadPolicy, buildTrust };

if (require.main === module) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--fingerprint') throw Error('Aufruf: release_policy.cjs --fingerprint <öffentliche PEM-Datei>');
    const publicKeyPem = fs.readFileSync(process.argv[3], 'utf8');
    console.log(JSON.stringify({ publicKeyPem, keyId: keyFingerprint(publicKeyPem) }, null, 2));
  } catch (error) {
    console.error(`Öffentlicher Update-Schlüssel ungültig: ${error.message}`);
    process.exitCode = 1;
  }
}
