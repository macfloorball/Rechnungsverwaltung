'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * @typedef {{ok: true, value: string} | {ok: false, error: {code: string, message: string}}} VersionResult
 * @typedef {Readonly<{apiVersion: 1, getVersion: () => Promise<VersionResult>}>} DesktopAPI
 * Requests: ttc:request:<feature>:<action>. No events are exposed yet.
 * Future events: ttc:event:<feature>:<event>, with named subscribe/unsubscribe methods.
 * Never expose generic send/invoke/on, channel arguments, Electron events or Node modules.
 */
/** @type {DesktopAPI} */
const desktopAPI = Object.freeze({
  apiVersion: 1,
  async getVersion(...args) {
    if (args.length !== 0) {
      return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Dieser Aufruf akzeptiert keine Argumente.' } };
    }
    try {
      // The fixed channel is deliberately local to the sandbox-compatible preload.
      return await ipcRenderer.invoke('ttc:request:app:get-version');
    } catch {
      return { ok: false, error: { code: 'IPC_UNAVAILABLE', message: 'Desktop-Verbindung nicht verfügbar.' } };
    }
  },
});
contextBridge.exposeInMainWorld('ttcDesktop', desktopAPI);
