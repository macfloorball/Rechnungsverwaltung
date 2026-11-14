'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// No generic channels, URLs, paths, Electron events or installation commands.
async function request(channel, args, valid = args.length === 0) {
  if (!valid) return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Ungültige Argumente.' } };
  try { return await ipcRenderer.invoke(channel, ...args); }
  catch { return { ok: false, error: { code: 'IPC_UNAVAILABLE', message: 'Desktop-Verbindung nicht verfügbar.' } }; }
}
function versionArgument(args) {
  return args.length === 1 && typeof args[0] === 'string' && args[0].length <= 17
    && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(args[0])
    && args[0].trim() === args[0] && args[0].split('.').every((part) => Number(part) <= 65535);
}
const desktopAPI = Object.freeze({
  apiVersion: 1,
  getVersion(...args) { return request('ttc:request:app:get-version', args); },
  getUpdateStatus(...args) { return request('ttc:request:updates:get-status', args); },
  checkForUpdates(...args) { return request('ttc:request:updates:check', args); },
  acknowledgeUpdate(...args) { return request('ttc:request:updates:acknowledge', args, versionArgument(args)); },
  deferUpdate(...args) { return request('ttc:request:updates:defer', args, versionArgument(args)); },
  requestUpdate(...args) { return request('ttc:request:updates:request', args, versionArgument(args)); },
  installUpdate(...args) { return request('ttc:request:updates:install', args, versionArgument(args)); },
  setUpdateAccessToken(...args) {
    const valid = args.length === 1 && typeof args[0] === 'string' && args[0].length >= 20
      && args[0].length <= 512 && /^[\x21-\x7e]+$/.test(args[0]);
    return request('ttc:request:updates:set-access', args, valid);
  },
  clearUpdateAccessToken(...args) { return request('ttc:request:updates:clear-access', args); },
  onUpdateStatus(callback, ...args) {
    if (typeof callback !== 'function' || args.length) return () => {};
    const listener = (_event, status) => { try { Promise.resolve(callback(status)).catch(() => {}); } catch {} };
    ipcRenderer.on('ttc:event:updates:status', listener);
    let disposed = false;
    return () => { if (!disposed) { disposed = true; ipcRenderer.removeListener('ttc:event:updates:status', listener); } };
  },
});
contextBridge.exposeInMainWorld('ttcDesktop', desktopAPI);
