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
- Abrechenbare Termine für einen Monat prüfen und Rechnungen als PDF erstellen.
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
- Review billable sessions for a month and generate PDF invoices.
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
