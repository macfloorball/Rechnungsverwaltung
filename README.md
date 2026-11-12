# TTC-Rechnungsverwaltung

Eine lokale Webanwendung zur Verwaltung von Trainingsterminen und zur
Erstellung monatlicher Rechnungen für einen Tischtennisverein. Das Projekt
verbindet eine FastAPI-Schnittstelle mit einer browserbasierten Oberfläche,
SQLite und PDF-Rechnungserstellung.

> **Portfolio-Hinweis:** Die Anwendung enthält keine Benutzerkonten oder
> Authentifizierung. Sie ist für den lokalen Betrieb gedacht und sollte nicht
> ungeschützt über ein Netzwerk oder das Internet erreichbar gemacht werden.

## Funktionen

- Tätigkeiten und Stundenpreise verwalten.
- Wöchentlichen Trainingsplan pflegen und Trainingstermine im Monatskalender
  planen, bearbeiten, als ausgefallen markieren und einzeln oder gesammelt
  abschließen.
- Abrechenbare, durchgeführte Termine für einen Monat prüfen und die
  gespeicherte Vorschau für diesen Monat aktualisieren. Endgültige Rechnungen
  werden als PDF erstellt und bleiben unverändert.
- Rechnungseinstellungen einschließlich Absender, Empfänger, Zahlungsangaben
  und optionalem Logo verwalten.
- Gespeicherte Rechnungen und deren unveränderliche Positions- und
  Einstellungssnapshots anzeigen.
- SQLite-Datenbank migrieren und mit dem optionalen systemd-Timer sichern.

## Technologien und Architektur

- **Backend:** Python, FastAPI und Pydantic für REST-Endpunkte und
  Eingabevalidierung.
- **Persistenz:** SQLite mit versionierten Datenbankmigrationen.
- **Frontend:** HTML, CSS und natives JavaScript mit ES-Modulen.
- **PDF:** ReportLab zur Erzeugung von Rechnungen.
- **Tests:** pytest für API, Datenbank, Rechnungen/PDFs und Backups;
  Kalender- und Abrechnungsabläufe werden teilweise über API-Tests geprüft.

Das Frontend wird vom FastAPI-Backend ausgeliefert und kommuniziert mit ihm
über die API. Es gibt keine separate Frontend-Build-Pipeline.

## Voraussetzungen

- Python 3.10 oder neuer
- `pip`

Die folgenden Schritte sind für Linux/macOS geschrieben. Unter Windows kann
die virtuelle Umgebung mit `.venv\Scripts\activate` aktiviert werden.

## Installation und Start

```bash
git clone https://github.com/macfloorball/Rechnungsverwaltung.git
cd Rechnungsverwaltung
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --host 127.0.0.1
```

Die Oberfläche ist anschließend unter <http://127.0.0.1:8000> erreichbar.
Der Entwicklungsserver bindet hier ausdrücklich an die Loopback-Adresse.
Ein einfacher Health-Check ist:

```bash
curl http://127.0.0.1:8000/api/health
```

Die Anwendung legt die lokale Datenbank unter `data/ttc.db` an. Erstellte
Rechnungs-PDFs werden unter `rechnungen/` gespeichert.

## Tests

Mit aktivierter virtueller Umgebung:

```bash
python -m pytest
```

Die Tests verwenden temporäre Datenbanken und Dateien; die lokale
Produktivdatenbank wird dafür nicht benötigt.

## Optionale Datenbanksicherung

Auf einem Linux-System mit systemd kann der wöchentliche Benutzer-Timer einmalig
eingerichtet werden:

```bash
./.venv/bin/python scripts/install_backup_timer.py
```

Eine Sicherung lässt sich auch manuell erstellen:

```bash
./.venv/bin/python scripts/backup_database.py
```

Der Backup-Prozess prüft die Sicherung auf SQLite-Konsistenz und setzt für
Backup-Ordner und -Dateien restriktive Rechte. Die PDF-Dateien im Ordner
`rechnungen/` werden von diesem Backup-Skript nicht mitgesichert.

## Projektstruktur

```text
backend/       FastAPI-Anwendung, Datenbank, Modelle und Rechnungslogik
frontend/      HTML-Oberfläche, Stylesheets und JavaScript-Module
scripts/       Datenbank-Backup und systemd-Timer
tests/         Automatisierte Tests
data/          Lokale Laufzeitdatenbank (nicht versioniert)
rechnungen/    Generierte Rechnungs-PDFs (nicht versioniert)
requirements.txt
TTC_Rechnungsverwaltung_Umsetzungsplan.md
```

## Datenschutz und Sicherheit

Die Datenbank und Rechnungen können personenbezogene, steuerliche und
Bankinformationen enthalten. Sie sind Laufzeitdaten und gehören nicht in Git,
Screenshots oder öffentliche Beispiele. Die Regeln in `.gitignore` schützen
nicht vor bereits versionierten Dateien; vor einer Veröffentlichung ist daher
zusätzlich der Git-Index zu prüfen.

Die Anwendung stellt derzeit keine Anmeldung oder Rollen-/Rechteverwaltung
bereit. Den Server nur lokal betreiben und nicht ungeschützt an eine
Netzwerkschnittstelle oder einen öffentlich erreichbaren Proxy binden. Die
Anwendung erzwingt momentan keine restriktiven Dateirechte für die Laufzeit-
Datenbank und die erzeugten PDFs; diese Dateien sollten auf gemeinsam
genutzten Systemen zusätzlich auf Betriebssystemebene geschützt werden.

Die Abhängigkeiten sind in `requirements.txt` aufgeführt; derzeit gibt es
keine Lockdatei mit festgeschriebenen Paketversionen.

---

# TTC Invoice Management

A local web application for managing training sessions and creating monthly
invoices for a table-tennis club. It combines a FastAPI backend, a browser-based
interface, SQLite persistence, and PDF invoice generation.

> **Portfolio note:** The application does not currently provide user accounts
> or authentication. It is intended for local use and must not be exposed to a
> network or the Internet without additional access controls.

## Features

- Manage activity types and hourly rates.
- Maintain a weekly training plan and plan, edit, cancel, and complete
  sessions individually or in bulk in a monthly calendar.
- Review completed billable sessions for a month and refresh its saved
  preview. Final invoices are generated as PDFs and remain unchanged.
- Manage invoice settings, including issuer, recipient, payment details, and
  an optional logo.
- Browse saved invoices with immutable line-item and settings snapshots.
- Apply versioned SQLite migrations and create optional systemd backups.

## Technology and architecture

- **Backend:** Python, FastAPI, and Pydantic for REST endpoints and validation.
- **Persistence:** SQLite with versioned database migrations.
- **Frontend:** HTML, CSS, and native JavaScript ES modules.
- **PDF:** ReportLab.
- **Tests:** pytest for the API, database, invoices/PDFs, and backups; some
  calendar and billing flows are covered by API tests.

The FastAPI backend serves the frontend, which communicates with it through the
API. There is no separate frontend build pipeline.

## Requirements

- Python 3.10 or newer
- `pip`

The commands below are for Linux/macOS. On Windows, activate the virtual
environment with `.venv\Scripts\activate`.

## Install and run

```bash
git clone https://github.com/macfloorball/Rechnungsverwaltung.git
cd Rechnungsverwaltung
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --host 127.0.0.1
```

Open <http://127.0.0.1:8000>. The development server is explicitly bound to
the loopback interface. A health check is available at:

```bash
curl http://127.0.0.1:8000/api/health
```

The application creates its local database at `data/ttc.db` and stores
generated invoice PDFs in `rechnungen/`.

## Tests

With the virtual environment activated, run:

```bash
python -m pytest
```

Tests use temporary databases and files; they do not require the local
application database.

## Optional database backups

On Linux with systemd, install the weekly user timer once:

```bash
./.venv/bin/python scripts/install_backup_timer.py
```

Create a backup manually with:

```bash
./.venv/bin/python scripts/backup_database.py
```

The backup process checks SQLite integrity and applies restrictive permissions
to the backup directory and files. It does not include PDF files from
`rechnungen/`.

## Privacy and security

The database and invoices may contain personal, tax, and banking information.
They are runtime data and must not be committed to Git or included in
screenshots or public examples. `.gitignore` does not untrack files that are
already committed, so check the Git index separately before publishing.

The application currently has no login or role-based access control. Keep the
server local and do not expose it unprotected through a network interface or
public proxy. The application does not currently enforce restrictive
permissions on its runtime database or generated PDFs; protect these files at
the operating-system level, especially on shared machines.

Dependencies are listed in `requirements.txt`; package versions are not
currently pinned in a lockfile.

## Electron: Oberfläche laden

Node.js ab 22.12 und npm zusätzlich zur bestehenden Python-Umgebung:

```bash
npm ci
npm run desktop:check
```

Entwicklung in zwei Terminals (aus dem Repository, Python-Umgebung aktiviert):

```bash
# Terminal 1: unveränderter Webentwicklungsstart
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
# Terminal 2
npm run desktop:dev
```

Die Webanwendung bleibt unter `http://127.0.0.1:8000` unabhängig im Browser
nutzbar. Electron wartet bis zu 15 Sekunden auf Oberfläche, Ressourcen und
`/api/health`, bevor es das Hauptfenster erstellt. Bei fehlendem Server erscheint
eine verständliche Fehlermeldung. Der Server wird weiterhin separat gestartet.

Produktionsausgabe: Da das Frontend natives HTML/CSS/JavaScript verwendet,
kopiert der Build die Dateien unverändert nach `dist/frontend` und erzeugt eine
Build-Kennung. Der vorhandene FastAPI-Server liefert diese Dateien und die API
aus; es wird weder ein Bundler noch ein zusätzlicher Server eingeführt.

```bash
npm run frontend:build
# Terminal 1: ohne Entwicklungsserver/Auto-Reload
TTC_FRONTEND_DIRECTORY=dist/frontend python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
# Terminal 2
npm run desktop:start
```

PowerShell für den Produktionsserver:

```powershell
$env:TTC_FRONTEND_DIRECTORY = "dist/frontend"
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

`TTC_FRONTEND_DIRECTORY` wird relativ zum Repository aufgelöst (absolute Pfade
sind ebenfalls möglich). Ohne diese Variable bleibt `frontend/` der Webstandard.
Electron kontrolliert im Produktionsmodus, ob der lokale Build existiert und der
Server dessen Build-Kennung ausliefert. Nach Frontend-Änderungen erneut bauen.
Ein Installer oder ein vollständiges Produktionspaket wird noch nicht erstellt.

Die Adresse steht zentral in `electron/config.cjs` (Standard: Loopback, Port 8000).
Für einen abweichenden Serverport in Terminal 2:

```bash
TTC_DESKTOP_URL=http://127.0.0.1:8123 npm run desktop:dev
```

PowerShell: `$env:TTC_DESKTOP_URL = "http://127.0.0.1:8123"`, anschließend
`npm run desktop:dev` oder `npm run desktop:start`. Die Variable akzeptiert nur
HTTP-Origins mit `127.0.0.1` oder `[::1]`, ohne Pfad, Zugangsdaten oder Query.
Der Backend-Port muss dazu passen. Es gibt kein clientseitiges Routing;
Abschnittsanker und Neuladen der Startseite funktionieren über dieselbe Origin.

Main steuert den Lebenszyklus, `window.cjs` schützt das Fenster und Preload
veröffentlicht nur `ttcDesktop.apiVersion`. Sandbox und Context Isolation bleiben
aktiv, Node-Integration bleibt deaktiviert. Fremde Navigation und neue Fenster
werden blockiert. Es gibt keine benötigten externen Webseiten mit Browserfreigabe;
unbekannte URLs werden nicht automatisch geöffnet. PDF-Popups bleiben einer
späteren Desktop-Integration vorbehalten. Native Windows-Abnahme steht noch aus.

## Entpackter Windows-Testbuild

```bash
npm ci
npm run desktop:build:win
```

Ausgabe: `dist/windows/TTC Rechnungsverwaltung-win32-x64/` mit
`TTC Rechnungsverwaltung.exe`. Der gesamte Ordner gehört zum Testbuild;
Build-Artefakte sind per `.gitignore` ausgeschlossen. Es gibt noch keinen
Installer, keine Signatur und keinen automatischen Updateprozess.

**Phase-1-Testbuild: Python-Laufzeit und Python-Pakete sind noch nicht eingebettet.**
Electron startet den lokalen Backend-Prozess jetzt selbst, wartet auf dessen
Bereitschaft und beendet ihn beim Schließen kontrolliert. Ein separat manuell
gestarteter Server ist für die EXE nicht erforderlich und würde den Port belegen.

Zum Testen den gesamten Build-Ordner an einen beschreibbaren Ort kopieren.
Python ab 3.10 vorausgesetzt, einmalig im Unterordner `resources/app`
eine Testumgebung einrichten (PowerShell):

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Danach `TTC Rechnungsverwaltung.exe` im Hauptordner starten. Die Anwendung
findet `resources/app/.venv/Scripts/python.exe` automatisch. Alternativ lässt
sich der absolute Interpreterpfad über `TTC_PYTHON` vorgeben. Externes Python
und dessen Pakete sind Voraussetzungen dieses Testbuilds, nicht mitgelieferte
Laufzeitkomponenten. Node.js oder npm werden zum Start der EXE nicht benötigt.

Standardadresse ist `http://127.0.0.1:8000/`. Bei einem abweichenden Port
`TTC_DESKTOP_PRODUCTION_URL` vor dem EXE-Start auf eine andere Loopback-Origin
setzen. Belegte Ports werden abgelehnt; vorhandene fremde Server werden
nicht übernommen oder beendet. Wiederholtes Starten aktiviert die bestehende
Electron-Instanz, statt einen zweiten Backend-Prozess zu starten.

Der Build enthält Frontend, Electron-Module, Backend-Quellcode,
`scripts/run.cjs`, `scripts/managed_server.py` und `requirements.txt`.
Vorhandene `.venv`-Ordner, Python-Pakete, Datenbanken und Rechnungen werden
nicht eingepackt. Tests ausschließlich mit neu angelegten Testdaten durchführen:
Die bisherigen Datenpfade bleiben unverändert (`resources/app/data/ttc.db`
und `resources/app/rechnungen/`). Eine updatefeste Datenablage sowie ein
vollständiges Paket mit eingebetteter Python-Laufzeit und Abhängigkeiten sind
spätere Arbeiten; dieser Testbuild ist noch nicht eigenständig verteilbar.

Nach Installation der Abhängigkeiten benötigen die vorhandenen Fachfunktionen
keine externen Dienste, aber weiterhin das von Electron gestartete lokale
Backend. Erstinstallation und Paketierung benötigen Downloads. Der Build
kann unter Linux erzeugt und statisch geprüft werden; die native Ausführung,
Python-Erkennung und Prozessbeendigung müssen zusätzlich auf einem echten
Windows-System abgenommen werden.
