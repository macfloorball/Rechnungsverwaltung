'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

async function buildFrontend(root = path.join(__dirname, '..')) {
  const source = path.join(root, 'frontend');
  const target = path.join(root, 'dist', 'frontend');
  const files = (await fs.readdir(source, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(source, path.join(entry.parentPath, entry.name))).sort();
  if (!files.includes('index.html') || !files.includes(path.join('js', 'app.js'))) {
    throw new Error('Frontend-Einstieg fehlt');
  }
  const hash = crypto.createHash('sha256');
  const contents = await Promise.all(files.map(async (file) => {
    const data = await fs.readFile(path.join(source, file));
    return data;
  }));
  await fs.rm(target, { recursive: true, force: true });
  for (const [index, file] of files.entries()) {
    await fs.mkdir(path.dirname(path.join(target, file)), { recursive: true });
    await fs.writeFile(path.join(target, file), contents[index]);
  }
  for (const [index, file] of files.entries()) {
    hash.update(file.split(path.sep).join('/')).update(contents[index]);
  }
  const manifest = { buildId: hash.digest('hex') };
  await fs.writeFile(path.join(target, 'desktop-build.json'), JSON.stringify(manifest));
  return manifest;
}
if (require.main === module) buildFrontend().then(() => console.log('Frontend-Build: dist/frontend')).catch((error) => {
  console.error(error.message); process.exitCode = 1;
});
module.exports = { buildFrontend };
