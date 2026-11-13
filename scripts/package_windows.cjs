'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildFrontend } = require('./build_frontend.cjs');
const { getDesktopRelease, assertPackageRelease } = require('./desktop_release.cjs');
const { validateReleaseMetadata } = require('../electron/version.cjs');

async function prepareWindowsSource(root, target, release = getDesktopRelease(root)) {
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  validateReleaseMetadata(release, metadata.version);
  await buildFrontend(root);
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, 'package.json'), JSON.stringify({
    name: metadata.name, productName: metadata.productName, version: metadata.version,
    desktopAppId: metadata.desktopAppId, description: metadata.description,
    main: metadata.main, author: metadata.author || metadata.productName, private: true,
    desktopRelease: release,
  }, null, 2));
  // Positive selection: never copy runtime data, environments, Git, or node_modules.
  for (const folder of ['electron', 'backend']) {
    await fs.mkdir(path.join(target, folder), { recursive: true });
    for (const entry of await fs.readdir(path.join(root, folder), { withFileTypes: true })) {
      const sourceModule = folder === 'electron'
        ? entry.name.endsWith('.cjs') && !entry.name.endsWith('.test.cjs')
        : entry.name.endsWith('.py');
      if (entry.isFile() && sourceModule) {
        await fs.copyFile(path.join(root, folder, entry.name), path.join(target, folder, entry.name));
      }
    }
  }
  // Required by electron/backend.cjs; include only the runtime launcher and
  // Python lifecycle adapter, never the build/test tools or an existing venv.
  await fs.mkdir(path.join(target, 'scripts'), { recursive: true });
  for (const name of ['run.cjs', 'managed_server.py']) {
    await fs.copyFile(path.join(root, 'scripts', name), path.join(target, 'scripts', name));
  }
  await fs.mkdir(path.join(target, 'electron', 'assets'), { recursive: true });
  for (const name of ['app-icon.ico', 'app-icon.png', 'app-icon.svg']) {
    await fs.copyFile(path.join(root, 'electron', 'assets', name), path.join(target, 'electron', 'assets', name));
  }
  await fs.mkdir(path.join(target, 'dist'), { recursive: true });
  await fs.cp(path.join(root, 'dist', 'frontend'), path.join(target, 'dist', 'frontend'), { recursive: true });
  await fs.copyFile(path.join(root, 'requirements.txt'), path.join(target, 'requirements.txt'));
  assertPackageRelease(target, release);
  return metadata;
}

async function packageWindows(root = path.join(__dirname, '..'), release = getDesktopRelease(root)) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ttc-win-build-'));
  try {
    const source = path.join(temporary, 'app');
    const metadata = await prepareWindowsSource(root, source, release);
    const { packager } = await import('@electron/packager');
    const output = await packager({
      dir: source, out: path.join(root, 'dist', 'windows'),
      name: metadata.productName, executableName: metadata.productName,
      platform: 'win32', arch: 'x64', electronVersion: metadata.devDependencies.electron,
      electronZipDir: process.env.TTC_ELECTRON_ZIP_DIRECTORY,
      appVersion: metadata.version, icon: path.join(source, 'electron', 'assets', 'app-icon.ico'),
      buildVersion: `${metadata.version}.0`,
      win32metadata: { ProductName: metadata.productName, FileDescription: metadata.description || metadata.productName,
        CompanyName: metadata.author || metadata.productName },
      asar: false, prune: false, overwrite: true,
    });
    for (const destination of output) assertPackageRelease(path.join(destination, 'resources', 'app'), release);
    for (const destination of output) console.log(`Windows-Testbuild: ${destination}`);
    return output;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) packageWindows().catch((error) => {
  console.error(`Windows-Build fehlgeschlagen: ${error.message}`);
  process.exitCode = 1;
});
module.exports = { prepareWindowsSource, packageWindows };
