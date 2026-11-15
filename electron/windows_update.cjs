'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { validateManifest, UpdateError } = require('./update_manifest.cjs');
const { compareVersions } = require('./version.cjs');
const { REQUIRED_FILES } = require('./installation.cjs');
const helperSource = require('./windows_update_helper.cjs');
const GUID = 'da941357-9ae2-5f27-a221-a8db9727ec79';
const FAILURE = 'Die Windows-Aktualisierung konnte nicht vorbereitet werden. Persönliche Daten bleiben erhalten. Bitte erneut prüfen oder einen vollständigen geprüften Installer verwenden.';

async function checkWindowsUpdateLock(profile) {
  const file = path.join(profile, 'updates', 'windows-install.lock');
  try {
    if (!(await fs.lstat(file)).isFile()) throw Error('invalid lock');
    const handle = await fs.open(file, 'r+'); await handle.close();
  } catch (error) {
    if (error.code !== 'ENOENT') throw Error('Ein Windows-Update ist aktiv oder sein Sperrverzeichnis ist nicht zugänglich. Bitte die Installation abschließen und die App danach erneut starten.');
  }
}
function startWindowsHelper(context, { spawnImpl = spawn, systemRoot = process.env.SystemRoot } = {}) {
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw new UpdateError('INSTALL_UNAVAILABLE');
  const executable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = Buffer.from(helperSource, 'utf16le').toString('base64');
  if (command.length > 29000) throw new UpdateError('INSTALL_UNAVAILABLE');
  const child = spawnImpl(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', command], {
    detached: true, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'],
  });
  let buffer = '', phase = 'ready', settle, closed = false;
  const wait = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new UpdateError('INSTALL_UNAVAILABLE')), 180000);
    settle = (error) => { clearTimeout(timer); error ? reject(new UpdateError('INSTALL_UNAVAILABLE')) : resolve(); };
  });
  const ready = wait();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer = (buffer + chunk).slice(-4096);
    const marker = phase === 'ready' ? 'TTC_UPDATE_READY' : 'TTC_UPDATE_COMMITTED';
    if (buffer.includes('TTC_UPDATE_REJECTED')) settle?.(true);
    else if (buffer.includes(marker)) { buffer = ''; settle?.(false); }
  });
  child.once('error', () => { closed = true; settle?.(true); });
  child.once('exit', () => { closed = true; settle?.(true); });
  child.stdin.on('error', () => settle?.(true));
  child.stdin.write(JSON.stringify(context) + '\n');
  return { ready,
    async commit() { if (closed) throw new UpdateError('INSTALL_UNAVAILABLE'); phase = 'committed'; const response = wait(); child.stdin.write('commit\n'); await response; },
    launch() { if (closed) throw new UpdateError('INSTALL_UNAVAILABLE'); child.stdin.end('launch\n'); child.stdout.destroy(); child.unref(); },
    cancel() { settle?.(true); child.stdin.end(); child.kill(); },
  };
}
function createWindowsInstaller({ config, app, downloader, dialog, getMainWindow, getBackend, restartBackend,
  exitForUpdate, getCandidate, helperFactory = startWindowsHelper, now = Date.now, platform = process.platform } = {}) {
  let status = null, busy = false;
  const listeners = new Set();
  const enabled = platform === 'win32' && app?.isPackaged && config.enabled && config.platform === 'win32';
  const profile = app.getPath('userData');
  function emit(next) { status = next; for (const fn of listeners) { try { Promise.resolve(fn(next)).catch(() => {}); } catch {} } }
  function current(version) {
    const packet = downloader.getVerified();
    if (!enabled || !packet || packet.version !== version || compareVersions(version, config.currentVersion) <= 0) throw new UpdateError('INSTALL_UNAVAILABLE');
    const latest = getCandidate?.();
    if (!latest || !latest.manifestBytes.equals(packet.candidate.manifestBytes) || !latest.signature.equals(packet.candidate.signature)) throw new UpdateError('INSTALL_UNAVAILABLE');
    const manifest = validateManifest(packet.candidate.manifestBytes, packet.candidate.signature, config, packet.candidate.release, now());
    const artifact = manifest.artifacts.find((a) => a.platform === 'win32' && a.packageFormat === 'nsis' && a.arch === 'x64');
    if (manifest.version !== version || !artifact || path.resolve(packet.file) !== path.join(profile, 'updates', 'downloads', path.basename(packet.slot), artifact.fileName)
        || !/^download-[A-Za-z0-9]{6}$/.test(path.basename(packet.slot))) throw new UpdateError('INSTALL_UNAVAILABLE');
    return { packet, artifact, expiresAt: manifest.expiresAt, commit: manifest.commit };
  }
  return {
    isBusy: () => busy,
    canInstall(version) { try { current(version); return !busy; } catch { return false; } },
    getStatus: () => status,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    reset() { if (busy) throw new UpdateError('INSTALL_BUSY'); emit(null); },
    async install(version) {
      if (busy) throw new UpdateError('INSTALL_BUSY');
      current(version); busy = true;
      let helper, stopped = false, window;
      try {
        window = getMainWindow();
        if (!window || window.isDestroyed()) throw new UpdateError('INSTALL_BUSY');
        const safe = () => window.webContents.executeJavaScript(`!document.querySelector('dialog[open]:not(#desktop-update-dialog)') && !document.querySelector('[aria-busy="true"]')`, true);
        if (!await safe()) throw new UpdateError('INSTALL_BUSY');
        const answer = await dialog.showMessageBox(window, { type: 'question', title: 'TTC Rechnungsverwaltung – Update',
          message: `Version ${version} jetzt installieren?`,
          detail: 'Die App und ihr lokaler Server werden kontrolliert beendet. Ungespeicherte Eingaben gehen verloren. Der Windows-Installer öffnet sich sichtbar; nach erfolgreicher Prüfung startet die App erneut. Rechnungen und persönliche Dateien bleiben erhalten.',
          buttons: ['Abbrechen', 'Jetzt installieren'], defaultId: 0, cancelId: 0, noLink: true });
        if (answer.response !== 1) return;
        if (!await safe()) throw new UpdateError('INSTALL_BUSY');
        await window.webContents.executeJavaScript('document.documentElement.inert = true', true);
        emit(Object.freeze({ state: 'preparing_install', version, error: null }));
        const { packet, artifact, expiresAt, commit } = current(version);
        const stat = await fs.lstat(packet.file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== artifact.size || stat.nlink !== 1) throw new UpdateError('INSTALL_UNAVAILABLE');
        // The helper locks and hashes the file again, then verifies native Authenticode.
        const executable = app.getPath('exe'), directory = path.dirname(executable);
        helper = helperFactory({ file: packet.file, slot: packet.slot, size: artifact.size, hash: artifact.sha256,
          version, expiresAt, commit, requiredFiles: REQUIRED_FILES, currentVersion: config.currentVersion, certificate: config.windows.certificateSha256,
          publisher: config.windows.publisherSubject, parentPid: process.pid, executable, directory, profile,
          updates: path.join(profile, 'updates'), downloads: path.join(profile, 'updates', 'downloads'),
          lock: path.join(profile, 'updates', 'windows-install.lock'), journal: path.join(profile, 'updates', 'windows-install-state.json'),
          installKey: `HKCU:\\Software\\${GUID}`, uninstallKey: `HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${GUID}` });
        await helper.ready;
        await getBackend().pauseForUpdate();
        stopped = true; await getBackend().stopForUpdate();
        current(version);
        await helper.commit();
        downloader.releaseForInstall(packet.file);
        emit(Object.freeze({ state: 'install_handoff', version, error: null }));
        helper.launch();
        exitForUpdate();
      } catch (error) {
        helper?.cancel();
        if (stopped) { try { await restartBackend(); } catch {} }
        else { try { await getBackend().resumeAfterUpdate(); } catch {} }
        emit(Object.freeze({ state: 'error', version, error: Object.freeze({ code: error?.code === 'INSTALL_BUSY' ? 'INSTALL_BUSY' : 'INSTALL_UNAVAILABLE',
          message: error?.code === 'INSTALL_BUSY' ? 'Bitte laufende Vorgänge abschließen und andere Dialoge schließen, bevor du installierst.' : FAILURE }) }));
      } finally {
        busy = false;
        if (status?.state !== 'install_handoff' && window && !window.isDestroyed()) {
          await window.webContents.executeJavaScript('document.documentElement.inert = false', true).catch(() => {});
        }
      }
    },
    async recovery() {
      if (!enabled) return;
      const file = path.join(profile, 'updates', 'windows-install-state.json');
      try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('invalid');
        const journal = JSON.parse(await fs.readFile(file, 'utf8'));
        if (journal.formatVersion !== 1 || !['handoff', 'installed', 'failed'].includes(journal.phase)) throw Error('invalid');
        if (journal.phase === 'installed' && journal.version === config.currentVersion) { await fs.unlink(file); return; }
        emit(Object.freeze({ state: 'error', version: config.currentVersion, error: Object.freeze({ code: 'INSTALL_INCOMPLETE', message: 'Die vorherige Aktualisierung wurde nicht vollständig bestätigt. Persönliche Daten bleiben erhalten. Bitte den vollständigen geprüften Installer verwenden, falls die App nicht korrekt funktioniert.' }) }));
      } catch (error) { if (error.code !== 'ENOENT') emit(Object.freeze({ state: 'error', version: config.currentVersion, error: Object.freeze({ code: 'INSTALL_INCOMPLETE', message: FAILURE }) })); }
    },
  };
}
module.exports = { createWindowsInstaller, startWindowsHelper, checkWindowsUpdateLock, GUID };
