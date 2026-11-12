'use strict';

const GET_VERSION_CHANNEL = 'ttc:request:app:get-version';

function registerAppIPC({ ipcMain, app, getMainWindow, getFrontendURL }) {
  // Requests use invoke/handle. No event channels are needed at this stage.
  // Future events must use ttc:event:<feature>:<event>; never a generic dispatcher.
  ipcMain.handle(GET_VERSION_CHANNEL, (event, ...args) => {
    try {
      const window = getMainWindow();
      const sender = event.sender;
      const frame = event.senderFrame;
      if (!window || window.isDestroyed() || sender !== window.webContents
          || sender.isDestroyed() || !frame || frame !== sender.mainFrame) {
        return { ok: false, error: { code: 'FORBIDDEN', message: 'Anfrage nicht erlaubt.' } };
      }
      const actual = new URL(frame.url);
      const expected = new URL(getFrontendURL());
      if (actual.protocol !== 'http:' || actual.username || actual.password
          || actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.search) {
        return { ok: false, error: { code: 'FORBIDDEN', message: 'Anfrage nicht erlaubt.' } };
      }
      if (args.length !== 0) {
        return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Dieser Aufruf akzeptiert keine Argumente.' } };
      }
      return { ok: true, value: app.getVersion() };
    } catch {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Anfrage konnte nicht verarbeitet werden.' } };
    }
  });
  let disposed = false;
  return () => {
    if (!disposed) {
      disposed = true;
      ipcMain.removeHandler(GET_VERSION_CHANNEL);
    }
  };
}

module.exports = { registerAppIPC, GET_VERSION_CHANNEL };
