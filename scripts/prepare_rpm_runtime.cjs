'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createPublicKey, verify, createHash } = require('node:crypto');
const { createUpdateTransport } = require('../electron/update_transport.cjs');
const { strictJSON } = require('../electron/update_manifest.cjs');
const { loadPolicy } = require('./release_policy.cjs');
const { command } = require('./rpm_package.cjs');
async function prepareRpmRuntime(root, destination) {
  const policy = JSON.parse(await fs.readFile(path.join(root, 'rpm-repository-policy.json')));
  const trust = loadPolicy(root);
  if (policy.repository !== trust.repository || policy.repositoryId !== trust.repositoryId
      || !/^desktop-v\d+\.\d+\.\d+$/.test(policy.runtime.tag) || !/^[a-f0-9]{40}$/.test(policy.runtime.commit)
      || !/^[a-f0-9]{64}$/.test(policy.runtime.imageSha256)) throw Error('Invalid pinned RPM runtime policy');
  await fs.mkdir(destination, { recursive: false, mode: 0o700 });
  const transport = createUpdateTransport({ config: { ...trust, platform: 'linux', arch: 'x64' }, token: null, signal: AbortSignal.timeout(240000) });
  const matches = (await transport.releases()).filter(r => r.tag_name === policy.runtime.tag);
  if (matches.length !== 1) throw Error('Pinned runtime release missing or ambiguous');
  const release = await transport.release(matches[0].id);
  if (release.tag_name !== policy.runtime.tag || release.target_commitish !== policy.runtime.commit || release.draft || release.prerelease || release.assets.length !== 6) throw Error('Unexpected runtime release');
  const manifestAsset = release.assets.find(a => a.name === 'desktop-update.json');
  const signatureAsset = release.assets.find(a => a.name === 'desktop-update.json.sig');
  if (!manifestAsset || !signatureAsset) throw Error('Missing runtime signature');
  const bytes = await transport.asset(manifestAsset.id, 65536), signature = await transport.asset(signatureAsset.id, 64);
  if (!verify(null, bytes, createPublicKey(trust.publicKeyPem), signature)) throw Error('Runtime signature rejected');
  const manifest = strictJSON(bytes);
  // This is an immutable build input, not an update offer. Its fixed signature,
  // commit and independently pinned artifact hash remain required after expiry.
  if (manifest.channel !== 'stable' || manifest.tag !== policy.runtime.tag || manifest.commit !== policy.runtime.commit
      || manifest.repository !== trust.repository || manifest.repositoryId !== trust.repositoryId || manifest.keyId !== trust.keyId) throw Error('Runtime source identity mismatch');
  const artifact = manifest.artifacts.find(a => a.platform === 'linux' && a.arch === 'x64' && a.packageFormat === 'appimage');
  const asset = release.assets.find(a => a.id === artifact?.assetId);
  if (!asset || asset.name !== artifact.fileName || asset.size !== artifact.size || artifact.sha256 !== policy.runtime.imageSha256
      || artifact.url !== `https://api.github.com/repos/${trust.repository}/releases/assets/${asset.id}`) throw Error('Runtime asset binding mismatch');
  const image = path.join(destination, 'runtime-base.AppImage');
  const handle = await fs.open(image, 'wx', 0o700); const digest = createHash('sha256'); let size = 0;
  try { await transport.streamAsset(asset.id, artifact.size, async chunk => { size += chunk.length; if (size > artifact.size) throw Error('Oversized runtime'); digest.update(chunk); await handle.writeFile(chunk); }); }
  finally { await handle.close(); }
  if (size !== artifact.size || digest.digest('hex') !== policy.runtime.imageSha256) throw Error('Runtime bytes rejected');
  const extracted = path.join(destination, 'extracted'); await fs.mkdir(extracted, { mode: 0o700 });
  command(image, ['--appimage-extract'], { cwd: extracted });
  await fs.writeFile(path.join(destination, 'verified-source.json'), JSON.stringify({ ...policy.runtime, signatureVerified: true, repository: policy.repository }, null, 2) + '\n');
  return path.join(extracted, 'squashfs-root');
}
module.exports = { prepareRpmRuntime };
if (require.main === module) prepareRpmRuntime(path.join(__dirname, '..'), path.resolve(process.argv[2]))
  .then(directory => console.log(directory)).catch(error => { console.error(error.message); process.exitCode = 1; });
