'use strict';

const path = require('node:path');
const DEFAULT_FRONTEND_URL = 'http://127.0.0.1:8000/';
function getFrontendURL(value, variable = 'TTC_DESKTOP_URL') {
  if (value === undefined) value = DEFAULT_FRONTEND_URL;
  const message = `${variable} muss eine lokale HTTP-Origin sein, z. B. http://127.0.0.1:8000/`;
  let url;
  try { url = new URL(value); } catch { throw new Error(message); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(message);
  }
  return url.href;
}

function getDesktopConfig(env, argv, packaged = false) {
  const production = packaged || argv.includes('--desktop-production');
  return {
    mode: production ? 'production' : 'development',
    url: getFrontendURL(production ? env.TTC_DESKTOP_PRODUCTION_URL : env.TTC_DESKTOP_URL,
      production ? 'TTC_DESKTOP_PRODUCTION_URL' : 'TTC_DESKTOP_URL'),
    buildDirectory: production ? path.join(__dirname, '..', 'dist', 'frontend') : null,
  };
}

module.exports = { getFrontendURL, getDesktopConfig };
