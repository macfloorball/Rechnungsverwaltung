'use strict';
const { configuration, UpdateError, newestRelease, validateManifest } = require('./update_manifest.cjs');
const { compareVersions, parseVersion } = require('./version.cjs');
const { createUpdateTransport } = require('./update_transport.cjs');
const { createUpdateCredentials, validToken } = require('./update_credentials.cjs');
const { createUpdateDownloader } = require('./update_download.cjs');
const { createUpdateController } = require('./update_controller.cjs');

const MESSAGES = Object.freeze({
  AUTH_REQUIRED: 'Für private Updates ist ein eigener GitHub-Zugang mit Leserecht erforderlich.',
  CREDENTIALS_UNAVAILABLE: 'Der geschützte GitHub-Zugang ist nicht verfügbar. Den Betriebssystem-Schlüsselspeicher prüfen.',
  INVALID_TOKEN: 'Der GitHub-Zugang ist ungültig.',
  TIMEOUT: 'Die Update-Prüfung hat zu lange gedauert. Bitte später erneut versuchen.',
  NETWORK: 'Die Update-Quelle ist derzeit nicht erreichbar. Die Anwendung bleibt lokal nutzbar.',
  RATE_LIMIT: 'GitHub begrenzt derzeit die Anfragen. Bitte später erneut prüfen.',
  INVALID_SIGNATURE: 'Die Update-Metadaten sind nicht vertrauenswürdig signiert.',
  INVALID_METADATA: 'Die Update-Metadaten sind ungültig oder unvollständig.',
  EXPIRED_METADATA: 'Die Update-Freigabe ist abgelaufen oder die Systemzeit stimmt nicht.',
  SOURCE_CHANGED: 'Die konfigurierte Update-Quelle hat sich geändert. Keine Aktualisierung freigegeben.',
  UNTRUSTED_SOURCE: 'Die Update-Quelle hat auf ein nicht freigegebenes Ziel umgeleitet.',
  TOO_MANY_RELEASES: 'Die Release-Liste konnte nicht vollständig geprüft werden.',
});

function createUpdateService({ config, getToken = async () => null, getHighestVersion = () => config.currentVersion,
  transportFactory = createUpdateTransport, now = Date.now, random = Math.random,
  timers = { setTimeout, clearTimeout }, timeoutMs = 15000, minimumIntervalMs = 30000 } = {}) {
  let state = Object.freeze({ state: config.enabled ? 'idle' : 'disabled', currentVersion: config.currentVersion,
    requiresAuthentication: Boolean(config.enabled && config.visibility === 'private'), repository: config.enabled ? config.repository : null,
    availableVersion: null, releaseNotes: '', checkedAt: null, reason: config.reason || null, error: null });
  let pending = null, active = null, schedule = null, started = false, stopped = false, candidate = null, lastStarted = null;
  const listeners = new Set();
  function update(patch) {
    state = Object.freeze({ ...state, ...patch });
    for (const listener of listeners) { try { Promise.resolve(listener(state)).catch(() => {}); } catch {} }
    return state;
  }
  function check() {
    if (stopped || !config.enabled) return Promise.resolve(state);
    if (pending) return pending;
    const instant = now();
    if (lastStarted !== null && instant >= lastStarted && instant - lastStarted < minimumIntervalMs) return Promise.resolve(state);
    lastStarted = instant;
    const controller = new AbortController();
    active = controller;
    const timeout = timers.setTimeout(() => controller.abort(new UpdateError('TIMEOUT')), timeoutMs);
    const aborted = new Promise((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }));
    pending = Promise.race([Promise.resolve().then(async () => {
      if (stopped) throw new UpdateError('STOPPED');
      candidate = null;
      update({ state: 'checking', availableVersion: null, releaseNotes: '', error: null });
      const token = config.visibility === 'private' ? await getToken() : null;
      if (controller.signal.aborted) throw controller.signal.reason;
      if (config.visibility === 'private' && !token) throw new UpdateError('AUTH_REQUIRED');
      if (token && !validToken(token)) throw new UpdateError('INVALID_TOKEN');
      const transport = transportFactory({ config, token, signal: controller.signal });
      const highest = await getHighestVersion();
      parseVersion(highest);
      const baseline = compareVersions(highest, config.currentVersion) > 0 ? highest : config.currentVersion;
      const release = newestRelease(await transport.releases(), baseline);
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!release) return { state: 'up_to_date' };
      if (!Array.isArray(release.assets)) throw new UpdateError('INVALID_METADATA');
      const manifestAsset = release.assets.filter((asset) => asset.name === 'desktop-update.json');
      const signatureAsset = release.assets.filter((asset) => asset.name === 'desktop-update.json.sig');
      if (manifestAsset.length !== 1 || signatureAsset.length !== 1 || manifestAsset[0].state !== 'uploaded'
          || signatureAsset[0].state !== 'uploaded' || !Number.isInteger(manifestAsset[0].size) || manifestAsset[0].size < 1
          || manifestAsset[0].size > 65536 || signatureAsset[0].size !== 64) throw new UpdateError('INVALID_METADATA');
      const bytes = await transport.asset(manifestAsset[0].id, 65536);
      const signature = await transport.asset(signatureAsset[0].id, 64);
      if (bytes.length !== manifestAsset[0].size || signature.length !== 64) throw new UpdateError('INVALID_METADATA');
      let manifest;
      try { manifest = validateManifest(bytes, signature, config, release, now()); }
      catch (error) { throw error instanceof UpdateError ? error : new UpdateError('INVALID_METADATA'); }
      if (controller.signal.aborted) throw controller.signal.reason;
      candidate = Object.freeze({ manifest, artifact: manifest.artifacts.find((file) => file.platform === config.platform),
        manifestBytes: Buffer.from(bytes), signature: Buffer.from(signature), release: structuredClone(release) });
      return { state: 'available', availableVersion: manifest.version, releaseNotes: manifest.releaseNotes };
    }), aborted]).then((result) => stopped ? state : update({ ...result, checkedAt: new Date(now()).toISOString() }))
      .catch((error) => {
        candidate = null;
        if (stopped || error?.code === 'RESET') return state;
        const code = error instanceof UpdateError && MESSAGES[error.code] ? error.code : 'NETWORK';
        return update({ state: code === 'AUTH_REQUIRED' ? 'authentication_required' : 'error', availableVersion: null,
          releaseNotes: '', checkedAt: new Date(now()).toISOString(), error: Object.freeze({ code, message: MESSAGES[code] }) });
      }).finally(() => { timers.clearTimeout(timeout); active = null; pending = null; });
    return pending;
  }
  function scheduleNext(delay) {
    schedule = timers.setTimeout(() => {
      schedule = null;
      if (stopped) return;
      void check();
      scheduleNext(6 * 3600000 * (0.9 + Math.max(0, Math.min(1, random())) * 0.2));
    }, delay);
    schedule?.unref?.();
  }
  return {
    check,
    async invalidate() {
      active?.abort(new UpdateError('RESET'));
      if (pending) await pending;
      candidate = null; lastStarted = null;
      if (!stopped) update({ state: config.enabled ? 'idle' : 'disabled', availableVersion: null, releaseNotes: '', error: null, checkedAt: null });
    },
    getStatus: () => state,
    getCandidate() {
      if (!candidate || Date.parse(candidate.manifest.expiresAt) <= now()) return null;
      return Object.freeze({ ...candidate, release: structuredClone(candidate.release), manifestBytes: Buffer.from(candidate.manifestBytes), signature: Buffer.from(candidate.signature) });
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start() { if (!started && !stopped && config.enabled) { started = true; scheduleNext(3000); } },
    stop() {
      if (stopped) return;
      stopped = true; candidate = null;
      if (schedule !== null) timers.clearTimeout(schedule);
      active?.abort(new UpdateError('STOPPED'));
      listeners.clear();
      state = Object.freeze({ ...state, state: 'disabled', reason: 'stopped', availableVersion: null, releaseNotes: '', error: null });
    },
  };
}

function createDesktopUpdates({ app, safeStorage, metadata = require('../package.json'), platform = process.platform, arch = process.arch }) {
  const currentVersion = app.getVersion();
  let config;
  try { config = { currentVersion, ...configuration(metadata, { packaged: app.isPackaged, currentVersion, platform, arch }) }; }
  catch { config = { enabled: false, currentVersion, reason: 'invalid_configuration' }; }
  const credentials = createUpdateCredentials({ safeStorage, profile: app.getPath('userData'), platform });
  const service = createUpdateService({ config, getToken: credentials.getToken });
  const downloader = createUpdateDownloader({ config, profile: app.getPath('userData'), getCandidate: service.getCandidate, getToken: credentials.getToken });
  return { credentials, service, downloader, controller: createUpdateController({ service, credentials, downloader }) };
}
module.exports = { createUpdateService, createDesktopUpdates };
