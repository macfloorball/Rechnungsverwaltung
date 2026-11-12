'use strict';

const { app, dialog } = require('electron');
const { getDesktopConfig } = require('./config.cjs');
const { waitForFrontend } = require('./startup.cjs');
const { createMainWindow } = require('./window.cjs');

let mainWindow = null;
let frontendURL;
let stopping = false;

function fail(error) {
  if (stopping) return;
  stopping = true;
  console.error('Electron-Fehler:', error instanceof Error ? error.message : 'Unbekannter Main-Prozessfehler');
  dialog.showErrorBox('Rechnungsverwaltung – Startfehler', error instanceof Error ? error.message : 'Die Anwendung konnte nicht geladen werden.');
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
  if (app.isReady() && frontendURL) {
    try { openMainWindow(); } catch (error) { fail(error); }
  }
});
app.whenReady().then(async () => {
  const config = getDesktopConfig(process.env, process.argv, app.isPackaged);
  await waitForFrontend(config);
  if (stopping) return;
  frontendURL = config.url;
  openMainWindow();
}).catch(fail);
