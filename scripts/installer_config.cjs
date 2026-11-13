'use strict';
const path = require('node:path');

// The prototype packager still owns the positive runtime file selection.
// NSIS consumes that directory rather than repackaging the development checkout.
function installerConfig(root, metadata) {
  return {
    appId: metadata.desktopAppId,
    productName: metadata.productName,
    electronVersion: metadata.devDependencies.electron,
    directories: { output: path.join(root, 'dist', 'installer') },
    artifactName: '${productName}-${version}-windows-${arch}-setup.${ext}',
    asar: false,
    npmRebuild: false,
    publish: null,
    toolsets: { wine: '1.0.1' },
    win: { target: [{ target: 'nsis', arch: ['x64'] }],
      publisherName: metadata.author,
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
