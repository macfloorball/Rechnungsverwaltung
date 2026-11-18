'use strict';
// Opt-in OS acceptance with ephemeral test trust and private temporary images.
// Does not change production policy, create Git tags or contact/publish GitHub.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createInstallationManifest } = require('../electron/installation.cjs');
const { releaseFixture } = require('../tests/release_fixture.cjs');
const { signedManifest } = require('./release_bundle.cjs');
const { appImageConfig } = require('./build_appimage.cjs');
const project = path.join(__dirname, '..');
const digest = b => createHash('sha256').update(b).digest('hex');
async function main() {
  assert.equal(process.platform, 'linux'); assert.notEqual(process.getuid(), 0);
  assert.ok((await fs.stat('/dev/fuse')).isCharacterDevice());
  const source = path.resolve(process.argv[2]);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ttc-native-update-'));
  await fs.chmod(root, 0o700);
  console.log(`Native update evidence: ${root}`);
  const { policy, privateKey } = releaseFixture();
  policy.visibility = 'public'; policy.windows = { mode: 'ed25519-only', certificateSha1: null, certificateSha256: null, publisherSubject: null, timestampUrl: null };
  const base = JSON.parse(await fs.readFile(path.join(source, 'resources/app/package.json')));
  assert.equal(base.desktopUpdateTrust.enabled, false, 'start only from a development fixture');
  const images = [];
  for (const version of ['0.1.0', '0.1.1']) {
    const directory = path.join(root, `appdir-${version}`);
    await fs.cp(source, directory, { recursive: true, dereference: true });
    await fs.rm(path.join(directory, '.DirIcon'), { force: true });
    const appRoot = path.join(directory, 'resources/app');
    const release = { formatVersion: 1, version, channel: 'stable', tag: `desktop-v${version}`, commit: (version === '0.1.0' ? 'a' : 'b').repeat(40) };
    // Deliberately artificial test metadata. These are not approved release commits.
    const metadata = { ...base, version, desktopRelease: release, desktopNativeAcceptance: true,
      desktopUpdateTrust: { ...policy, enabled: true } };
    await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify(metadata));
    for (const name of ['linux_update.cjs']) await fs.copyFile(path.join(project, 'electron', name), path.join(appRoot, 'electron', name));
    await fs.copyFile(path.join(project, 'tests/native_appimage_fixture.cjs'), path.join(appRoot, 'electron/native_acceptance.cjs'));
    const bootstrap = await fs.readFile(path.join(appRoot, 'electron/bootstrap.cjs'), 'utf8');
    await fs.writeFile(path.join(appRoot, 'electron/bootstrap.cjs'), bootstrap.replace("  require('./main.cjs');", "  require('./native_acceptance.cjs');\n  require('./main.cjs');"));
    await fs.writeFile(path.join(appRoot, 'installation-manifest.json'), JSON.stringify(createInstallationManifest(appRoot, 'linux')));
    const { build, Platform, Arch } = require('electron-builder');
    const config = appImageConfig(project, { ...require('../package.json'), version }, release);
    config.directories.output = path.join(root, `build-${version}`);
    config.extraMetadata = { version }; config.artifactName = `native-fixture-${version}.AppImage`;
    const outputs = await build({ projectDir: project, prepackaged: directory, targets: Platform.LINUX.createTarget('AppImage', Arch.x64), config, publish: 'never' });
    images.push(outputs.find(file => file.endsWith('.AppImage')));
  }
  const imageB = images[1], bytesB = await fs.readFile(imageB), hashB = digest(bytesB);
  const releaseMetadata = { formatVersion: 1, version: '0.1.1', channel: 'stable', tag: 'desktop-v0.1.1', commit: 'b'.repeat(40) };
  const packages = [{ platform: 'win32', arch: 'x64', packageFormat: 'nsis', assetId: 10, size: 1000001, sha256: 'd'.repeat(64),
    fileName: 'ttc-rechnungsverwaltung-0.1.1-windows-x64-setup.exe', windowsSignature: { status: 'NotSigned', timestamped: false, version: '0.1.1', certificateSha256: null, publisherSubject: null } },
  { platform: 'linux', arch: 'x64', packageFormat: 'appimage', assetId: 20, size: bytesB.length, sha256: hashB,
    fileName: 'ttc-rechnungsverwaltung-0.1.1-linux-x64.AppImage' }];
  const signed = signedManifest(policy, releaseMetadata, packages, 'Isolated native test only', privateKey);
  const release = { id: 100, draft: false, prerelease: false, tag_name: releaseMetadata.tag, target_commitish: releaseMetadata.commit, published_at: new Date().toISOString(),
    assets: packages.map(p => ({ id: p.assetId, name: p.fileName, size: p.size, state: 'uploaded' })).concat([
      { id: 30, name: 'desktop-update.json', size: signed.bytes.length, state: 'uploaded' }, { id: 40, name: 'desktop-update.json.sig', size: 64, state: 'uploaded' },
      { id: 50, name: 'RELEASE_NOTES.md', size: 1, state: 'uploaded' }, { id: 60, name: 'SHA256SUMS', size: 1, state: 'uploaded' }]) };
  const fixture = path.join(root, 'fixture.json');
  await fs.writeFile(fixture, JSON.stringify({ release, manifest: signed.bytes.toString('base64'), signature: signed.signature.toString('base64'), imageB, imageBSha256: hashB }), { mode: 0o600 });
  const image = path.join(root, 'TTC.AppImage'); await fs.copyFile(images[0], image); await fs.chmod(image, 0o700);
  await fs.mkdir(path.join(root, 'profile'), { mode: 0o700 });
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TTC_') && !key.startsWith('APPIMAGE') && !key.startsWith('PYTHON')
    && !['APPDIR', 'ARGV0', 'OWD', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  Object.assign(env, { XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), TTC_NATIVE_UPDATE_FIXTURE: fixture,
    TTC_DATA_DIRECTORY: path.join(root, 'data'), TTC_DOCUMENT_DIRECTORY: path.join(root, 'documents'), TTC_LEGACY_DATABASE: path.join(root, 'no-legacy.db'),
    TTC_DESKTOP_PRODUCTION_URL: `http://127.0.0.1:${port}` });
  const log = await fs.open(path.join(root, 'native.log'), 'wx');
  const child = spawn(image, [], { env, cwd: root, stdio: ['ignore', log.fd, log.fd] });
  const exited = new Promise((resolve, reject) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.once('error', reject); });
  try {
    const deadline = Date.now() + 120000;
    let result;
    while (Date.now() < deadline) {
      try { result = JSON.parse(await fs.readFile(path.join(root, 'native-result.json'))); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(result, `Native update timeout; inspect ${root}`);
    assert.equal(result.passed, true, result.error);
    assert.equal((await exited).code, 0);
    assert.equal(digest(await fs.readFile(image)), hashB);
    console.log(`NATIVE_APPIMAGE_UPDATE passed: 0.1.0 -> 0.1.1, real FUSE/helper/replacement/restart/data/PDF; fixture feed and confirmation; evidence: ${root}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const forced = setTimeout(() => child.kill('SIGKILL'), 5000); child.kill('SIGTERM'); await exited; clearTimeout(forced); }
    await log.close();
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
