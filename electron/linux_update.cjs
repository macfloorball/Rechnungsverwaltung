'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { UpdateError, validateManifest } = require('./update_manifest.cjs');
const { compareVersions } = require('./version.cjs');
const { validateInstallation } = require('./installation.cjs');
const MANUAL = 'Dieses AppImage kann hier nicht sicher automatisch ersetzt werden. Bitte die freigegebene AppImage-Datei aus dem GitHub-Repository manuell aktualisieren. Es werden keine erhöhten Rechte angefordert.';
const LOCAL_FS = new Set([0xef53, 0x9123683e, 0x58465342, 0x01021994, 0x794c7630]);
const decodeMount = (value) => value.replace(/\\([0-7]{3})/g, (_match, digits) => String.fromCharCode(parseInt(digits, 8)));
const cleanEnv = (env) => Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('PYTHON')
  && !['LD_LIBRARY_PATH', 'LD_PRELOAD', 'ELECTRON_RUN_AS_NODE'].includes(key)));

async function secureDirectory(file, own = false, privateMode = false) {
  for (let current = file; ; current = path.dirname(current)) {
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || ![0, process.getuid()].includes(stat.uid)
        || ((stat.mode & 0o022) && !(current !== file && stat.uid === 0 && (stat.mode & 0o1000)))) throw new UpdateError('INSTALL_UNAVAILABLE');
    if (current === path.dirname(current)) break;
  }
  const stat = await fs.lstat(file);
  if ((own && stat.uid !== process.getuid()) || (privateMode && (stat.mode & 0o077))) throw new UpdateError('INSTALL_UNAVAILABLE');
}
async function probeAppImage({ app, env = process.env, mountInfo = () => fs.readFile('/proc/self/mountinfo', 'utf8') }) {
  if (process.platform !== 'linux' || process.getuid() === 0 || !app.isPackaged || !path.isAbsolute(env.APPIMAGE || '') || !path.isAbsolute(env.APPDIR || '')) throw new UpdateError('INSTALL_UNAVAILABLE');
  const target = path.resolve(env.APPIMAGE), mount = path.resolve(env.APPDIR);
  if (path.resolve(app.getAppPath()) !== path.join(mount, 'resources', 'app')
      || path.resolve(app.getPath('exe')) !== path.join(mount, 'ttc-rechnungsverwaltung')) throw new UpdateError('INSTALL_UNAVAILABLE');
  const record = (await mountInfo()).split('\n').map((line) => line.split(' ')).find((fields) => decodeMount(fields[4] || '') === mount);
  const separator = record?.indexOf('-');
  if (!record || separator < 0 || !record[5].split(',').includes('ro')
      || !['fuse.squashfuse', 'fuse.AppImage', 'fuse.appimage'].includes(record[separator + 1])) throw new UpdateError('INSTALL_UNAVAILABLE');
  await secureDirectory(path.dirname(target), true);
  if (await fs.realpath(target) !== target || !LOCAL_FS.has(Number((await fs.statfs(path.dirname(target))).type))) throw new UpdateError('INSTALL_UNAVAILABLE');
  await fs.access(path.dirname(target), fs.constants.W_OK | fs.constants.X_OK);
  const stat = await fs.lstat(target, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== BigInt(process.getuid()) || stat.nlink !== 1n
      || (stat.mode & 0o7022n) || (stat.mode & 0o700n) !== 0o700n) throw new UpdateError('INSTALL_UNAVAILABLE');
  const handle = await fs.open(target, 'r');
  try {
    const header = Buffer.alloc(24); await handle.read(header, 0, 24, 0);
    if (header.subarray(0, 6).toString('hex') !== '7f454c460201' || header.subarray(8, 11).toString('hex') !== '414902'
        || header.readUInt16LE(18) !== 62) throw new UpdateError('INSTALL_UNAVAILABLE');
  } finally { await handle.close(); }
  return { target, identity: Object.fromEntries(['dev', 'ino', 'size'].map((key) => [key, String(stat[key])]).concat([['mtime', String(stat.mtimeNs)], ['ctime', String(stat.ctimeNs)]])) };
}
async function cleanupLinuxStages(target) {
  const parent = path.dirname(target);
  await secureDirectory(parent, true);
  for (const name of await fs.readdir(parent)) {
    if (!/^\.ttc-rechnungsverwaltung-update-[a-f0-9]{24}$/.test(name)) continue;
    const directory = path.join(parent, name), stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) continue;
    const files = await fs.readdir(directory);
    if (!files.includes('.owner.json') || files.some((file) => !['.owner.json', 'image.part'].includes(file))) continue;
    let safe = true;
    for (const file of files) {
      const entry = await fs.lstat(path.join(directory, file));
      if (!entry.isFile() || entry.isSymbolicLink() || entry.uid !== process.getuid() || entry.nlink !== 1
          || (entry.mode & 0o7077) || (file === '.owner.json' && entry.size > 1024)) safe = false;
    }
    if (!safe) continue;
    let marker;
    try { marker = JSON.parse(await fs.readFile(path.join(directory, '.owner.json'), 'utf8')); } catch { continue; }
    if (marker.formatVersion === 1 && marker.appId === 'de.mac-floorball.ttc-rechnungsverwaltung' && marker.originalName === path.basename(target)) {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
}
async function prepareHelper(appRoot, profile) {
  validateInstallation(appRoot, true, 'linux');
  await secureDirectory(profile, true);
  const updates = path.join(profile, 'updates');
  await fs.mkdir(updates, { recursive: true, mode: 0o700 }); await secureDirectory(updates, true, true);
  const manifest = JSON.parse(await fs.readFile(path.join(appRoot, 'installation-manifest.json'), 'utf8'));
  const selected = Object.entries(manifest.files).filter(([name]) => name === 'backend/linux_update_helper.py'
    || name === 'runtime/python/bin/python3.13'
    || (name.startsWith('runtime/python/lib/python3.13/') && !name.includes('/site-packages/'))
    || /^runtime\/python\/lib\/[^/]+\.so(?:\.[0-9.]+)?$/.test(name));
  const space = await fs.statfs(updates, { bigint: true });
  let total = 0n;
  for (const [name] of selected) total += (await fs.stat(path.join(appRoot, name), { bigint: true })).size;
  if (space.bavail * space.bsize < total + 16n * 1024n * 1024n) throw new UpdateError('INSTALL_UNAVAILABLE');
  const directory = await fs.mkdtemp(path.join(updates, 'linux-helper-'));
  try {
    for (const [name, hash] of selected) {
      const source = path.join(appRoot, name), destination = path.join(directory, name);
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      const bytes = await fs.readFile(source);
      if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new UpdateError('INSTALL_UNAVAILABLE');
      await fs.writeFile(destination, bytes, { flag: 'wx', mode: name === 'runtime/python/bin/python3.13' ? 0o700 : 0o600 });
    }
    const executable = path.join(directory, 'runtime/python/bin/python3.13'), script = path.join(directory, 'backend/linux_update_helper.py');
    await promisify(execFile)(executable, ['-I', '-B', '-c', 'import os, fcntl, hashlib, json, select; assert hasattr(os, "pidfd_open")'], { env: cleanEnv(process.env), timeout: 15000 });
    return { directory, executable, script };
  } catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error; }
}
function startLinuxHelper(context, prepared, { spawnImpl = spawn } = {}) {
  const child = spawnImpl(prepared.executable, ['-I', '-B', prepared.script], { shell: false, detached: true,
    env: cleanEnv(process.env), stdio: ['pipe', 'pipe', 'ignore'] });
  let buffer = '', phase = 'ready', closed = false, settle;
  function wait() { return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new UpdateError('INSTALL_UNAVAILABLE')), 180000);
    settle = (failed) => { clearTimeout(timer); failed ? reject(new UpdateError('INSTALL_UNAVAILABLE')) : resolve(); };
  }); }
  const ready = wait();
  const ended = new Promise((resolve) => { child.once('exit', resolve); child.once('error', resolve); });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { buffer = (buffer + chunk).slice(-4096);
    if (buffer.includes('TTC_UPDATE_REJECTED')) settle?.(true);
    else if (buffer.includes(phase === 'ready' ? 'TTC_UPDATE_READY' : 'TTC_UPDATE_COMMITTED')) { buffer = ''; settle?.(false); } });
  child.once('error', () => { closed = true; settle?.(true); });
  child.once('exit', () => { closed = true; settle?.(true); });
  child.stdin.on('error', () => settle?.(true));
  child.stdin.write(JSON.stringify(context) + '\n');
  return { ready,
    async commit() { if (closed) throw new UpdateError('INSTALL_UNAVAILABLE'); phase = 'committed'; const response = wait(); child.stdin.write('commit\n'); await response; },
    launch() { if (closed) throw new UpdateError('INSTALL_UNAVAILABLE'); child.stdin.end('launch\n'); child.stdout.destroy(); child.unref(); },
    async cancel() {
      settle?.(true); child.stdin.end();
      if (!closed) {
        let timer;
        await Promise.race([ended, new Promise((resolve) => { timer = setTimeout(resolve, 1000); })]);
        clearTimeout(timer);
        if (!closed) child.kill();
        let stopped;
        await Promise.race([ended, new Promise((resolve) => { stopped = setTimeout(resolve, 2000); })]);
        clearTimeout(stopped);
        if (!closed) child.kill('SIGKILL');
      }
    },
  };
}
async function checkLinuxUpdateLock(app) {
  const lock = path.join(app.getPath('userData'), 'updates/linux-install.lock');
  try { if (!(await fs.lstat(lock)).isFile()) throw Error('lock'); }
  catch (error) { if (error.code === 'ENOENT') return; throw Error('AppImage-Updatesperre ist nicht zugänglich.'); }
  try {
    await promisify(execFile)(path.join(app.getAppPath(), 'runtime/python/bin/python3.13'),
      ['-I', '-B', path.join(app.getAppPath(), 'backend/linux_update_helper.py'), '--probe-lock', lock], { env: cleanEnv(process.env), timeout: 15000 });
  } catch { throw Error('Ein AppImage-Update ist aktiv oder die Updatesperre ist nicht zugänglich. Bitte die Aktualisierung abschließen und die App erneut starten.'); }
}
function createLinuxInstaller({ config, app, downloader, dialog, getMainWindow, getBackend, restartBackend, exitForUpdate,
  getCandidate, now = Date.now, probe = probeAppImage, prepare = prepareHelper, helperFactory = startLinuxHelper, platform = process.platform } = {}) {
  const enabled = platform === 'linux' && app.isPackaged && config.enabled && config.platform === 'linux';
  const profile = app.getPath('userData');
  let capability = null, status = null, busy = false;
  const listeners = new Set();
  const emit = (value) => { status = value; for (const fn of listeners) { try { Promise.resolve(fn(value)).catch(() => {}); } catch {} } };
  function current(version) {
    const packet = downloader.getVerified(), latest = getCandidate?.();
    if (!enabled || !capability || !packet || packet.version !== version || compareVersions(version, config.currentVersion) <= 0
        || !latest || !latest.manifestBytes.equals(packet.candidate.manifestBytes) || !latest.signature.equals(packet.candidate.signature)) throw new UpdateError('INSTALL_UNAVAILABLE');
    const manifest = validateManifest(packet.candidate.manifestBytes, packet.candidate.signature, config, packet.candidate.release, now());
    const artifact = manifest.artifacts.find((a) => a.platform === 'linux' && a.packageFormat === 'appimage' && a.arch === 'x64');
    if (manifest.version !== version || !artifact || !/^download-[A-Za-z0-9]{6}$/.test(path.basename(packet.slot))
        || path.resolve(packet.file) !== path.join(profile, 'updates/downloads', path.basename(packet.slot), artifact.fileName)) throw new UpdateError('INSTALL_UNAVAILABLE');
    return { packet, manifest, artifact };
  }
  return {
    isBusy: () => busy, getStatus: () => status,
    getPolicy: () => ({ message: enabled && !capability ? MANUAL : null }),
    canInstall(version) { try { current(version); return !busy; } catch { return false; } },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    reset() { if (busy) throw new UpdateError('INSTALL_BUSY'); emit(null); },
    async install(version) {
      if (busy) throw new UpdateError('INSTALL_BUSY');
      current(version); busy = true;
      let window, prepared, helper, stopped = false, handed = false;
      try {
        window = getMainWindow();
        const safe = () => window && !window.isDestroyed() && window.webContents.executeJavaScript(`!document.querySelector('dialog[open]:not(#desktop-update-dialog)') && !document.querySelector('[aria-busy="true"]')`, true);
        if (!await safe()) throw new UpdateError('INSTALL_BUSY');
        const answer = await dialog.showMessageBox(window, { type: 'question', title: 'TT Rechnungsverwaltung – AppImage-Update',
          message: `Version ${version} jetzt installieren?`, detail: 'Die App und ihr lokaler Server werden kontrolliert beendet. Ungespeicherte Eingaben gehen verloren. Das geprüfte AppImage wird am bisherigen Ort ersetzt und neu gestartet. Rechnungen und persönliche Dateien bleiben erhalten.',
          buttons: ['Abbrechen', 'Jetzt installieren'], defaultId: 0, cancelId: 0, noLink: true });
        if (answer.response !== 1) return;
        if (!await safe()) throw new UpdateError('INSTALL_BUSY');
        await window.webContents.executeJavaScript('document.documentElement.inert = true', true);
        emit(Object.freeze({ state: 'preparing_install', version, error: null }));
        capability = await probe({ app });
        const { packet, manifest, artifact } = current(version);
        prepared = await prepare(app.getAppPath(), profile);
        helper = helperFactory({ ...capability, profile, file: packet.file, size: artifact.size, sha256: artifact.sha256,
          version, currentVersion: config.currentVersion, expiresAt: manifest.expiresAt, parentPid: process.pid,
          helperDirectory: prepared.directory, helperName: path.basename(prepared.directory) }, prepared);
        await helper.ready;
        await getBackend().pauseForUpdate(); stopped = true; await getBackend().stopForUpdate();
        current(version); await helper.commit();
        downloader.releaseForInstall(packet.file);
        emit(Object.freeze({ state: 'install_handoff', version, error: null }));
        helper.launch(); handed = true; exitForUpdate();
      } catch (error) {
        await helper?.cancel();
        if (stopped) { try { await restartBackend(); } catch {} }
        else { try { await getBackend().resumeAfterUpdate(); } catch {} }
        emit(Object.freeze({ state: 'error', version, error: Object.freeze({ code: error?.code === 'INSTALL_BUSY' ? 'INSTALL_BUSY' : 'INSTALL_UNAVAILABLE',
          message: error?.code === 'INSTALL_BUSY' ? 'Bitte laufende Vorgänge abschließen und andere Dialoge schließen.' : MANUAL }) }));
      } finally {
        busy = false;
        if (!handed && prepared) await fs.rm(prepared.directory, { recursive: true, force: true }).catch(() => {});
        if (!handed && window && !window.isDestroyed()) await window.webContents.executeJavaScript('document.documentElement.inert = false', true).catch(() => {});
      }
    },
    async recovery() {
      if (!enabled) return;
      await checkLinuxUpdateLock(app);
      try { capability = await probe({ app }); } catch { capability = null; }
      if (capability) {
        try { await cleanupLinuxStages(capability.target); } catch { capability = null; }
      }
      const file = path.join(profile, 'updates/linux-install-state.json');
      try {
        await secureDirectory(path.dirname(file), true, true);
        for (const name of await fs.readdir(path.dirname(file))) {
          if (!/^linux-helper-[A-Za-z0-9]{6}$/.test(name)) continue;
          const helper = path.join(path.dirname(file), name), entry = await fs.lstat(helper);
          if (entry.isDirectory() && !entry.isSymbolicLink() && entry.uid === process.getuid() && !(entry.mode & 0o077)) await fs.rm(helper, { recursive: true, force: true });
        }
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('journal');
        const journal = JSON.parse(await fs.readFile(file, 'utf8'));
        if (journal.formatVersion !== 1 || !/^linux-helper-[A-Za-z0-9]{6}$/.test(journal.helper) || !/^download-[A-Za-z0-9]{6}$/.test(journal.download)) throw Error('journal');
        if (journal.phase === 'replaced' && journal.version === config.currentVersion) {
          await fs.rm(path.join(profile, 'updates', journal.helper), { recursive: true, force: true });
          await fs.rm(path.join(profile, 'updates/downloads', journal.download), { recursive: true, force: true });
          await fs.unlink(file); return;
        }
        emit(Object.freeze({ state: 'error', version: config.currentVersion, error: Object.freeze({ code: 'INSTALL_INCOMPLETE', message: 'Das letzte AppImage-Update wurde nicht vollständig bestätigt. Bitte die freigegebene AppImage-Datei manuell prüfen. Persönliche Daten bleiben erhalten.' }) }));
      } catch (error) { if (error.code !== 'ENOENT') emit(Object.freeze({ state: 'error', version: config.currentVersion, error: Object.freeze({ code: 'INSTALL_INCOMPLETE', message: MANUAL }) })); }
    },
  };
}
module.exports = { createLinuxInstaller, probeAppImage, prepareHelper, startLinuxHelper, checkLinuxUpdateLock, cleanupLinuxStages };
