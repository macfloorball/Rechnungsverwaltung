'use strict';

const path = require('node:path');
const DEFAULT_FRONTEND_URL = 'http://127.0.0.1:8000/';
function getFrontendURL(value) {
  if (value === undefined) value = DEFAULT_FRONTEND_URL;
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('TTC_DESKTOP_URL muss eine lokale HTTP-Origin sein, z. B. http://127.0.0.1:8000/');
  }
  return url.href;
}

function getDesktopConfig(env, argv, packaged = false) {
  const production = packaged || argv.includes('--desktop-production');
  return {
    mode: production ? 'production' : 'development',
    url: getFrontendURL(env.TTC_DESKTOP_URL),
    buildDirectory: production ? path.join(__dirname, '..', 'dist', 'frontend') : null,
  };
}

module.exports = { getFrontendURL, getDesktopConfig };
