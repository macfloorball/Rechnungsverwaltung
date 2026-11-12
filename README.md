# TTC Rechnungsverwaltung

Eine lokale Webanwendung mit zusätzlichem Electron-Desktop-Grundgerüst zur
Verwaltung von Trainingsterminen und zur Erstellung monatlicher Rechnungen
für einen Tischtennisverein. Das Projekt
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
- **Desktop:** Electron mit lokalem Python-/Uvicorn-Prozess, sicherem Preload
  und begrenzter IPC-Schnittstelle.
- **Tests:** pytest für API, Datenbank, Rechnungen/PDFs und Backups;
  Kalender- und Abrechnungsabläufe werden teilweise über API-Tests geprüft.

Das Frontend wird vom FastAPI-Backend ausgeliefert und kommuniziert mit ihm
über die API. Es gibt keinen Frontend-Bundler; für den Desktop-Produktionsstart
kopiert `npm run frontend:build` die Dateien nach `dist/frontend`.

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
electron/      Main, Preload, IPC, Fensterkonfiguration und Icons
scripts/       Start-/Prozessverwaltung, Build-Werkzeuge, Backups und Timer
Planung/       Umsetzungspläne und bestehende Bestandsaufnahme
dist/          Generierte Frontend- und Windows-Builds (nicht versioniert)
tests/         Automatisierte Tests
data/          Lokale Laufzeitdatenbank (nicht versioniert)
rechnungen/    Generierte Rechnungs-PDFs (nicht versioniert)
requirements.txt
Planung/TTC_Rechnungsverwaltung_Umsetzungsplan.md
Planung/Umsetzungsplan_Desktop-App_Rechnungsautomatisierung.md
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

Python-Abhängigkeiten stehen in `requirements.txt` und sind bisher nicht
versionsgebunden. Die zusätzlichen JavaScript-Abhängigkeiten sind über
`package-lock.json` festgeschrieben.

---

# TTC Invoice Management

A local web application with an additional Electron desktop shell for managing
training sessions and creating monthly invoices for a table-tennis club. It combines a FastAPI backend, a browser-based
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
API. There is no frontend bundler; `npm run frontend:build` copies the static
files to `dist/frontend` for desktop production mode.

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

Python dependencies are listed in `requirements.txt` and are not currently
pinned. JavaScript dependencies are locked in `package-lock.json`. Electron
owns the local Python backend during desktop use; Python and its packages
are still external prerequisites of the Phase 1 Windows test build. Native
Windows execution has not yet been verified.

## Electron: Entwicklung und Produktionsstart

Der Desktop-Start benötigt Python mit den Paketen aus `requirements.txt`.
Zum Entwickeln, Testen und Bauen zusätzlich Node.js ab 22.12 und npm:

```bash
npm ci
npm run desktop:check
```

Aus dem Repository starten:

| Betriebsart | Befehl | Prozessbesitz / Frontend |
| --- | --- | --- |
| Web ohne Reload | `npm run web:start` | Starter verwaltet Uvicorn; Quellfrontend, Browser separat öffnen |
| Webentwicklung | `npm run web:dev` | Starter verwaltet Uvicorn mit Reload; Quellfrontend |
| Desktop-Entwicklung | `npm run desktop:dev` | Starter startet nur Electron; Electron besitzt Backend mit Reload und lädt Quellfrontend |
| Frontend bauen | `npm run frontend:build` | Kopie der statischen Dateien mit Build-Kennung nach `dist/frontend` |
| Desktop-Produktion | `npm run desktop:start` | Electron besitzt Backend ohne Reload und lädt `dist/frontend` |
| Windows-Testbuild erzeugen | `npm run desktop:build:win` | Erzeugt zuerst Frontend-Build, dann entpackten Windows-x64-Testbuild |

Für die Desktop-Entwicklung ist nur **ein** Startbefehl erforderlich:

```bash
npm run desktop:dev
```

Für den Produktionsmodus im Checkout:

```bash
npm run frontend:build
npm run desktop:start
```

Keinen zweiten Uvicorn-Server parallel auf demselben Port starten. Electron
startet seinen Server selbst, wartet bis zu 15 Sekunden auf Oberfläche,
Ressourcen und `/api/health` und erstellt erst danach das Hauptfenster.
Im Produktionsmodus muss die ausgelieferte Build-Kennung zur lokalen Ausgabe
passen. Nach Frontend-Änderungen erneut bauen.

Die im Repository vorhandene `.venv` wird automatisch verwendet; alternativ
`TTC_PYTHON` auf den Interpreter setzen. Ohne beides wird `python` unter Windows
beziehungsweise `python3` auf anderen Plattformen gesucht. Fehlende Interpreter,
Pakete, Builds und belegte Ports führen zu einer Startfehlermeldung.
Die bestehende Webanwendung bleibt zusätzlich über den oben beschriebenen
direkten Befehl `python -m uvicorn backend.main:app ...` startbar.

### Konfiguration

Standard ist `http://127.0.0.1:8000/`, zentral in `electron/config.cjs`.

| Variable | Verwendung |
| --- | --- |
| `TTC_DESKTOP_URL` | Adresse für Desktop- und Webentwicklung |
| `TTC_DESKTOP_PRODUCTION_URL` | Getrennte Adresse für Desktop-Produktion, EXE und `web:start`; ignoriert den Entwicklungswert |
| `TTC_PYTHON` | Optionaler Interpreterpfad, vorzugsweise absolut |
| `TTC_FRONTEND_DIRECTORY` | Frontend-Pfad beim direkten Uvicorn-Webstart; verwaltete Startmodi setzen ihn selbst |

Zulässig sind nur HTTP-Origins mit `127.0.0.1` oder `[::1]`, optionalem Port,
ohne Zugangsdaten, Pfad, Query oder Fragment. Beispiel Linux/macOS:

```bash
TTC_DESKTOP_URL=http://127.0.0.1:8123 npm run desktop:dev
TTC_DESKTOP_PRODUCTION_URL=http://127.0.0.1:8124 npm run desktop:start
```

PowerShell:

```powershell
$env:TTC_DESKTOP_URL = "http://127.0.0.1:8123"
npm run desktop:dev
```

Für Produktion stattdessen `$env:TTC_DESKTOP_PRODUCTION_URL` setzen.
`TTC_FRONTEND_DIRECTORY` beim direkten Webstart wird relativ zum Repository
aufgelöst; absolute Pfade sind ebenfalls möglich. Ohne Variable gilt `frontend/`.

### Fenster, Sicherheit und Beenden

App-Name und Fenstertitel sind **TTC Rechnungsverwaltung**. Das Fenster startet
mit 1280 × 800, mindestens 1000 × 650; auf kleineren Arbeitsflächen werden
beide Werte begrenzt. Minimieren, Wiederherstellen und Maximieren sind nativ.
Electron-Profile behalten den bisherigen technischen Namen; Rechnungsdaten
werden dadurch nicht verschoben.

Sandbox, Context Isolation und CSP sind aktiv, Node-Integration und unnötige
Berechtigungen deaktiviert. Preload stellt nur `ttcDesktop.apiVersion` und den
lesenden Aufruf `ttcDesktop.getVersion()` bereit. Der Main-Prozess validiert
IPC-Absender, Hauptframe, URL und Argumente. Es gibt kein clientseitiges Routing;
Abschnittsanker und Neuladen bleiben auf der lokalen Oberfläche.

Unbekannte URLs und neue Electron-Fenster werden blockiert. Nur validierte
lokale Rechnungs-PDF-Endpunkte werden an den Standardbrowser übergeben.
Downloads und PNG-/JPEG-Logo-Uploads nutzen die vorhandenen Browserabläufe.
Für einen neuen PDF-Abruf muss der lokale Server noch laufen; nach Schließen
der App steht ihr eigener Backend-Dienst nicht mehr zur Verfügung.

Unter Windows/Linux beendet das letzte geschlossene Hauptfenster die App.
Electron fordert über eine private Pipe den kontrollierten Backend-Shutdown
an und wartet auf dessen Abschluss. Nur eigene Prozessreferenzen werden
bereinigt; fremde Server bleiben erhalten. Bei hartem Main-Prozessabbruch
fordert das Pipe-Ende ebenfalls den Shutdown an. Ein blockierter Dienst kann
nach begrenzter Wartezeit mit protokollierter Warnung erzwungen beendet werden;
ein unterbrochener Datenvorgang ist dabei nicht vollständig auszuschließen.
Ungespeicherte Formulareingaben werden nicht zuverlässig erkannt oder geschützt.

Unter macOS kann die App nach Schließen des letzten Fensters aktiv bleiben
und bei Aktivierung ein neues Hauptfenster öffnen; native macOS-Abnahme offen.
Windows-Einzelausführung und -Prozessbeendigung sind ebenfalls noch offen.
Den tatsächlichen Phase-1-Abnahmestand beschreibt der
[Desktop-Umsetzungsplan](Planung/Umsetzungsplan_Desktop-App_Rechnungsautomatisierung.md#phase-1----desktop-grundgerüst).

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

## Datenzugriff und Transaktionsgrenzen

Das Frontend verwendet ausschließlich die lokale REST-API. SQLite wird im
Python-Backend verwendet; Electron und der PDF-Renderer berechnen keine
Datenbankabfragen. Die dauerhaften Tabellen sind `organizations`,
`activity_types`, `weekly_plan`, `trainings`, `invoices` und `invoice_items`.
`schema_migrations` speichert den angewendeten Schemastand.

`backend/database.py` enthält CRUD, Organisationseinstellungen und atomare
Rechnungsoperationen. Finalisierung speichert Rechnung, Positionen und
Nummernkreis gemeinsam; Vorschauaktualisierung ersetzt die Positionen in einer
Transaktion. Fremdschlüssel schützen Zuordnungen und löschen Rechnungspositionen
mit ihrer Rechnung. Kalendererzeugung ordnet Wochenplanvorkommen eindeutig zu.
Preis-, Einstellungs- und Logo-Snapshots erhalten historische Rechnungsdaten.
PDF-Dateien sind eigenständige Dateien; ihre Erzeugung und SQLite-Transaktionen
bilden keine gemeinsame atomare Operation.
