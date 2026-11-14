'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validateReleaseMetadata } = require('./version.cjs');

const REQUIRED_FILES = [
  'package.json', 'packaged-runtime.json', 'electron/bootstrap.cjs', 'electron/main.cjs', 'electron/installation.cjs', 'electron/version.cjs',
  'electron/updates.cjs', 'electron/update_manifest.cjs', 'electron/update_transport.cjs', 'electron/update_credentials.cjs',
  'electron/update_controller.cjs', 'electron/update_download.cjs', 'electron/windows_update.cjs', 'electron/windows_update_helper.cjs',
  'backend/desktop_update_gate.py',
  'scripts/run.cjs', 'scripts/managed_server.py', 'backend/main.py',
  'dist/frontend/index.html', 'dist/frontend/desktop-build.json',
  'runtime/python/python.exe', 'runtime/python/python313.dll', 'runtime/python/python313._pth',
  'runtime/python/Lib/site-packages/fastapi/__init__.py',
];
function requiredFiles(platform) {
  if (platform === 'win32') return REQUIRED_FILES;
  if (platform !== 'linux') throw Error('Installationsplattform wird nicht unterstützt.');
  return [...REQUIRED_FILES.filter((name) => !name.startsWith('runtime/python/')),
    'runtime/python/bin/python3.13', 'runtime/python/lib/python3.13/site-packages/fastapi/__init__.py'];
}
const SELECTION = ['package.json', 'packaged-runtime.json', 'electron', 'scripts', 'backend', 'dist/frontend', 'runtime/python'];
function digest(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function createInstallationManifest(root, platform = 'win32') {
  const files = {};
  function visit(name) {
    const file = path.join(root, name);
    const entry = fs.lstatSync(file);
    if (entry.isDirectory()) {
      for (const child of fs.readdirSync(file).sort()) visit(`${name}/${child}`);
    } else if (entry.isFile()) files[name] = digest(file);
    else throw Error('Installationspaket enthält einen nicht regulären Dateieintrag.');
  }
  SELECTION.forEach(visit);
  for (const name of requiredFiles(platform)) if (!files[name]) throw Error('Installationspaket ist unvollständig.');
  return { formatVersion: 1, platform, files };
}

function validateInstallation(root, installed = false, platform = process.platform) {
  if (!installed && !fs.existsSync(path.join(root, 'packaged-runtime.json'))) return false;
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (metadata.ttcDistribution !== (platform === 'linux' ? 'appimage' : 'installer') || typeof metadata.desktopAppId !== 'string' ||
        !metadata.desktopAppId || metadata.main !== 'electron/bootstrap.cjs') throw Error();
    validateReleaseMetadata(metadata.desktopRelease, metadata.version);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'installation-manifest.json'), 'utf8'));
    if (manifest.formatVersion !== 1 || !manifest.files || Array.isArray(manifest.files)) throw Error();
    // Preserve compatibility with existing Windows format-1 manifests.
    if ((manifest.platform || 'win32') !== platform) throw Error();
    for (const name of requiredFiles(platform)) if (!manifest.files[name]) throw Error();
    const base = path.resolve(root) + path.sep;
    for (const [name, hash] of Object.entries(manifest.files)) {
      const file = path.resolve(root, name);
      if (name.includes('\\') || !file.startsWith(base) || !/^[a-f0-9]{64}$/.test(hash) ||
          !fs.lstatSync(file).isFile() || digest(file) !== hash) throw Error();
    }
    return true;
  } catch (error) {
    if (['EACCES', 'EPERM'].includes(error.code)) {
      throw Error('Die Programmdateien sind nicht lesbar. Zugriffsrechte prüfen oder die Anwendung mit dem Installer reparieren. Persönliche Daten bleiben erhalten.');
    }
    throw Error('Die Installation ist unvollständig oder beschädigt. Anwendung mit dem vollständigen Installer reparieren. Persönliche Daten bleiben erhalten.');
  }
}
module.exports = { REQUIRED_FILES, createInstallationManifest, validateInstallation };
