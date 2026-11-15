'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validateInstallation } = require('../electron/installation.cjs');
const { getDesktopRelease, assertPackageRelease } = require('./desktop_release.cjs');

function checkAppImage(directory, project = path.join(__dirname, '..')) {
  const root = path.resolve(directory);
  const app = path.join(root, 'resources', 'app');
  validateInstallation(app, true, 'linux');
  const release = getDesktopRelease(project);
  assertPackageRelease(app, release);
  if (fs.readFileSync(path.join(root, 'AppRun'), 'utf8') !== fs.readFileSync(path.join(project, 'build', 'linux', 'AppRun'), 'utf8')) {
    throw Error('AppImage enthält nicht den freigegebenen Starter mit aktivierter Sandbox.');
  }
  const desktopFiles = fs.readdirSync(root).filter((name) => name.endsWith('.desktop'));
  const commands = desktopFiles.length === 1
    ? fs.readFileSync(path.join(root, desktopFiles[0]), 'utf8').split('\n').filter((line) => line.startsWith('Exec=')) : [];
  if (commands.length !== 1 || commands[0] !== 'Exec=AppRun %U') {
    throw Error('AppImage-Desktopstarter enthält unerwartete Startargumente.');
  }
  return release;
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw Error('Aufruf: check_appimage.cjs <entpacktes AppImage>');
    console.log(JSON.stringify(checkAppImage(process.argv[2]), null, 2));
  } catch (error) {
    console.error(`AppImage-Prüfung fehlgeschlagen: ${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = { checkAppImage };
