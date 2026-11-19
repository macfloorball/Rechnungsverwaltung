'use strict';
// Windows-only local acceptance artifacts. No remotes, publication, or persisted private key.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { releaseFixture } = require('../tests/release_fixture.cjs');
const { signedManifest } = require('../scripts/release_bundle.cjs');
const { buildInstaller } = require('../scripts/build_installer.cjs');
const { checkInstaller } = require('../scripts/check_installer.cjs');
const project = path.resolve(__dirname, '..');
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

async function main() {
  assert.equal(process.platform, 'win32');
  assert.equal(process.env.TTC_DESKTOP_RELEASE_TAG, undefined);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const sha = git(project, 'rev-parse', 'HEAD');
  assert.equal(git(project, 'status', '--porcelain'), '');
  assert.ok(process.argv.length <= 3, 'Usage: node scripts/build-windows-stable-test-pair.cjs [new-output-directory]');
  const runtime = path.join(project, 'dist', 'python-windows');
  assert.ok(fs.existsSync(path.join(runtime, 'runtime-manifest.json')), 'Prepare dist/python-windows first.');
  const output = process.argv[2];
  const root = output ? path.resolve(output) : fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-win-pair-'));
  if (output) fs.mkdirSync(root);
  console.log(`Isolated Windows test builds: ${root} (base ${sha})`);
  const archive = path.join(root, 'source.zip');
  git(project, 'archive', '--format=zip', '--output', archive, sha);
  const { privateKey, policy } = releaseFixture();
  policy.visibility = 'public';
  policy.repository = 'macfloorball/ttc-isolated-windows-fixture';
  policy.windows = { mode: 'ed25519-only', certificateSha1: null, certificateSha256: null,
    publisherSubject: null, timestampUrl: null };
  const packages = [];
  for (const [name, version] of [['A', '0.1.1'], ['B', '0.1.2']]) {
    const source = path.join(root, name);
    fs.mkdirSync(source);
    execFileSync('tar.exe', ['-xf', archive, '-C', source]);
    const metadata = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
    const lock = JSON.parse(fs.readFileSync(path.join(source, 'package-lock.json')));
    metadata.version = lock.version = lock.packages[''].version = version;
    json(path.join(source, 'package.json'), metadata);
    json(path.join(source, 'package-lock.json'), lock);
    json(path.join(source, 'desktop-release-policy.json'), policy);
    fs.copyFileSync(path.join(__dirname, 'windows-native-test-adapter.cjs'), path.join(source, 'electron/windows-native-test-adapter.cjs'));
    const bootstrap = path.join(source, 'electron/bootstrap.cjs');
    const original = fs.readFileSync(bootstrap, 'utf8');
    assert.ok(original.includes("  require('./main.cjs');"));
    fs.writeFileSync(bootstrap, original.replace("  require('./main.cjs');", "  require('./windows-native-test-adapter.cjs');\n  require('./main.cjs');"));
    git(source, 'init', '-q');
    git(source, 'add', '.');
    git(source, '-c', 'user.name=Codex Test', '-c', 'user.email=codex@users.noreply.github.com',
      'commit', '-qm', `test: isolate native Windows fixture ${name} from ${sha}`);
    const tag = `desktop-v${version}`;
    git(source, 'tag', tag);
    assert.equal(git(source, 'remote'), '');
    fs.symlinkSync(path.join(project, 'node_modules'), path.join(source, 'node_modules'), 'junction');
    fs.cpSync(runtime, path.join(source, 'dist', 'python-windows'), { recursive: true });
    process.env.TTC_DESKTOP_RELEASE_TAG = tag;
    try {
      await buildInstaller(source);
      const receipt = checkInstaller(source);
      assert.equal(receipt.windowsSignature.status, 'NotSigned');
      packages.push({ ...receipt, path: path.join(source, 'dist', 'installer', receipt.fileName) });
    } finally {
      delete process.env.TTC_DESKTOP_RELEASE_TAG;
    }
  }
  const release = packages[1];
  const artifacts = [{ ...release, assetId: 10, fileName: `ttc-rechnungsverwaltung-${release.version}-windows-x64-setup.exe` },
    { platform: 'linux', arch: 'x64', packageFormat: 'appimage', assetId: 20, size: 1000001,
      sha256: '0'.repeat(64), fileName: `ttc-rechnungsverwaltung-${release.version}-linux-x64.AppImage` }];
  const result = signedManifest(policy, release, artifacts, 'Isolated Windows test only. Linux asset is a placeholder.', privateKey);
  fs.writeFileSync(path.join(root, 'desktop-update.json'), result.bytes);
  fs.writeFileSync(path.join(root, 'desktop-update.json.sig'), result.signature);
  json(path.join(root, 'builds.json'), { sha, packages, linuxPlaceholder: true });
  console.log(JSON.stringify({ root, packages }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
