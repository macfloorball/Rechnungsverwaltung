'use strict';

const path = require('node:path');
const { BrowserWindow } = require('electron');

function createMainWindow(frontendURL, onError) {
  const mainWindow = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });

  const contents = mainWindow.webContents;
  const session = contents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
  const allowedURL = frontendURL || require('node:url').pathToFileURL(path.join(__dirname, 'ready.html')).href;
  for (const eventName of ['will-navigate', 'will-redirect']) {
    contents.on(eventName, (event, url) => {
      if (url !== allowedURL) event.preventDefault();
    });
  }
  session.webRequest.onBeforeRequest((details, callback) => {
    const allowed = frontendURL
      ? new URL(details.url).origin === new URL(frontendURL).origin
      : details.url === allowedURL;
    callback({ cancel: !allowed });
  });
  contents.on('console-message', (event) => {
    if (event.level === 'error') console.error('[renderer]', event.message);
  });
  contents.on('preload-error', () => onError(new Error('Preload konnte nicht initialisiert werden')));
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') onError(new Error(`Renderer beendet: ${details.reason}`));
  });
  contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) onError(new Error(`Frontend-Ladefehler (${code})`));
  });
  const loaded = frontendURL
    ? mainWindow.loadURL(frontendURL)
    : mainWindow.loadFile(path.join(__dirname, 'ready.html'));
  loaded.catch(() => onError(new Error('Frontend konnte nicht geladen werden')));
  return mainWindow;
}

module.exports = { createMainWindow };
