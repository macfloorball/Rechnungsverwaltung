'use strict';

const path = require('node:path');
const { BrowserWindow, screen } = require('electron');
const { APP_NAME, getWindowOptions } = require('./identity.cjs');

function createMainWindow(frontendURL, onError) {
  const mainWindow = new BrowserWindow({
    ...getWindowOptions(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea),
    show: false,
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
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle(APP_NAME);
  });
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow.isDestroyed()) mainWindow.show();
  });
  const session = contents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
  const allowedURL = frontendURL;
  for (const eventName of ['will-navigate', 'will-redirect']) {
    contents.on(eventName, (event, url) => {
      try {
        const target = new URL(url);
        const start = new URL(allowedURL);
        if (target.origin !== start.origin || target.pathname !== start.pathname || target.search) {
          event.preventDefault();
        }
      } catch { event.preventDefault(); }
    });
  }
  session.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try { allowed = new URL(details.url).origin === new URL(frontendURL).origin; } catch {}
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
    if (!mainWindow.isDestroyed() && isMainFrame && code !== -3) onError(new Error(`Frontend-Ladefehler (${code})`));
  });
  const loaded = mainWindow.loadURL(frontendURL);
  loaded.catch(() => {
    if (!mainWindow.isDestroyed()) onError(new Error('Frontend konnte nicht geladen werden'));
  });
  return mainWindow;
}

module.exports = { createMainWindow };
