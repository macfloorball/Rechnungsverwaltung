'use strict';
const { app, dialog } = require('electron');

// Installed builds validate before loading any application modules or starting
// a backend. Missing validation/startup modules therefore also fail safely.
try {
  require('./installation.cjs').validateInstallation(app.getAppPath(), true);
  require('./main.cjs');
} catch {
  console.error('Installationsprüfung fehlgeschlagen.');
  app.whenReady().then(() => {
    dialog.showErrorBox('TT Rechnungsverwaltung – Installationsfehler',
      'Installationsdateien fehlen, sind beschädigt oder nicht lesbar. Zugriffsrechte prüfen und die Anwendung mit dem vollständigen Installer reparieren. Persönliche Daten bleiben erhalten.');
    app.exit(1);
  }).catch(() => app.exit(1));
}
