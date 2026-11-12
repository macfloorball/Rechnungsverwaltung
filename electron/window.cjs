'use strict';

const path = require('node:path');
const { BrowserWindow, screen, shell, dialog } = require('electron');
const { openInvoicePDF } = require('./browser-links.cjs');
const { APP_NAME, getWindowOptions } = require('./identity.cjs');

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'",
  "img-src 'self'", "font-src 'self'", "connect-src 'self'",
  "object-src 'none'", "frame-src 'none'", "frame-ancestors 'none'",
  "worker-src 'none'", "base-uri 'none'", "form-action 'self'",
].join('; ');

function createMainWindow(frontendURL, onError) {
  const mainWindow = new BrowserWindow({
    ...getWindowOptions(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
    },
  });

  const contents = mainWindow.webContents;
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle(APP_NAME);
  });
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow.isDestroyed()) mainWindow.show();
  });
  const session = contents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  contents.setWindowOpenHandler(({ url }) => {
    openInvoicePDF(url, frontendURL, shell, () => {
      console.error('Rechnungs-PDF konnte nicht im Standardbrowser geöffnet werden.');
      if (!mainWindow.isDestroyed()) {
        dialog.showMessageBox(mainWindow, {
          type: 'error', title: APP_NAME,
          message: 'Die Rechnung konnte nicht im Standardbrowser geöffnet werden.',
          detail: 'Bitte versuche es erneut oder verwende „PDF herunterladen“.',
        }).catch(() => {});
      }
    });
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  const allowedURL = frontendURL;
  for (const eventName of ['will-navigate', 'will-redirect']) {
    contents.on(eventName, (event, url) => {
      try {
        const target = new URL(url);
        const start = new URL(allowedURL);
        if (target.username || target.password || target.origin !== start.origin || target.pathname !== start.pathname || target.search) {
          event.preventDefault();
        }
      } catch { event.preventDefault(); }
    });
  }
  session.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try {
      const target = new URL(details.url);
      const start = new URL(frontendURL);
      allowed = target.protocol === 'http:' && !target.username && !target.password
        && target.origin === start.origin && details.resourceType !== 'subFrame';
      if (details.resourceType === 'mainFrame') {
        allowed = allowed && target.pathname === start.pathname && !target.search;
      }
    } catch {}
    callback({ cancel: !allowed });
  });
  session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    if (details.resourceType === 'mainFrame' && new URL(details.url).origin === new URL(frontendURL).origin) {
      // Preserve any stricter server policy; browsers enforce all supplied policies.
      const existing = Object.entries(responseHeaders)
        .filter(([name]) => name.toLowerCase() === 'content-security-policy')
        .flatMap(([, values]) => values);
      for (const name of Object.keys(responseHeaders)) {
        if (name.toLowerCase() === 'content-security-policy') delete responseHeaders[name];
      }
      responseHeaders['Content-Security-Policy'] = [...existing, CONTENT_SECURITY_POLICY];
    }
    callback({ responseHeaders });
  });
  contents.on('console-message', (event) => {
    if (event.level === 'error') console.error('[renderer]', event.message);
  });
  contents.on('preload-error', () => onError(new Error('Preload konnte nicht initialisiert werden')));
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') onError(new Error(`Renderer beendet: ${details.reason}`));
  });
  contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (!mainWindow.isDestroyed() && isMainFrame && code !== -3) onError(new Error(`Frontend-Ladefehler (${code})`));
  });
  const loaded = mainWindow.loadURL(frontendURL);
  loaded.catch(() => {
    if (!mainWindow.isDestroyed()) onError(new Error('Frontend konnte nicht geladen werden'));
  });
  return mainWindow;
}

module.exports = { createMainWindow };
