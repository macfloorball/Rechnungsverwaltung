'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { REQUIRED_FILES, createInstallationManifest, validateInstallation } = require('./installation.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-installation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of REQUIRED_FILES) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `fixture ${name}`);
  }
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    ttcDistribution: 'installer', desktopAppId: 'de.mac-floorball.ttc-rechnungsverwaltung', main: 'electron/bootstrap.cjs',
  }));
  fs.writeFileSync(path.join(root, 'data', 'ttc.db'), 'untouched user data');
  const manifest = createInstallationManifest(root);
  fs.writeFileSync(path.join(root, 'installation-manifest.json'), JSON.stringify(manifest));
  return { root, manifest };
}

test('installed files are verified without reading or modifying personal data', (t) => {
  const { root, manifest } = fixture(t);
  assert.equal(validateInstallation(root, true), true);
  assert.ok(!Object.keys(manifest.files).some((name) => name.startsWith('data/')));
  fs.writeFileSync(path.join(root, 'data', 'ttc.db'), 'updated user data');
  assert.equal(validateInstallation(root, true), true);
  assert.equal(fs.readFileSync(path.join(root, 'data', 'ttc.db'), 'utf8'), 'updated user data');
});

test('missing runtime marker, truncated packages and invalid manifests fail before startup', (t) => {
  for (const name of ['packaged-runtime.json', 'runtime/python/python.exe', 'backend/main.py', 'installation-manifest.json']) {
    const { root } = fixture(t);
    fs.unlinkSync(path.join(root, name));
    assert.throws(() => validateInstallation(root, true), /vollständigen Installer/);
    assert.equal(fs.readFileSync(path.join(root, 'data', 'ttc.db'), 'utf8'), 'untouched user data');
  }
  const { root, manifest } = fixture(t);
  fs.writeFileSync(path.join(root, 'backend', 'main.py'), 'truncated');
  assert.throws(() => validateInstallation(root, true), /beschädigt/);
  manifest.files['../outside'] = 'a'.repeat(64);
  fs.writeFileSync(path.join(root, 'installation-manifest.json'), JSON.stringify(manifest));
  assert.throws(() => validateInstallation(root, true), /beschädigt/);
});

test('access failures produce actionable errors without disclosing file paths', (t) => {
  const { root } = fixture(t);
  const original = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    if (file === path.join(root, 'installation-manifest.json')) {
      throw Object.assign(Error('/private/customer-file'), { code: 'EACCES' });
    }
    return original(file, ...args);
  });
  assert.throws(() => validateInstallation(root, true), (error) => {
    assert.match(error.message, /Zugriffsrechte/);
    assert.doesNotMatch(error.message, /private|customer/);
    return true;
  });
});

test('development checkouts keep their existing startup behavior', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-development-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(validateInstallation(root), false);
});
