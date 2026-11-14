'use strict';

const { parseVersion } = require('./version.cjs');
const { validToken } = require('./update_credentials.cjs');

const GET_VERSION_CHANNEL = 'ttc:request:app:get-version';
const GET_UPDATE_STATUS_CHANNEL = 'ttc:request:updates:get-status';
const CHECK_UPDATES_CHANNEL = 'ttc:request:updates:check';
const ACK_UPDATE_CHANNEL = 'ttc:request:updates:acknowledge';
const DEFER_UPDATE_CHANNEL = 'ttc:request:updates:defer';
const REQUEST_UPDATE_CHANNEL = 'ttc:request:updates:request';
const SET_UPDATE_ACCESS_CHANNEL = 'ttc:request:updates:set-access';
const CLEAR_UPDATE_ACCESS_CHANNEL = 'ttc:request:updates:clear-access';
const UPDATE_STATUS_CHANNEL = 'ttc:event:updates:status';
const ACTION_ERRORS = Object.freeze({
  UPDATE_CHANGED: 'Die Update-Freigabe hat sich geändert. Bitte erneut prüfen.',
  UPDATE_BUSY: 'Der GitHub-Zugang wird bereits bearbeitet. Bitte kurz warten.',
  CREDENTIALS_NOT_REQUIRED: 'Für diese App-Version wird kein neuer GitHub-Zugang benötigt.',
  CREDENTIALS_UNAVAILABLE: 'Der geschützte Betriebssystem-Speicher ist nicht verfügbar. Der Zugang wurde nicht bestätigt.',
  INVALID_TOKEN: 'Bitte einen gültigen persönlichen GitHub-Zugang eingeben.',
  DOWNLOAD_UNAVAILABLE: 'Automatisches Aktualisieren ist derzeit nicht verfügbar. Bitte später erneut versuchen oder einen geprüften Installer verwenden.',
});
const error = (code, message) => ({ ok: false, error: { code, message } });

function registerAppIPC({ ipcMain, app, getMainWindow, getFrontendURL, getUpdateService, getUpdateController }) {
  function allowed(event) {
    const window = getMainWindow(), sender = event.sender, frame = event.senderFrame;
    if (!window || window.isDestroyed() || sender !== window.webContents || sender.isDestroyed()
        || !frame || frame !== sender.mainFrame) return false;
    const actual = new URL(frame.url), expected = new URL(getFrontendURL());
    return actual.protocol === 'http:' && !actual.username && !actual.password
      && actual.origin === expected.origin && actual.pathname === expected.pathname && !actual.search;
  }
  const channels = [];
  function handle(channel, action, validate = (args) => args.length === 0) {
    channels.push(channel);
    ipcMain.handle(channel, (event, ...args) => {
      try {
        if (!allowed(event)) return error('FORBIDDEN', 'Anfrage nicht erlaubt.');
        if (!validate(args)) return error('INVALID_ARGUMENT', 'Ungültige Argumente.');
        return action(...args);
      } catch { return error('INTERNAL_ERROR', 'Anfrage konnte nicht verarbeitet werden.'); }
    });
  }
  handle(GET_VERSION_CHANNEL, () => ({ ok: true, value: app.getVersion() }));
  if (getUpdateService) {
    handle(GET_UPDATE_STATUS_CHANNEL, () => {
      const service = getUpdateController?.() || getUpdateService();
      return service ? { ok: true, value: service.getStatus() } : error('UPDATE_UNAVAILABLE', 'Update-Dienst nicht verfügbar.');
    });
    handle(CHECK_UPDATES_CHANNEL, () => {
      const service = getUpdateController?.() || getUpdateService();
      if (!service) return error('UPDATE_UNAVAILABLE', 'Update-Dienst nicht verfügbar.');
      return Promise.resolve(service.check()).then((value) => ({ ok: true, value }))
        .catch(() => error('UPDATE_UNAVAILABLE', 'Update-Prüfung derzeit nicht verfügbar.'));
    });
  }
  if (getUpdateController) {
    const versionArgument = (args) => { try { if (args.length !== 1) return false; parseVersion(args[0]); return true; } catch { return false; } };
    const action = (method) => async (...args) => {
      try {
        const controller = getUpdateController();
        if (!controller) return error('UPDATE_UNAVAILABLE', 'Update-Dienst nicht verfügbar.');
        return { ok: true, value: await controller[method](...args) };
      } catch (failure) {
        const code = Object.hasOwn(ACTION_ERRORS, failure?.code) ? failure.code : 'UPDATE_UNAVAILABLE';
        return error(code, ACTION_ERRORS[code] || 'Die Update-Aktion ist gerade nicht verfügbar.');
      }
    };
    handle(ACK_UPDATE_CHANNEL, action('acknowledge'), versionArgument);
    handle(DEFER_UPDATE_CHANNEL, action('defer'), versionArgument);
    handle(REQUEST_UPDATE_CHANNEL, action('request'), versionArgument);
    handle(SET_UPDATE_ACCESS_CHANNEL, action('setAccess'), (args) => args.length === 1 && validToken(args[0]));
    handle(CLEAR_UPDATE_ACCESS_CHANNEL, action('clearAccess'));
  }
  let detachUpdates;
  let disposed = false;
  const dispose = () => {
    if (!disposed) { disposed = true; detachUpdates?.(); channels.forEach((channel) => ipcMain.removeHandler(channel)); }
  };
  dispose.bindUpdates = (controller) => {
    if (disposed || !controller) return;
    detachUpdates?.();
    detachUpdates = controller.subscribe((status) => {
      try {
        const window = getMainWindow(), sender = window?.webContents;
        if (!window || window.isDestroyed() || !sender || sender.isDestroyed()) return;
        if (!allowed({ sender, senderFrame: sender.mainFrame })) return;
        sender.send(UPDATE_STATUS_CHANNEL, status);
      } catch { /* A closed or navigated window must not fail Main. */ }
    });
  };
  return dispose;
}
module.exports = { registerAppIPC, GET_VERSION_CHANNEL, GET_UPDATE_STATUS_CHANNEL, CHECK_UPDATES_CHANNEL, ACK_UPDATE_CHANNEL, DEFER_UPDATE_CHANNEL, REQUEST_UPDATE_CHANNEL, SET_UPDATE_ACCESS_CHANNEL, CLEAR_UPDATE_ACCESS_CHANNEL, UPDATE_STATUS_CHANNEL };
