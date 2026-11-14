'use strict';
const { UpdateError } = require('./update_manifest.cjs');
const { parseVersion } = require('./version.cjs');

// Session decisions and credential access belong to Main, not localStorage or
// renderer-controlled flags. Only Main receives verified file paths.
function createUpdateController({ service, credentials, downloader }) {
  const shown = new Set(), deferred = new Set(), listeners = new Set();
  let credentialChange = false;
  function getStatus() {
    const status = service.getStatus();
    const transfer = downloader?.getStatus();
    if (transfer) return Object.freeze({ ...status, ...transfer, availableVersion: transfer.version, promptVersion: null, canDownload: false });
    const candidate = status.state === 'available' ? service.getCandidate() : null;
    if (status.state === 'available' && !candidate) return Object.freeze({ ...status, state: 'error',
      availableVersion: null, releaseNotes: '', promptVersion: null, canDownload: false, download: null,
      error: Object.freeze({ code: 'UPDATE_CHANGED', message: 'Die Update-Freigabe ist nicht mehr aktuell. Bitte erneut prüfen.' }) });
    const version = candidate?.manifest.version;
    return Object.freeze({ ...status, promptVersion: version && !shown.has(version) ? version : null,
      deferred: Boolean(version && deferred.has(version)), canDownload: Boolean(version && downloader && !credentialChange), download: null });
  }
  function emit() {
    const status = getStatus();
    for (const listener of listeners) { try { Promise.resolve(listener(status)).catch(() => {}); } catch {} }
    return status;
  }
  function expected(version) {
    parseVersion(version);
    const candidate = service.getCandidate();
    if (service.getStatus().state !== 'available' || !candidate || candidate.manifest.version !== version) throw new UpdateError('UPDATE_CHANGED');
  }
  const unsubscribe = service.subscribe(emit);
  const detachDownload = downloader?.subscribe(emit);
  async function changeCredentials(action) {
    if (credentialChange) throw new UpdateError('UPDATE_BUSY');
    credentialChange = true;
    try { await downloader?.reset(); await action(); await service.invalidate(); return getStatus(); }
    finally { credentialChange = false; }
  }
  return {
    getStatus,
    async check() {
      if (credentialChange || downloader?.isBusy()) return getStatus();
      await downloader?.reset(); await service.check(); return getStatus();
    },
    acknowledge(version) { expected(version); shown.add(version); return emit(); },
    defer(version) { expected(version); shown.add(version); deferred.add(version); return emit(); },
    request(version) {
      if (credentialChange || downloader?.isBusy()) throw new UpdateError('DOWNLOAD_BUSY');
      expected(version);
      if (!downloader) throw new UpdateError('DOWNLOAD_UNAVAILABLE');
      shown.add(version); downloader.start(version); return getStatus();
    },
    async setAccess(token) {
      if (!service.getStatus().requiresAuthentication) throw new UpdateError('CREDENTIALS_NOT_REQUIRED');
      return changeCredentials(() => credentials.setToken(token));
    },
    async clearAccess() { return changeCredentials(() => credentials.clear()); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { unsubscribe(); detachDownload?.(); listeners.clear(); },
  };
}
module.exports = { createUpdateController };
