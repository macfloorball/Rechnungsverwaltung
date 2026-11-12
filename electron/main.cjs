'use strict';

const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { getFrontendURL } = require('./config.cjs');

let mainWindow;

async function createWindow() {
  const frontendURL = getFrontendURL(process.env.TTC_DESKTOP_URL);
  mainWindow = new BrowserWindow({
    webPreferences: {
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
  if (frontendURL) await mainWindow.loadURL(frontendURL);
  else await mainWindow.loadFile(path.join(__dirname, 'ready.html'));
}

function fail(error) {
  console.error('Electron-Start fehlgeschlagen:', error.message);
  app.exit(1);
}

app.whenReady().then(createWindow).catch(fail);
app.on('window-all-closed', () => app.quit());
// No preload or IPC handlers: the renderer receives no privileged API.
