'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { launchConfig, validateFrontend, checkPort, spawnBackend, stopTree } = require('../scripts/run.cjs');
const { waitForFrontend } = require('./startup.cjs');

const databaseErrors = {
  missing: 'Die lokale Datenbank fehlt. Datenverzeichnis prüfen oder eine Sicherung wiederherstellen.',
  locked: 'Die lokale Datenbank ist belegt. Andere App-Instanzen schließen und erneut starten.',
  corrupt: 'Die lokale Datenbank ist beschädigt oder ungültig. Original erhalten und eine Sicherung wiederherstellen.',
  access: 'Die lokale Datenbank ist nicht erreichbar oder beschreibbar. Datenverzeichnis, Speicherplatz und Rechte prüfen.',
  schema: 'Der Datenbankstand wird nicht unterstützt. Passende App-Version verwenden; Datenbank nicht löschen.',
};

function createBackend({ config, root, env, onFailure }) {
  const launch = launchConfig(config.mode === 'production' ? 'desktop-production' : 'desktop-dev', {
    ...env, TTC_DESKTOP_URL: config.url, TTC_DESKTOP_PRODUCTION_URL: config.url,
  }, root);
  let child;
  let starting;
  let stopping = false;
  let shutdown;
  let ready = false;
  return {
    start() {
      starting ??= (async () => {
        validateFrontend(launch);
        if (!fs.existsSync(path.join(root, 'scripts', 'managed_server.py'))) {
          throw new Error('Backend-Startdateien fehlen. Dieser Build muss mit den Backend-Dateien paketiert werden.');
        }
        await checkPort(launch.url);
        if (stopping) return;
        child = spawnBackend(launch, root, {
          ...env, TTC_LEGACY_DATABASE: env.TTC_LEGACY_DATABASE || path.join(root, 'data', 'ttc.db'),
        });
        const failed = new Promise((_resolve, reject) => {
          function failure(message) {
            if (stopping) return;
            const error = new Error(message);
            if (ready) onFailure(error);
            reject(error);
          }
          child.once('error', () => failure('Backend konnte nicht gestartet werden. Python-Pfad (TTC_PYTHON) und installierte Python-Pakete prüfen.'));
          child.once('exit', () => {
            failure(databaseErrors[child.databaseError] || 'Der lokale Anwendungsserver wurde unerwartet beendet. Python-Pakete und Backend-Fehlerausgabe prüfen.');
          });
        });
        try {
          await Promise.race([waitForFrontend(launch), failed]);
        } catch (error) {
          // A failed reload worker leaves its supervisor alive until shutdown.
          if (databaseErrors[child.databaseError]) throw new Error(databaseErrors[child.databaseError]);
          throw error;
        }
        if (!stopping) ready = true;
      })();
      return starting;
    },
    stop() {
      if (!shutdown) {
        stopping = true;
        shutdown = (async () => {
          // A quit during the port check must not race a late backend spawn.
          if (!child) return false;
          return stopTree(child);
        })();
      }
      return shutdown;
    },
  };
}
module.exports = { createBackend };
