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

- `GET` und `PUT /api/settings`: Tätigkeitsarten und Preise laden bzw. ändern.
  `PUT` erwartet ein Objekt mit einer `activities`-Liste.
- `GET` und `PUT /api/weekly-plan`: Wochenplan laden bzw. vollständig ersetzen.
- `GET /api/calendar/{year}/{month}`: Monatskalender mit geplanten und
  gespeicherten Terminen laden.
- `POST`, `PUT /api/trainings/{id}` und `DELETE /api/trainings/{id}`:
  Trainingstermine verwalten.
- `POST /api/invoices/preview`: Abgeschlossene Termine eines Monats
  abrechnen und Positionen mit Trainingseinheit, Datum, Stunden und Betrag
  für die Rechnungsvorschau liefern. Die Weboberfläche stellt diese im
  Tabellenlayout der bereitgestellten Rechnung dar.
- `POST /api/invoices`: Rechnung samt unveränderlichen Positionen,
  Preis-Snapshots und PDF speichern. Der Dateiname lautet
  `Rechnung_TTC_YYYY-MM.pdf`; pro Monat wird höchstens eine Rechnung
  erstellt.
- `GET /api/invoices/{id}/pdf`: gespeicherte PDF im Browser anzeigen oder
  herunterladen. Die Weboberfläche öffnet die PDF zum Drucken im
  Browser-PDF-Viewer; dort kann der Druckdialog des Browsers verwendet
  werden, außerdem steht ein separater Download bereit.

Ungültige Eingaben werden mit `422` zurückgegeben. Eine Rechnung ohne
abrechenbare Termine ergibt `400`; Konflikte, etwa eine doppelte
Tätigkeitsbezeichnung oder eine Rechnung für einen bereits abgerechneten
Monat, ergeben `409`.

## Wichtige Hinweise

- Die virtuelle Umgebung (`.venv`) wird nicht in Git verwaltet.
- Lokale Datenbanken und generierte Rechnungen sind in `.gitignore` ausgeschlossen.
- PDF-Rechnungen werden im Ordner `rechnungen/` gespeichert.
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
