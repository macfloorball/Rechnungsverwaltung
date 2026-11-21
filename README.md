# TT Rechnungsverwaltung

Eine lokale Anwendung mit fertiger Electron-Desktop-App und Weboberfläche zur
Verwaltung von Trainingsterminen und zur Erstellung monatlicher Rechnungen
für einen Tischtennisverein. Das Projekt
verbindet eine FastAPI-Schnittstelle mit einer browserbasierten Oberfläche,
SQLite und PDF-Rechnungserstellung.

> **Portfolio-Hinweis:** Die Anwendung enthält keine Benutzerkonten oder
> Authentifizierung. Sie ist für den lokalen Betrieb gedacht und sollte nicht
> ungeschützt über ein Netzwerk oder das Internet erreichbar gemacht werden.

## App herunterladen und installieren

Die fertige App benötigt **kein separat installiertes Python, Node.js, npm oder
Git**. Die [deutschsprachige Installationsanleitung](Planung/Installation.md)
erklärt Download, Installation, Start, Updates, Datensicherung und Fehlerhilfe.

- **Windows x64:** [Setup-EXE im stabilen Desktop-Release 0.1.3](https://github.com/macfloorball/Rechnungsverwaltung/releases/tag/desktop-v0.1.3).
- **Linux x86_64:** AppImage im selben Desktop-Release.
- **Fedora 45 x86_64:** Installation und Updates über das
  [signierte DNF-Repository](https://macfloorball.github.io/Rechnungsverwaltung/rpm/).

Der Windows-Installer besitzt derzeit keine Authenticode-Signatur; Windows kann
Warnungen anzeigen. Details und die Grenzen der bisherigen nativen Prüfungen
stehen in der Anleitung. Die vollständige Windows-Live-Abnahme aus
[Issue #32](https://github.com/macfloorball/Rechnungsverwaltung/issues/32) bleibt offen.

Windows 0.1.0/0.1.1 benötigt wegen eines Fehlers in der Updateübergabe einmal
ein manuelles vollständiges Setup ab Version 0.1.2 über die bestehende Installation.
Vorher sichern und die App schließen; Details stehen in der Installationsanleitung.

Die folgenden Python-/npm-Befehle beschreiben die **Entwicklung und den Start aus
dem Quellcode**, nicht die Installation der fertigen App.

## Lizenz

Der eigene Projektcode steht unter der [MIT-Lizenz](LICENSE). Sie erlaubt auch
kommerzielle Nutzung, Änderungen und Weitergabe, sofern der Urheberrechts- und
Lizenzhinweis erhalten bleibt. Fremdkomponenten unterliegen weiterhin ihren
jeweiligen Lizenzen und Urheberhinweisen; sie werden dadurch nicht neu lizenziert.

Die Lizenz erteilt keinen Schreibzugriff auf dieses Repository und keinen
Zugriff auf die privaten Signierschlüssel für offizielle Updates.

Eine Übersicht der mitgelieferten Fremdkomponenten und ihrer Lizenzdateien steht
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Der aktuelle Prüfstand und
offene Punkte vor einer Binärveröffentlichung stehen in der
[Desktop-Lizenzprüfung](Planung/Desktop_Lizenzpruefung.md).

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

## Wiederholung je Wochenplaneintrag

Unter **Wochenplan konfigurieren** pro Zeile „Jede Woche“ oder „Alle 2 Wochen“
wählen. Neue und bestehende Zeilen verwenden standardmäßig „Jede Woche“.
Bei „Alle 2 Wochen“ ist **Erster Termin** ausdrücklich anzugeben; das Datum muss
zum Wochentag der Zeile passen. Speichern übernimmt die Regel, erneutes Öffnen
und ein App-Neustart erhalten die Auswahl. Mehrere Tätigkeiten und gemischte
Rhythmen am selben Tag sind möglich. Die Felder sind per Tab bedienbar.
Bei einem Fehler bleiben die Eingaben erhalten.

Die 14-tägige Folge verwendet die Differenz von Kalenderdaten: Datum ≥ Startdatum
und Tagesdifferenz durch 14 teilbar. Sie hängt weder von ISO-Wochennummern noch
von UTC oder vergangenen Stunden ab. Donnerstag, 03.12.2026 ergibt 03.12.,
17.12., 31.12. und 14.01.2027, nicht 10.12. oder 24.12. Im wöchentlichen Modus
wird ein eventuell gespeichertes Startdatum **ignoriert**; es begrenzt die Folge
nicht. Beim Wechsel auf 14-tägig wird kein Startdatum automatisch erfunden.

Das Speichern einer Änderung von Rhythmus, Startdatum, Wochentag oder Aktivierung
synchronisiert ausschließlich zukünftige Termine des jeweiligen Planeintrags im
aktuellen Profil. „Zukünftig“ bedeutet strikt nach dem lokalen heutigen Datum.
Passende Termine behalten ihre IDs. Nicht mehr passende Termine werden nur dann
entfernt, wenn ihre automatische Herkunft und ihre Unverändertheit bewiesen sind,
sie noch geplant sind und keine Rechnungsposition (Vorschau oder final) auf sie
verweist. Manuelle, bearbeitete, heutige, vergangene und abgeschlossene Termine
bleiben erhalten. Die Bearbeitung eines Kalendertermins ändert den Wochenplan
nicht. Stunden-/Tätigkeitsänderungen im Plan überschreiben bestehende Termine
weiterhin nicht; neu erzeugte Termine nutzen die gespeicherten Planwerte.

Für neue automatische Termine ist `manually_modified=0` der Änderungsnachweis.
Ein SQLite-Trigger setzt ihn bei fachlichen Änderungen dauerhaft auf 1, auch bei
Verschiebung, Status-/Sammelaktionen, Änderungen von Tätigkeit, Stunden, Notiz,
Preis oder Herkunft über andere Datenzugriffswege. Eine spätere Rückänderung
stellt den Nachweis nicht wieder her. Migration 8 lässt den Wert für Altbestände
bewusst NULL (unbekannt); diese werden konservativ erhalten. Ähnliche manuelle
Termine werden durch die bestehende Kollisionsregel weiterhin berücksichtigt,
aber niemals als automatisch erzeugt oder unbearbeitet eingestuft. Automatische
Vorkommen reservieren ihr Ursprungsdatum und bei Verschiebung auch ihr tatsächliches
Datum für denselben Planeintrag gegen Ersatzduplikate.

Die bestehenden Migrationssicherungen werden weiterverwendet. Migration und
Neustart sind idempotent. Planänderung, gezielte Bereinigung, Ergänzung und
Ergebniszahlen werden gemeinsam in einer Transaktion gespeichert; ein Fehler
rollt alles zurück. `weekly_plan_months` speichert die verwalteten Monate pro
Profil, auch nach Deaktivierung oder vollständiger Bereinigung eines Monats.
Nur diese Monate werden ergänzt; neue Pläne initialisieren wie bisher den aktuellen
und folgenden Monat. Weitere Monate folgen beim Öffnen. Es gibt keine unbegrenzte
Vorausgenerierung. Historische Rechnungsdaten, Nummern, Snapshots und PDFs werden
von dieser Synchronisierung nicht geschrieben.

`GET /api/weekly-plan` und die Listen-Antwort von `PUT /api/weekly-plan` bleiben
kompatibel. Die Eingaben enthalten zusätzlich `repeat_weeks` (nur Ganzzahl 1 oder 2,
Default 1) und `start_date` (ISO-Kalenderdatum oder null). PUT liefert im zusätzlichen
Header `X-Weekly-Plan-Sync` ein JSON-Objekt mit `added`, `removed`, `updated` und
`preserved`. `updated` bleibt 0, da passende Termine unverändert wiederverwendet
werden. `preserved` zählt nur zukünftige, nicht mehr passende Ausnahmen, keine
unbetroffene Historie. Die Oberfläche zeigt diese Zahlen nach erfolgreichem
Speichern an und lädt den sichtbaren Kalender neu. Profilwechsel ersetzen wie
bisher das Dokument; verspätete Antworten wirken nicht auf das neue Profil.

## Ansichten und Navigation

Die App startet mit **Kalender / Übersicht**. Die Hauptnavigation wechselt im
selben Fenster zwischen fünf Ansichten; ein Seitenneustart ist dafür nicht nötig.

| Ansicht | Aktionen |
| --- | --- |
| Kalender / Übersicht | Monat wechseln, Termine erfassen/bearbeiten, Status und Sammelaktion; direkt darunter Monatsvorschau erstellen/aktualisieren und endgültige Monatsrechnung mit PDF öffnen/herunterladen oder nach Bestätigung löschen |
| Rechnung konfigurieren | Absender, Empfänger, Bankverbindung, Steuerangaben, Rechnungstexte und Logo |
| Wochenplan konfigurieren | Wochentage, Tätigkeiten, Stunden, Wiederholung, erster Termin und Aktivierung je Planeintrag |
| Tätigkeiten und Preise | Bis zu zehn Tätigkeiten mit Stundenpreis und Aktivstatus (auch deaktivierte Einträge zählen) |
| Verwaltung / App-Einstellungen | Vollständige Datensicherung, CSV-/Dokumentenexport und Desktop-Updates; Wiederherstellung gemäß Anleitung bei beendeter App |

**Eingaben bleiben beim Hin- und Herwechseln erhalten**, einschließlich neuer
Tätigkeitszeilen und noch nicht gespeicherter Wochenplaneinträge. Der Kalender
behält seinen Monat; der Rechnungsbereich folgt diesem Monat. Zum Wechseln der
Abrechnung den Monat im Kalender auswählen. Vorhandene endgültige PDFs bleiben
von einer erneuten Vorschau unverändert. Andere Rechnungsmonate sind über die
Kalendernavigation erreichbar.

Jeder Konfigurationsbereich wird über seinen eigenen Speichern-Button gespeichert.
Das Speichern von Tätigkeiten speichert keinen Wochenplan und keine
Rechnungseinstellungen. Logoaktionen erhalten andere noch nicht gespeicherte
Rechnungseingaben. Bei API-Fehlern bleiben Eingaben und Fehlermeldungen in der
betroffenen Ansicht erhalten. Solange Daten erstmals geladen werden, sind die
zugehörigen Formulare gesperrt; bei Ladefehlern steht „erneut laden“ bereit.
Während eines Speichervorgangs sind die betroffenen Felder kurz gesperrt.
Es gibt keine automatische Speicherung. Vor Schließen oder Neuladen der App
müssen Änderungen ausdrücklich gespeichert werden.

Die Navigation ist mit Tab und Eingabetaste bedienbar. Beim Ansichtswechsel
wandert der Fokus auf die Überschrift; versteckte Bereiche bleiben außerhalb der
Tab-Reihenfolge. In kleinen Webfenstern bricht die Navigation um; breite Tabellen
sind innerhalb ihres Bereichs horizontal scrollbar. Alle UI-Ressourcen bleiben
lokal. Windows und AppImage verwenden weiterhin ihre vorhandenen Updateabläufe;
bei RPM-Installationen verwaltet DNF die Updates. Im reinen Webbetrieb entfällt
der Desktop-Updatebereich.

Für Änderungen an der Navigation gibt es zusätzlich zu `scripts/navigation.test.cjs`
einen gezielten Test mit echtem Electron-Renderer und temporärem Profil:

```bash
TTC_RUN_ELECTRON_TESTS=1 .venv/bin/python -m pytest -q tests/test_navigation.py
```

Dieser prüft Entwicklung und Produktionsfrontend, getrennte Speicheraktionen,
Entwürfe und API-Fehler, Tastatur/Fokus, Monatswechsel und verspätete Antworten,
sowie Persistenz nach einem vollständigen App-/Backend-Neustart. Er benötigt
eine grafische Sitzung und verändert keine vorhandenen Nutzerdaten.

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

## Entwicklung: Voraussetzungen

- Python 3.10 oder neuer
- `pip`

Die folgenden Schritte sind für Linux/macOS geschrieben. Unter Windows kann
die virtuelle Umgebung mit `.venv\Scripts\activate` aktiviert werden.

## Entwicklung: Installation und Start aus dem Quellcode

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

A local application with a packaged Electron desktop app and a web interface for managing
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

## Download and install the desktop app

Use the [German installation guide](Planung/Installation.md) for Windows Setup,
Linux AppImage and Fedora DNF. Packaged apps include their runtimes; Python,
Node.js, npm and Git are not installation prerequisites. The commands below
are for development and running from source.

## Development requirements

- Python 3.10 or newer
- `pip`

The commands below are for Linux/macOS. On Windows, activate the virtual
environment with `.venv\Scripts\activate`.

## Development: install and run from source

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
owns the local Python backend during desktop use. Packaged releases include
Python and its dependencies. Native Windows 11 installation and data-preservation
tests are partially documented in [the historical test record](Planung/Windows_Installationspruefung.md);
the full Windows live-update acceptance remains open in issue #32.

## Electron: Entwicklung und Produktionsstart

Der Desktop-Start aus dem Quellcode benötigt Python mit den Paketen aus `requirements.txt`.
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

Die automatisch erzeugten API-Dokumentationsoberflächen `/docs` und `/redoc`
sowie `/docs/oauth2-redirect` sind im gemeinsamen Backend für alle Startmodi
deaktiviert (HTTP 404), da sie externe CDN-Ressourcen einbinden. Das lokale
API-Schema bleibt unter `/openapi.json` verfügbar. Oberfläche und fachliche
REST-Endpunkte verwenden weiterhin den lokalen Anwendungsdienst.

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

App-Name und Fenstertitel sind **TT Rechnungsverwaltung**. Das Fenster startet
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

Ausgabe: `dist/windows/TT Rechnungsverwaltung-win32-x64/` mit
`TT Rechnungsverwaltung.exe`. Der gesamte Ordner gehört zum Testbuild;
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

Danach `TT Rechnungsverwaltung.exe` im Hauptordner starten. Die Anwendung
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
SQLite noch FastAPI oder Rechnungsregeln. `save_new()` veröffentlicht Dateien
exklusiv nach vollständigem Schreiben in eine temporäre Datei und `fsync`;
vorhandene Dateien und symbolische Links werden nicht überschrieben. Bei einem
Schreibfehler wird nur die temporäre Datei bereinigt. `get_file()` liefert
nur vorhandene reguläre Dateien, keine symbolischen
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
neue Testdaten und isolierte Profile. Seit Schritt 10 werden Entwicklung und
Produktion jeweils mit Standardablage und eigenem Dokumentenordner geprüft;
Produktion verwendet das gebaute Frontend.

Geprüft werden die sichtbare HTML-Rechnungsvorschau, der Ausschluss geplanter und abgesagter
Termine, die Finalisierung, PDF-Abruf mit passenden HTTP-Headern, der tatsächliche
Electron-Download und der bytegleiche Inhalt der gespeicherten PDF. Eine neue
Vorschau verändert die finale PDF nicht. Nach Neuladen wird die Rechnung über
das Archiv geöffnet. Der Test prüft außerdem Sandbox, Context Isolation und die
beschränkte Preload-Bridge. Browserübergaben werden ausschließlich im Test
abgefangen; die produktive URL-Validierung bleibt aktiv.
Bei einer blockierten Dokumentenablage wird die sichtbare Fehlermeldung geprüft;
nach Beseitigung des Hindernisses muss das erneute Speichern erfolgreich sein.

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

Unter Linux prüft jeder aktivierte Electron-Durchlauf außerdem einen absichtlichen
`SIGKILL` des Test-Hauptprozesses nach bestätigten Schreibvorgängen. Das eigene
Backend muss sich danach beenden; ein weiterer App-Start prüft Rechnungen, PDFs,
Entwurf, Kalender und Nummernkreis erneut. Ausschließlich die temporäre Test-App
und ihr eigenes Profil werden dafür verwendet.

Für einen praktischen Offline-Test unter Linux kann derselbe Electron-Test in
einem eigenen Netzwerk-Namespace mit ausschließlich Loopback ausgeführt werden.
Voraussetzungen sind `unshare`, `ip`, erlaubte Benutzer-/Netzwerk-Namespaces,
die eingerichtete Python-/Electron-Umgebung und eine lokale grafische Sitzung.
Aus dem Projektverzeichnis:

```bash
unshare --user --map-current-user --net --keep-caps sh -c 'ip link set lo up && exec env TTC_RUN_ELECTRON_TESTS=1 TTC_EXPECT_OFFLINE=1 .venv/bin/python -m pytest -q -s tests/test_desktop_invoice.py'
```

Die Isolation gilt nur für den Test und seine Kindprozesse; die übrige Sitzung
bleibt online. `TTC_EXPECT_OFFLINE=1` allein trennt kein Netzwerk: Es fordert
die Prüfung an, dass ausschließlich Loopback mit IPv4/IPv6 vorhanden ist und
Verbindungen zu externen IPv4-/IPv6-Testadressen an fehlender Erreichbarkeit
scheitern. Auch Electron prüft den geerbten Netzwerk-Namespace und die fehlende
Erreichbarkeit bei jedem Start. Die Chromium-Sandbox bleibt aktiv.
Alle vier Kombinationen aus Entwicklung/Produktion und Standard-/eigener
Dokumentenablage laufen einschließlich vollständigem Neustart mit temporären
Daten. PDF-Browserübergaben und Dialogantworten bleiben wie oben kontrolliert;
native Windows-Ausführung, tatsächliche Standardbrowser-Anzeige und das
physische Abschalten eines Netzwerkadapters werden dadurch nicht geprüft.

Falls `node`/`npm` fehlen, die vorhandene Electron-Abhängigkeit aber installiert
ist, kann ihre eingebettete Node-Laufzeit unter Linux für die JavaScript-Tests
verwendet werden:

```bash
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test --test-isolation=none electron/*.test.cjs scripts/*.test.cjs
```

### Kontrollierte Dateioperationen (Phase 3, Schritt 7)

Der Dokumentendienst bündelt Speichern, geprüften Lesezugriff, Umbenennen und
Löschen innerhalb eines Dokumentenverzeichnisses. Alle Operationen akzeptieren
einfache Dateinamen; Pfadbestandteile, Windows-Gerätenamen, Datenstromreferenzen,
Steuerzeichen und unter Windows mehrdeutige abschließende Punkte/Leerzeichen
werden abgelehnt.

| Operation | Verhalten |
| --- | --- |
| `save_new()` | Vollständig schreiben, synchronisieren und ohne Ersetzen veröffentlichen; bei Fehlern kein teilweise veröffentlichtes Dokument |
| `save_new_with_identity()` | Zusätzlich die Identität der gerade veröffentlichten Datei für eine spätere bedingte Bereinigung zurückgeben |
| `get_file()` / `open_read()` | Vorhandene reguläre Datei ermitteln beziehungsweise lesend öffnen; `open_read()` prüft auch den tatsächlich geöffneten Dateideskriptor |
| `rename()` | Innerhalb derselben Ablage einen neuen Namen ohne Zielersetzung anlegen, dann den geprüften alten Namen entfernen |
| `delete()` | Reguläre Datei entfernen; mit `expected` nur bei passender vorher erfasster Dateiidentität, mit `missing_ok` fehlende Dateien tolerieren |

Die Dateiidentität umfasst Dateisystem, Dateikennung, Größe und Änderungszeit.
Sie wird beim Speichern nach Schließen des Schreibhandles und vor der
Veröffentlichung erfasst. Die Rechnungs-API verwendet sie bei fehlgeschlagener
Finalisierung zur Bereinigung der eigenen neuen PDF und beim Löschen einer
Rechnung. Eine dabei als geändert erkannte Datei wird erhalten. War eine PDF
schon vor dem Löschen der Rechnung nicht vorhanden, wird anschließend keine
zwischenzeitlich entstandene Datei unter demselben Namen entfernt.

Publizieren und Umbenennen benötigen ein Dateisystem mit Hardlink-Unterstützung.
Scheitert beim Umbenennen das Entfernen des alten Namens, bleiben beide Namen
erhalten und der Aufrufer erhält den Fehler. Die Umbenennung ist daher keine
gemeinsame atomare Operation aus zwei Namensänderungen. Dateisystemoperationen
und SQLite bleiben ebenfalls getrennt; nach einem Fehler beim Entfernen der PDF
kann wie bisher eine bereits gelöschte Rechnung mit zurückgebliebener PDF
vorliegen. Die API meldet diesen Zustand ausdrücklich.

Ein harter Absturz nach Veröffentlichung einer PDF und vor dem Datenbank-Commit
kann umgekehrt eine PDF ohne finale Rechnung hinterlassen. Der erneute
Finalisierungsversuch meldet HTTP 409 und überschreibt die Datei nicht.
App und Backend vollständig beenden und Dateibestand sowie Rechnungszuordnung
prüfen. Eine zweifelsfrei nicht zugeordnete PDF separat sichern und erhalten,
bevor ihr ursprünglicher Dateiname für einen erneuten Versuch freigegeben wird.
Es gibt keine automatische Löschung solcher Dateien; eine gemeinsame
Absturztransaktion über SQLite und PDF-Ablage wird nicht zugesichert.

`rename()` steht auf Ebene des Dateidienstes bereit. Finale Rechnungsoriginale
behalten ihre verbindlichen Namen `Rechnung_TTC_YYYY-MM.pdf` und ihre bestehenden
Datenbankreferenzen. Frei gewählte Namen für exportierte Kopien bleiben über
den vorhandenen Download-/Speicherdialog möglich. Electron erhält weiterhin
ausschließlich die bisherige begrenzte Bridge und validierte PDF-URLs.

### Dateifehler behandeln (Phase 3, Schritt 8)

`backend/document_errors.py` ordnet Dateifehler festen Meldungen mit einer
Handlungsanweisung zu. Die Übersetzung erfolgt gezielt an den Grenzen der
Dokumentenoperationen; bestehende Datenbankfehler bleiben separat behandelt.
Die lokale API behält das Fehlerformat `{"detail": "…"}` bei, das die vorhandene
Oberfläche bereits anzeigt. Meldungen und Dokumenten-Fehlerprotokolle enthalten
keine internen Dateipfade oder rohen Betriebssystemtexte.

| Fall | API-Verhalten |
| --- | --- |
| Gespeicherte PDF fehlt | HTTP 404 mit Hinweis auf Dokumentenordner und Sicherung; Rechnung bleibt erhalten |
| Dateiname bereits vorhanden oder Datei zwischenzeitlich geändert | HTTP 409; vorhandene beziehungsweise geänderte Datei bleibt erhalten |
| Zugriffsrechte, geöffnete/gesperrte Datei, schreibgeschützte Ablage | HTTP 503 mit Hinweis auf Rechte und andere Programme |
| Speicherplatz oder Kontingent erschöpft | HTTP 503 mit Hinweis auf freien Speicher |
| Ungültiger Ordner oder ungeeignetes Dateisystem | HTTP 503 mit Hinweis auf gültigen lokalen Ordner beziehungsweise Hardlinks |
| Sonstiger Dateisystemfehler | HTTP 503 mit Hinweis auf Erreichbarkeit und erneuten Versuch |

Die Meldung unterscheidet, ob eine Rechnung nicht gespeichert oder nicht gelöscht
wurde, ob eine neue PDF nach einem Speicherfehler nicht bereinigt werden konnte
oder ob die Rechnung bereits gelöscht wurde und die PDF zurückblieb. In diesen
Fällen den Dateibestand prüfen, bevor erneut gespeichert wird. Fehlgeschlagene
PDF-Schreibvorgänge verändern weder die gespeicherte Vorschau noch den Nummernkreis.

Beim Start meldet das Backend ausschließlich einen begrenzten Fehlercode über
`TTC_DOCUMENT_ERROR`. Der Starter erkennt auch aufgeteilte Ausgabeblöcke;
Electron zeigt eine feste passende Meldung statt eines allgemeinen Backend- oder
Python-Fehlers. Dies gilt auch beim Ausfall eines Entwicklungs-Reload-Workers.

`DocumentPDFResponse` verwendet weiterhin die vorhandene Dateiantwort samt
Download- und Bereichsabruf-Headern. Erfolgsheader werden erst mit dem Beginn
der eigentlichen Antwort übertragen. Scheitert vorher das Öffnen oder erste
Lesen, erhält der Aufrufer eine nachvollziehbare JSON-Fehlermeldung. Verschwindet
eine Datei erst unmittelbar vor der Übertragung, kann dies als vorübergehender
Lesefehler mit HTTP 503 gemeldet werden. Bricht das Lesen nach bereits übertragenen
PDF-Daten ab, wird die Übertragung beendet; dann ist ein neuer Abruf erforderlich,
weil Status und Header nicht mehr geändert werden können.

### Fremde Dokumente beim Rechnungslöschen schützen (Phase 3, Schritt 9)

Vor dem Löschen prüft die API weiterhin den verbindlichen Dateinamen, die
eindeutige Rechnungszuordnung und die Identität der vorhandenen regulären Datei.
`delete_final_invoice()` vergleicht die ausgewählte Rechnung innerhalb seiner
SQLite-Schreibtransaktion erneut mit dem aktuellen Datensatz. Auch zwischenzeitlich
hinzugekommene weitere Dateiverweise werden geprüft, einschließlich abweichender
Groß-/Kleinschreibung. Bei einem Konflikt bleiben Rechnung und Dateien erhalten;
die API fordert mit HTTP 409 zum erneuten Laden und Prüfen auf.

Nach dem Löschen des Datensatzes prüft `invoice_document_deletion_guard()` vor
der PDF-Bereinigung erneut, dass keine Rechnung mehr auf die Datei verweist.
Die SQLite-Schreibsperre bleibt während der bedingten Dateioperation bestehen.
Damit können parallele Datenbank-Schreibvorgänge die Zuordnung nicht zwischen
dieser Prüfung und der Bereinigung ändern. Eine bereits anderweitig zugeordnete
oder anhand der gespeicherten Identität als ersetzt erkannte Datei wird erhalten.
Kann die Zuordnung nicht geprüft werden, bleibt die PDF ebenfalls erhalten und
die API weist auf den bereits gelöschten Datensatz und die notwendige Kontrolle hin.

Fehlt ein gespeicherter Dateiverweis, wird kein Dateiname zum Löschen hergeleitet.
War die PDF schon bei der Auswahl nicht vorhanden, entfernt die API keine später
unter diesem Namen erschienene Datei. Es gibt keine rekursive Löschung oder Suche
nach ähnlichen Dateinamen. Andere Rechnungs-PDFs, nicht zugeordnete Dateien und
Kopien in alten Ablagen bleiben erhalten. Wiederholtes Löschen einer nicht mehr
vorhandenen Rechnung meldet HTTP 404 und führt keine Dateioperation aus.

Datenbanklöschung und Dateientfernung bleiben zwei getrennte Schritte. Bei einem
Fehler nach der Datenbanklöschung kann die PDF zurückbleiben; diese bestehende
Einschränkung wird ausdrücklich gemeldet. Eine gemeinsame atomare Transaktion
über SQLite und Dateisystem wird nicht zugesichert.

### Rechnungs- und Vorschauabläufe prüfen (Phase 3, Schritt 10)

Die Regression kombiniert folgende Prüfungen, ohne produktive Nutzerdaten zu
verwenden:

| Tests | Abgedeckte Abläufe |
| --- | --- |
| `tests/test_api.py` | Abrechenbare Termine, manuelle und Wochenplan-Leistungen, Pauschalen, Rundung, Vorschauaktualisierung, finale Snapshots samt Logos, Nummernkreis, Archiv, Konflikte und sichere Lösch-/Fehlerfälle |
| `tests/test_invoice.py` | PDF-Erzeugung, Rechnungsdaten, Positionen, Kontaktdaten, Logo, Summen und Layoutgrenzen |
| `tests/test_document_storage.py`, `tests/test_document_errors.py`, `tests/test_invoice_documents.py` | Dateioperationen, Zuordnung, unveränderte Bestände bei Fehlern, Konkurrenzschutz und PDF-Bereichsabrufe |
| `tests/test_storage_paths.py`, `tests/test_storage_update.py`, `tests/test_storage_lifecycle.py` | Speicherorte, Bestandsübernahme, Installationsaustausch und echte Backend-Neustarts mit beiden Ablagen und mit/ohne Reload |
| `tests/test_desktop_invoice.py` | Durchgehender Electron-Ablauf in allen vier Kombinationen aus Entwicklung/Produktion und Standard-/eigener Ablage, jeweils mit anschließendem vollständigem App-Neustart |

Der Electron-Test aktualisiert eine Vorschau nach einer Terminänderung,
finalisiert sie und prüft den Download. Nach einer weiteren Terminänderung
muss die neue Vorschau vom weiterhin unveränderten finalen PDF abweichen.
Ein erneuter Finalisierungsversuch vor dem Löschen wird abgelehnt. Im Archiv
werden Abbrechen und Bestätigen der Löschabfrage mit kontrollierten Antworten
geprüft; eine zweite Rechnung bleibt erhalten. Anschließend wird die aktuelle
Vorschau mit neuer Rechnungsnummer finalisiert. Nach vollständigem Beenden und
Neustarten der App müssen beide Rechnungen, PDFs und der Nummernkreis erhalten
sein und das PDF aus dem Archiv wieder geöffnet werden können.

Alle Python-Prüfungen einschließlich der GUI-Fälle unter Linux:

```bash
TTC_RUN_ELECTRON_TESTS=1 python -m pytest -q
```

Die JavaScript-Prüfungen laufen zusätzlich mit `npm run desktop:check`
beziehungsweise mit der oben beschriebenen eingebetteten Node-Laufzeit.
Die automatisierten Prüfungen unter Linux ersetzen weiterhin keine native
Windows-Abnahme. Browserübergaben werden abgefangen, Downloads automatisch
gespeichert und Bestätigungen kontrolliert beantwortet. Die tatsächliche
PDF-Darstellung, das Drucken und manuelle Betriebssystemdialoge sind separat
abzunehmen.

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

### Vollständige Sicherungen (Phase 5)

Eine vollständige Sicherung umfasst SQLite mit allen Tabellen, Nummernkreisen,
Einstellungen, Logos und Rechnungssnapshots sowie sämtliche regulären Dateien
im konfigurierten Dokumentenordner (auch nicht zugeordnete PDFs und Anhänge).
Unterordner und symbolische Links werden sicherheitshalber abgelehnt, nicht
unbemerkt ausgelassen. Installationsdateien, Cache, Protokolle, alte Sicherungen
und Startumgebungsvariablen gehören nicht zum Nutzdatenbackup. Externe
Logo-Quelldateien werden nicht benötigt: verwendete Logos liegen in SQLite.

Format: ein privates, zeitgestempeltes ZIP mit `database/ttc.db`,
`documents/<Dateiname>` und `manifest.json` (Formatversion, UTC-Zeitpunkt,
Größe und SHA-256 jeder Nutzdatei). Absolute Quellpfade werden nicht gespeichert.
Es gibt keine automatische Löschung vollständiger Sicherungen. Das bisherige
`backup_database.py` samt Timer bleibt eine reine Datenbanksicherung.

In der Anwendung unter **Datensicherung** auf **Sicherung erstellen** klicken.
Ein leerer Zielpfad verwendet `ttc-rechnungsverwaltung-backups` im Benutzerordner.
Alternativ einen absoluten lokalen Ordner eintragen, etwa `D:\Sicherungen` oder
`/home/name/Sicherungen`. Die Erfolgsmeldung nennt die fertige ZIP-Datei.
Jede Sicherung erhält UTC-Zeitstempel und Zufallskennung; bestehende Archive
werden auch bei einer Namenskollision niemals ersetzt. Temporäre Dateien werden
bei gewöhnlichen Fehlern entfernt; nach einem Stromausfall können versteckte
`.ttc-backup-*`-Arbeitsordner verbleiben. Nur veröffentlichte ZIP-Dateien verwenden.

#### Wiederherstellung bei beendeter App

App und sämtliche zugehörigen Backend-Prozesse auf beiden Geräten beenden.
Zuerst den aktuellen Bestand vollständig sichern. Das Originalprofil bleibt
als Rückfallmöglichkeit erhalten. Anschließend mit lokal eingerichteter
Python-Umgebung im Projekt-/App-Verzeichnis ausführen:

```bash
python -m backend.backup_restore --archive "/absolut/Sicherungen/ttc-backup-….zip" --target "/absolut/NeuesProfil" --current-database "/absolut/AktuellesProfil/ttc.db" --current-documents "/absolut/AktuelleDokumente" --safety-directory "/absolut/Sicherheitskopien" --confirm
```

Der Zielordner darf noch nicht existieren. Erst nach erfolgreicher Prüfung
aller Prüfsummen, SQLite-Integrität, Fremdschlüssel und PDF-Verweise werden
Dateien im neuen Profil veröffentlicht. ZIP-Pfade werden nicht blind extrahiert.
Bei Platz-/Rechtefehlern während der Veröffentlichung kann ein unvollständiges
neues Profil verbleiben: nicht verwenden, Originalprofil behalten und mit einem
anderen neuen Ziel erneut versuchen. Bestehende Profile werden niemals ersetzt.

Danach `TTC_DATA_DIRECTORY` auf den neuen absoluten Profilpfad setzen und die App
starten. Ein bisheriges `TTC_DOCUMENT_DIRECTORY` entfernen oder ausdrücklich auf
`<NeuesProfil>/documents` ändern, damit keine alten PDFs verwendet werden.
Unter PowerShell etwa `$env:TTC_DATA_DIRECTORY = 'D:\TTC\NeuesProfil'` setzen;
Pfade mit Leerzeichen in Anführungszeichen einschließen. Die Sicherung ist
zwischen Windows und Linux übertragbar; Startumgebung und Python müssen auf dem
Zielgerät eingerichtet sein. Das Wiederherstellungslimit beträgt 8 GiB und
100.000 Archiveinträge. Es gibt keine Zusammenführung bestehender Datenbestände.

Vor Veröffentlichung des neuen Profils erzeugt das Wiederherstellungswerkzeug
zwingend eine vollständige Sicherheitskopie des aktuellen Bestands im angegebenen
`--safety-directory`. Scheitert diese Sicherung, wird das neue Profil nicht
veröffentlicht. `--current-database` und `--current-documents` ausdrücklich prüfen;
ohne Angabe werden die normalen Pfade aus der Startumgebung verwendet. Auf einem
neuen PC die App zunächst einmal mit einem eigenen leeren Profil starten und
wieder schließen; dieses Profil als aktuellen Bestand angeben. Das Backup-ZIP
anschließend in einen weiteren neuen Profilordner wiederherstellen. Es gibt
keinen Schalter zum Umgehen der Sicherheitskopie.

#### Datenexport

**CSV und Dokumente exportieren** liefert ein ZIP mit sechs Tabellen
(Organisation/Empfänger/Einstellungen, Tätigkeiten, Wochenplan, Termine,
Rechnungen und Rechnungspositionen) sowie unveränderten PDFs/Anhängen.
CSV verwendet UTF-8 mit BOM, Semikolon und Kopfzeilen; Geldbeträge bleiben Cent,
Datumswerte ISO-Text und Binärwerte erhalten `base64:`. Formelfähige Textfelder
werden mit einem Apostroph entschärft. Der Export verwendet denselben konsistenten
Snapshot wie Backups. Er dient der Auswertung; CSV-Import und Zusammenführung
sind nicht vorgesehen. Zur Wiederherstellung das vollständige Backup verwenden.


#### Regelmäßig sichern und Sicherungen aufbewahren

Nach wichtigen Änderungen und vor Updates eine vollständige Sicherung erstellen.
Mindestens eine zusätzliche Kopie auf einem getrennten Datenträger aufbewahren;
eine Sicherung auf derselben Platte schützt nicht vor deren Ausfall. Mehrere
Generationen behalten und gelegentlich bei beendeter App in ein neues Profil
wiederherstellen. Rechnungen, Termine, Einstellungen und PDFs dort kontrollieren,
bevor alte Sicherungen oder Profile manuell entfernt werden. Vollständige
Sicherungen werden nicht automatisch rotiert; der bisherige Linux-Timer sichert
weiterhin ausschließlich SQLite und ersetzt diesen Ablauf nicht.

ZIP-Backups und Exporte sind unverschlüsselt und enthalten personenbezogene
Daten einschließlich Kontodaten. Sicherungsmedien und Zugriffsrechte entsprechend
schützen. Unix-Dateien erhalten private Rechte; unter Windows gelten zusätzlich
die Berechtigungen des Zielordners. Genügend freien Platz für Arbeitskopie und
ZIP vorhalten. Ein lokales Dateisystem mit Hardlink-Unterstützung ist erforderlich.
Auch die Backup-Erstellung lehnt Archive über dem Wiederherstellungslimit ab.
Nicht alle Dateisysteme auf USB-Sticks unterstützen die benötigten Operationen.

Während einer Sicherung werden App-Schreibvorgänge vorübergehend blockiert;
größere Bestände möglichst ohne parallele Bearbeitung sichern. Temporäre
`.ttc-document-write-*`-Unterordner sind unveröffentlichte Schreibvorgänge und
werden nicht gesichert. Andere Unterordner, Links und unter Windows mehrdeutige
Namen führen zum Abbruch. Ein bereits vor der Sicherung veröffentlichter, aber
noch nicht in SQLite bestätigter PDF-Schreibvorgang kann als nicht zugeordnete
Datei enthalten sein; solche Dateien werden erhalten, niemals automatisch gelöscht.
Die App bietet weiterhin keine gemeinsame Transaktion über SQLite und Dateisystem.

Die beschriebenen Bedienabläufe können unter Linux automatisiert mit
`TTC_RUN_ELECTRON_TESTS=1 python -m pytest -q -s tests/test_desktop_invoice.py`
geprüft werden. Der Test nutzt ausschließlich temporäre Profile und kontrollierte
Downloadpfade. Native Windows-Bedienung, manuelle Speicherdialoge sowie reale
Stromausfälle sind gesondert zu prüfen; ein Windows-Testbuild ersetzt diese
Prüfungen nicht. Windows-Installer und eingebettete Python-Laufzeit bleiben den
späteren Projektphasen zugeordnet.


## Windows-Installation und Updates (Phase 6)

Die neue [Desktop-CI](Planung/Desktop_CI.md) prüft Python-/JavaScript-Tests,
Windows-NSIS-Builds und Linux-AppImages bei Desktop-PRs und relevanten Pushes.
Sie veröffentlicht keine produktiven Releases. Linux-Buildanleitung und
Abnahmegrenzen stehen ebenfalls dort.

Der getrennte [Desktop-Release-Workflow](Planung/Desktop_Release_Einrichtung.md)
veröffentlicht ausdrücklich freigegebene `desktop-vX.Y.Z`-Tags. Die stabilen
Desktop-Releases werden getrennt von den RPM-Releases veröffentlicht. Er verwendet
dasselbe inzwischen öffentliche Repository. Windows nutzt ausdrücklich den Modus
`ed25519-only` ohne Authenticode; das gemeinsame Ed25519-Manifest bleibt für beide
Plattformen verpflichtend. Das produktive Ed25519-Vertrauen und das geschützte
GitHub-Environment sind eingerichtet. Ein Release benötigt weiterhin die
erfolgreiche exakte Merge-CI und die geschützten Jobfreigaben; der abschließende
Live-A/B-Nachweis ist separat zu erbringen.

Die [Update-Erkennung](Planung/Desktop_Update_Erkennung.md) ist im Main-Prozess
implementiert: verzögerte/wiederkehrende Prüfungen, verifizierte Release-Metadaten
und benannte manuelle Prüf-IPC. Entwicklungsbuilds bleiben deaktiviert. Die
[Update-Oberfläche](Planung/Desktop_Update_Oberflaeche.md) ergänzt Dialog,
manuelle Prüfung und persönlichen GitHub-Zugang. Der
[verifizierte Paketdownload](Planung/Desktop_Update_Download.md) ist nach
Nutzerzustimmung implementiert. Die
[Windows-Installationsübergabe](Planung/Desktop_Windows_Update.md) nutzt den
vorhandenen sichtbaren NSIS-Installer nach erneuter Bestätigung. Das produktive
Ed25519-Vertrauen ist eingerichtet; die vollständige Windows-Live-Abnahme steht
weiterhin aus. Ohne konfigurierte Vertrauensdaten bleibt der Updateweg gesperrt. Der
[Linux-AppImage-Updateweg](Planung/Desktop_Linux_Update.md) ersetzt benutzereigene,
sicher beschreibbare AppImages nach Bestätigung atomar. Bei ungeeigneten Pfaden
bleibt die manuelle Aktualisierung vorgesehen. Daneben ist eine eigene signierte
RPM-Distribution veröffentlicht, deren Updates DNF verwaltet; DEB-Pakete werden
nicht angeboten.
[Offlinebetrieb und Fehlerbehandlung](Planung/Desktop_Update_Fehlerbehandlung.md)
sichern Abbruch, konkurrierende Aktionen und Neustart-Bereinigung ab.
Die [Regressionstestmatrix](Planung/Desktop_Update_Tests.md) beschreibt die
automatisierten Prüfungen und grenzt echte Linux-/Electron-Ausführung von
Testadaptern und noch ausstehender nativer Installationsabnahme ab.
Die [Release- und Abnahmeanleitung](Planung/Desktop_Update_Abnahme.md) führt durch
GitHub-Einrichtung, Freigabe, native Windows-/Linux-Prüfungen mit zwei Versionen,
Datenerhaltsvergleich und manuelle Wiederherstellung. Signierte Desktop-Livereleases
sind veröffentlicht; dies ersetzt nicht die noch offene vollständige native
Windows- und gemeinsame Live-A/B-Abnahme.

Das Repository ist laut aktuellem Arbeitsauftrag öffentlich. Die
[Freigabevorbereitung](Planung/Repository_Public_Freigabe.md) bleibt als historischer
Prüfstand erhalten; sie belegt keine erledigten Lizenzpflichten für Binärpakete.
Der [historische Umsetzungsstand vom 18.11.2026](Planung/Desktop_Update_Stand_2026-11-18.md) trennt
bestandene automatische Tests und den nativen Linux-Testwechsel mit Testfeed
von ausstehender Gesamt-Abnahme und Einrichtung. Restaufgaben stehen in
[Issue #32](https://github.com/macfloorball/Rechnungsverwaltung/issues/32).

Der vorhandene `@electron/packager` stellt weiterhin ausschließlich ausgewählte
Programmdateien zusammen. `electron-builder` erzeugt daraus einen deutschen
NSIS-Installer für Windows x64, pro Benutzer ohne Administratorrechte. Ein fester
Installationsort verhindert die Auswahl eines Daten- oder Dokumentenordners.
Der Installer erhält keine Löschfunktion für persönliche Daten. Die eingebettete
Python-Laufzeit wird mit ihren Paketen ausgeliefert; am Ziel-PC sind weder Python
noch Node.js oder npm erforderlich. Linux-Entwicklungs- und Webstarts bleiben erhalten.

Technische Grundlage: [NSIS-Konfiguration](https://www.electron.build/nsis/) und
[Python Embedded Distribution](https://docs.python.org/3/using/windows.html#the-embeddable-package).
Der Build ruft keine Updates ab und veröffentlicht keine Releases.

### Installer bauen

Voraussetzungen auf dem Build-Rechner: Node.js gemäß `package.json`, eine
lokale Python-Umgebung mit pip und Internetzugang für die Build-Werkzeuge.
Aus dem Projektverzeichnis:

```sh
npm ci
python scripts/prepare_windows_runtime.py dist/python-windows
npm run desktop:installer:win
```

Unter Linux kann statt `python` der Interpreter `.venv/bin/python` verwendet
werden. Das Laufzeitziel muss neu sein; bei Paketänderungen einen frischen
Build erstellen. Das Python-Archiv ist auf Version 3.13.17 und SHA-256 fixiert,
Windows-Pakete sind in `requirements-windows.txt` versioniert. Es werden nur
Windows-x64-Wheels eingebunden, keine Entwicklungsumgebung und keine Testpakete.
Der Build kontrolliert die Laufzeitdateien und den Stand der Paketliste.
Ergebnis ohne Release-Tag:
`dist/installer/TT Rechnungsverwaltung-0.1.3-windows-x64-development-setup.exe`.
Produktionsbuilds behalten den Dateinamen ohne `-development`; Einzelheiten zur
Versionsprüfung stehen unter [Desktop-Release-Versionierung](#desktop-release-versionierung).
Der bisherige `desktop:build:win` bleibt ein entpackter Entwickler-Testbuild
ohne eingebettete Laufzeit. Nur `desktop:installer:win` erstellt das eigenständige
Installationspaket. Build-Ausgaben unter `dist/` werden nicht versioniert.

### Produktidentität

App-Name: **TT Rechnungsverwaltung**, Herausgeber: **mac-floorball**,
Paketversion: **0.1.3** aus `package.json`. Das vorhandene TTC-Symbol wird
für App, EXE und Installer verwendet. Der technische Profilname bleibt
`ttc-rechnungsverwaltung`; eine Änderung der Herausgeberangabe verschiebt
damit keine Bestandsdaten. AppUserModelID: `de.mac-floorball.ttc-rechnungsverwaltung`.
Der Installer ist nicht digital signiert. Die Herausgeber-Metadaten ersetzen
kein Zertifikat; eine SmartScreen-Anzeige eines unbekannten Herausgebers ist möglich.

Der Installer legt für den aktuellen Benutzer eine Desktop-Verknüpfung und
einen Startmenü-Eintrag **TT Rechnungsverwaltung** an. Bei Neuinstallation
beziehungsweise Update werden die Verknüpfungen bereitgestellt. Der Start
benötigt weder ein Terminal noch einen separaten Backend-Aufruf. Die native
Prüfung beider Verknüpfungen ist Bestandteil der Windows-VM-Abnahme.

### Desktop-Release-Versionierung

`package.json` bleibt die einzige Versionsquelle für die Desktop-App; die
beiden Wurzelversionen in `package-lock.json` müssen übereinstimmen. Die aktuelle
Version ist **0.1.3**. Die Backend-/Web-Versionierung wird nicht geändert.
Versionsänderungen immer gemeinsam in Paket und Lockfile pflegen.

```sh
npm run desktop:version
npm run desktop:version -- --tag desktop-v0.1.0
```

Ohne Tag entsteht ein ausdrücklich als `development` gekennzeichneter Build.
Für einen stabilen Build muss `TTC_DESKTOP_RELEASE_TAG=desktop-vX.Y.Z` gesetzt
sein. Der passende Tag muss bereits existieren und auf den sauberen aktuellen
Commit zeigen. Die Prüfung erstellt weder Tags noch Releases. Unter PowerShell
die Variable beispielsweise mit `$env:TTC_DESKTOP_RELEASE_TAG = 'desktop-v0.1.0'`
setzen. Diese Variable für Entwicklungsbuilds wieder entfernen.

Erlaubt ist der stabile SemVer-Kern `X.Y.Z`, ohne führende Nullen oder Zusätze;
jede Komponente liegt zwischen 0 und 65535, damit sie verlustfrei in die
Windows-Dateiversion `X.Y.Z.0` passt. Prerelease- und Buildzusätze werden bewusst
abgelehnt: Entwicklung wird über den Kanal gekennzeichnet, da die vorhandene
NSIS-Vergleichslogik keine SemVer-Prereleaseordnung sicherstellt.

Jeder andere vorhandene `desktop-v*`-Tag muss gültig und älter sein. Gleiche
Versionen werden nur beim erneuten Prüfen desselben Tags akzeptiert;
Veröffentlichung und Überschreiben sind dadurch nicht erlaubt. Haupt-, Neben-
und Patchversionen dürfen steigen, aber nie auf einen kleineren oder gleichen
Versionsstand wechseln. Der wiederverwendbare Updatevergleich prüft zusätzlich
einen gespeicherten Versionshöchststand. Eine gleichversionige manuelle
Installer-Reparatur bleibt möglich, die vorhandene NSIS-Downgrade-Sperre bleibt aktiv.

Paketversion, Electron-/Windows-Version, Installer-Konfiguration und eingebettetes
`desktopRelease` verwenden dieselbe geprüfte Version. Der Installer-Build schreibt
zusätzlich `<Installer>.release.json` mit Kanal, Tag/Commit (bei stabilen Builds),
Plattform, Größe und SHA-256. Diese Datei ist **unsignierte Buildinformation**,
noch kein vertrauenswürdiges Update-Manifest und keine Installationsfreigabe.
Ein `stable`-Kanal allein ersetzt keine Signaturprüfung.

Release-Prüfungen benötigen vollständige lokale Git-Historie und sämtliche
Desktop-Tags; der Release-Workflow ruft diese explizit ab. Die Prüfung des
freigegebenen Entwicklungsbranches, Signierung und Veröffentlichung sind
implementiert und bleiben bis zur Einrichtung der externen Voraussetzungen
gesperrt. Details: [Release-Einrichtung](Planung/Desktop_Release_Einrichtung.md).

### Persönliche Daten bei der Deinstallation

Die Deinstallation entfernt Programmdateien, Registrierung und Verknüpfungen.
Das Datenprofil `%APPDATA%\ttc-rechnungsverwaltung` mit Datenbank und Standard-
Dokumentenordner bleibt erhalten; ebenso eigene Dokumentenordner und externe
Backups. Auch der versteckte NSIS-Schalter `--delete-app-data` wird vor der
Deinstallation abgelehnt (Exitcode 2). Persönliche Daten lassen sich nur separat
und bewusst nach eigener Prüfung und Sicherung entfernen. Für einen späteren
Start mit vorhandenem Bestand genügt eine erneute Installation derselben App.

### Manueller Updateprozess

1. In der laufenden App eine **vollständige Sicherung** erstellen (Datenbank,
   Dokumente und Einstellungen), Erfolgsmeldung prüfen und Sicherung außerhalb
   des Installationsordners aufbewahren. Eine reine Datenbankkopie reicht nicht.
2. App vollständig schließen und das Ende ihres lokalen Servers abwarten.
   Keine zweite Instanz oder Schreibprogramme auf dem Datenbestand offen lassen.
3. Den neuen Installer aus derselben vertrauenswürdigen Bezugsquelle übernehmen,
   Ed25519-signierte Freigabedaten und den festgelegten Windows-Modus prüfen:
   aktuell ausdrücklich `NotSigned` mit passender ProductVersion, im optionalen
   strengen Modus zusätzlich Authenticode/Zertifikat/Publisher/Zeitstempel.
   SHA-256 vergleichen und unter demselben
   Windows-Benutzer starten. Die [Abnahmeanleitung](Planung/Desktop_Update_Abnahme.md#dateiverteilung-und-manuelles-prüfen)
   beschreibt diese Prüfungen; eine Prüfsummendatei allein genügt nicht.
   App-ID, technischer Profilname und Herausgeber bleiben stabil.
4. Über die vorhandene Installation installieren; nicht vorher Datenverzeichnisse
   verschieben oder löschen. Gleichversionige Neuinstallation dient der Reparatur.
5. App starten und Einstellungen, Termine, Rechnungsnummernkreis sowie gespeicherte
   PDFs prüfen. Die vorhandene Datenbankinitialisierung prüft das Schema und
   führt erforderliche Migrationen kontrolliert mit vorheriger SQLite-Sicherung aus.

Dieser manuelle Weg bleibt unabhängig vom optionalen In-App-Update verfügbar.
Der implementierte automatische Weg lädt erst nach Zustimmung und verlangt vor
Installation und Neustart eine zweite Bestätigung; produktiv bleibt er bis zur
Vertrauenseinrichtung gesperrt. Der Installer blockiert ein Downgrade gegenüber
der in Windows registrierten Version (Exitcode 3). Ein manuelles Austauschen von Dateien wird
dadurch nicht abgesichert; zusätzlich lehnt das Backend neuere Datenbankschemata ab.
Bei fehlgeschlagenem Update denselben oder einen neueren vollständigen Installer
erneut ausführen. Originaldaten und Sicherungen behalten. Für einen notwendigen
Rückfall eine zur Sicherung passende App-Version und den dokumentierten Offline-
Wiederherstellungsprozess aus Phase 5 in einen neuen Datenordner verwenden. Niemals
eine ältere App schreibend auf eine bereits migrierte Datenbank zwingen. Ein
automatisches Zurückrollen sämtlicher Programmdateien bei Stromausfall ist nicht
implementiert; die Reparatur erfolgt über den vollständigen Installer.

### Trennung von Installation und Daten

Der Installationsdialog bietet keine freie Pfadwahl. Auch der NSIS-Schalter
`/D=` wird vor einer Installation abgelehnt (Exitcode 4), damit Programmdateien
nicht versehentlich in einen bestehenden Daten- oder Dokumentenordner gelangen.
Updates ersetzen die Programmdateien und die eingebettete Laufzeit, während
das technische Benutzerprofil und konfigurierte Dokumentenpfade erhalten bleiben.
Die vorhandenen Tests `tests/test_storage_update.py` prüfen den Wechsel zwischen
getrennten Installationsverzeichnissen bei unveränderter Datenbank, Einstellungen,
Logo, Nummernkreis, Rechnungssnapshots und PDFs, einschließlich eigener Ablage.
Diese Regression wird wiederverwendet; es gibt keine zweite Datenmigration.

### Datenbankmigration beim Update

Der Installer öffnet und verändert die Datenbank nicht. Nach Installation startet
das vorhandene Backend mit demselben Benutzerprofil. Die Initialisierung prüft
Integrität, Migrationsreihenfolge und unterstützte Schemaversion. Vor einer
erforderlichen Migration entsteht eine SQLite-Sicherung `ttc.db.before-migration-*.sqlite3`
im Datenprofil. Bereits aktuelle Datenbanken werden nur validiert. Fehlerhafte
Migrationsschritte rollen ihre Transaktion zurück; die Sicherung bleibt erhalten.
Ein neuerer oder lückenhafter Schemastand wird ohne Überschreiben abgelehnt.
Die SQLite-Sicherung ergänzt das vollständige Backup vor Updates und ersetzt
dessen Dokumentensicherung nicht.

`tests/packaged_migration_check.py` lässt sich mit dem ausgelieferten Interpreter
ausführen. Es prüft in einem eigenen temporären Profil den Import der Laufzeitpakete,
einen erzwungenen Migrationsfehler, die vorherige Sicherung, erfolgreichen
Wiederholungsversuch, unveränderten Neustart und Ablehnung eines neueren Schemas.
Die Paketprüfung verwendet bewusst einen fremden Arbeitsordner; der Windows-
Suchpfad in `python313._pth` verweist ausdrücklich auf den Anwendungscode.

### Fehlerbehandlung und Plattformgrenzen

Installierte Builds verwenden einen eigenen Startprüfer: Bevor Anwendungs- oder
Backendmodule geladen werden, werden Paketmetadaten und das Datei-Manifest
kontrolliert. Fehlende, veränderte oder unlesbare Programmdateien führen zu einem
Installationsfehler mit Reparaturhinweis. Dabei wird keine Ersatzdatenbank angelegt.
Das Manifest schützt gegen unvollständige oder beschädigte Kopien; es ist keine
digitale Signatur. Datenprofile werden weder gehasht noch in das Paket aufgenommen.
Windows-Backendausgaben werden für die Electron-Prozessschnittstelle als UTF-8
übertragen, auch bei einer anderen Windows-Konsolencodierung.

Der Installer ist für Windows 10/11 x64 vorgesehen. Das
[native Teilprotokoll vom 13.11.2026](Planung/Windows_Installationspruefung.md)
belegt in einer Windows-11-VM Installation, Start ohne Entwicklungswerkzeuge,
Desktop-Verknüpfung, Neuinstallation und Datenerhalt bei einem Versionswechsel.
Die dort benannten offenen Rechte-, SmartScreen- und weiteren Prüffälle, die
unabhängige zweite Windows-Umgebung sowie die vollständige aktuelle Live-Abnahme
bleiben offen; Windows 10 ist damit nicht als nativ abgenommen erklärt.

Linux bleibt für Entwicklung, Webbetrieb und Tests unterstützt. Ein Windows-
Crossbuild benötigt unter Linux zusätzlich ein funktionsfähiges Wine. Es kann
über `USE_SYSTEM_WINE=true` aus dem Suchpfad oder über
`ELECTRON_BUILDER_WINE_TOOLSET_DIR` aus einer geeigneten Toolset-Installation
verwendet werden. Ein auf diesem Rechner fehlerhaftes mitgeliefertes Wine-Bundle
wurde für den Build durch temporär entpackte Fedora-Wine-Werkzeuge ersetzt.
Auf einem Windows-Build-Rechner ist Wine nicht nötig.
Für einen vorhandenen offiziellen Electron-ZIP-Cache lässt sich
`TTC_ELECTRON_ZIP_DIRECTORY` angeben. Der Build veröffentlicht fertige Installer
erst nach erfolgreicher Erstellung und Prüfung; fehlgeschlagene Zwischenbuilds
ersetzen keinen zuvor fertig erstellten Installer.

Die zusätzlichen Paketprüfungen sind optional aktivierbar: `TTC_WINDOWS_PYTHON`
verweist auf den ausgelieferten Interpreter. Unter Linux werden zusätzlich
`TTC_WINE` und ein separates `TTC_WINE_PREFIX` gesetzt. Die Prüfungen verwenden
ausschließlich temporäre Profile und ein fremdes Arbeitsverzeichnis.
Die NSIS-Compilerprüfung benötigt `TTC_MAKENSIS` und `TTC_NSIS_PLUGINS`
(das Verzeichnis der x86-unicode-Plugins). Mit Wine führt sie auch die
Schutzprüfungen für Datenlöschung, Installationspfad und Downgrade aus.

### Fedora: Installation und Updates über DNF

Zusätzlich zum AppImage gibt es eine eigene signierte RPM-Distribution.
Sie installiert einen Menüeintrag und aktualisiert sich über DNF.
Installation, Einrichtung, Build und Veröffentlichungsablauf sind in
[Linux RPM-Repository](Planung/Linux_RPM_Repository.md) beschrieben.

### Tätigkeiten und Preise

Die Liste zeigt nur vorhandene Tätigkeiten. **+ Tätigkeit hinzufügen** ergänzt
jeweils eine neue, als ungespeichert gekennzeichnete Zeile. Name, Stundenpreis
(bis zwei Nachkommastellen) und Aktivstatus werden mit **Tätigkeiten speichern**
übernommen. Neue Zeilen lassen sich vorher mit **Verwerfen** entfernen. Bei
Speicherfehlern bleiben die Eingaben erhalten.

Es sind höchstens **zehn insgesamt angelegte Tätigkeiten einschließlich
deaktivierter Einträge** möglich. Die Kapazitätsanzeige zählt auch neue Zeilen.
Gespeicherte Tätigkeiten werden nicht gelöscht; Deaktivieren gibt keinen Platz
frei. Namen müssen nach Entfernen äußerer Leerzeichen eindeutig sein; die
bestehende Unterscheidung von Groß- und Kleinschreibung bleibt erhalten.

Neue Zuordnungen im Wochenplan und Kalender bieten aktive Tätigkeiten an.
Bestehende Zuordnungen zu deaktivierten Tätigkeiten bleiben erhalten. Änderungen
an Tätigkeiten ändern keine historischen Rechnungssnapshots oder fertigen PDFs.
Die Speicherung bleibt lokal und verwendet die vorhandene Einzelkonfiguration;
eine Datenbankmigration ist dafür nicht erforderlich.

## Mehrere Rechnungsprofile

Der Umschalter **Aktives Rechnungsprofil** steht dauerhaft oberhalb der Navigation.
**Neues Profil** legt einen leeren Arbeitsbereich mit eigenen Standardwerten an;
Tätigkeiten, Wochenplan oder Kontaktdaten werden nicht aus dem bisherigen Profil kopiert.
**Profil umbenennen** ändert nur den Anzeigenamen. Profillöschung ist in dieser
Erstversion bewusst nicht vorgesehen, damit historische Belege erhalten bleiben.

Jedes Profil hat eigene Absender-/Empfängerdaten, Zahlungseinstellungen, Logo,
Tätigkeiten (höchstens zehn einschließlich deaktivierter Einträge), Wochenplanung,
Kalenderstatus, Vorschauen, Rechnungen und PDFs. Updateeinstellungen und vollständige
Sicherungen/Datenexporte gelten weiterhin für die gesamte lokale App.

Beim Profilwechsel erscheint eine Warnung: Ungespeicherte Eingaben und offene
Dialoge werden nach Bestätigung verworfen. Eine laufende Speicherung muss zunächst
abgeschlossen werden. Ein vollständiger Neuladevorgang trennt die Oberflächen und
Caches; der betrachtete Kalendermonat und die Funktionsansicht bleiben innerhalb
des Browser-/App-Fensters erhalten. Der zuletzt ausgewählte gültige Profilkontext
wird lokal gespeichert. Nach Neustart oder Restore mit unbekannter Profil-ID wird
das erste vorhandene Profil gewählt. Ohne verfügbaren Browserspeicher gilt derselbe
Fallback. Fehler beim Laden der Profile sperren die Fachansichten sichtbar.

### Technischer Profilvertrag und Migration

Fachliche Profile verwenden die bestehenden `organizations.id` als stabile positive
Integer-IDs; `profile_name` ist ausschließlich der Anzeigename. Diese Profile sind
unabhängig von Electron-`userData` und Betriebssystemkonten. Eine gemeinsame SQLite-
Datenbank enthält alle Profile. Jede API-Anfrage führt ihren eigenen Kontext über
`X-Profile-ID`; PDF-/Logo-Links verwenden `?profile_id=…`. Beide Angaben müssen bei
gleichzeitiger Verwendung übereinstimmen. Ohne Angabe bleibt der Legacy-Vertrag
explizit Profil **1**, niemals das zuletzt in einer Oberfläche ausgewählte Profil.
Ungültige IDs ergeben 422, unbekannte Profile 404. Detail-/Schreibzugriffe auf fremde
IDs werden abgewiesen. Profilverwaltung und vollständige Exporte sind app-weit.

`ProfileDatabasePath` transportiert die Request-ID durch die vorhandenen Dienste;
Datenbankfunktionen begrenzen CRUD und Fachoperationen anhand dieser ID. Die pro
Verbindung gebundene SQLite-Funktion `current_profile()` besitzt keinen globalen
veränderlichen Zustand. Rohe Datenbankpfade bleiben für app-weite Sicherungen und
Dokumentinitialisierung nutzbar. Fachliche API-Abhängigkeiten liefern stets einen
Profilkontext. Datenbanktrigger verhindern fremde Beziehungen und nachträgliche
Profilverschiebungen; Import-/Startvalidierung prüft auch bereits vorhandene Zeilen.

Schemamigration **7** ergänzt den Anzeigenamen (Altbestand: **TTC**) und ersetzt die
globale Tätigkeitsnamens-/Vorschau-Eindeutigkeit durch profilbezogene Indizes.
Vor der Migration wird der vorhandene SQLite-Sicherungsmechanismus verwendet.
Der neue Migrationsschritt läuft transaktional; Fehler rollen Schema, Trigger und
Migrationsmarker zurück. Ein Neustart versucht die Migration erneut. IDs, Zähler,
Snapshots und Dokumentreferenzen bleiben erhalten; historische PDFs werden weder
verschoben noch umbenannt. Fehler erzeugen keine leere Ersatzdatenbank.

Die bisherige fortlaufende Nummerierungslogik bleibt pro Profil erhalten (kein
jährlicher Zählerreset). Gleiche sichtbare Rechnungsnummern sind zwischen Profilen
zulässig. Neue PDFs außerhalb des Standardprofils heißen
`profile-<ID>-Rechnung_TTC_<Jahr>-<Monat>.pdf`; Namen der Profile sind keine Pfade.
Die gemeinsame Dokumentenablage bleibt dadurch mit dem bestehenden portablen
Backupformat kompatibel. Dokumentzugriffe verlangen eine passende Rechnungs-ID,
Profilzugehörigkeit und eindeutige gespeicherte Referenz; es gibt keine globale
Dateisuche als Ersatz für eine fehlende Zuordnung.

Vollständige ZIP-Sicherungen und CSV-Exporte enthalten **alle** Profile. Das ZIP-
Containerformat bleibt Version 1; die SQLite-Schemaversion schützt vor Verwendung
mit älteren Apps. Restore migriert ausschließlich die temporär geprüfte Kopie und
publiziert sie wie bisher in einen neuen Datenordner. Auch alte Einzelprofilarchive
und SQLite-Imports werden Profil 1 / TTC zugeordnet. Bestehende Ziele werden nicht
überschrieben oder mit Importdaten zusammengeführt. Archivpfad-, Prüfsummen- und
Fremdschlüsselprüfungen bleiben erhalten; zusätzlich werden Profilbeziehungen und
profilübergreifende Dokumentreferenzen geprüft. Die App arbeitet weiterhin offline.

### Rechnungsnummern und Rechnungsangaben

Neue finale Rechnungen erhalten `JAHR-LAUFNUMMER`, zum Beispiel `2026-01`
oder `2026-100`. Maßgeblich ist das **Rechnungsdatum**, nicht der Leistungsmonat:
Eine am 2. Januar 2027 erstellte Dezemberrechnung für 2026 gehört zum Nummernkreis
2027. Die Vorschau liefert ihr Rechnungsdatum zurück; die Oberfläche verwendet
es auch beim anschließenden Speichern. API-Aufrufe können ein explizites
Rechnungsdatum setzen, andernfalls gilt das lokale Tagesdatum des Backends.
Die laufende Nummer wird erst beim endgültigen Speichern vergeben. Vorschauen
zeigen eine unverbindliche nächste Nummer und verbrauchen keine Nummern.

Jedes Rechnungsprofil besitzt eigene Jahresnummernkreise. Unter „Rechnung
konfigurieren“ lässt sich ein Jahr laden und dessen nächste positive ganze
Nummer einstellen (bis 999999999). Die angezeigte Untergrenze schützt bereits
vergebene Nummern, auch nach dem Löschen ihrer Rechnung. Nicht vergebene manuelle
Sprünge lassen sich bis zu dieser Untergrenze korrigieren. Andere Profile und
Jahre bleiben unberührt. Finale Rechnungsnummern sind weiterhin unveränderlich.
Gleiche Nummern in unterschiedlichen Profilen sind zulässig; die bestehenden
profilbezogenen PDF-Dateinamen und Dokumentzuordnungen bleiben eindeutig.

Die Vergabe prüft den zuvor gelesenen Zähler innerhalb derselben SQLite-
`BEGIN IMMEDIATE`-Transaktion wie Rechnung, Positionen und Snapshot. Bei einer
parallelen Änderung wird der konkurrierende Versuch mit HTTP 409 abgelehnt;
eine erneute Vorschau und Speicherung verwendet den neuen Zähler. Ein Fehler
rollt die Vergabe zurück und entfernt nur die eigene neu veröffentlichte PDF.
Die bereits bestehende Begrenzung auf eine finale Rechnung je Leistungsmonat
und Profil bleibt bestehen.

Schema-Migration 9 ergänzt transaktional die optionale `tax_id` sowie die
Tabellen `invoice_counters` und `invoice_number_legacy_floors`. Die vorhandene
Migrationssicherung wird vorab angelegt. Historische Rechnungen, Snapshots und
PDF-Dateien werden nicht verändert. Eindeutige alte `JAHR-ZAHL`-Nummern bilden
Untergrenzen für ihr bezeichnetes Jahr. Andere Schemata werden nicht als
Jahresnummern interpretiert: Der größte numerische Endbestandteil und der alte
nächste Zähler bilden konservativ eine Untergrenze für die durch gespeicherte
Rechnungsdaten belegten Jahre des Profils. Ist kein Jahr belegbar oder fehlt
ein gültiges Rechnungsdatum, gilt die Untergrenze vorsichtshalber für alle
noch nicht angelegten Jahresnummernkreise dieses Profils. Dadurch können bei
unklaren Altbeständen Lücken entstehen. Neue Jahre ohne solche Unsicherheit
beginnen bei 1. Ein Neustart initialisiert keine Zähler erneut. Die alten
Organisationsfelder bleiben lesbar; `next_invoice_number` ist nur noch ein
Kompatibilitätswert der letzten Vergabe, keine Quelle der Jahresnummerierung.
Präfix und Zahlungsziel sind für neue Rechnungen ohne Wirkung.

„Steuer ID“ ist ein eigenständiges optionales Profilfeld (maximal 100 Zeichen),
getrennt von Steuernummer und Umsatzsteuer-ID. Neue Rechnungen übernehmen den
Wert in ihren unveränderlichen Snapshot und zeigen `Steuer ID: …` nur bei
vorhandenem Wert. Es erfolgt keine externe Prüfung. Neue Rechnungen erzeugen
kein Fälligkeitsdatum aus dem alten Zahlungsziel; freie Rechnungstexte und
Zahlungshinweise bleiben erhalten. IBAN-Eingaben mit oder ohne Leerzeichen
werden vor der bestehenden internationalen Validierung normalisiert und zur
Anzeige in Vierergruppen gegliedert. Gespeichert bleibt der kompakte Kontowert.

Vollständige Backups enthalten Einstellungen und Nummernkreise zusammen mit
allen PDFs in der SQLite-Sicherung; die Wiederherstellung migriert alte
Einzel- und Mehrprofilbestände ausschließlich in einer temporären Kopie.
Der CSV-Datenexport enthält beide neuen Nummernkreistabellen ebenfalls.
