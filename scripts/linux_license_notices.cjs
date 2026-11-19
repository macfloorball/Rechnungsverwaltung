'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Validate the versioned evidence before copying it into the temporary AppDir.
// The source runtime and its upstream manifest remain untouched.
async function copyLinuxLicenseNotices(root, python) {
  const collections = ['python-linux', 'pydantic-core', 'desktop-linux'];
  const verified = [];
  for (const name of collections) {
    const source = path.join(root, 'third_party/licenses', name);
    const bytes = await fs.readFile(path.join(source, 'provenance.json'));
    const provenance = JSON.parse(bytes);
    const files = [{ name: 'provenance.json', bytes }];
    for (const entry of provenance.files) {
      if (typeof entry.file !== 'string' || path.basename(entry.file) !== entry.file
          || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error('Ungültiger Linux-Lizenznachweis.');
      const file = path.join(source, entry.file);
      if (!(await fs.lstat(file)).isFile()) throw Error('Linux-Lizenznachweis muss reguläre Datei sein.');
      const content = await fs.readFile(file);
      if (createHash('sha256').update(content).digest('hex') !== entry.sha256) throw Error(`Linux-Lizenznachweis beschädigt: ${name}/${entry.file}`);
      files.push({ name: entry.file, bytes: content });
    }
    verified.push({ name, files });
  }
  for (const collection of verified) {
    const target = path.join(python, 'licenses', collection.name);
    await fs.mkdir(target, { recursive: true });
    for (const file of collection.files) await fs.writeFile(path.join(target, file.name), file.bytes);
  }
}
module.exports = { copyLinuxLicenseNotices };
