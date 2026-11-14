'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Only named requests are exposed; no channel, URL, path or command arguments.
async function request(channel, args) {
  if (args.length) return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Dieser Aufruf akzeptiert keine Argumente.' } };
  try { return await ipcRenderer.invoke(channel); }
  catch { return { ok: false, error: { code: 'IPC_UNAVAILABLE', message: 'Desktop-Verbindung nicht verfügbar.' } }; }
}
const desktopAPI = Object.freeze({
  apiVersion: 1,
  getVersion(...args) { return request('ttc:request:app:get-version', args); },
  getUpdateStatus(...args) { return request('ttc:request:updates:get-status', args); },
  checkForUpdates(...args) { return request('ttc:request:updates:check', args); },
});
contextBridge.exposeInMainWorld('ttcDesktop', desktopAPI);
