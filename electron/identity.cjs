'use strict';
const path = require('node:path');
const fs = require('node:fs');
const metadata = require('../package.json');
const APP_NAME = metadata.productName;
const WINDOW_SIZE = Object.freeze({ width: 1280, height: 800, minWidth: 1000, minHeight: 650 });

function configureIdentity(app) {
  // productName affects Electron's default cache/profile path. Keep the old
  // technical-name profile; preserve paths explicitly overridden by callers.
  for (const key of ['userData', 'sessionData']) {
    const current = app.getPath(key);
    if (path.basename(current) === APP_NAME) {
      const preserved = path.join(path.dirname(current), metadata.name);
      fs.mkdirSync(preserved, { recursive: true });
      app.setPath(key, preserved);
    }
  }
  app.setName(APP_NAME);
}

function getWindowOptions(workArea, platform = process.platform) {
  // Electron screen coordinates are DIP: no manual multiplication by scaleFactor.
  const width = Math.min(WINDOW_SIZE.width, workArea.width);
  const height = Math.min(WINDOW_SIZE.height, workArea.height);
  return {
    title: APP_NAME,
    icon: path.join(__dirname, 'assets', platform === 'win32' ? 'app-icon.ico' : 'app-icon.png'),
    width, height,
    minWidth: Math.min(WINDOW_SIZE.minWidth, width),
    minHeight: Math.min(WINDOW_SIZE.minHeight, height),
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + Math.floor((workArea.height - height) / 2),
    resizable: true, maximizable: true, fullscreen: false,
    backgroundColor: '#f5f7fa',
  };
}
module.exports = { APP_NAME, WINDOW_SIZE, configureIdentity, getWindowOptions };
