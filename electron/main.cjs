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
let updateExitApproved = false;

function shutdown() {
  if (!shutdownPromise) {
    stopping = true;
    try { updates?.controller?.dispose(); } catch {}
    try { updates?.service.stop(); } catch {}
    shutdownPromise = Promise.resolve().then(async () => {
      try { await updates?.downloader?.stop(); }
      catch { console.error('Updatecache konnte beim Beenden nicht vollständig bereinigt werden.'); }
    }).then(() => backend?.stop()).then((forced) => {
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
  mainWindow.on('close', (event) => { if (updates?.installer?.isBusy() && !updateExitApproved) event.preventDefault(); });
  mainWindow.once('closed', () => { mainWindow = null; });
}

process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
process.on('SIGINT', () => app.quit());
process.on('SIGTERM', () => app.quit());
app.on('before-quit', (event) => {
  if (updates?.installer?.isBusy() && !updateExitApproved) { event.preventDefault(); return; }
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
  if (process.platform === 'win32' && app.isPackaged) await require('./windows_update.cjs').checkWindowsUpdateLock(app.getPath('userData'));
  if (process.platform === 'linux' && app.isPackaged) await require('./linux_update.cjs').checkLinuxUpdateLock(app);
  const backendOptions = { config, root: app.getAppPath(), env: { ...process.env, TTC_DATA_DIRECTORY: process.env.TTC_DATA_DIRECTORY || app.getPath('userData') }, onFailure: fail };
  backend = createBackend(backendOptions);
  await backend.start();
  if (stopping) return;
  frontendURL = config.url;
  const disposeIPC = registerAppIPC({ ipcMain, app, getMainWindow: () => mainWindow, getFrontendURL: () => frontendURL,
    getUpdateService: () => updates?.service, getUpdateController: () => updates?.controller });
  app.once('will-quit', disposeIPC);
  openMainWindow();
  if (stopping) return;
  try {
    updates = createDesktopUpdates({ app, safeStorage, installation: { dialog, getMainWindow: () => mainWindow, getBackend: () => backend,
      async restartBackend() { await backend.stopForUpdate(); backend = createBackend(backendOptions); await backend.start(); },
      exitForUpdate() { updateExitApproved = true; app.quit(); },
    } });
    disposeIPC.bindUpdates?.(updates.controller);
    await updates.installer?.recovery();
    await updates.downloader?.recover();
    updates.service.start();
  } catch {
    // Optional update failures must never enter the application's fatal handler.
    console.error('Update-Dienst konnte nicht initialisiert werden. Die lokale Anwendung bleibt verfügbar.');
  }
}).catch(fail);
