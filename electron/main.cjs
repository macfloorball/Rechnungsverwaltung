'use strict';

const { app, dialog, ipcMain, safeStorage } = require('electron');
const { getDesktopConfig } = require('./config.cjs');
const { createBackend } = require('./backend.cjs');
const { createMainWindow } = require('./window.cjs');
const { registerAppIPC } = require('./ipc.cjs');
const { APP_NAME, configureIdentity } = require('./identity.cjs');
const { createDesktopUpdates } = require('./updates.cjs');

configureIdentity(app);
const primaryInstance = app.requestSingleInstanceLock();
let mainWindow = null;
let frontendURL;
let backend;
let updates;
let stopping = false;
let shutdownComplete = false;
let shutdownPromise;
let exitCode = 0;

function shutdown() {
  if (!shutdownPromise) {
    stopping = true;
    try { updates?.service.stop(); } catch {}
    shutdownPromise = Promise.resolve().then(() => backend?.stop()).then((forced) => {
      if (forced) exitCode = 1;
    }).catch(() => {
      exitCode = 1;
      console.error('Eigener Backend-Prozess konnte nicht kontrolliert beendet werden.');
    }).then(() => {
      shutdownComplete = true;
      if (exitCode) app.exit(exitCode);
      else app.quit();
    });
  }
  return shutdownPromise;
}

function fail(error) {
  if (stopping) return;
  exitCode = 1;
  const message = error instanceof Error ? error.message : 'Die Anwendung konnte nicht geladen werden.';
  console.error('Electron-Fehler:', message);
  dialog.showErrorBox(`${APP_NAME} – Startfehler`, message);
  shutdown();
}

function openMainWindow() {
  if (stopping) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }
  mainWindow = createMainWindow(frontendURL, fail);
  mainWindow.once('closed', () => { mainWindow = null; });
}

process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
process.on('SIGINT', () => app.quit());
process.on('SIGTERM', () => app.quit());
app.on('before-quit', (event) => {
  if (!shutdownComplete && primaryInstance) {
    event.preventDefault();
    shutdown();
  }
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (app.isReady() && frontendURL) {
    try { openMainWindow(); } catch (error) { fail(error); }
  }
});
app.on('second-instance', () => {
  if (frontendURL) openMainWindow();
});

if (!primaryInstance) app.quit();
else app.whenReady().then(async () => {
  const config = getDesktopConfig(process.env, process.argv, app.isPackaged);
  backend = createBackend({ config, root: app.getAppPath(), env: { ...process.env, TTC_DATA_DIRECTORY: process.env.TTC_DATA_DIRECTORY || app.getPath('userData') }, onFailure: fail });
  await backend.start();
  if (stopping) return;
  frontendURL = config.url;
  const disposeIPC = registerAppIPC({ ipcMain, app, getMainWindow: () => mainWindow, getFrontendURL: () => frontendURL,
    getUpdateService: () => updates?.service });
  app.once('will-quit', disposeIPC);
  openMainWindow();
  if (stopping) return;
  try {
    updates = createDesktopUpdates({ app, safeStorage });
    updates.service.start();
  } catch {
    // Optional update failures must never enter the application's fatal handler.
    console.error('Update-Dienst konnte nicht initialisiert werden. Die lokale Anwendung bleibt verfügbar.');
  }
}).catch(fail);
