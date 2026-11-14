'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { getDesktopRelease } = require('./desktop_release.cjs');
const { validateReleaseMetadata } = require('../electron/version.cjs');

function checkInstaller(root) {
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const release = getDesktopRelease(root);
  const name = `${metadata.productName}-${release.version}-windows-x64${release.channel === 'development' ? '-development' : ''}-setup.exe`;
  const installer = path.join(root, 'dist', 'installer', name);
  const bytes = fs.readFileSync(installer);
  const info = JSON.parse(fs.readFileSync(installer + '.release.json', 'utf8'));
  validateReleaseMetadata(info, release.version);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length < 1000000 || bytes.subarray(0, 2).toString() !== 'MZ'
      || ['formatVersion', 'version', 'channel', 'tag', 'commit'].some((key) => info[key] !== release[key])
      || info.appId !== metadata.desktopAppId || info.platform !== 'win32' || info.arch !== 'x64'
      || info.packageFormat !== 'nsis' || info.fileName !== name || info.size !== bytes.length || info.sha256 !== sha256
      || fs.readFileSync(installer + '.sha256', 'utf8') !== `${sha256}  ${name}\n`) {
    throw Error('Windows-Installer oder Build-Metadaten sind unvollständig oder inkonsistent.');
  }
  return info;
}
if (require.main === module) {
  try {
    console.log(JSON.stringify(checkInstaller(path.join(__dirname, '..')), null, 2));
  } catch (error) {
    console.error(`Windows-Installer-Prüfung fehlgeschlagen: ${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = { checkInstaller };
