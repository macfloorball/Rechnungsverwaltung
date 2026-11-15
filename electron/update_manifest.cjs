'use strict';
const { createPublicKey, createHash, verify } = require('node:crypto');
const { parseVersion, versionFromTag, compareVersions, validateReleaseMetadata } = require('./version.cjs');

class UpdateError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function invalid() { throw new UpdateError('INVALID_METADATA'); }
const hex = (value, length) => typeof value === 'string' && value.length === length && /^[a-f0-9]+$/.test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;

function configuration(metadata, { packaged, currentVersion, platform, arch }) {
  if (!packaged || metadata.desktopRelease?.channel !== 'stable') return { enabled: false, reason: 'development' };
  if (metadata.desktopUpdateTrust?.enabled !== true) return { enabled: false, reason: 'not_configured' };
  if (arch !== 'x64' || !['win32', 'linux'].includes(platform)
      || metadata.ttcDistribution !== (platform === 'win32' ? 'installer' : 'appimage')) return { enabled: false, reason: 'unsupported_package' };
  validateReleaseMetadata(metadata.desktopRelease, currentVersion);
  const trust = metadata.desktopUpdateTrust;
  if (metadata.version !== currentVersion || metadata.desktopAppId !== 'de.mac-floorball.ttc-rechnungsverwaltung'
      || typeof trust.repository !== 'string' || trust.repository.trim() !== trust.repository || trust.repository.length > 200
      || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(trust.repository) || ['.', '..'].includes(trust.repository.split('/')[1]) || !positive(trust.repositoryId)
      || !['private', 'public'].includes(trust.visibility) || typeof trust.publicKeyPem !== 'string'
      || !trust.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----') || trust.publicKeyPem.includes('PRIVATE')) invalid();
  const publicKey = createPublicKey(trust.publicKeyPem);
  const fingerprint = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  if (publicKey.asymmetricKeyType !== 'ed25519' || fingerprint !== trust.keyId
      || !hex(trust.windows?.certificateSha256, 64) || typeof trust.windows.publisherSubject !== 'string'
      || !trust.windows.publisherSubject.trim() || /[\r\n\0]/.test(trust.windows.publisherSubject)) invalid();
  return Object.freeze({ enabled: true, appId: metadata.desktopAppId, currentVersion, platform, arch,
    repository: trust.repository, repositoryId: trust.repositoryId, visibility: trust.visibility,
    keyId: trust.keyId, publicKey, windows: Object.freeze({ ...trust.windows }) });
}

// JSON.parse accepts duplicate keys. Check the already syntactically valid token
// stream too, including escaped property names, before accepting signed metadata.
function strictJSON(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 65536) invalid();
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(text);
  const tokens = text.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) || [];
  let index = 0;
  function visit(depth) {
    if (depth > 16) invalid();
    const token = tokens[index++];
    if (token === '{') {
      const keys = new Set();
      if (tokens[index] === '}') { index++; return; }
      do {
        const key = JSON.parse(tokens[index++]);
        if (typeof key !== 'string' || keys.has(key) || tokens[index++] !== ':') invalid();
        keys.add(key);
        visit(depth + 1);
        if (tokens[index] !== ',') break;
        index++;
      } while (true);
      if (tokens[index++] !== '}') invalid();
    } else if (token === '[') {
      if (tokens[index] === ']') { index++; return; }
      do { visit(depth + 1); if (tokens[index] !== ',') break; index++; } while (true);
      if (tokens[index++] !== ']') invalid();
    } else if (!token || ['}', ']', ':', ','].includes(token)) invalid();
  }
  visit(0);
  if (index !== tokens.length) invalid();
  return value;
}

function keys(object, expected) {
  if (!object || Array.isArray(object) || typeof object !== 'object'
      || JSON.stringify(Object.keys(object).sort()) !== JSON.stringify([...expected].sort())) invalid();
}

function validateManifest(bytes, signature, config, release, now = Date.now()) {
  if (!Buffer.isBuffer(signature) || signature.length !== 64 || !verify(null, bytes, config.publicKey, signature)) throw new UpdateError('INVALID_SIGNATURE');
  const manifest = strictJSON(bytes);
  keys(manifest, ['formatVersion', 'appId', 'channel', 'version', 'tag', 'commit', 'repository', 'repositoryId', 'visibility',
    'keyId', 'publishedAt', 'expiresAt', 'releaseNotes', 'artifacts']);
  parseVersion(manifest.version);
  if (manifest.formatVersion !== 1 || manifest.appId !== config.appId || manifest.channel !== 'stable'
      || manifest.tag !== release.tag_name || versionFromTag(manifest.tag) !== manifest.version
      || !hex(manifest.commit, 40) || manifest.commit !== release.target_commitish
      || manifest.repository !== config.repository || manifest.repositoryId !== config.repositoryId || manifest.visibility !== config.visibility
      || manifest.keyId !== config.keyId || typeof manifest.releaseNotes !== 'string' || manifest.releaseNotes.length > 12000
      || typeof manifest.publishedAt !== 'string' || typeof manifest.expiresAt !== 'string') invalid();
  const published = Date.parse(manifest.publishedAt), expires = Date.parse(manifest.expiresAt);
  if (!Number.isFinite(published) || !Number.isFinite(expires) || published > now + 300000 || expires <= now
      || expires <= published || expires - published > 365 * 86400000) throw new UpdateError('EXPIRED_METADATA');
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 2 || !Array.isArray(release.assets) || release.assets.length !== 6
      || release.draft !== false || release.prerelease !== false) invalid();
  const names = new Set(), ids = new Set();
  for (const asset of release.assets) {
    if (!positive(asset.id) || names.has(asset.name) || ids.has(asset.id) || asset.state !== 'uploaded') invalid();
    names.add(asset.name); ids.add(asset.id);
  }
  const platforms = new Set();
  for (const artifact of manifest.artifacts) {
    const windows = artifact.platform === 'win32';
    keys(artifact, ['platform', 'arch', 'packageFormat', 'fileName', 'assetId', 'size', 'sha256', 'url', ...(windows ? ['windowsSignature'] : [])]);
    if (!['win32', 'linux'].includes(artifact.platform) || platforms.has(artifact.platform) || artifact.arch !== 'x64'
        || artifact.packageFormat !== (windows ? 'nsis' : 'appimage') || !positive(artifact.assetId)
        || !Number.isSafeInteger(artifact.size) || artifact.size < 1000000 || artifact.size > 1024 ** 3 || !hex(artifact.sha256, 64)
        || artifact.fileName !== `ttc-rechnungsverwaltung-${manifest.version}-${windows ? 'windows-x64-setup.exe' : 'linux-x64.AppImage'}`
        || artifact.url !== `https://api.github.com/repos/${config.repository}/releases/assets/${artifact.assetId}`
        || !release.assets.some((asset) => asset.id === artifact.assetId && asset.name === artifact.fileName && asset.size === artifact.size)) invalid();
    if (windows) {
      const receipt = artifact.windowsSignature;
      keys(receipt, ['status', 'certificateSha256', 'publisherSubject', 'timestamped', 'version']);
      if (receipt.status !== 'Valid' || receipt.timestamped !== true || receipt.version !== manifest.version
          || receipt.certificateSha256 !== config.windows.certificateSha256 || receipt.publisherSubject !== config.windows.publisherSubject) invalid();
      Object.freeze(receipt);
    }
    platforms.add(artifact.platform);
    Object.freeze(artifact);
  }
  const expectedNames = ['desktop-update.json', 'desktop-update.json.sig', 'RELEASE_NOTES.md', 'SHA256SUMS', ...manifest.artifacts.map((file) => file.fileName)];
  if (!expectedNames.every((name) => names.has(name))) invalid();
  Object.freeze(manifest.artifacts);
  return Object.freeze(manifest);
}

function newestRelease(releases, current) {
  let newest = null;
  const versions = new Set();
  for (const release of releases) {
    if (release?.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string'
        || typeof release.published_at !== 'string' || !Number.isFinite(Date.parse(release.published_at))) continue;
    let version;
    try { version = versionFromTag(release.tag_name); } catch { continue; }
    if (versions.has(version)) invalid();
    versions.add(version);
    if (compareVersions(version, current) > 0 && (!newest || compareVersions(version, versionFromTag(newest.tag_name)) > 0)) newest = release;
  }
  return newest;
}
module.exports = { UpdateError, configuration, strictJSON, validateManifest, newestRelease };
