'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { command, rpmRelease } = require('./rpm_package.cjs');
const { compareVersions } = require('../electron/version.cjs');
const { loadRpmPolicy, checkRpmGate } = require('./rpm_gate.cjs');
const { githubAPI } = require('./github_api.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function newerOrEqual(tag, release) {
  const match = /^rpm-v(\d+\.\d+\.\d+)-([1-9]\d*)$/.exec(tag);
  if (!match) return false;
  const order = compareVersions(match[1], release.version);
  return order > 0 || (order === 0 && Number(match[2]) >= release.release);
}
async function checkPagesRelease(api, policy, release) {
  const releases = await api.pages(`/repos/${policy.repository}/releases`);
  const stable = releases.filter(x => !x.draft && !x.prerelease);
  if (!stable.some(x => x.tag_name === release.tag) || stable.some(x => x.tag_name !== release.tag && newerOrEqual(x.tag_name, release))) {
    throw Error('Pages darf ausschließlich den neuesten veröffentlichten RPM-Release bereitstellen.');
  }
}
async function publishRpm({ api, policyAPI = api, policy, release, prepare, gate = checkRpmGate }) {
  const base = `/repos/${policy.repository}`;
  async function existing(exclude = null) {
    const items = await api.pages(`${base}/releases`);
    for (const item of items.filter(x => x.id !== exclude)) {
      if (item.tag_name === release.tag || (!item.draft && !item.prerelease && newerOrEqual(item.tag_name, release))) throw Error('RPM-Release existiert bereits oder wäre ein Downgrade.');
    }
    return items.filter(x => !x.draft && !x.prerelease && /^rpm-v\d+\.\d+\.\d+-[1-9]\d*$/.test(x.tag_name))
      .sort((a, b) => newerOrEqual(a.tag_name, { version: b.tag_name.slice(5).split('-')[0], release: Number(b.tag_name.split('-').at(-1)) }) ? -1 : 1)[0];
  }
  await gate(policyAPI, policy, release);
  const previous = await existing();
  let history = null;
  if (previous) {
    const assets = await api.pages(`${base}/releases/${previous.id}/assets`);
    const archive = assets.find(x => x.name === 'repository-metadata.tar.gz');
    if (!archive || archive.state !== 'uploaded' || !/^sha256:[a-f0-9]{64}$/.test(archive.digest || '') || archive.size <= 0) throw Error('Vorheriges RPM-Metadatenarchiv fehlt.');
    history = await api.verifyAsset(policy.repository, archive, { size: archive.size, sha256: archive.digest.slice(7) }, true);
  }
  // Key verification, RPM/source binding and local signing all precede remote mutations.
  const files = await prepare(history);
  const names = [`ttc-rechnungsverwaltung-${release.version}-${release.release}.x86_64.rpm`, 'repository-metadata.tar.gz',
    `ttc-rechnungsverwaltung-${release.version}-${release.release}.x86_64.rpm.build.json`, 'SHA256SUMS'];
  if (files.length !== names.length || !names.every(name => files.filter(f => f.fileName === name && Buffer.isBuffer(f.bytes) && f.bytes.length > 0).length === 1)) throw Error('Unvollständiges RPM-Veröffentlichungspaket.');
  const draft = await api.request('POST', `${base}/releases`, { body: { tag_name: release.tag, target_commitish: release.commit,
    name: `TT Rechnungsverwaltung RPM ${release.version}-${release.release}`, draft: true, prerelease: false, make_latest: 'false',
    body: `Fedora x86_64: Installation und Updates über das signierte DNF-Repository: ${policy.baseUrl}\n\nApp vor DNF-Updates vollständig schließen.\n\nOpenPGP: ${policy.keyFingerprint}\n\nDrittanbieter-Quellen: https://github.com/${policy.repository}/releases/tag/desktop-sources-2026-11-19` } });
  if (!Number.isSafeInteger(draft.id) || draft.id <= 0 || !draft.draft || draft.tag_name !== release.tag) throw Error('Ungültiger RPM-Entwurf.');
  const uploaded = [];
  for (const file of files) {
    const asset = await api.request('POST', `${base}/releases/${draft.id}/assets?name=${encodeURIComponent(file.fileName)}`, { body: file.bytes, upload: true });
    const expected = { size: file.bytes.length, sha256: hash(file.bytes) };
    if (asset.name !== file.fileName || asset.state !== 'uploaded' || asset.size !== expected.size) throw Error('Unvollständiger RPM-Upload.');
    await api.verifyAsset(policy.repository, asset, expected);
    uploaded.push(asset);
  }
  const assets = await api.pages(`${base}/releases/${draft.id}/assets`);
  if (assets.length !== files.length || !uploaded.every(x => assets.some(a => a.id === x.id && a.name === x.name && a.size === x.size && a.state === 'uploaded'))) throw Error('RPM-Assetliste geändert.');
  await gate(policyAPI, policy, release);
  await existing(draft.id);
  const result = await api.request('PATCH', `${base}/releases/${draft.id}`, { body: { draft: false, prerelease: false, make_latest: 'false' } });
  if (result.draft !== false || result.prerelease !== false || result.tag_name !== release.tag) throw Error('RPM-Veröffentlichungsstatus unklar; manuell prüfen.');
  return result;
}
async function main() {
  const root = path.join(__dirname, '..'); const policy = loadRpmPolicy(root);
  if (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF_TYPE !== 'tag' || process.env.GITHUB_REPOSITORY !== policy.repository || process.env.GITHUB_REF_NAME !== process.env.TTC_RPM_RELEASE_TAG) throw Error('Exakter RPM-Tag-Push erforderlich.');
  const release = rpmRelease(root, { release: Number(process.env.TTC_RPM_RELEASE_NUMBER) });
  if (process.argv.includes('--verify-pages')) {
    const api = githubAPI(process.env.GITHUB_TOKEN);
    await checkRpmGate(githubAPI(process.env.DESKTOP_POLICY_READ_TOKEN || process.env.GITHUB_TOKEN), policy, release);
    await checkPagesRelease(api, policy, release);
    console.log(`Pages-Freigabe für neuesten RPM-Release geprüft: ${release.tag}`); return;
  }
  const key = process.env.RPM_REPOSITORY_PRIVATE_KEY;
  delete process.env.RPM_REPOSITORY_PRIVATE_KEY;
  if (!key?.includes('-----BEGIN PGP PRIVATE KEY BLOCK-----')) throw Error('Privater RPM-Schlüssel fehlt.');
  const input = path.join(root, 'dist/rpm-input');
  const filename = `ttc-rechnungsverwaltung-${release.version}-${release.release}.x86_64.rpm`;
  if (fs.readdirSync(input).sort().join('|') !== [filename, filename + '.build.json'].sort().join('|')) throw Error('Unerwartete RPM-Buildartefakte.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-rpm-publish-'));
  try {
    const result = await publishRpm({ api: githubAPI(process.env.GITHUB_TOKEN),
      policyAPI: githubAPI(process.env.DESKTOP_POLICY_READ_TOKEN || process.env.GITHUB_TOKEN), policy, release,
      prepare: async history => {
        const releaseFile = path.join(temporary, 'release.json'); fs.writeFileSync(releaseFile, JSON.stringify(release));
        const previous = path.join(temporary, 'previous.tar.gz'); if (history) fs.writeFileSync(previous, history);
        const output = path.join(root, 'dist/rpm-signed');
        command('python3', ['scripts/prepare_rpm_release.py', path.join(input, filename), path.join(root, policy.publicKeyFile),
          output, releaseFile, path.join(root, 'rpm-repository-policy.json'), ...(history ? ['--previous', previous] : [])], { cwd: root, input: key });
        return fs.readdirSync(output).map(fileName => ({ fileName, bytes: fs.readFileSync(path.join(output, fileName)) }));
      } });
    console.log(`RPM-Release veröffentlicht: ${result.html_url}`);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
module.exports = { publishRpm, newerOrEqual, checkPagesRelease };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
