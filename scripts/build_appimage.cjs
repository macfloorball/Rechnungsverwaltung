'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { prepareWindowsSource: prepareDesktopSource } = require('./package_windows.cjs');
const { copyDesktopRuntime } = require('./package_desktop_runtime.cjs');
const { copyLinuxLicenseNotices } = require('./linux_license_notices.cjs');
const { getDesktopRelease, assertPackageRelease } = require('./desktop_release.cjs');
const { createInstallationManifest, validateInstallation } = require('../electron/installation.cjs');

function appImageConfig(root, metadata, release) {
  return {
    appId: metadata.desktopAppId, productName: metadata.productName,
    electronVersion: metadata.devDependencies.electron, asar: false, npmRebuild: false, publish: null,
    directories: { output: path.join(root, 'dist', 'appimage') },
    toolsets: { appimage: '1.0.3' },
    appImage: { executableArgs: [] },
    artifactName: '${productName}-${version}-linux-${arch}' + (release.channel === 'development' ? '-development' : '') + '.${ext}',
    linux: { target: [{ target: 'AppImage', arch: ['x64'] }], category: 'Office',
      icon: path.join(root, 'electron', 'assets', 'app-icon.png'), executableName: metadata.name },
  };
}

async function buildAppImage(root = path.join(__dirname, '..')) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw Error('AppImage-Build benötigt Linux x86_64.');
  const release = getDesktopRelease(root);
  const runtime = path.join(root, 'dist', 'python-linux');
  const manifest = JSON.parse(await fs.readFile(path.join(runtime, 'runtime-manifest.json'), 'utf8'));
  if (manifest.platform !== 'linux-x64' || !manifest.files['bin/python3.13']) throw Error('Linux-Python-Laufzeit fehlt.');
  for (const [name, hash] of Object.entries(manifest.files)) {
    const file = path.resolve(runtime, name);
    if (!file.startsWith(runtime + path.sep) || !(await fs.lstat(file)).isFile()
        || createHash('sha256').update(await fs.readFile(file)).digest('hex') !== hash) throw Error('Linux-Python-Laufzeit ist beschädigt.');
  }
  if (createHash('sha256').update(await fs.readFile(path.join(root, 'requirements-linux.txt'))).digest('hex') !== manifest.requirementsSha256) {
    throw Error('Linux-Python-Pakete sind veraltet. Laufzeit neu erstellen.');
  }
  await fs.mkdir(path.join(root, 'dist'), { recursive: true });
  const temporary = await fs.mkdtemp(path.join(root, 'dist', '.appimage-'));
  try {
    const source = path.join(temporary, 'app');
    const metadata = await prepareDesktopSource(root, source, release);
    const appMetadata = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
    Object.assign(appMetadata, { ttcDistribution: 'appimage', main: 'electron/bootstrap.cjs' });
    await fs.writeFile(path.join(source, 'package.json'), JSON.stringify(appMetadata, null, 2));
    await copyDesktopRuntime(runtime, path.join(source, 'runtime', 'python'), 'linux');
    await copyLinuxLicenseNotices(root, path.join(source, 'runtime', 'python'));
    await fs.writeFile(path.join(source, 'packaged-runtime.json'), JSON.stringify({ python: manifest.python, platform: 'linux-x64' }));
    await fs.writeFile(path.join(source, 'installation-manifest.json'), JSON.stringify(createInstallationManifest(source, 'linux'), null, 2));
    validateInstallation(source, true, 'linux');
    const { packager } = await import('@electron/packager');
    const [prepackaged] = await packager({ dir: source, out: path.join(temporary, 'unpacked'),
      name: metadata.productName, executableName: metadata.name, platform: 'linux', arch: 'x64',
      electronVersion: metadata.devDependencies.electron, appVersion: release.version,
      asar: false, prune: false, overwrite: true });
    assertPackageRelease(path.join(prepackaged, 'resources', 'app'), release);
    // Packager normalizes package.json; hash the final files, not the input tree.
    await fs.writeFile(path.join(prepackaged, 'resources', 'app', 'installation-manifest.json'),
      JSON.stringify(createInstallationManifest(path.join(prepackaged, 'resources', 'app'), 'linux'), null, 2));
    validateInstallation(path.join(prepackaged, 'resources', 'app'), true, 'linux');
    // The pinned builder copies prepackaged AppRun over its generated launcher.
    // Its default launcher can silently disable the sandbox; ours never does.
    await fs.copyFile(path.join(root, 'build', 'linux', 'AppRun'), path.join(prepackaged, 'AppRun'));
    await fs.chmod(path.join(prepackaged, 'AppRun'), 0o755);
    const { build, Platform, Arch } = require('electron-builder');
    const config = appImageConfig(root, metadata, release);
    const destination = config.directories.output;
    config.directories.output = path.join(temporary, 'artifacts');
    const artifacts = await build({ projectDir: root, prepackaged,
      targets: Platform.LINUX.createTarget('AppImage', Arch.x64), config, publish: 'never' });
    const images = artifacts.filter((file) => file.endsWith('.AppImage'));
    if (images.length !== 1) throw Error('Genau ein vollständiges AppImage wird erwartet.');
    const bytes = await fs.readFile(images[0]);
    if (bytes.length < 1000000 || bytes.subarray(0, 4).toString('hex') !== '7f454c46') throw Error('AppImage ist unvollständig.');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const info = images[0] + '.release.json';
    const checksum = images[0] + '.sha256';
    await fs.writeFile(info, JSON.stringify({ ...release, appId: metadata.desktopAppId,
      platform: 'linux', arch: 'x64', packageFormat: 'appimage', fileName: path.basename(images[0]),
      size: bytes.length, sha256 }, null, 2) + '\n');
    await fs.writeFile(checksum, `${sha256}  ${path.basename(images[0])}\n`);
    await fs.mkdir(destination, { recursive: true });
    const result = [];
    for (const file of [...artifacts, info, checksum]) {
      const target = path.join(destination, path.basename(file));
      await fs.rename(file, target);
      await fs.chmod(target, file.endsWith('.AppImage') ? 0o755 : 0o644);
      result.push(target);
    }
    return result;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
if (require.main === module) buildAppImage().then((files) => files.forEach((file) => console.log(`AppImage: ${file}`))).catch((error) => {
  console.error(`AppImage-Build fehlgeschlagen: ${error.message}`);
  process.exitCode = 1;
});
module.exports = { appImageConfig, buildAppImage };
