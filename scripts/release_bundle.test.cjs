'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { collectPackages, sha256 } = require('./release_bundle.cjs');
const { releaseFixture } = require('../tests/release_fixture.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-release-bundle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { policy } = releaseFixture();
  const release = { formatVersion: 1, version: '1.2.3', channel: 'stable', tag: 'desktop-v1.2.3', commit: 'c'.repeat(40) };
  const appId = 'de.mac-floorball.ttc-rechnungsverwaltung';
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: release.version, productName: 'TTC', desktopAppId: appId }));
  const input = path.join(root, 'input');
  const receipt = { status: 'Valid', timestamped: true, version: release.version, certificateSha256: policy.windows.certificateSha256, publisherSubject: policy.windows.publisherSubject };
  const files = [];
  for (const platform of ['win32', 'linux']) {
    const directory = path.join(input, platform === 'win32' ? 'windows' : 'linux');
    fs.mkdirSync(directory, { recursive: true });
    const fileName = `TTC-1.2.3-${platform === 'win32' ? 'windows-x64-setup.exe' : 'linux-x86_64.AppImage'}`;
    const bytes = Buffer.alloc(1000001);
    if (platform === 'win32') bytes.write('MZ'); else Buffer.from('7f454c46', 'hex').copy(bytes);
    const file = path.join(directory, fileName);
    fs.writeFileSync(file, bytes);
    fs.writeFileSync(file + '.sha256', `${sha256(bytes)}  ${fileName}\n`);
    fs.writeFileSync(file + '.release.json', JSON.stringify({ ...release, appId, platform, arch: 'x64',
      packageFormat: platform === 'win32' ? 'nsis' : 'appimage', fileName, size: bytes.length, sha256: sha256(bytes),
      ...(platform === 'win32' ? { windowsSignature: receipt } : {}) }));
    files.push(file);
  }
  return { root, input, policy, release, receipt, files };
}

test('only exact complete platform bundles are accepted and canonical binary names are used', (t) => {
  const f = fixture(t);
  const files = collectPackages(f.root, f.input, f.release, f.policy, () => f.receipt);
  assert.equal(files.length, 2);
  assert.deepEqual(files.map((file) => file.fileName), ['ttc-rechnungsverwaltung-1.2.3-windows-x64-setup.exe', 'ttc-rechnungsverwaltung-1.2.3-linux-x64.AppImage']);
});

test('private files, corrupted downloads and rejected Windows signatures cannot enter the release', (t) => {
  let f = fixture(t);
  fs.writeFileSync(path.join(f.input, 'windows', 'private-source.zip'), 'private');
  assert.throws(() => collectPackages(f.root, f.input, f.release, f.policy, () => f.receipt), /nicht freigegebene/);
  f = fixture(t);
  fs.appendFileSync(f.files[1], 'tampered');
  assert.throws(() => collectPackages(f.root, f.input, f.release, f.policy, () => f.receipt), /stimmen/);
  f = fixture(t);
  assert.throws(() => collectPackages(f.root, f.input, f.release, f.policy, () => { throw Error('Invalid Authenticode'); }), /Invalid Authenticode/);
  assert.throws(() => collectPackages(f.root, f.input, f.release, f.policy, () => ({ ...f.receipt, timestamped: false })), /Signaturnachweis|ungültig/);
  assert.throws(() => collectPackages(f.root, f.input, f.release, f.policy, () => ({ ...f.receipt, version: '1.2.2' })), /Signaturnachweis|ungültig/);
});


test('explicit unsigned bundles require matching native receipts and both source commits', (t) => {
  const f = fixture(t);
  f.policy.windows = { mode: 'ed25519-only' };
  const receipt = { status: 'NotSigned', timestamped: false, version: f.release.version, certificateSha256: null, publisherSubject: null };
  const infoPath = f.files[0] + '.release.json';
  const info = JSON.parse(fs.readFileSync(infoPath));
  info.windowsSignature = receipt;
  fs.writeFileSync(infoPath, JSON.stringify(info));
  assert.equal(collectPackages(f.root, f.input, f.release, f.policy, () => receipt).length, 2);
  assert.throws(() => collectPackages(f.root, f.input, f.release, f.policy, () => ({ ...receipt, status: 'HashMismatch' })));
  info.commit = 'f'.repeat(40);
  fs.writeFileSync(infoPath, JSON.stringify(info));
  assert.throws(() => collectPackages(f.root, f.input, f.release, f.policy, () => receipt), /stimmen/);
});
