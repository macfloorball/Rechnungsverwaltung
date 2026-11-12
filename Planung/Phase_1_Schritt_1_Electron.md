# Phase 1 – Schritt 1: Electron-Grundintegration

## A. Analyse und Umsetzung

Vor den Änderungen wurden Projektstruktur, Phase-0-Bericht, Python-Abhängigkeiten,
Frontend-Einstieg, Backend-Auslieferung und Konfigurationszugriffe untersucht.
Es gibt kein Frontend-Framework mit eigener Version: HTML/CSS und native
JavaScript-ES-Module, Einstieg `frontend/js/app.js`. FastAPI liefert diese über
StaticFiles aus; relative `/api/`-Aufrufe gehen an denselben Server. Python wird
mit pip und `requirements.txt` verwaltet, ohne Python-Lockdatei. Es gab weder
npm-Manifeste noch Bundler, Frontend-Build oder Startskripte für JavaScript.
Der Webstart ist `python -m uvicorn backend.main:app --reload --host 127.0.0.1`.
Anwendungseigene Umgebungsvariablen wurden nicht gefunden. SQLite, ReportLab und
Dateizugriffe bleiben serverseitig. Keine Authentifizierung vorhanden.

npm wurde ausschließlich für die zusätzliche Desktop-Hülle eingeführt.
Der eindeutige Main-Einstieg ist `electron/main.cjs`; Renderer sind die minimale
Bereitschaftsseite bzw. optional das unveränderte, separat ausgelieferte Frontend.
Ohne URL startet Electron unabhängig vom Backend. Eine konfigurierte lokale
HTTP-Origin bereitet das spätere Laden vor, ohne bereits Backend-Prozessverwaltung
oder einen vollständigen Desktop-Ablauf zu implementieren.

`contextIsolation`, `sandbox` und `webSecurity` sind aktiv, `nodeIntegration`
und Webviews deaktiviert. Berechtigungen, neue Fenster und fremde Navigation
werden abgelehnt, Netzwerkanfragen auf die konfigurierte Origin begrenzt.
Es gibt keinen Preload, keine freigegebenen Node-APIs und keine IPC-Kanäle.
Ein späterer Bedarf kann durch eine gezielte Preload-/IPC-Schnittstelle ergänzt
werden; eine leere oder generische Bridge ist jetzt unnötig.

## B. Dateien

- `package.json`: privates npm-Projekt, Electron-Main, klar benannte Skripte.
- `package-lock.json`: exakte Auflösung der npm-Abhängigkeiten.
- `electron/main.cjs`: Main-Prozess, sicheres Minimalfenster, Ladepfad und Fehlerausgabe.
- `electron/config.cjs`: Validierung der optionalen Loopback-Origin.
- `electron/config.test.cjs`: Tests der erlaubten und abgelehnten Konfigurationen.
- `electron/ready.html`: lokale Bereitschaftsseite mit restriktiver CSP.
- `.gitignore`: `node_modules/` ausschließen.
- `README.md`: Installation, paralleler Web-/Electron-Start, PowerShell-Beispiel.
- Dieser Bericht: Entscheidungen, Ergebnisse und offene Grenzen.

Backend, Frontend, Datenhaltung, Rechnungslogik und bestehende Python-Konfiguration
wurden nicht geändert. Kein weiterer Phase-1-Schritt ist als erledigt markiert.

## C. Konfiguration

Neue direkte Entwicklungsabhängigkeit: `electron` exakt `45.3.1`, laut offizieller
Releaseübersicht am Prüftag aktuell stabil. Node.js ab 22.12 erforderlich.
In dieser Sitzung wurde mangels systemweitem Node eine temporäre Node-24.22.3-
Laufzeit unter `/tmp` verwendet (Archiv per SHA-256 geprüft).

- `npm ci`: Installation anhand der Lockdatei.
- `npm run desktop:dev`: unabhängiger Electron-Start.
- `npm run desktop:check`: Syntaxprüfung und Node-Konfigurationstests.
- `TTC_DESKTOP_URL`: optionale lokale HTTP-Origin; kein doppelter Standardport.

Beim ersten Start lädt das Electron-npm-Paket gegebenenfalls seine Binärdatei
nach. Die Binärdatei wurde für die Prüfung explizit mit dem mitgelieferten
`install.js` heruntergeladen. Ein Windows-Build/Installer ist nicht eingerichtet.

## D. Prüfungen

- npm-Installation erfolgreich, Audit: 0 bekannte Schwachstellen.
- Syntaxprüfung und Konfigurationstests erfolgreich; geprüft wurden fehlende
  Konfiguration, IPv4-/IPv6-Loopback und ungültige/fremde URLs.
- Bestehende Python-Tests: **49 bestanden in 2,89 Sekunden**.
- Echter Uvicorn-Start auf `127.0.0.1:18765` mit ausschließlich temporärer
  Datenbank und temporärem Rechnungsverzeichnis erfolgreich.
- Echter Electron-Main-Start mit Bereitschaftsseite erfolgreich.
- Electron lädt das unveränderte Frontend vom Testserver erfolgreich:
  Titel `TTC-Rechnungsverwaltung`, Kalenderelement vorhanden, `typeof require`
  im Renderer ist `undefined`; tatsächliche WebPreferences bestätigen
  Sandbox, Context Isolation und deaktivierte Node-Integration.
- Nach Korrektur der Konsolenereignis-Signatur keine JavaScript-Fehler im
  Lade-Smoke-Test. Chromium meldet in dieser Linux-Umgebung einen GPU-
  Cachefehler (`Persistent cache error: 1`), ohne den Start/Ladevorgang zu verhindern.
- GUI- und Serverprüfungen sowie Python-Tests außerhalb der restriktiven
  Sandbox ausgeführt. Keine bestehende Nutzerdatenbank für den Smoke-Test geöffnet.

Nicht geprüft: Windows-Start, vollständige Bedienabläufe im Renderer, finale
PDF-Workflows, Installer oder Produktionsbetrieb. Neue PDF-Fenster sind aktuell
absichtlich gesperrt und benötigen im dafür vorgesehenen Schritt eine gezielte
Lösung. Ein nicht erreichbarer konfigurierter Server führt zu einer Fehlermeldung
auf stderr und Exitcode 1; ein komfortabler Bereitschafts-/Fehlerablauf folgt später.

## E. Voraussetzung für den nächsten Schritt

Electron ist technisch eingebunden, Main und Renderer sind getrennt,
Abhängigkeiten reproduzierbar festgelegt und das Laden des bestehenden Frontends
ist grundsätzlich nachgewiesen. Weiterführende Prozessverwaltung, Fenstergestaltung,
Desktop-Funktionen und Paketierung wurden nicht vorweggenommen.

Quellen: [Electron-Releases](https://releases.electronjs.org/),
[Sicherheit](https://www.electronjs.org/docs/latest/tutorial/security/),
[Sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox).
