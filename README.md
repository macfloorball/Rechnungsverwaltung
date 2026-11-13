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
Rechnungs-PDFs werden ohne Pfad-Overrides unter `rechnungen/` gespeichert.
Mit `TTC_DATA_DIRECTORY` liegen Datenbank und PDFs unter diesem Datenverzeichnis
als `ttc.db` beziehungsweise in `documents/`; dies ist auch der Desktop-Modus.
`TTC_DOCUMENT_DIRECTORY` kann die PDF-Ablage unabhängig davon überschreiben.

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
Backup-Ordner und -Dateien restriktive Rechte. Die PDF-Dateien unter
`rechnungen/` beziehungsweise `documents/` werden von diesem Backup-Skript nicht
mitgesichert.

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
generated invoice PDFs in `rechnungen/` by default. With `TTC_DATA_DIRECTORY`,
including desktop mode, it uses `ttc.db` and `documents/` inside that directory.
`TTC_DOCUMENT_DIRECTORY` optionally overrides the PDF directory independently.

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
`rechnungen/` or `documents/`.

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
| `TTC_DATA_DIRECTORY` | Absolutes Verzeichnis für `ttc.db`; Desktop-Standard: Electron-`userData`, Web-Standard: `data/` im Projekt |
| `TTC_DOCUMENT_DIRECTORY` | Optionales absolutes Dokumentenverzeichnis, unabhängig von SQLite; ohne Override `documents/` im Desktop-Datenverzeichnis bzw. `rechnungen/` im Webbetrieb ohne Datenpfad-Override |
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
Electron-Profile behalten den bisherigen technischen Namen. Die Desktop-Datenbank
liegt als `ttc.db` im Electron-`userData`-Verzeichnis:
Windows `%APPDATA%/ttc-rechnungsverwaltung`, Linux
`${XDG_CONFIG_HOME:-~/.config}/ttc-rechnungsverwaltung`, macOS
`~/Library/Application Support/ttc-rechnungsverwaltung`. Ein explizites
`TTC_DATA_DIRECTORY` überschreibt diesen Ort. Die Web-Startmodi behalten ohne
Override `data/ttc.db`. Entwicklung und Produktion nutzen dasselbe Desktop-Profil;
für isolierte Tests ein separates absolutes Datenverzeichnis setzen.

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
Desktop-Datenbank und PDFs liegen außerhalb des Builds im Benutzerprofil
als `ttc.db` beziehungsweise unter `documents/`. Ein
vollständiges Paket mit eingebetteter Python-Laufzeit und Abhängigkeiten bleibt
offen; dieser Testbuild ist noch nicht eigenständig verteilbar.

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

### Persistenzentscheidung

SQLite bleibt die maßgebliche lokale Datenquelle für Organisation und den einen
Rechnungsempfänger, Bank-/Steuerdaten, Texte, Nummernkreis und Logos, Tätigkeiten
mit Preisen, Wochenplan, Termine samt Status und Preissnapshot sowie Entwürfe,
finale Rechnungen und deren Positions-/Einstellungs-/Logo-Snapshots. Es werden
keine neue Kundentabelle, Benutzerkonten oder Cloud-Datenhaltung eingeführt.
Geldbeträge bleiben ganzzahlige Centwerte; optionale Stunden und bestehende IDs,
Fremdschlüssel und JSON-/BLOB-Snapshots bleiben erhalten.

PDF-Inhalte bleiben außerhalb von SQLite. Die Datenbank enthält weiterhin ihre
Dateizuordnung; die Dokumentenpfade sind seit Phase 3 zentral aufgelöst.
Electron-Profile und Fensterzustand gehören nicht ins fachliche Schema.

### Dokumentenverzeichnis (Phase 3, Schritt 1)

Für die Desktop-App wird `documents/` unterhalb des bestehenden lokalen
Datenverzeichnisses als Dokumentenablage festgelegt. Maßgeblich ist der von
`backend/paths.py` ermittelte Datenordner: Electron übergibt standardmäßig
`app.getPath('userData')`; ein absolutes `TTC_DATA_DIRECTORY` bestimmt bereits
heute einen abweichenden Datenordner. Die seit Schritt 4 verwendeten Desktop-Pfade lauten:

| Inhalt | Pfad relativ zum Datenverzeichnis |
| --- | --- |
| SQLite-Datenbank (bereits umgesetzt) | `ttc.db` |
| Rechnungs-PDFs | `documents/` |
| Weitere dateibasierte Anhänge (Zielablage, soweit vorhanden) | `documents/` |

Unter Windows ist die Standard-Zielablage somit
`%APPDATA%/ttc-rechnungsverwaltung/documents/`. Sie liegt außerhalb der
Installation und bleibt bei unverändertem Benutzerprofil unabhängig von
Installationspfad, Arbeitsverzeichnis und App-Version. Entwicklung und Produktion
teilen wie bei der Datenbank dasselbe Profil; Tests verwenden temporäre
Datenverzeichnisse. Logos und Rechnungssnapshots bleiben gemäß Phase 2 in SQLite.
Eine konkrete Zuordnungs- oder Unterordnerstruktur für weitere Anhänge wird hier
nicht eingeführt.

Für den bisherigen Webbetrieb ohne `TTC_DATA_DIRECTORY` bleibt die Ablage
`rechnungen/` im Projekt erhalten. Bei explizitem `TTC_DATA_DIRECTORY` verwendet
auch der Webbetrieb dessen Unterordner `documents/`. Das Backend nutzt
in beiden Startarten dieselbe Pfadauflösung. Ein unabhängig einstellbarer
Dokumentenort ist seit Schritt 5 über `TTC_DOCUMENT_DIRECTORY` verfügbar.

Schritt 1 hat ausschließlich diese Verzeichnisentscheidung dokumentiert. Die
Anbindung an die Rechnungs-API und die schonende Übernahme der bisherigen
Rechnungsdateien sind seit Schritt 4 umgesetzt und unten beschrieben.

### Zentraler Dokumentendienst (Phase 3, Schritt 2)

`backend/document_storage.py` stellt `DocumentStore` bereit. Er kennt weder
SQLite noch FastAPI oder Rechnungsregeln. `save_new()` legt Dateien exklusiv an;
vorhandene Dateien und symbolische Links werden nicht überschrieben. Bei einem
Schreibfehler wird die neu angelegte unvollständige Datei nach dem Schließen
entfernt. `get_file()` liefert nur vorhandene reguläre Dateien, keine symbolischen
Links. Dokumentreferenzen müssen einfache Dateinamen sein; Verzeichnisbestandteile,
absolute Pfade und Windows-Datenstromreferenzen werden abgelehnt. Dateisystemfehler
werden an den Aufrufer weitergereicht.

Ohne explizites Verzeichnis nutzt der Dienst `get_document_directory()` aus
`backend/paths.py`: zuerst `TTC_DOCUMENT_DIRECTORY`, andernfalls mit
`TTC_DATA_DIRECTORY` dessen Unterordner `documents/`, sonst das bisherige
Webverzeichnis `rechnungen/`. Die Auflösung legt keine Ordner an;
erst das Speichern oder Übernehmen erzeugt die Ablage. Der Pfad wird pro Dienstinstanz absolut
aufgelöst und bleibt bei einem Wechsel des Arbeitsverzeichnisses stabil.

Die Rechnungs-API nutzt den Dienst zum Schreiben und Auffinden von PDFs. Seit
Schritt 4 erhält sie ihr Verzeichnis aus der zentralen Pfadauflösung; in Schritt 2
wurde zunächst noch die bisherige Ablage übergeben.

### Eindeutige Dokumentenzuordnung (Phase 3, Schritt 3)

Die bestehende Zuordnung bleibt erhalten: Eine finale Rechnung besitzt über
`invoices.pdf_path` den einfachen Dateinamen
`Rechnung_TTC_YYYY-MM.pdf` ihres Abrechnungszeitraums. Die vorhandene Fachlogik
erlaubt eine finale Rechnung pro Zeitraum. Vorschauen besitzen keine gespeicherte
PDF-Zuordnung; ihre Rechnungsdaten und Positionen werden weiterhin in SQLite verwaltet.

`backend/invoice_documents.py` prüft für den PDF-Abruf und vor dem Löschen einer
Rechnung, ob der Dateiverweis zum Zeitraum gehört und ausschließlich dieser
finalen Rechnung zugeordnet ist. Auch abweichende Groß-/Kleinschreibung in weiteren
Verweisen gilt wegen der Windows-Dateisystemsemantik als Konflikt. Ein ungültiger
oder mehrdeutiger Verweis erlaubt keinen PDF-Abruf und verhindert das Löschen der
Rechnung. Es erfolgt keine automatische Reparatur oder Änderung des Altbestands.
Eine Finalisierung lehnt bereits vergebene Dateiverweise innerhalb derselben
SQLite-Transaktion ab, bevor Vorschau oder Nummernkreis geändert werden.

Logos bleiben als `organizations.logo_data` der Organisation zugeordnet; finale
Rechnungen behalten ihren eigenen `logo_snapshot` samt Medientyp. Eine Änderung
des aktuellen Logos verändert diese Rechnungssnapshots nicht. Das bisherige
`logo_path` wird beim Logo-Upload geleert und nicht als Dateianhang geöffnet.
Weitere frei hochladbare Anhänge sind bisher nicht implementiert und werden in
diesem Schritt nicht eingeführt. Dateinamen und Schemaversion bleiben unverändert;
die zentrale Umstellung des Ablageverzeichnisses ist in Schritt 4 umgesetzt.

### Zentrale Dokumentenpfade und Bestandsübernahme (Phase 3, Schritt 4)

`backend/paths.py` legt sowohl das aktive Dokumentenverzeichnis als auch die
bisherige Ablage `rechnungen/` der laufenden Installation fest. Die Rechnungs-API
verwendet `get_document_directory()` für Erstellen, Abrufen und Löschen von PDFs.
Es gibt keinen zusätzlichen Pfad im Electron-Renderer oder im PDF-Generator.

Nach der Datenbankvorbereitung übernimmt `prepare_invoice_documents()` beim
Backend-Start fehlende PDFs aus der bisherigen Ablage in das aktive Verzeichnis.
Nur eindeutig zugeordnete finale Rechnungen mit passendem Dateinamen werden
berücksichtigt. Vorschauen, ungültige oder mehrdeutige Verweise und nicht
zugeordnete Dateien werden nicht übernommen. Fehlende Quelldateien bleiben
fehlend; der PDF-Abruf meldet weiterhin HTTP 404. Im Webbetrieb ohne Override
sind Quelle und Ziel identisch, sodass keine Kopie nötig ist.

Vorhandene reguläre Zieldateien sind maßgeblich und werden weder überschrieben
noch mit der Quelle zusammengeführt. Die Quelle wird ausschließlich gelesen und
bleibt auch nach erfolgreicher Übernahme unverändert. `copy_missing_from()`
erstellt eine temporäre Kopie im Zielverzeichnis und veröffentlicht sie erst
vollständig per Hardlink ohne Überschreiben. Bei Schreibfehlern bleibt keine
teilweise veröffentlichte PDF zurück. Auch ein zwischenzeitlich angelegtes Ziel
bleibt erhalten. Symbolische Links werden nicht als Dokumentdateien übernommen.
Bei Übernahmefehlern bricht der Backend-Start ab; nach Behebung kann erneut
gestartet werden. Das Zieldateisystem muss Hardlinks unterstützen.

Die Übernahme ändert weder Datenbankreferenzen noch Rechnungsinhalte. Nach der
Übernahme funktionieren Neustart und Austausch der Installation mit demselben
Datenverzeichnis auch ohne den alten Installationsordner. Einen alten Build
erst entfernen, wenn die zugehörigen PDFs vollständig übernommen oder separat
gesichert sind. Ein externer Datenbankimport allein überträgt weiterhin keine
PDFs: Liegen sie außerhalb der bisherigen Ablage der laufenden Installation,
müssen die zu dieser Datenbank gehörenden Dateien bewusst bereitgestellt werden.
Es wird kein Dateiverzeichnis aus einem beliebigen Datenbankpfad abgeleitet.

### Einstellbarer Dokumentenspeicherort (Phase 3, Schritt 5)

`TTC_DOCUMENT_DIRECTORY` bestimmt einen eigenen absoluten Dokumentenordner für
Desktop- und Webstart. Die SQLite-Datei bleibt am bisherigen Datenbankpfad.
Leere, nur aus Leerzeichen bestehende oder relative Werte werden beim Start
abgelehnt. Ohne diese Variable bleibt die Standardablage unverändert. Die
Konfiguration nutzt wie die vorhandenen Startoptionen die Umgebung; es gibt
hierfür keinen zusätzlichen Einstellungsdialog.

Beispiel unter Windows in PowerShell, vor dem App-Start:

```powershell
$env:TTC_DOCUMENT_DIRECTORY = "D:\TTC Dokumente"
npm run desktop:start
```

Unter Linux beispielsweise:

```bash
TTC_DOCUMENT_DIRECTORY="/absoluter/Pfad/TTC Dokumente" npm run desktop:start
```

Einen lokalen Ordner außerhalb der Installation wählen. Bei jedem Start muss
dieselbe Konfiguration gelten; für EXE-Starts unter Windows kann die Variable
dauerhaft als Windows-Benutzervariable eingerichtet werden. Die App danach
vollständig neu starten. Die Einstellung wird nicht in SQLite geschrieben.

Beim Start werden fehlende, eindeutig zugeordnete PDFs zuerst aus der bisherigen
Standardablage (`documents/` im Datenverzeichnis beziehungsweise `rechnungen/`
im Webbetrieb ohne Datenpfad-Override) übernommen. Anschließend wird die alte
Installationsablage berücksichtigt. Bestehende Zieldateien haben Vorrang; alle
Quellen bleiben unverändert. Es gelten die oben beschriebenen Regeln zur
Übernahme einschließlich der Hardlink-Unterstützung im Ziel.

Beim Wechsel von einem eigenen Ordner zu einem anderen oder zurück zum Standard
App und Backend zuerst beenden. Die zu dieser Datenbank gehörenden PDFs aus dem
bisher aktiven Ordner im gewünschten Ziel bereitstellen, vorhandene gleichnamige
Dateien vorab prüfen und nicht ungeprüft überschreiben. Erst anschließend die
Variable ändern beziehungsweise entfernen, neu starten und die PDFs prüfen.
Eigene frühere Ordner werden nicht automatisch gesucht oder verschoben. Quellen
erst nach vollständiger Prüfung beziehungsweise separater Sicherung entfernen.

### PDF-Abläufe in Electron prüfen (Phase 3, Schritt 6)

`tests/test_desktop_invoice.py` prüft die vorhandenen Abläufe mit echten
Electron-Fenstern, Preload, Renderer und dem von Electron gestarteten Python-Backend.
Der Test kopiert die App in temporäre Verzeichnisse und verwendet ausschließlich
neue Testdaten und isolierte Profile. Entwicklung wird mit Standardablage,
Produktion mit gebautem Frontend und eigenem Dokumentenordner geprüft.

Geprüft werden die sichtbare HTML-Rechnungsvorschau, der Ausschluss geplanter
Termine, die Finalisierung, PDF-Abruf mit passenden HTTP-Headern, der tatsächliche
Electron-Download und der bytegleiche Inhalt der gespeicherten PDF. Eine neue
Vorschau verändert die finale PDF nicht. Nach Neuladen wird die Rechnung über
das Archiv geöffnet. Der Test prüft außerdem Sandbox, Context Isolation und die
beschränkte Preload-Bridge. Browserübergaben werden ausschließlich im Test
abgefangen; die produktive URL-Validierung bleibt aktiv.

Voraussetzungen: installierte Projektabhängigkeiten, eine grafische Sitzung und
eine Umgebung, die lokale Loopback-Verbindungen sowie Electron-Prozesse erlaubt.
Die Tests werden ohne ausdrückliche Aktivierung übersprungen:

```bash
TTC_RUN_ELECTRON_TESTS=1 python -m pytest -q -s tests/test_desktop_invoice.py
```

PowerShell:

```powershell
$env:TTC_RUN_ELECTRON_TESTS = "1"
python -m pytest -q -s tests/test_desktop_invoice.py
```

Die ausgegebenen temporären Artefaktverzeichnisse enthalten Vorschau-Screenshot,
Test-PDF und Download. Unter Linux wurden beide Modi ohne Abschalten der
Electron-Sandbox geprüft. Die HTML-Vorschau läuft im Electron-Fenster; finale
PDFs werden gemäß bestehender Architektur an den Standardbrowser übergeben.
Der Test ersetzt weder die native Windows-Abnahme noch die manuelle Kontrolle
der PDF-Darstellung und des Druckdialogs im tatsächlichen Standardbrowser.

Falls `node`/`npm` fehlen, die vorhandene Electron-Abhängigkeit aber installiert
ist, kann ihre eingebettete Node-Laufzeit unter Linux für die JavaScript-Tests
verwendet werden:

```bash
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test --test-isolation=none electron/*.test.cjs scripts/*.test.cjs
```

### Schemaänderungen

Die bestehenden Migrationen 1–6 bleiben unverändert in ihrer fachlichen Wirkung.
Der Starter prüft Integrität und eine lückenlose Versionsfolge, bevor er das
Schema verändert. Neuere Schemastände werden abgelehnt; ein Downgrade führt keine
Rückmigration aus. Jeder Migrationsschritt schreibt seinen Versionsmarker erst
mit erfolgreichem Commit. Bei einem Fehler wird der laufende Schritt verworfen;
der nächste Start kann nach Behebung ab der letzten bestätigten Version fortsetzen.

Vor Änderungen an einer vorhandenen Datenbank erzeugt SQLite eine konsistente,
eindeutig benannte `ttc.db.before-migration-*.sqlite3` neben der Datenbank.
Diese Wiederherstellungskopien werden nicht automatisch überschrieben oder rotiert.
Zur Rückkehr App und Backend vollständig beenden, den aktuellen Bestand samt
SQLite-Begleitdateien separat sichern und eine passende Kopie mit der dazugehörigen
älteren App-Version verwenden. Keine SQLite-Dateien während des Betriebs ersetzen.
Diese Kopien enthalten keine PDFs und ersetzen kein vollständiges Backup.

### Modell- und API-Kompatibilität

`backend/models.py` bleibt das Eingabemodell der REST-API. Die Datenzugriffsschicht
nimmt einfache Python-Werte entgegen und kennt weder FastAPI noch Electron oder
die Oberfläche. Die API übersetzt fehlende Datensätze in HTTP 404, ungültige
Stapeloperationen in 422 und verletzte Datenbankregeln in 409. SQL liegt zentral
in `backend/database.py`; der PDF-Renderer erhält weiterhin fertige Rechnungswerte.

Der Pfadwechsel benötigt keine neue fachliche Tabelle und keine zusätzliche
Schemaversion: Schema 6, bestehende IDs, optionale Stunden, Statuswerte,
Wochenplanzuordnung und Snapshots bleiben kompatibel. Alte Datenbanken durchlaufen
weiterhin die Migrationen 1–6. Es findet keine Neuberechnung alter Rechnungen statt.
Ein Stapel von Preis- oder Wochenplanänderungen wird bei Fehlern vollständig
zurückgerollt. Der Nummernkreis wird weiterhin gemeinsam mit der Finalisierung
aktualisiert, nicht durch eine getrennte UI-Aktion.

### Übernahme bestehender Daten

Beim Wechsel vom bisherigen Desktop-Stand kann `data/ttc.db` im alten Checkout
oder unter `resources/app/data/ttc.db` liegen. Diese Daten müssen bei einem neuen
Benutzerprofil übernommen werden; eine leere Desktop-Datenbank darf einen
vorhandenen Altbestand nicht unbemerkt ersetzen. Electron meldet dem Backend den
bisherigen Datenbankpfad. Ist noch keine Zieldatenbank vorhanden, wird eine
geprüfte SQLite-Kopie übernommen und im Ziel migriert. Existiert das Ziel bereits,
ist ausschließlich dieses maßgeblich; es gibt keine automatische Zusammenführung.

Die Übernahme lässt die Quelle unverändert. Vorhandene IDs, Einstellungen,
Nummernkreis, Preis-/Logo-/Rechnungssnapshots und Dateizuordnungen bleiben erhalten.
Eine beschädigte, fremde oder von einer neueren App erzeugte Datenbank wird
abgelehnt. Bei Fehlern bleibt das Ziel unveröffentlicht. Alte und neue App vor
einem bewussten manuellen Import beenden; nicht gleichzeitig an beiden Beständen
weiterarbeiten. Der Datenbankimport selbst verschiebt oder löscht keine PDFs.
Beim Backend-Start übernimmt die oben beschriebene Dokumentenvorbereitung fehlende,
eindeutig zugeordnete PDFs aus der bisherigen Ablage der laufenden Installation.

Für einen Altbestand außerhalb der aktuellen Installation kann einmalig ein
expliziter Import ausgeführt werden (Ziel darf noch nicht existieren):

```bash
python -m backend.storage_import --source /absoluter/alter/Pfad/data/ttc.db --target /absolutes/Benutzerverzeichnis/ttc.db
```

Unter PowerShell Windows-Pfade mit Leerzeichen in Anführungszeichen setzen.
`TTC_LEGACY_DATABASE` kann beim Desktop-Start einen abweichenden Quellpfad
angeben; ohne Override prüft Electron nur `data/ttc.db` seiner Installation.
Ein neuer Build enthält selbst keine Altdaten. Deshalb einen alten Build nicht
löschen, bevor Datenbank und Dokumente gesichert beziehungsweise übernommen sind.
Der Import verwendet SQLite-Backup einschließlich bestätigter WAL-Daten,
migriert eine temporäre Kopie und veröffentlicht sie atomar ohne Überschreiben.
Dateisysteme ohne Hardlink-Unterstützung werden sicher mit einem Fehler abgelehnt.

### Datenbankfehler

Ein neues Profil wird beim ersten Start initialisiert. Eine während des Betriebs
fehlende Datenbank wird hingegen nicht still neu angelegt. Leere, beschädigte,
fremde oder nicht unterstützte Datenbanken führen zu einem Startfehler; sie
werden nicht automatisch gelöscht oder ersetzt. Gesperrte Datenbanken haben
eine begrenzte Wartezeit von fünf Sekunden. Andere Instanzen beenden und den
Vorgang erneut versuchen. Bei Zugriffsfehlern Datenverzeichnis, Berechtigungen
und freien Speicher prüfen; bei Beschädigung Originaldateien erhalten und eine
Sicherung verwenden. Keine Reparatur am einzigen Original durchführen.

Die lokale API meldet nicht verfügbare Datenbanken mit HTTP 503 und einer
Handlungsanweisung ohne SQL oder personenbezogene Inhalte. Electron zeigt beim
fehlgeschlagenen Backend-Start eine entsprechende feste Meldung. Schemafehler
erfordern eine passende App-Version, keinen automatischen Datenbank-Reset.

### Datenerhalt bei App-Austausch

Desktop-Updates verwenden denselben technischen Profilnamen und damit denselben
Datenbankpfad. Ein Start mit aktuellem Schema prüft nur Struktur, Integrität und
Fremdschlüssel; er legt keine Tabellen oder Standarddatensätze erneut an. Neue
App-Dateien enthalten keine Datenbank und keine Migrationssicherungen. Der Build
kopiert ausschließlich Python-Quellmodule aus dem Backend-Verzeichnis.

Der Austausch des Installationsverzeichnisses und wiederholte Starts erhalten
Organisation/Empfänger, Wochenplan, Termine, Nummernkreis und Rechnungssnapshots.
Der Datenpfad hängt weder vom Arbeitsverzeichnis noch vom Installationspfad ab.
Ein explizit geänderter Profilpfad ist ein anderer Datenbestand. Auch beim
Austausch der App keine alten Datenquellen oder Rechnungsverzeichnisse löschen.
Die übernommene PDF-Ablage bleibt wie die Datenbank außerhalb der Installation.
Installer, Deinstallation und die native Windows-Abnahme folgen separat.

Beim manuellen Datenbank-Backup für den Desktop dasselbe `TTC_DATA_DIRECTORY`
setzen oder `--database` mit dem absoluten Desktop-Datenbankpfad angeben. Der
Linux-systemd-Timer verwendet ohne eigene Konfiguration weiterhin die Web-Datenbank;
für Desktop-Daten den Datenpfad ausdrücklich in der Unit konfigurieren.

### Persistenzprüfung für die Entwicklung

`python -m pytest -q` prüft unter anderem Migrationen und deren Rollback,
Altdatenimport mit WAL-Daten und konkurrierendem Ziel, parallele Finalisierung,
Datenbankfehler und den Austausch des Installationsverzeichnisses. Die
Integrationstests starten und beenden echte lokale Backend-Prozesse mit und ohne
Reload. Datenbank, Rechnungen und Testprotokolle liegen dabei in temporären
Verzeichnissen. `npm run desktop:check` prüft zusätzlich Desktop-Datenpfad,
Startfehler, IPC/Sandbox und den Ausschluss von Nutzerdaten aus dem Paket.
Für Prozess- und HTTP-Tests muss die Testumgebung lokale Loopback-Sockets erlauben.
