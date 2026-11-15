'use strict';
const { UpdateError } = require('./update_manifest.cjs');
const { parseVersion } = require('./version.cjs');

// Session decisions and credential access belong to Main, not localStorage or
// renderer-controlled flags. Only Main receives verified file paths.
function createUpdateController({ service, credentials, downloader, installer }) {
  const shown = new Set(), deferred = new Set(), listeners = new Set();
  let operation = null, checkPending = null, revision = 0;
  function getStatus() {
    const status = { ...service.getStatus(), revision, actionBusy: Boolean(operation), installationHint: installer?.getPolicy?.().message || null };
    const installation = installer?.getStatus();
    if (installation) return Object.freeze({ ...status, ...installation, availableVersion: installation.version, promptVersion: null, canDownload: false, canInstall: false });
    const transfer = downloader?.getStatus();
    if (transfer) return Object.freeze({ ...status, ...transfer, availableVersion: transfer.version, promptVersion: null, canDownload: false, canInstall: Boolean(!operation && transfer.state === 'downloaded' && installer?.canInstall(transfer.version)) });
    const candidate = status.state === 'available' ? service.getCandidate() : null;
    if (status.state === 'available' && !candidate) return Object.freeze({ ...status, state: 'error',
      availableVersion: null, releaseNotes: '', promptVersion: null, canDownload: false, download: null,
      error: Object.freeze({ code: 'UPDATE_CHANGED', message: 'Die Update-Freigabe ist nicht mehr aktuell. Bitte erneut prüfen.' }) });
    const version = candidate?.manifest.version;
    return Object.freeze({ ...status, promptVersion: version && !shown.has(version) ? version : null,
      deferred: Boolean(version && deferred.has(version)), canDownload: Boolean(version && downloader && !operation), download: null });
  }
  function emit() {
    revision++;
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
  const detachInstall = installer?.subscribe(emit);
  function exclusive(kind, action) {
    if (operation || installer?.isBusy()) return Promise.reject(new UpdateError('UPDATE_BUSY'));
    operation = kind;
    emit();
    return Promise.resolve().then(action).then(() => {
      operation = null; return emit();
    }, (error) => { operation = null; emit(); throw error; });
  }
  function changeCredentials(action) {
    return exclusive('credentials', async () => {
      installer?.reset(); await downloader?.reset(); await action(); await service.invalidate();
    });
  }
  return {
    getStatus,
    check() {
      if (checkPending) return checkPending;
      if (operation || downloader?.isBusy() || installer?.isBusy()) return Promise.resolve(getStatus());
      checkPending = exclusive('check', async () => { installer?.reset(); await downloader?.reset(); await service.check(); })
        .finally(() => { checkPending = null; });
      return checkPending;
    },
    acknowledge(version) { expected(version); shown.add(version); return emit(); },
    defer(version) { expected(version); shown.add(version); deferred.add(version); return emit(); },
    request(version) {
      if (operation || downloader?.isBusy() || installer?.isBusy()) throw new UpdateError('DOWNLOAD_BUSY');
      expected(version);
      if (!downloader) throw new UpdateError('DOWNLOAD_UNAVAILABLE');
      shown.add(version); downloader.start(version); return getStatus();
    },
    install(version) {
      parseVersion(version);
      if (downloader?.isBusy() || !installer) return Promise.reject(new UpdateError('INSTALL_UNAVAILABLE'));
      return exclusive('install', () => installer.install(version));
    },
    cancel(version) {
      parseVersion(version);
      if (!downloader) return Promise.reject(new UpdateError('DOWNLOAD_UNAVAILABLE'));
      return exclusive('cancel', () => downloader.cancel(version));
    },
    async setAccess(token) {
      if (!service.getStatus().requiresAuthentication) throw new UpdateError('CREDENTIALS_NOT_REQUIRED');
      return changeCredentials(() => credentials.setToken(token));
    },
    async clearAccess() { return changeCredentials(() => credentials.clear()); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { unsubscribe(); detachDownload?.(); detachInstall?.(); listeners.clear(); },
  };
}
module.exports = { createUpdateController };
