'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { packageWindows } = require('./package_windows.cjs');
const { installerConfig } = require('./installer_config.cjs');

async function buildInstaller(root = path.join(__dirname, '..')) {
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const runtime = path.join(root, 'dist', 'python-windows');
  const manifest = JSON.parse(await fs.readFile(path.join(runtime, 'runtime-manifest.json'), 'utf8'));
  if (manifest.platform !== 'win32-x64' || !manifest.files['python.exe']) throw Error('Windows-Python-Laufzeit fehlt oder ist unvollständig.');
  for (const [name, hash] of Object.entries(manifest.files)) {
    const file = path.resolve(runtime, name);
    if (!file.startsWith(runtime + path.sep) || createHash('sha256').update(await fs.readFile(file)).digest('hex') !== hash) {
      throw Error('Windows-Python-Laufzeit ist beschädigt. Laufzeit neu erstellen.');
    }
  }
  const requirements = await fs.readFile(path.join(root, 'requirements-windows.txt'));
  if (createHash('sha256').update(requirements).digest('hex') !== manifest.requirementsSha256) throw Error('Windows-Python-Pakete sind veraltet. Laufzeit neu erstellen.');
  const output = await packageWindows(root);
  for (const destination of output) {
    await fs.cp(runtime, path.join(destination, 'resources', 'app', 'runtime', 'python'), { recursive: true });
    await fs.writeFile(path.join(destination, 'resources', 'app', 'packaged-runtime.json'), JSON.stringify({ python: manifest.python }));
  }
  const { build, Platform, Arch } = require('electron-builder');
  const artifacts = await build({ projectDir: root, prepackaged: output[0],
    targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
    config: installerConfig(root, metadata), publish: 'never' });
  for (const file of artifacts.filter((name) => name.endsWith('.exe'))) {
    const bytes = await fs.readFile(file);
    if (bytes[0] !== 0x4d || bytes[1] !== 0x5a || bytes.length < 1000000) throw Error('Installer-Datei fehlt oder ist unvollständig.');
    await fs.writeFile(file + '.sha256', `${createHash('sha256').update(bytes).digest('hex')}  ${path.basename(file)}\n`);
  }
  return artifacts;
}
if (require.main === module) buildInstaller().then((files) => files.forEach((file) => console.log(`Installer: ${file}`))).catch((error) => {
  console.error(`Installer-Build fehlgeschlagen: ${error.message}`);
  process.exitCode = 1;
});
module.exports = { buildInstaller };
