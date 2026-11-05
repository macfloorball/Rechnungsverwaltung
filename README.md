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
  abrechnen und eine Vorschau liefern.
- `POST /api/invoices`: Rechnung samt unveränderlichen Positionen und
  Preis-Snapshots speichern.
- `GET /api/invoices/{id}/pdf`: gespeicherte PDF abrufen. Bis zur
  Implementierung des PDF-Generators antwortet dieser Endpunkt mit `404`.

Ungültige Eingaben werden mit `422` zurückgegeben. Konflikte mit
Datenbankregeln, etwa eine doppelte Tätigkeitsbezeichnung, ergeben `409`.

## Wichtige Hinweise

- Die virtuelle Umgebung (`.venv`) wird nicht in Git verwaltet.
- Lokale Datenbanken und generierte Rechnungen sind in `.gitignore` ausgeschlossen.
- Benutzeroberfläche und PDF-Erstellung werden in späteren Phasen ergänzt.
