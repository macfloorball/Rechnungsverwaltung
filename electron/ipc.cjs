'use strict';

const GET_VERSION_CHANNEL = 'ttc:request:app:get-version';
const GET_UPDATE_STATUS_CHANNEL = 'ttc:request:updates:get-status';
const CHECK_UPDATES_CHANNEL = 'ttc:request:updates:check';
const error = (code, message) => ({ ok: false, error: { code, message } });

function registerAppIPC({ ipcMain, app, getMainWindow, getFrontendURL, getUpdateService }) {
  function allowed(event) {
    const window = getMainWindow(), sender = event.sender, frame = event.senderFrame;
    if (!window || window.isDestroyed() || sender !== window.webContents || sender.isDestroyed()
        || !frame || frame !== sender.mainFrame) return false;
    const actual = new URL(frame.url), expected = new URL(getFrontendURL());
    return actual.protocol === 'http:' && !actual.username && !actual.password
      && actual.origin === expected.origin && actual.pathname === expected.pathname && !actual.search;
  }
  const channels = [];
  function handle(channel, action) {
    channels.push(channel);
    ipcMain.handle(channel, (event, ...args) => {
      try {
        if (!allowed(event)) return error('FORBIDDEN', 'Anfrage nicht erlaubt.');
        if (args.length) return error('INVALID_ARGUMENT', 'Dieser Aufruf akzeptiert keine Argumente.');
        return action();
      } catch { return error('INTERNAL_ERROR', 'Anfrage konnte nicht verarbeitet werden.'); }
    });
  }
  handle(GET_VERSION_CHANNEL, () => ({ ok: true, value: app.getVersion() }));
  if (getUpdateService) {
    handle(GET_UPDATE_STATUS_CHANNEL, () => {
      const service = getUpdateService();
      return service ? { ok: true, value: service.getStatus() } : error('UPDATE_UNAVAILABLE', 'Update-Dienst nicht verfügbar.');
    });
    handle(CHECK_UPDATES_CHANNEL, () => {
      const service = getUpdateService();
      if (!service) return error('UPDATE_UNAVAILABLE', 'Update-Dienst nicht verfügbar.');
      return Promise.resolve(service.check()).then((value) => ({ ok: true, value }))
        .catch(() => error('UPDATE_UNAVAILABLE', 'Update-Prüfung derzeit nicht verfügbar.'));
    });
  }
  let disposed = false;
  return () => {
    if (!disposed) { disposed = true; channels.forEach((channel) => ipcMain.removeHandler(channel)); }
  };
}
module.exports = { registerAppIPC, GET_VERSION_CHANNEL, GET_UPDATE_STATUS_CHANNEL, CHECK_UPDATES_CHANNEL };
