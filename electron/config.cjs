'use strict';

// No implicit server address: the web server remains independently managed.
function getFrontendURL(value) {
  if (value === undefined) return null;
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('TTC_DESKTOP_URL muss eine lokale HTTP-Origin sein, z. B. http://127.0.0.1:8000/');
  }
  return url.href;
}

module.exports = { getFrontendURL };
