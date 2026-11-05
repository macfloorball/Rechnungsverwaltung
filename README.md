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

## Wichtige Hinweise

- Die virtuelle Umgebung (`.venv`) wird nicht in Git verwaltet.
- Lokale Datenbanken und generierte Rechnungen sind in `.gitignore` ausgeschlossen.
- Die eigentliche Anwendung wird in den späteren Phasen Schritt für Schritt erweitert.
