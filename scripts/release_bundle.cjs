'use strict';
const fs = require('node:fs');
const { validWindowsReceipt } = require('../electron/windows_trust.cjs');
const path = require('node:path');
const { createHash, createPrivateKey, createPublicKey, sign, verify } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { validateReleaseMetadata } = require('../electron/version.cjs');
const { validatePolicy, keyFingerprint } = require('./release_policy.cjs');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function signingKey(privatePem, policy) {
  validatePolicy(policy);
  try {
    const key = createPrivateKey(privatePem);
    if (key.asymmetricKeyType !== 'ed25519' || keyFingerprint(createPublicKey(key).export({ type: 'spki', format: 'pem' })) !== policy.keyId) throw Error();
    return key;
  } catch { throw Error('Ed25519-Release-Schlüssel fehlt oder passt nicht zur freigegebenen Vertrauenswurzel.'); }
}

function collectPackages(root, input, release, policy, verifyWindows) {
  validatePolicy(policy);
  validateReleaseMetadata(release, release.version);
  if (release.channel !== 'stable') throw Error('Entwicklungsbuilds dürfen nicht veröffentlicht werden.');
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (metadata.version !== release.version || metadata.desktopAppId !== 'de.mac-floorball.ttc-rechnungsverwaltung'
      || !/^[A-Za-z0-9._ -]+$/.test(metadata.productName)) throw Error('Paketidentität stimmt nicht überein.');
  return [
    { directory: 'windows', platform: 'win32', packageFormat: 'nsis',
      original: `${metadata.productName}-${release.version}-windows-x64-setup.exe`,
      fileName: `ttc-rechnungsverwaltung-${release.version}-windows-x64-setup.exe` },
    { directory: 'linux', platform: 'linux', packageFormat: 'appimage',
      original: `${metadata.productName}-${release.version}-linux-x86_64.AppImage`,
      fileName: `ttc-rechnungsverwaltung-${release.version}-linux-x64.AppImage` },
  ].map((target) => {
    const directory = path.join(input, target.directory);
    const allowed = [target.original, target.original + '.sha256', target.original + '.release.json'].sort();
    if (JSON.stringify(fs.readdirSync(directory).sort()) !== JSON.stringify(allowed)) throw Error('Release-Artefaktliste ist unvollständig oder enthält nicht freigegebene Dateien.');
    for (const name of allowed) if (!fs.lstatSync(path.join(directory, name)).isFile()) throw Error('Nur reguläre Release-Dateien sind erlaubt.');
    const file = path.join(directory, target.original);
    const size = fs.statSync(file).size;
    if (size < 1000000 || size > 1024 ** 3) throw Error('Unplausible Größe eines Release-Pakets.');
    const bytes = fs.readFileSync(file);
    if (target.platform === 'win32' ? bytes.subarray(0, 2).toString() !== 'MZ' : bytes.subarray(0, 4).toString('hex') !== '7f454c46') {
      throw Error('Release-Paket hat ein falsches Dateiformat.');
    }
    const info = JSON.parse(fs.readFileSync(file + '.release.json', 'utf8'));
    validateReleaseMetadata(info, release.version);
    const digest = sha256(bytes);
    if (['formatVersion', 'version', 'channel', 'tag', 'commit'].some((key) => info[key] !== release[key])
        || info.appId !== metadata.desktopAppId || info.platform !== target.platform || info.arch !== 'x64'
        || info.packageFormat !== target.packageFormat || info.fileName !== target.original || info.size !== size || info.sha256 !== digest
        || fs.readFileSync(file + '.sha256', 'utf8') !== `${digest}  ${target.original}\n`) {
      throw Error('Release-Paket, Version und Build-Metadaten stimmen nicht überein.');
    }
    let windowsSignature;
    if (target.platform === 'win32') {
      windowsSignature = verifyWindows(file, policy);
      for (const field of ['status', 'certificateSha256', 'publisherSubject', 'timestamped', 'version']) {
        if (info.windowsSignature?.[field] !== windowsSignature[field]) throw Error('Windows-Signaturnachweis stimmt nicht überein.');
      }
      if (!validWindowsReceipt(windowsSignature, policy.windows, release.version)) throw Error('Windows-Code-Signatur ist ungültig.');
    }
    return { fileName: target.fileName, bytes, platform: target.platform, arch: 'x64',
      packageFormat: target.packageFormat, size, sha256: digest, ...(windowsSignature ? { windowsSignature } : {}) };
  });
}

function releaseNotes(root, release) {
  const subjects = execFileSync('git', ['log', '--no-merges', '-30', '--format=%s', release.commit],
    { cwd: root, encoding: 'utf8', timeout: 10000 }).split('\n').filter(Boolean);
  const text = subjects.map((subject) => `- ${subject.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 240)}`).join('\n');
  return `TT Rechnungsverwaltung ${release.version}\n\n${text}\n\nQuellstand: ${release.commit}\nWindows x64: NSIS. Linux x64: AppImage.\nVor dem Update eine vollständige Datensicherung erstellen.\n`;
}

function signedManifest(policy, release, packages, notes, key, now = new Date()) {
  validatePolicy(policy);
  validateReleaseMetadata(release, release.version);
  if (release.channel !== 'stable' || packages.length !== 2 || new Set(packages.map((file) => file.platform)).size !== 2
      || !['win32', 'linux'].every((platform) => packages.some((file) => file.platform === platform))
      || typeof notes !== 'string' || notes.length > 12000) throw Error('Unvollständiges stabiles Release-Manifest.');
  const manifest = { formatVersion: 1, appId: 'de.mac-floorball.ttc-rechnungsverwaltung',
    channel: 'stable', version: release.version, tag: release.tag, commit: release.commit,
    repository: policy.repository, repositoryId: policy.repositoryId, visibility: policy.visibility,
    keyId: policy.keyId, publishedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + policy.manifestLifetimeDays * 86400000).toISOString(),
    releaseNotes: notes, artifacts: packages.map((file) => {
      const windows = file.platform === 'win32';
      const fileName = `ttc-rechnungsverwaltung-${release.version}-${windows ? 'windows-x64-setup.exe' : 'linux-x64.AppImage'}`;
      if (!Number.isSafeInteger(file.assetId) || file.assetId <= 0 || file.fileName !== fileName
          || file.arch !== 'x64' || file.packageFormat !== (windows ? 'nsis' : 'appimage')
          || !Number.isSafeInteger(file.size) || file.size < 1000000 || file.size > 1024 ** 3
          || typeof file.sha256 !== 'string' || file.sha256.length !== 64 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error('Ungültige Plattform- oder Asset-Metadaten.');
      if (windows && !validWindowsReceipt(file.windowsSignature, policy.windows, release.version)) throw Error('Authenticode-Nachweis fehlt.');
      return { platform: file.platform, arch: file.arch, packageFormat: file.packageFormat, fileName,
        assetId: file.assetId, size: file.size, sha256: file.sha256,
        url: `https://api.github.com/repos/${policy.repository}/releases/assets/${file.assetId}`,
        ...(windows ? { windowsSignature: file.windowsSignature } : {}) };
    }) };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  const signature = sign(null, bytes, key);
  if (signature.length !== 64 || !verify(null, bytes, createPublicKey(policy.publicKeyPem), signature)) throw Error('Release-Selbstverifikation fehlgeschlagen.');
  return { bytes, signature };
}
module.exports = { sha256, signingKey, collectPackages, releaseNotes, signedManifest };
