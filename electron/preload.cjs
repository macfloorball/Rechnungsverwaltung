'use strict';

const { contextBridge } = require('electron');

/**
 * @typedef {Readonly<{apiVersion: 1}>} DesktopAPI
 * Only static interface metadata is exposed. No IPC channels are registered.
 * Future requests: ttc:request:<feature>:<action>, events: ttc:event:<feature>:<event>.
 * Add only named methods here, never generic send/invoke or renderer channel names.
 * Each future main handler must validate sender frame and payload and return
 * a sanitized {ok, value} or {ok, error: {code, message}} response.
 */
/** @type {DesktopAPI} */
const desktopAPI = Object.freeze({ apiVersion: 1 });
contextBridge.exposeInMainWorld('ttcDesktop', desktopAPI);
