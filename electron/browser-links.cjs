'use strict';

function invoicePDFURL(value, frontendURL) {
  try {
    const url = new URL(value);
    const frontend = new URL(frontendURL);
    if (url.protocol !== 'http:' || url.origin !== frontend.origin
        || url.username || url.password || url.hash
        || (url.search && !/^\?profile_id=[1-9]\d*$/.test(url.search))
        || !/^\/api\/invoices\/[1-9]\d*\/pdf$/.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

function openInvoicePDF(value, frontendURL, shell, onError) {
  const url = invoicePDFURL(value, frontendURL);
  if (!url) return false;
  // Only the validated local GET endpoint is handed off. No paths, protocols,
  // general external URLs or process APIs are exposed to the renderer.
  Promise.resolve().then(() => shell.openExternal(url)).catch(() => onError());
  return true;
}

module.exports = { invoicePDFURL, openInvoicePDF };
