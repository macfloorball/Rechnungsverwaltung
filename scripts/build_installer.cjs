'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { packageWindows } = require('./package_windows.cjs');
const { copyDesktopRuntime } = require('./package_desktop_runtime.cjs');
const { agreementHash } = require('./license_agreement.cjs');
const { installerConfig } = require('./installer_config.cjs');
const { withNsisTemplates } = require('./nsis_templates.cjs');
const { createInstallationManifest, validateInstallation } = require('../electron/installation.cjs');
const { getDesktopRelease, assertPackageRelease } = require('./desktop_release.cjs');
const { loadPolicy } = require('./release_policy.cjs');
const { authenticode } = require('./windows_signing.cjs');

async function buildInstaller(root = path.join(__dirname, '..')) {
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const release = getDesktopRelease(root);
  const policy = release.channel === 'stable' ? loadPolicy(root) : null;
  if (policy && process.platform !== 'win32') throw Error('Produktive Windows-Installer benötigen einen nativen Windows-Buildrunner.');
  const config = installerConfig(root, metadata, release);
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
  const output = await packageWindows(root, release);
  for (const destination of output) {
    // electron-builder skips app executable signing for prepackaged inputs.
    if (policy) authenticode(path.join(destination, `${metadata.productName}.exe`), policy, true, release.version);
    const appRoot = path.join(destination, 'resources', 'app');
    const packagedPython = path.join(appRoot, 'runtime', 'python');
    await copyDesktopRuntime(runtime, packagedPython, 'win32');
    await fs.cp(path.join(root, 'third_party', 'licenses', 'desktop-windows'),
      path.join(packagedPython, 'licenses', 'desktop-windows'), { recursive: true });
    await fs.cp(path.join(root, 'third_party', 'licenses', 'pydantic-core'),
      path.join(packagedPython, 'licenses', 'pydantic-core'), { recursive: true });
    await fs.writeFile(path.join(appRoot, 'packaged-runtime.json'), JSON.stringify({ python: manifest.python }));
    assertPackageRelease(appRoot, release);
    const appMetadata = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'));
    appMetadata.ttcDistribution = 'installer';
    appMetadata.main = 'electron/bootstrap.cjs';
    await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify(appMetadata, null, 2));
    await fs.writeFile(path.join(appRoot, 'installation-manifest.json'), JSON.stringify(createInstallationManifest(appRoot), null, 2));
    validateInstallation(appRoot, true, 'win32');
  }
  const { build, Platform, Arch } = require('electron-builder');
  const destination = config.directories.output;
  const staging = await fs.mkdtemp(path.join(root, 'dist', '.installer-'));
  try {
    // A failed compiler/Wine run must not replace a usable installer with its
    // small intermediate uninstaller generator.
    config.directories.output = staging;
    // Hash only the agreement displayed for consent, never the notices inventory.
    const agreement = await fs.readFile(config.nsis.license, 'utf8');
    const hash = agreementHash(agreement);
    // electron-builder adds a BOM: keep that transformation in disposable staging.
    config.nsis.license = path.join(staging, 'agreement.txt');
    await fs.writeFile(config.nsis.license, agreement);
    const include = path.join(staging, 'agreement.nsh');
    await fs.writeFile(include, `!define TTC_LICENSE_HASH "${hash}"\n!include "${config.nsis.include}"\n`);
    config.nsis.include = include;
    const artifacts = await withNsisTemplates(path.join(staging, 'templates'), () =>
      build({ projectDir: root, prepackaged: output[0],
        targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), config, publish: 'never' }));
    const installers = artifacts.filter((name) => name.endsWith('.exe'));
    if (!installers.length) throw Error('Installer wurde nicht erzeugt.');
    const checksums = [];
    for (const file of installers) {
      const windowsSignature = policy ? authenticode(file, policy, false, release.version) : null;
      const bytes = await fs.readFile(file);
      if (bytes[0] !== 0x4d || bytes[1] !== 0x5a || bytes.length < 1000000) throw Error('Installer-Datei fehlt oder ist unvollständig.');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      await fs.writeFile(file + '.sha256', `${sha256}  ${path.basename(file)}\n`);
      // Unsigned build information, not an authorization to install an update.
      await fs.writeFile(file + '.release.json', JSON.stringify({ ...release,
        appId: metadata.desktopAppId, platform: 'win32', arch: 'x64', packageFormat: 'nsis',
        fileName: path.basename(file), size: bytes.length, sha256, windowsSignature,
      }, null, 2) + '\n');
      checksums.push(file + '.sha256');
      checksums.push(file + '.release.json');
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
