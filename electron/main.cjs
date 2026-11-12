'use strict';

const { app } = require('electron');
const { getFrontendURL } = require('./config.cjs');
const { createMainWindow } = require('./window.cjs');

let mainWindow = null;
let frontendURL;
let stopping = false;

function fail(error) {
  if (stopping) return;
  stopping = true;
  console.error('Electron-Fehler:', error instanceof Error ? error.message : 'Unbekannter Main-Prozessfehler');
  app.exit(1);
}

function openMainWindow() {
  if (stopping) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }
  mainWindow = createMainWindow(frontendURL, fail);
  mainWindow.once('closed', () => { mainWindow = null; });
}

process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
app.on('before-quit', () => { stopping = true; });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (app.isReady()) {
    try { openMainWindow(); } catch (error) { fail(error); }
  }
});
app.whenReady().then(() => {
  frontendURL = getFrontendURL(process.env.TTC_DESKTOP_URL);
  openMainWindow();
}).catch(fail);
