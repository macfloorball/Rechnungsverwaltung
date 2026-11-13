'use strict';
const path = require('node:path');
const { validateReleaseMetadata } = require('../electron/version.cjs');

// The prototype packager still owns the positive runtime file selection.
// NSIS consumes that directory rather than repackaging the development checkout.
function installerConfig(root, metadata, release = { formatVersion: 1, version: metadata.version, channel: 'development', tag: null, commit: null }) {
  validateReleaseMetadata(release, metadata.version);
  return {
    appId: metadata.desktopAppId,
    productName: metadata.productName,
    electronVersion: metadata.devDependencies.electron,
    directories: { output: path.join(root, 'dist', 'installer') },
    artifactName: '${productName}-${version}-windows-${arch}' + (release.channel === 'development' ? '-development' : '') + '-setup.${ext}',
    buildVersion: `${release.version}.0`,
    extraMetadata: { version: release.version, desktopRelease: release },
    asar: false,
    npmRebuild: false,
    publish: null,
    win: { target: [{ target: 'nsis', arch: ['x64'] }],
      icon: path.join(root, 'electron', 'assets', 'app-icon.ico'),
      signAndEditExecutable: false, requestedExecutionLevel: 'asInvoker' },
    nsis: { oneClick: false, perMachine: false,
      include: path.join(root, 'build', 'windows', 'installer.nsh'),
      allowElevation: false, allowToChangeInstallationDirectory: false,
      packElevateHelper: false,
      deleteAppDataOnUninstall: false,
      createDesktopShortcut: 'always', createStartMenuShortcut: true,
      shortcutName: metadata.productName,
      runAfterFinish: false, installerLanguages: ['de_DE'],
    },
  };
}
module.exports = { installerConfig };
