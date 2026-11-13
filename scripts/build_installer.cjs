'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { packageWindows } = require('./package_windows.cjs');
const { installerConfig } = require('./installer_config.cjs');
const { createInstallationManifest, validateInstallation } = require('../electron/installation.cjs');

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
    const appRoot = path.join(destination, 'resources', 'app');
    const appMetadata = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'));
    appMetadata.ttcDistribution = 'installer';
    appMetadata.main = 'electron/bootstrap.cjs';
    await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify(appMetadata, null, 2));
    await fs.writeFile(path.join(appRoot, 'installation-manifest.json'), JSON.stringify(createInstallationManifest(appRoot), null, 2));
    validateInstallation(appRoot, true);
  }
  const { build, Platform, Arch } = require('electron-builder');
  const config = installerConfig(root, metadata);
  const destination = config.directories.output;
  const staging = await fs.mkdtemp(path.join(root, 'dist', '.installer-'));
  try {
    // A failed compiler/Wine run must not replace a usable installer with its
    // small intermediate uninstaller generator.
    config.directories.output = staging;
    const artifacts = await build({ projectDir: root, prepackaged: output[0],
      targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), config, publish: 'never' });
    const installers = artifacts.filter((name) => name.endsWith('.exe'));
    if (!installers.length) throw Error('Installer wurde nicht erzeugt.');
    const checksums = [];
    for (const file of installers) {
      const bytes = await fs.readFile(file);
      if (bytes[0] !== 0x4d || bytes[1] !== 0x5a || bytes.length < 1000000) throw Error('Installer-Datei fehlt oder ist unvollständig.');
      await fs.writeFile(file + '.sha256', `${createHash('sha256').update(bytes).digest('hex')}  ${path.basename(file)}\n`);
      checksums.push(file + '.sha256');
    }
    await fs.mkdir(destination, { recursive: true });
    const published = [];
    for (const file of [...artifacts, ...checksums]) {
      const target = path.join(destination, path.basename(file));
      await fs.rename(file, target);
      published.push(target);
    }
    return published;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
if (require.main === module) buildInstaller().then((files) => files.forEach((file) => console.log(`Installer: ${file}`))).catch((error) => {
  console.error(`Installer-Build fehlgeschlagen: ${error.message}`);
  process.exitCode = 1;
});
module.exports = { buildInstaller };
