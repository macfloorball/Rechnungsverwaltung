'use strict';
const path = require('node:path');
const { loadPolicy } = require('./release_policy.cjs');
const { getDesktopRelease } = require('./desktop_release.cjs');
const { compareVersions, versionFromTag } = require('../electron/version.cjs');
const { githubAPI } = require('./github_api.cjs');
const { checkGate } = require('./release_gate.cjs');
const { authenticode } = require('./windows_signing.cjs');
const { sha256, signingKey, collectPackages, releaseNotes, signedManifest } = require('./release_bundle.cjs');

async function publish({ api, policyAPI = api, policy, release, packages, notes, key, now = new Date(), gate = checkGate }) {
  const base = `/repos/${policy.repository}`;
  async function checkExisting(excludeId = null) {
    const releases = await api.pages(`${base}/releases`);
    for (const existing of releases) {
      if (existing.id === excludeId) continue;
      if (existing.tag_name === release.tag) throw Error('Für diesen Tag existiert bereits ein Release oder Entwurf. Kein Überschreiben.');
      if (!existing.draft && !existing.prerelease && existing.tag_name.startsWith('desktop-v')
          && compareVersions(release.version, versionFromTag(existing.tag_name)) <= 0) throw Error('Ein neuerer oder gleicher stabiler Desktop-Release existiert bereits.');
    }
  }
  // Verify the signing key and complete local bundle before any remote mutation.
  const probe = signedManifest(policy, release, packages.map((file, index) => ({ ...file, assetId: index + 1 })), notes, key, now);
  if (!probe.signature) throw Error('Release-Signatur fehlt.');
  await gate(policyAPI, policy, release);
  await checkExisting();
  const draft = await api.request('POST', `${base}/releases`, { body: { tag_name: release.tag,
    target_commitish: release.commit, name: `TT Rechnungsverwaltung ${release.version}`, body: notes,
    draft: true, prerelease: false, generate_release_notes: false, make_latest: 'false' } });
  if (!Number.isSafeInteger(draft.id) || draft.id <= 0 || draft.draft !== true || draft.tag_name !== release.tag) throw Error('Ungültiger Release-Entwurf.');
  const uploaded = [];
  async function upload(file) {
    const asset = await api.request('POST', `${base}/releases/${draft.id}/assets?name=${encodeURIComponent(file.fileName)}`, { body: file.bytes, upload: true });
    const expected = { size: file.bytes.length, sha256: sha256(file.bytes) };
    if (asset.name !== file.fileName || asset.state !== 'uploaded' || asset.size !== expected.size) throw Error('Unvollständiges oder umbenanntes Release-Asset.');
    await api.verifyAsset(policy.repository, asset, expected);
    uploaded.push({ ...expected, fileName: file.fileName, assetId: asset.id });
    return asset.id;
  }
  const boundPackages = [];
  for (const file of packages) boundPackages.push({ ...file, assetId: await upload(file) });
  const manifest = signedManifest(policy, release, boundPackages, notes, key, now);
  const metadata = [
    { fileName: 'desktop-update.json', bytes: manifest.bytes },
    { fileName: 'desktop-update.json.sig', bytes: manifest.signature },
    { fileName: 'RELEASE_NOTES.md', bytes: Buffer.from(notes) },
  ];
  const sums = [...packages, ...metadata].map((file) => `${sha256(file.bytes)}  ${file.fileName}`).join('\n') + '\n';
  metadata.push({ fileName: 'SHA256SUMS', bytes: Buffer.from(sums) });
  for (const file of metadata) await upload(file);
  const assets = await api.pages(`${base}/releases/${draft.id}/assets`);
  if (assets.length !== uploaded.length || !uploaded.every((file) => assets.some((asset) => asset.id === file.assetId
      && asset.name === file.fileName && asset.size === file.size && asset.state === 'uploaded'))) throw Error('Release-Artefaktliste ist unvollständig oder enthält zusätzliche Dateien.');
  // All artifacts have been downloaded and cryptographically compared after upload.
  // Any failure above leaves a draft. There is no retry/replace/delete path.
  await gate(policyAPI, policy, release);
  await checkExisting(draft.id);
  const result = await api.request('PATCH', `${base}/releases/${draft.id}`, { body: { draft: false, prerelease: false, make_latest: 'false' } });
  if (result.draft !== false || result.prerelease !== false || result.tag_name !== release.tag) throw Error('Veröffentlichungsstatus unklar; Release manuell prüfen, nicht automatisch wiederholen.');
  return result;
}

if (require.main === module) {
  (async () => {
    const root = path.join(__dirname, '..');
    const policy = loadPolicy(root);
    if (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF_TYPE !== 'tag'
        || process.env.GITHUB_REPOSITORY !== policy.repository || process.env.GITHUB_REF_NAME !== process.env.TTC_DESKTOP_RELEASE_TAG) {
      throw Error('Release-Veröffentlichung benötigt das freigegebene Tag-Push-Ereignis.');
    }
    const release = getDesktopRelease(root);
    const key = signingKey(process.env.DESKTOP_UPDATE_PRIVATE_KEY, policy);
    const packages = collectPackages(root, path.join(root, 'dist', 'release-input'), release, policy,
      (file, checkedPolicy) => authenticode(file, checkedPolicy, false, release.version));
    const result = await publish({ api: githubAPI(process.env.GITHUB_TOKEN),
      policyAPI: githubAPI(process.env.DESKTOP_POLICY_READ_TOKEN || process.env.GITHUB_TOKEN),
      policy, release, packages, notes: releaseNotes(root, release), key });
    console.log(`Privater Desktop-Release veröffentlicht: ${result.html_url}`);
  })().catch((error) => { console.error(`Release nicht bestätigt: ${error.message}`); process.exitCode = 1; });
}
module.exports = { publish };
