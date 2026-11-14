'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { UpdateError, validateManifest } = require('./update_manifest.cjs');
const { compareVersions } = require('./version.cjs');
const { validToken } = require('./update_credentials.cjs');
const { createUpdateTransport } = require('./update_transport.cjs');

const MESSAGES = Object.freeze({
  DOWNLOAD_SIZE: 'Das Update wurde unvollständig oder mit unerwarteter Größe übertragen. Bitte erneut prüfen.',
  DOWNLOAD_HASH: 'Das heruntergeladene Paket stimmt nicht mit der signierten Freigabe überein. Es wurde verworfen.',
  DOWNLOAD_SPACE: 'Für das Update ist nicht genügend freier Speicher vorhanden.',
  DOWNLOAD_STORAGE: 'Das geschützte Downloadverzeichnis ist nicht verfügbar. Zugriffsrechte prüfen.',
  DOWNLOAD_TIMEOUT: 'Der Download hat zu lange keine Daten geliefert oder das Zeitlimit überschritten.',
  DOWNLOAD_CANCELLED: 'Der Download wurde abgebrochen.',
  INVALID_SIGNATURE: 'Die Update-Freigabe ist nicht vertrauenswürdig signiert.',
  INVALID_METADATA: 'Die Update-Freigabe ist ungültig oder unvollständig.',
  EXPIRED_METADATA: 'Die Update-Freigabe ist abgelaufen. Bitte erneut prüfen.',
  UPDATE_CHANGED: 'Die Update-Freigabe hat sich geändert. Bitte erneut prüfen.',
  AUTH_REQUIRED: 'Für private Updates ist ein persönlicher GitHub-Zugang mit Leserecht erforderlich.',
  INVALID_TOKEN: 'Der persönliche GitHub-Zugang ist ungültig.',
  CREDENTIALS_UNAVAILABLE: 'Der geschützte GitHub-Zugang ist nicht verfügbar.',
  SOURCE_CHANGED: 'Die konfigurierte Update-Quelle hat sich geändert.',
  UNTRUSTED_SOURCE: 'Der Download wurde auf ein nicht freigegebenes Ziel umgeleitet.',
  RATE_LIMIT: 'GitHub begrenzt die Anfragen. Bitte später erneut versuchen.',
  NETWORK: 'Der Download ist fehlgeschlagen. Die Anwendung bleibt lokal nutzbar.',
});

function createUpdateDownloader({ config, profile, getCandidate, getToken = async () => null,
  transportFactory = createUpdateTransport, now = Date.now, timeoutMs = 10 * 60000, idleTimeoutMs = 30000,
  statfs = fs.statfs } = {}) {
  const root = path.resolve(profile), cache = path.join(root, 'updates', 'downloads');
  let status = null, pending = null, active = null, retained = null, disposed = false;
  const listeners = new Set();
  function emit(next) {
    status = next && Object.freeze(next);
    for (const listener of listeners) { try { Promise.resolve(listener(status)).catch(() => {}); } catch {} }
  }
  async function directory(file, create = false, privateMode = true) {
    if (create) { try { await fs.mkdir(file, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
    const stat = await fs.lstat(file);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32'
        && (stat.uid !== process.getuid() || (stat.mode & (privateMode ? 0o077 : 0o022))))) throw new UpdateError('DOWNLOAD_STORAGE');
  }
  async function prepare() {
    // Reject redirected ancestors, including junctions visible as symbolic links.
    for (let entry = root; ; entry = path.dirname(entry)) {
      if ((await fs.lstat(entry)).isSymbolicLink()) throw new UpdateError('DOWNLOAD_STORAGE');
      if (entry === path.dirname(entry)) break;
    }
    await directory(root, false, false);
    await directory(path.join(root, 'updates'), true);
    await directory(cache, true);
    // Only our private, random session slots are removed. No resumable partials.
    for (const name of await fs.readdir(cache)) {
      if (/^download-[A-Za-z0-9]{6}$/.test(name)) await fs.rm(path.join(cache, name), { recursive: true, force: true });
    }
  }
  function validated(candidate, version, release = candidate?.release) {
    if (!config.enabled || !config.publicKey || !candidate) throw new UpdateError('UPDATE_CHANGED');
    let manifest;
    try { manifest = validateManifest(candidate.manifestBytes, candidate.signature, config, release, now()); }
    catch (error) { throw error instanceof UpdateError ? error : new UpdateError('INVALID_METADATA'); }
    if (manifest.version !== version || compareVersions(version, config.currentVersion) <= 0) throw new UpdateError('UPDATE_CHANGED');
    const artifact = manifest.artifacts.find((file) => file.platform === config.platform && file.arch === config.arch);
    if (!artifact) throw new UpdateError('INVALID_METADATA');
    return { manifest, artifact };
  }
  async function discard() {
    if (retained) { const slot = retained.slot; retained = null; await fs.rm(slot, { recursive: true, force: true }); }
  }
  function start(version) {
    if (disposed || !config.enabled) throw new UpdateError('DOWNLOAD_UNAVAILABLE');
    if (pending) throw new UpdateError('DOWNLOAD_BUSY');
    const candidate = getCandidate();
    const { artifact } = validated(candidate, version);
    const abort = new AbortController(); active = abort;
    let idle;
    const total = setTimeout(() => abort.abort(new UpdateError('DOWNLOAD_TIMEOUT')), timeoutMs);
    function touch() { clearTimeout(idle); idle = setTimeout(() => abort.abort(new UpdateError('DOWNLOAD_TIMEOUT')), idleTimeoutMs); }
    touch();
    const aborted = new Promise((_resolve, reject) => abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true }));
    aborted.catch(() => {});
    const guarded = (work) => Promise.race([work, aborted]);
    const check = () => abort.signal.throwIfAborted();
    let received = 0, reported = 0, lastProgress = -Infinity;
    const progress = (force = false, phase = 'receiving') => {
      if (force || (received > 0 && reported === 0) || now() - lastProgress >= 100) {
        lastProgress = now(); reported = received;
        emit({ state: 'downloading', version, error: null,
          download: Object.freeze({ receivedBytes: received, totalBytes: artifact.size, phase }) });
      }
    };
    progress(true);
    pending = Promise.resolve().then(async () => {
      let slot, handle;
      try {
        await discard(); check();
        await prepare(); check();
        const space = await statfs(cache, { bigint: true });
        if (space.bavail * space.bsize < BigInt(artifact.size + 16 * 1024 * 1024)) throw new UpdateError('DOWNLOAD_SPACE');
        slot = await fs.mkdtemp(path.join(cache, 'download-'));
        await fs.chmod(slot, 0o700); await directory(slot); check();
        const token = config.visibility === 'private' ? await guarded(Promise.resolve().then(getToken)) : null;
        check();
        if (config.visibility === 'private' && !token) throw new UpdateError('AUTH_REQUIRED');
        if (token && !validToken(token)) throw new UpdateError('INVALID_TOKEN');
        const transport = transportFactory({ config, token, signal: abort.signal });
        const release = await guarded(transport.release(candidate.release.id));
        check(); validated(candidate, version, release); touch();
        const partial = path.join(slot, 'package.part');
        handle = await fs.open(partial, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW || 0), 0o600);
        await guarded(transport.streamAsset(artifact.assetId, artifact.size, async (chunk) => {
          check();
          if (!Buffer.isBuffer(chunk) || received + chunk.length > artifact.size) throw new UpdateError('DOWNLOAD_SIZE');
          let offset = 0;
          while (offset < chunk.length) {
            check();
            const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, received + offset);
            if (!bytesWritten) throw new UpdateError('DOWNLOAD_STORAGE');
            offset += bytesWritten;
          }
          received += chunk.length; touch(); progress();
        }));
        check();
        if (received !== artifact.size) throw new UpdateError('DOWNLOAD_SIZE');
        progress(true, 'verifying');
        await handle.sync();
        const hash = createHash('sha256'), block = Buffer.alloc(256 * 1024);
        let position = 0;
        while (position < artifact.size) {
          check();
          const { bytesRead } = await handle.read(block, 0, Math.min(block.length, artifact.size - position), position);
          if (!bytesRead) throw new UpdateError('DOWNLOAD_SIZE');
          hash.update(block.subarray(0, bytesRead)); position += bytesRead; touch();
        }
        const stat = await handle.stat(), onDisk = await fs.lstat(partial);
        if (!onDisk.isFile() || onDisk.isSymbolicLink() || stat.ino !== onDisk.ino || stat.dev !== onDisk.dev
            || stat.nlink !== 1 || stat.size !== artifact.size || onDisk.size !== artifact.size) throw new UpdateError('DOWNLOAD_STORAGE');
        if (hash.digest('hex') !== artifact.sha256) throw new UpdateError('DOWNLOAD_HASH');
        validated(candidate, version); check();
        // A new check may revoke or replace the offer while the download runs.
        const latest = getCandidate();
        if (!latest || !latest.manifestBytes.equals(candidate.manifestBytes) || !latest.signature.equals(candidate.signature)) throw new UpdateError('UPDATE_CHANGED');
        await handle.close(); handle = null;
        const file = path.join(slot, artifact.fileName);
        await fs.rename(partial, file); check();
        retained = { slot, file, version, artifact, candidate };
        slot = null;
        emit({ state: 'downloaded', version, download: Object.freeze({ receivedBytes: received, totalBytes: artifact.size, phase: 'verified' }), error: null });
      } catch (error) {
        let code = abort.signal.aborted ? abort.signal.reason?.code : error?.code;
        if (code === 'ENOSPC' || code === 'EDQUOT') code = 'DOWNLOAD_SPACE';
        else if (['EACCES', 'EPERM', 'ELOOP', 'ENOTDIR', 'ENOENT', 'EIO', 'EROFS'].includes(code)) code = 'DOWNLOAD_STORAGE';
        if (!Object.hasOwn(MESSAGES, code)) code = 'NETWORK';
        // No paths, tokens, remote exception messages or URLs cross IPC.
        status = Object.freeze({ state: 'error', version, download: null, error: Object.freeze({ code, message: MESSAGES[code] }) });
      } finally {
        clearTimeout(total); clearTimeout(idle);
        await handle?.close().catch(() => {});
        if (slot) {
          try { await fs.rm(slot, { recursive: true, force: true }); }
          catch { status = Object.freeze({ state: 'error', version, download: null, error: Object.freeze({ code: 'DOWNLOAD_STORAGE', message: MESSAGES.DOWNLOAD_STORAGE }) }); }
        }
        pending = null; active = null;
        if (status?.state === 'error') emit(status);
      }
    });
    return status;
  }
  return {
    start, getStatus: () => status,
    isBusy: () => Boolean(pending),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async reset() { active?.abort(new UpdateError('DOWNLOAD_CANCELLED')); if (pending) await pending; await discard(); emit(null); },
    async stop() { disposed = true; await this.reset(); listeners.clear(); },
    // Internal test/installer handoff. Never returned to Renderer; future
    // installation must revalidate file ownership, size, hash and platform trust.
    getVerified: () => retained && Object.freeze({ ...retained }),
  };
}
module.exports = { createUpdateDownloader };
