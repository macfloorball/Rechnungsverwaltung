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
  const args = ['-m', 'uvicorn', 'backend.main:app', '--host', url.hostname.replace(/[\[\]]/g, ''), '--port', url.port || '80'];
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

async function stopTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('error', resolve); killer.once('exit', resolve);
    });
    return;
  }
  const signal = (name) => {
    try { process.kill(-child.pid, name); return true; }
    catch (error) { if (error.code !== 'ESRCH') throw error; return false; }
  };
  if (!signal('SIGTERM')) return;
  // Also wait for reload workers when their parent has already exited.
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try { process.kill(-child.pid, 0); } catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  signal('SIGKILL');
}

async function run(mode, { root = ROOT, env = process.env, electronEntry = root } = {}) {
  const config = launchConfig(mode, env, root);
  if (!fs.existsSync(path.join(config.frontend, 'index.html'))) {
    throw new Error(config.desktop && config.mode === 'production'
      ? 'Frontend-Build fehlt. Bitte npm run frontend:build ausführen.' : 'Frontend-Einstieg fehlt.');
  }
  if (config.mode === 'production' && !fs.existsSync(path.join(config.buildDirectory, 'desktop-build.json'))) {
    throw new Error('Frontend-Build ist unvollständig. Bitte npm run frontend:build ausführen.');
  }
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
      await Promise.all(children.map(stopTree));
      finish(code);
    })();
    return shutdownPromise;
  }
  const signals = ['SIGINT', 'SIGTERM'];
  const onSignal = () => { shutdown(0).catch(() => finish(1)); };
  signals.forEach((name) => process.on(name, onSignal));
  function start(command, args, label) {
    const child = spawn(command, args, { cwd: root, env: {
      ...env,
      TTC_FRONTEND_DIRECTORY: config.frontend,
      // Each managed child receives an explicit, mode-specific address.
      TTC_DESKTOP_URL: config.url,
      TTC_DESKTOP_PRODUCTION_URL: config.url,
    }, stdio: 'inherit', detached: true, windowsHide: false });
    children.push(child);
    child.once('error', () => {
      console.error(`${label} konnte nicht gestartet werden. Python-Pfad (TTC_PYTHON), Installation und Abhängigkeiten prüfen.`);
      shutdown(1).catch(() => finish(1));
    });
    child.once('exit', (code, signal) => {
      if (stopping) return;
      if (label === 'Electron' && code === 0 && !signal) shutdown(0).catch(() => finish(1));
      else {
        console.error(`${label} unerwartet beendet (Code ${code ?? signal}).`);
        shutdown(1).catch(() => finish(1));
      }
    });
  }
  try {
    console.log(`Start: ${mode} – ${config.url}`);
    start(config.python, config.args, 'Anwendungsserver');
    const ready = waitForFrontend(config).then(() => 'ready');
    const status = await Promise.race([ready, finished.then(() => 'stopped')]);
    if (status === 'ready' && !stopping) {
      console.log('Anwendungsserver und Frontend bereit.');
      if (config.desktop) {
        const electron = require(path.join(root, 'node_modules', 'electron'));
        start(electron, [electronEntry, ...(config.mode === 'production' ? ['--desktop-production'] : [])], 'Electron');
      }
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
module.exports = { launchConfig, checkPort, stopTree, run };
