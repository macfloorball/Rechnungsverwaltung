'use strict';
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { getDesktopConfig } = require('../electron/config.cjs');
const { waitForFrontend } = require('../electron/startup.cjs');

const ROOT = path.join(__dirname, '..');
const MODES = ['web', 'web-dev', 'desktop-dev', 'desktop-production'];

function launchConfig(mode, env = process.env, root = ROOT) {
  if (!MODES.includes(mode)) throw new Error(`Startmodus erforderlich: ${MODES.join(', ')}`);
  const production = ['web', 'desktop-production'].includes(mode);
  const config = getDesktopConfig(env, production ? ['--desktop-production'] : []);
  // Plain web mode continues to serve the original source frontend.
  if (mode === 'web') { config.mode = 'development'; config.buildDirectory = null; }
  else if (production) config.buildDirectory = path.join(root, 'dist', 'frontend');
  const url = new URL(config.url);
  const venv = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const python = env.TTC_PYTHON || (fs.existsSync(venv) ? venv : process.platform === 'win32' ? 'python' : 'python3');
  const args = ['-m', 'scripts.managed_server', 'backend.main:app', '--host', url.hostname.replace(/[\[\]]/g, ''), '--port', url.port || '80'];
  if (!production) args.push('--reload', '--reload-dir', path.join(root, 'backend'));
  return { ...config, python, args, desktop: mode.startsWith('desktop-'),
    frontend: mode === 'desktop-production' ? path.join(root, 'dist', 'frontend') : path.join(root, 'frontend') };
}

function checkPort(url) {
  const address = new URL(url);
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error('Lokaler Port ist belegt oder nicht verfügbar. Laufende Instanz beenden oder eine andere Loopback-Adresse konfigurieren.')));
    server.listen(Number(address.port || 80), address.hostname.replace(/[\[\]]/g, ''), () => server.close(resolve));
  });
}

const stoppingTrees = new WeakMap();
function stopTree(child, options = {}) {
  if (!child) return Promise.resolve(false);
  if (!stoppingTrees.has(child)) stoppingTrees.set(child, stopOwnedTree(child, options));
  return stoppingTrees.get(child);
}

async function stopOwnedTree(child, { graceMs = 20000, terminateMs = 2000 } = {}) {
  if (!child?.pid) return false;
  let forced = false;
  if (child.managedBackend && child.exitCode === null && child.signalCode === null) {
    child.stdin?.end('shutdown\n');
    const deadline = Date.now() + graceMs;
    while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (child.exitCode === null && child.signalCode === null) {
      forced = true;
      console.error('Server-Shutdown überschritten. Erzwinge Beenden eigener Prozesse; laufende Datenoperationen können unterbrochen werden.');
    }
  }
  if (child.managedBackend && child.exitCode !== null && child.exitCode !== 0) {
    console.error('Anwendungsserver wurde nicht fehlerfrei beendet.');
    forced = true;
  }
  if (process.platform === 'win32') {
    if (child.exitCode !== null || child.signalCode !== null) return forced;
    await new Promise((resolve, reject) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      const timer = setTimeout(() => { killer.kill(); reject(new Error('Prozessbereinigung hat das Zeitlimit überschritten')); }, 5000);
      killer.once('error', (error) => { clearTimeout(timer); reject(error); });
      killer.once('exit', (code) => { clearTimeout(timer);
        if (code !== 0 && child.exitCode === null && child.signalCode === null) reject(new Error('Eigener Prozess konnte nicht beendet werden'));
        else resolve();
      });
    });
    return forced;
  }
  const signal = (name) => {
    try { process.kill(-child.pid, name); return true; }
    catch (error) { if (error.code !== 'ESRCH') throw error; return false; }
  };
  if (!signal('SIGTERM')) return forced;
  // Also wait for reload workers when their parent has already exited.
  const deadline = Date.now() + terminateMs;
  while (Date.now() < deadline) {
    try { process.kill(-child.pid, 0); } catch (error) { if (error.code === 'ESRCH') return forced; throw error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (signal('SIGKILL')) {
    console.error('Eigener Prozessbaum reagiert nicht; erzwungen beendet.');
    return true;
  }
  return forced;
}

function validateFrontend(config) {
  if (!fs.existsSync(path.join(config.frontend, 'index.html'))) {
    throw new Error(config.desktop && config.mode === 'production'
      ? 'Frontend-Build fehlt. Bitte npm run frontend:build ausführen.' : 'Frontend-Einstieg fehlt.');
  }
  if (config.mode === 'production' && !fs.existsSync(path.join(config.buildDirectory, 'desktop-build.json'))) {
    throw new Error('Frontend-Build ist unvollständig. Bitte npm run frontend:build ausführen.');
  }
}

function spawnBackend(config, root, env) {
  const child = spawn(config.python, config.args, {
    cwd: root, env: { ...env, TTC_FRONTEND_DIRECTORY: config.frontend },
    stdio: ['pipe', 'inherit', 'pipe'], detached: true, windowsHide: true,
  });
  let errorOutput = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    errorOutput = (errorOutput + chunk).slice(-4096);
    const match = errorOutput.match(/(?:^|\n)TTC_DATABASE_ERROR:(missing|locked|corrupt|access|schema)\r?\n/);
    if (match) child.databaseError = match[1];
    const documentMatch = errorOutput.match(/(?:^|\n)TTC_DOCUMENT_ERROR:(missing|access|space|exists|changed|invalid|unsupported|io)\r?\n/);
    if (documentMatch) child.documentError = documentMatch[1];
  });
  child.managedBackend = true;
  child.stdin.on('error', () => {});
  return child;
}

function runElectron(config, root, env, electronEntry) {
  const executable = require(path.join(root, 'node_modules', 'electron'));
  const child = spawn(executable, [electronEntry, ...(config.mode === 'production' ? ['--desktop-production'] : [])], {
    cwd: root, env, stdio: 'inherit', detached: true,
  });
  return new Promise((resolve) => {
    let timer;
    const onSignal = () => {
      child.kill('SIGTERM');
      timer ??= setTimeout(() => stopTree(child).catch(() => {}).finally(() => resolve(1)), 25000);
    };
    const finish = (code) => {
      clearTimeout(timer);
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      resolve(code);
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    child.once('error', () => { console.error('Electron konnte nicht gestartet werden.'); finish(1); });
    child.once('exit', (code) => finish(code ?? 1));
  });
}

async function run(mode, { root = ROOT, env = process.env, electronEntry = root } = {}) {
  const config = launchConfig(mode, env, root);
  if (config.desktop) return runElectron(config, root, env, electronEntry);
  validateFrontend(config);
  await checkPort(config.url);
  const children = [];
  let stopping = false;
  let shutdownPromise;
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  async function shutdown(code) {
    if (shutdownPromise) return shutdownPromise;
    stopping = true;
    shutdownPromise = (async () => {
      const results = await Promise.allSettled(children.map((child) => stopTree(child)));
      const failed = results.some((result) => result.status === 'rejected' || result.value === true);
      if (results.some((result) => result.status === 'rejected')) console.error('Fehler beim Beenden eigener Prozesse; Prozessstatus prüfen.');
      finish(failed ? 1 : code);
    })();
    return shutdownPromise;
  }
  const signals = ['SIGINT', 'SIGTERM'];
  const onSignal = () => { shutdown(0).catch(() => finish(1)); };
  signals.forEach((name) => process.on(name, onSignal));
  function startServer() {
    const child = spawnBackend(config, root, env);
    children.push(child);
    child.once('error', () => {
      console.error('Anwendungsserver konnte nicht gestartet werden. Python-Pfad (TTC_PYTHON), Installation und Abhängigkeiten prüfen.');
      shutdown(1).catch(() => finish(1));
    });
    child.once('exit', (code, signal) => {
      if (stopping) return;
      console.error(`Anwendungsserver unerwartet beendet (Code ${code ?? signal}).`);
      shutdown(1).catch(() => finish(1));
    });
  }
  try {
    console.log(`Start: ${mode} – ${config.url}`);
    startServer();
    const ready = waitForFrontend(config).then(() => 'ready');
    const status = await Promise.race([ready, finished.then(() => 'stopped')]);
    if (status === 'ready' && !stopping) {
      console.log('Anwendungsserver und Frontend bereit.');
    }
  } catch (error) {
    console.error(error.message);
    await shutdown(1);
  }
  const code = await finished;
  signals.forEach((name) => process.removeListener(name, onSignal));
  return code;
}

if (require.main === module) run(process.argv[2]).then((code) => process.exit(code)).catch((error) => {
  console.error(error.message); process.exitCode = 1;
});
module.exports = { launchConfig, checkPort, stopTree, validateFrontend, spawnBackend, run };
