'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { checkInstaller } = require('./check_installer.cjs');

test('CI rejects absent, truncated and mismatched installers rather than accepting only an unpacked app', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-installer-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.0', productName: 'TTC', desktopAppId: 'test.app' }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: '0.1.0', packages: { '': { version: '0.1.0' } } }));
  assert.throws(() => checkInstaller(root));
  const fileName = 'TTC-0.1.0-windows-x64-development-setup.exe';
  fs.mkdirSync(path.join(root, 'dist/installer'), { recursive: true });
  const file = path.join(root, 'dist/installer', fileName);
  const bytes = Buffer.alloc(1000001); bytes.write('MZ');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const info = { formatVersion: 1, version: '0.1.0', channel: 'development', tag: null, commit: null,
    appId: 'test.app', platform: 'win32', arch: 'x64', packageFormat: 'nsis', fileName, size: bytes.length, sha256 };
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(file + '.release.json', JSON.stringify(info));
  fs.writeFileSync(file + '.sha256', `${sha256}  ${fileName}\n`);
  assert.equal(checkInstaller(root).version, '0.1.0');
  fs.writeFileSync(file + '.release.json', JSON.stringify({ ...info, arch: 'arm64' }));
  assert.throws(() => checkInstaller(root), /inkonsistent/);
  fs.writeFileSync(file + '.release.json', JSON.stringify(info));
  fs.writeFileSync(file, 'MZtruncated');
  assert.throws(() => checkInstaller(root), /inkonsistent/);
});
