# Phase 0 – Bestandsaufnahme der Desktop-Umstellung

Stand: 12.11.2026. Untersucht wurde der lokale Repository-Stand
`75b7c9c` auf `Entwicklung-App`. Der Arbeitsbaum war vor Beginn sauber.
Der neue Umstellungsbranch heißt `codex/desktop-umstellung`.
Die vorhandenen Remote-Referenzen wurden gelesen, nicht neu abgerufen.
`Entwicklung-App` enthält den lokal bekannten Stand von `origin/main`
(`aadea6c`) sowie den Planungscommit; der lokale Branch `main` liegt dahinter.

## Architektur und Start

| Bereich | Vorhandener Stand / Quelle |
| --- | --- |
| Oberfläche | HTML, CSS, natives JavaScript mit ES-Modulen in `frontend/`; kein React/Vue und kein Node-Build |
| Backend | Python, FastAPI, Pydantic; `backend/main.py` enthält REST-API, Kalendererzeugung und Abrechnungskoordination |
| Auslieferung | FastAPI bindet `frontend/` als StaticFiles unter `/` ein |
| Datenbank | Python `sqlite3`, zentrale CRUD-Funktionen in `backend/database.py`, daneben direkte SQL-Zugriffe in `main.py` |
| Schema | `organizations`, `activity_types`, `weekly_plan`, `trainings`, `invoices`, `invoice_items`; Migrationen 1–6 über `schema_migrations` |
| PDF | ReportLab in `backend/invoice_generator.py`, Ausgabe als lokale PDF-Datei |
| Installation | `requirements.txt`, keine festgeschriebenen Versionen oder Lockdatei |
| Build | Aktuell kein Paket-, Desktop- oder Installer-Build vorhanden |

Entwicklungsstart aus dem Repository:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --host 127.0.0.1
```

Windows-Aktivierung: `.venv\Scripts\activate`. Ohne `--reload` ist ein
normaler lokaler Serverstart möglich; ein eigenständiges Windows-Paket
entsteht dadurch noch nicht. Oberfläche: `http://127.0.0.1:8000`,
Health-Check: `/api/health`. Der Import von `backend.main` benötigt die
mitgelieferte Frontend-Struktur; beim Start initialisiert der Lifespan die DB.

## Funktionsbestand

| Arbeitsablauf | Tatsächlicher Umfang |
| --- | --- |
| Kunden / Empfänger | Keine separate Kundenverwaltung und keine Kundentabelle. Ein Rechnungsempfänger sowie Absender-/Vereinsdaten in Organisationseinstellungen |
| Tätigkeiten | Bis zu vier Tätigkeitsarten, Preise in Cent, Aktivierung/Deaktivierung |
| Wochenplan | Wochentag, Tätigkeit und Stunden; beim Speichern werden laufender und folgender Monat befüllt; Kalenderabruf erzeugt Termine ab dem laufenden Monat |
| Termine | Monatsnavigation, zusätzliche Termine, Bearbeiten/Löschen, Notizen, optionale Stunden; ohne Stunden wird der gespeicherte Satz einmal berechnet |
| Status | `planned`, `completed`, `cancelled`; Einzelabschluss und Sammelabschluss geplanter Wochenplantermine |
| Entwürfe | Monatliche gespeicherte, aktualisierbare Vorschau, getrennt von finaler Rechnung |
| Abrechnung | Nur abgeschlossene Termine im gewählten Monat; Cent-Rundung mit Decimal; Preis-Snapshot am Termin |
| Finale Rechnung | Eine finale Rechnung je Monat, Nummernkreis, PDF, unveränderliche Positions-/Einstellungs-/Logo-Snapshots; bestehende PDF wird nicht überschrieben |
| Archiv | Finale Rechnungen auflisten, öffnen, herunterladen und einschließlich zugehöriger PDF löschen; Vorschauen nicht über diese Löschfunktion löschbar |
| Einstellungen | Absender, Empfänger, Bank-/Steuerdaten, Texte, Zahlungsziel, Nummernkreis; PNG-/JPEG-Logo hochladen und entfernen |
| Backup | Manuelles SQLite-Backup mit Konsistenzprüfung und Rotation; optional wöchentlicher Linux-systemd-Benutzertimer |

Rechen- und Kalenderlogik liegt überwiegend in `main.py` und `database.py`.
`backend/calculation_service.py` und `backend/calendar_service.py` sind leer;
sie sind noch keine verwendbaren Fachmodule.

## Datenablage und externe Abhängigkeiten

- SQLite: `data/ttc.db`, relativ zum Quellprojekt über `PROJECT_ROOT`.
  Keine externe Datenbank, kein Login, kein Cloud-Dienst.
- PDFs: `rechnungen/`, ebenfalls im Projekt. Die DB speichert den Dateinamen;
  der PDF-Endpunkt prüft Zuordnung und Verzeichnisgrenze.
- Logos: als BLOB in der Organisation und als Snapshot in finalen Rechnungen.
  Kein allgemeines Anhangssystem vorhanden.
- Backups: standardmäßig `~/ttc-rechnungsverwaltung-backups`, nur Datenbank;
  Rechnungs-PDFs sind ausdrücklich nicht enthalten.
- Laufzeitdaten sind per `.gitignore` ausgeschlossen. Inhalte vorhandener
  Nutzerdaten wurden für diese Untersuchung nicht geöffnet oder verändert.
- Installation benötigt Python-Pakete; ein späteres Desktop-Paket muss die
  Python-Laufzeit und Abhängigkeiten mitbringen. Node/Electron fehlen noch.

## Offline- und Browserabhängigkeiten

Die Quellcodeprüfung zeigt keine externen API-Aufrufe, CDNs, Webfonts,
Telemetrie oder fest verdrahteten fremden Server-URLs im Anwendungsfrontend.
API-Aufrufe verwenden relative `/api/...`-Pfade; Styles und ES-Module sind lokal.
CSS nutzt Systemschriften, PDF nutzt ReportLabs Helvetica.
Der fachliche Betrieb ist deshalb bereits lokal ohne Internet vorgesehen,
sobald die Abhängigkeiten installiert sind und der lokale Server läuft.
Ein echter Windows-Test mit abgeschalteter Internetverbindung steht aus.
FastAPIs automatisch erzeugte `/docs`-/`/redoc`-Seiten sind keine Produktansichten;
ihre Standardressourcen können externe URLs verwenden und sind nicht als
Offline-Dokumentation eingeplant.

Für Electron besonders zu prüfen:

- Oberfläche über die lokale HTTP-Origin laden. Ein direktes `file://`-Laden
  würde die root-relativen API-Pfade nicht bedienen.
- `fetch`, DOM, ES-Module, Custom Events und `<dialog>.showModal()` sind
  Browserbestandteile; ihre Abläufe im Electron-Renderer überprüfen.
- `window.confirm` wird für Sammelabschluss und Rechnungslöschung verwendet.
- Logoauswahl erfolgt über Dateieingabe und `FileReader` (Base64-Upload).
- PDF-Links öffnen mit `target="_blank"`; Downloads verwenden das
  `download`-Attribut. Fensteröffnung, PDF-Anzeige und Speicherdialoge benötigen
  ein bewusstes Desktop-Verhalten.
- Keine Persistenz in localStorage/sessionStorage gefunden; die DB bleibt
  maßgeblicher Datenbestand.

## Entscheidung für die nächsten Phasen

Electron wird im bestehenden Repository ergänzt. Es gibt keinen erkennbaren
Grund für eine Trennung oder Neuentwicklung. Frontend, REST-Vertrag,
SQLite-Schema/Migrationen, PDF-Renderer und bestehende Tests bleiben Grundlage.

Für Phase 1 ist ein von Electron verwalteter lokaler Python-/Uvicorn-Prozess
vorgesehen. Electron lädt dessen Loopback-Origin; die Web-Startmöglichkeit
bleibt erhalten. Backend-Bereitschaft, Portwahl, Fehleranzeige, Einzelinstanz
und Beenden des Kindprozesses müssen implementiert werden. Im Paket darf
kein separat vom Benutzer installiertes Python vorausgesetzt werden.
Die konkrete Paketierung ist mit einem Windows-Build zu verifizieren.

Die Electron-Oberfläche erhält `contextIsolation: true` und keinen Node-Zugriff.
Spätere Dateioperationen werden über eine eng begrenzte IPC-Schnittstelle
angebunden. Electron erhält keine eigene Rechnungsberechnung.

## Risiken und notwendige Anpassungen

1. **Datenpfade (Phase 2/3):** DB und PDFs aus dem Installations-/Quellordner
   in ein Benutzer-Datenverzeichnis verschieben; zentral konfigurieren.
   Dabei auch die beim Import gebundenen Standardargumente in `database.py`,
   den Lifespan und die separaten Backup-Standardpfade berücksichtigen.
   Bestehende lokale Daten kontrolliert übernehmen, niemals überschreiben.
2. **Fachlogik (schrittweise):** Direkte SQL-Zugriffe und Abrechnung in
   `main.py` erschweren die Trennung. Nur bei konkretem Bedarf extrahieren;
   keine vorzeitige Neuimplementierung.
3. **Datei-/DB-Konsistenz:** PDF-Schreiben und DB-Transaktion sind nicht
   gemeinsam atomar. Ein Absturz kann verwaiste PDFs erzeugen. Beim Löschen
   wird zuerst die Rechnung entfernt; ein Dateifehler kann eine PDF
   zurücklassen (der Endpunkt meldet diesen Fall). Wiederanlauf und
   Wiederherstellung später gezielt testen.
4. **Backup (Phase 5):** Der jetzige Timer ist Linux-spezifisch und das Backup
   unvollständig für eine Desktop-Wiederherstellung. PDFs und Einstellungen
   in ein vollständiges Backup-/Restore-Konzept aufnehmen.
5. **Reproduzierbarkeit:** Paketversionen sind offen; Windows-Kompatibilität,
   Python-Version und Paketierung vor dem ersten Installer festlegen.
6. **PDF-Grenzen:** Einseitiges Layout kann bei zu viel Inhalt einen
   `ValueError` auslösen; das ist eine bestehende Einschränkung, kein in
   Phase 0 behobener Fehler.
7. **Lokale API:** Keine Authentifizierung vorhanden. Den Kindprozess nur
   an Loopback binden; Zugriffsschutz des Desktop-Dienstes, Navigation und
   neue Fenster beim Electron-Grundgerüst berücksichtigen.
8. **Dateirechte:** Laufzeitdaten erhalten bislang keine explizit restriktiven
   Rechte. Updates und Deinstallation müssen Nutzerdaten erhalten.

## Prüfung und Abnahme

Die vorhandenen Tests umfassen API, Schema-/Altdatenmigration, Preis- und
Einstellungssnapshots, Kalenderpersistenz, Status, Vorschau/Finalisierung,
PDF-Erzeugung und SQLite-Backup inklusive Wiederherstellung in Testdaten.
`test_calculations.py` und `test_calendar.py` sind leer; die entsprechende
Abdeckung liegt überwiegend in `test_api.py`. UI-/Electron-End-to-End-Tests
und Windows-Installer-Tests sind noch nicht vorhanden.

Testergebnis: `.venv/bin/python -m pytest -q` – **49 bestanden in 2,87 s**.
Der vollständige Lauf wurde außerhalb der Sandbox ausgeführt, weil der
API-Testlauf innerhalb der Sandbox hängen blieb. Die isolierten Datenbank-,
PDF- und Backup-Tests bestanden auch dort (23 Tests). Es wurde kein
fachlicher Testfehler festgestellt. Start und StaticFiles-Auslieferung werden
über den FastAPI-TestClient geprüft; ein echter Uvicorn-/Browserstart mit
Netzwerkabschaltung wurde nicht durchgeführt.

Die Bestandsaufnahme wird als eigener Dokumentationscommit auf dem
Desktop-Branch festgehalten (Commit auffindbar über den Titel
`docs: complete desktop phase 0 inventory`).
Es werden ausschließlich temporäre Testdaten verwendet. Ein Windows-System
steht in dieser Linux-Sitzung nicht zur Verfügung; die Windows-Abnahme der
allgemeinen Definition of Done bleibt ausdrücklich offen. Phase 0 bereitet
Phase 1 vor und enthält noch keine Electron-Implementierung.
