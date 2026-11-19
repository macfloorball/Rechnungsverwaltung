'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { copyLinuxLicenseNotices } = require('./linux_license_notices.cjs');

test('Linux evidence ships Python/Rust/font notices with checked hashes', async t => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), 'ttc-linux-notices-'));
  t.after(() => fs.rm(target, { recursive: true, force: true }));
  const root = path.join(__dirname, '..');
  await copyLinuxLicenseNotices(root, target);
  for (const group of ['python-linux', 'pydantic-core', 'desktop-linux']) {
    const source = path.join(root, 'third_party/licenses', group);
    const provenance = JSON.parse(await fs.readFile(path.join(source, 'provenance.json')));
    for (const entry of provenance.files) assert.deepEqual(await fs.readFile(path.join(target, 'licenses', group, entry.file)), await fs.readFile(path.join(source, entry.file)));
  }
  assert.equal((await fs.readdir(path.join(target, 'licenses/pydantic-core'))).length, 102);
});

test('changed or linked license evidence blocks copying before output is written', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ttc-linux-notice-corrupt-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const collection = path.join(root, 'third_party/licenses/python-linux');
  await fs.mkdir(collection, { recursive: true });
  await fs.writeFile(path.join(collection, 'provenance.json'), JSON.stringify({ files: [{ file: 'LICENSE.txt', sha256: '0'.repeat(64) }] }));
  await fs.writeFile(path.join(collection, 'LICENSE.txt'), 'changed');
  const target = path.join(root, 'output');
  await assert.rejects(copyLinuxLicenseNotices(root, target), /beschädigt/);
  if (process.platform === 'linux') {
    await fs.unlink(path.join(collection, 'LICENSE.txt'));
    await fs.symlink('provenance.json', path.join(collection, 'LICENSE.txt'));
    await assert.rejects(copyLinuxLicenseNotices(root, target), /reguläre/);
  }
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });
});
