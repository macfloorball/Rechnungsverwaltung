# TTC-Rechnungsverwaltung

Private Webanwendung zur Erfassung von Trainingstagen und automatischen Erstellung der monatlichen TTC-Rechnung.

## Projektstruktur

```text
ttc-rechnungen/
├── backend/
│   └── main.py
├── frontend/
│   ├── css/
│   └── js/
├── templates/
├── data/
├── rechnungen/
├── tests/
├── .gitignore
├── .venv/
├── requirements.txt
├── README.md
└── TTC_Rechnungsverwaltung_Umsetzungsplan.md
```

## Voraussetzungen

- Linux-Rechner
- Git
- Python 3.15 oder kompatibel

## Einrichtung

1. Repository klonen oder in das Projektverzeichnis wechseln.
2. Virtuelle Umgebung erstellen:

```bash
python3 -m venv .venv
```

3. Umgebung aktivieren:

```bash
source .venv/bin/activate
```

4. Abhängigkeiten installieren:

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

## Starten der Anwendung

Im aktivierten Terminal:

```bash
uvicorn backend.main:app --reload
```

Danach ist die Anwendung unter:

```text
http://127.0.0.1:8000
```

erreichbar.

## Testen

Mit einem zweiten Terminal oder einem HTTP-Client:

```bash
curl http://127.0.0.1:8000/api/health
```

Erwartete Rückgabe:

```json
{"status":"ok"}
```

Die automatisierten Tests startest du mit:

```bash
python -m pytest
```

## Aktuelle API

- `GET` und `PUT /api/organization/settings`: Absender, Empfänger,
  Bankverbindung, Steuerdaten, Rechnungstexte, Zahlungsziel und
  Nummernkreis der Standardorganisation laden bzw. ändern. Feldvalidierungs-
  fehler werden im Einstellungsbereich mit Feld und Ursache angezeigt.
- `POST /api/organization/logo`: Logo als JSON mit `media_type`
  (`image/png` oder `image/jpeg`) und Base64-kodiertem `data_base64`
  hochladen. Es gelten 2 MB und höchstens 4000 × 4000 Pixel. Die
  Bildsignatur wird geprüft; SVG und beliebige Pfade werden nicht
  akzeptiert.
- `GET` und `DELETE /api/organization/logo`: gespeichertes Logo anzeigen
  beziehungsweise entfernen.
- `GET` und `PUT /api/settings`: Tätigkeitsarten und Preise laden bzw. ändern.
  `PUT` erwartet ein Objekt mit bis zu vier Einträgen in einer
  `activities`-Liste. Verwendete Tätigkeiten bleiben erhalten und können
  deaktiviert werden.
- `GET` und `PUT /api/weekly-plan`: Wochenplan laden bzw. vollständig
  ersetzen. Änderungen am Plan ändern keine bereits gespeicherten
  Trainingstermine.
- `GET /api/calendar/{year}/{month}`: Monatskalender mit geplanten und
  gespeicherten Terminen laden.
- `POST`, `PUT /api/trainings/{id}` und `DELETE /api/trainings/{id}`:
  Trainingstermine verwalten.
- `POST /api/invoices/preview`: Abgeschlossene Termine eines Monats
  abrechnen und Positionen mit Trainingseinheit, Datum, Stunden und Betrag
  für die Rechnungsvorschau liefern. Verwendet werden die beim jeweiligen
  Training gespeicherten Stundenpreise; geplante und ausgefallene Termine
  bleiben ausgeschlossen. Die Vorschau speichert keine Rechnung. Die
  Weboberfläche stellt Positionen und Summe dar, zeigt einen Ladezustand und
  meldet leere Monate sowie API- und Netzwerkfehler.
- `POST /api/invoices`: Rechnung samt unveränderlichen Positionen,
  Preis- und Rechnungseinstellungs-Snapshots sowie PDF speichern. Das
  Rechnungsdatum wird serverseitig gesetzt. Die Nummer wird aus dem
  konfigurierten Präfix, Jahr und Zähler gebildet, zum Beispiel
  `RE-2026-0001`. Der Dateiname lautet `Rechnung_TTC_YYYY-MM.pdf`; pro
  Monat wird höchstens eine Rechnung erstellt.
- `GET /api/invoices`: gespeicherte Rechnungen chronologisch, neueste zuerst,
  als Übersicht laden. Rechnungspositionen und PDF werden beim Öffnen nicht
  aus aktuellen Terminen neu berechnet. Interne Snapshot- und Logo-Daten
  werden nicht in die Übersicht ausgegeben.
- `GET /api/invoices/{id}/pdf`: gespeicherte PDF im Browser anzeigen oder
  herunterladen. Die Weboberfläche öffnet die PDF zum Drucken im
  Browser-PDF-Viewer; dort kann der Druckdialog des Browsers verwendet
  werden, außerdem steht ein separater Download bereit.

## Rechnungseinstellungen und Datenbankmigration

Der Bereich **Rechnungseinstellungen** auf der Startseite verwaltet
Absender- und Empfängerdaten, Bankverbindung, Steuerangaben, Texte,
Zahlungsziel, Rechnungsnummern-Präfix und Logo. Optionale Angaben wie
Telefonnummer, BIC und Steuerdaten müssen nicht ausgefüllt werden.
Eine Organisation wird automatisch verwendet; Organisationen auswählen,
Benutzerkonten, Login und Mehrbenutzeroberfläche sind nicht implementiert.

Die Tabelle `organizations` hält diese Angaben und einen Nummernzähler.
Tätigkeiten, Wochenplan, Trainingstermine, Rechnungen und
Rechnungspositionen besitzen eine `organization_id`. Rechnungspositionen
bleiben außerdem über `invoice_id` ihrer Rechnung zugeordnet. Damit ist die
Datenstruktur für spätere Organisationen vorbereitet; derzeit wird nur die
Standardorganisation mit ID `1` verwendet.

Beim Anwendungsstart führt `initialize_database()` die versionierten
Migrationen aus der Tabelle `schema_migrations` aus. Die Migrationen
ergänzen Organisations- und Snapshot-Spalten und ordnen vorhandene
Datensätze der Standardorganisation zu. Tätigkeiten, Wochenplan,
Trainingseinträge, Rechnungen und Rechnungspositionen werden nicht gelöscht.
Bestehende Rechnungsnummern, PDF-Pfade und Dateien bleiben erhalten.
Migrationen können bei einem Neustart erneut aufgerufen werden, ohne sie
doppelt anzuwenden.

Neue Rechnungen speichern die verwendeten Tätigkeitspositionen,
Rechnungseinstellungen und – wenn aktiviert – die Logodaten als Snapshot.
Spätere Änderungen an Organisation, Logo oder Preisen verändern weder diese
Snapshots noch das bereits generierte PDF. Ältere Rechnungen behalten ihr
ursprünglich gespeichertes PDF; für sie wird nachträglich kein
Rechnungseinstellungs-Snapshot erzeugt.

Logos liegen als Bilddaten in SQLite. Sie sind daher Teil des SQLite-
Datenbankbackups. Der bestehende Backup-Job sichert jedoch nicht den
separaten Ordner `rechnungen/`; PDF-Dateien müssen zusätzlich gesichert
werden, wenn sie über einen Verlust des Anwendungsordners hinaus erhalten
bleiben sollen.

Die Option **Logo in neuen Rechnungen anzeigen** ist erst verfügbar, wenn ein
Logo hochgeladen wurde. Ein Upload aktiviert die Logo-Anzeige; das Entfernen
des Logos deaktiviert sie.

Ungültige Eingaben werden mit `422` zurückgegeben. Eine Rechnung ohne
abrechenbare Termine ergibt `400`; Konflikte, etwa eine doppelte
Tätigkeitsbezeichnung oder eine Rechnung für einen bereits abgerechneten
Monat, ergeben `409`.

## Wichtige Hinweise

- Die virtuelle Umgebung (`.venv`) wird nicht in Git verwaltet.
- Lokale Datenbanken und generierte Rechnungen sind in `.gitignore` ausgeschlossen.
- PDF-Rechnungen werden im Ordner `rechnungen/` gespeichert.
- Tätigkeiten, Wochenplan und Rechnungsarchiv werden direkt auf der
  Startseite verwaltet.
- Datenbanksicherungen werden wöchentlich sonntags um 03:00 Uhr unter
  `~/ttc-rechnungsverwaltung-backups` angelegt; 30 Tage alte Sicherungen
  werden entfernt. Der Backup-Ordner ist nicht Teil des Git-Repositories.

## Datenbank-Backups

Nach dem Einrichten der virtuellen Umgebung den wöchentlichen systemd-Timer
einmalig installieren und aktivieren:

```bash
./.venv/bin/python scripts/install_backup_timer.py
```

Eine Sicherung kann jederzeit manuell erstellt werden:

```bash
./.venv/bin/python scripts/backup_database.py
```

Der Backup-Prozess verwendet SQLite Online Backup, prüft die Sicherung auf
Konsistenz und vergibt private Dateirechte (`0700` für den Ordner, `0600`
für Sicherungsdateien). Der Timer läuft sonntags um 03:00 Uhr; falls der
Rechner zu diesem Zeitpunkt ausgeschaltet war, holt systemd die Sicherung
nach, sobald der Benutzerdienst wieder startet.

Timerstatus und Ausführungsprotokoll:

```bash
systemctl --user status ttc-rechnungsverwaltung-backup.timer
journalctl --user -u ttc-rechnungsverwaltung-backup.service
```

Für den späteren Serverbetrieb muss der systemd-Benutzerdienst auch ohne
interaktive Anmeldung laufen dürfen (Linger). Datenbank-Backups enthalten
persönliche Daten und dürfen nicht in Git oder einen ungeschützten
Cloudspeicher kopiert werden.
