# TT Rechnungsverwaltung -- Projekt- und Umsetzungsplan

**Ziel:** Eine einfache, private Webanwendung zur Erfassung von
Trainingstagen und zur automatischen Erstellung der monatlichen
TTC-Rechnung.

**Entwicklungsstrategie:** Zuerst lokal auf Linux entwickeln und testen,
den Quellcode über ein privates GitHub-Repository verwalten und die
fertige Anwendung anschließend auf einem privaten Server mit VPN-Zugriff
betreiben.

------------------------------------------------------------------------

## 1. Ziel und Funktionsumfang

Die Anwendung soll ausschließlich diese Aufgaben erfüllen:

1.  Vier verschiedene Tätigkeitsarten mit individuellen Preisen
    verwalten.
2.  Einen regulären Wochenplan mit wiederkehrenden Trainingstagen
    hinterlegen.
3.  Für jeden Monat automatisch einen Kalender erzeugen.
4.  Reguläre Trainingstage im Kalender vorausfüllen.
5.  Trainingstage anklicken und als tatsächlich durchgeführt bestätigen.
6.  Krankheitstage oder andere Ausfälle markieren.
7.  Zusätzliche Einsätze eintragen, wenn an einem anderen Tag
    ausgeholfen wurde.
8.  Tätigkeit und Stunden pro Termin individuell ändern.
9.  Mehrere Tätigkeiten am selben Tag erfassen können.
10. Beträge und Gesamtsumme automatisch berechnen.
11. Eine PDF-Rechnung erstellen, die der bereitgestellten
    TTC-Rechnungsvorlage möglichst genau entspricht.
12. Die PDF speichern, erneut öffnen und drucken können.

Nicht vorgesehen sind Mitgliederverwaltung, Statistiken,
Kalender-Synchronisierung oder andere unnötige Zusatzfunktionen.

### Wichtige fachliche Regeln

-   Reguläre Termine aus dem Wochenplan sind zunächst nur
    vorausgefüllt/geplant.
-   Ein Termin wird nur berechnet, wenn er als tatsächlich durchgeführt
    bestätigt wurde.
-   Ausgefallene Termine (z. B. wegen Krankheit) werden nicht berechnet.
-   Zusätzliche Einsätze können an beliebigen Tagen hinzugefügt werden.
-   Änderungen an einem einzelnen Termin verändern nicht den
    Standard-Wochenplan.
-   Pro Tag können mehrere Tätigkeiten mit jeweils eigenen Stunden
    erfasst werden.
-   Eine bereits erstellte Rechnung muss ihre damaligen Preise und
    Positionen unveränderlich behalten. Spätere Preisänderungen dürfen
    alte Rechnungen nicht verändern.

------------------------------------------------------------------------

## 2. Empfohlene Technologie

  -----------------------------------------------------------------------
  Bereich                 Technologie             Aufgabe
  ----------------------- ----------------------- -----------------------
  Benutzeroberfläche      HTML                    Struktur der Webseiten

  Gestaltung              CSS                     Layout, Farben,
                                                  Kalender und Formulare

  Interaktion             Vanilla JavaScript      Kalender bedienen und
                                                  API aufrufen

  Backend                 Python + FastAPI        Geschäftslogik und
                                                  Schnittstellen

  Datenbank               SQLite                  Wochenplan,
                                                  Trainingstermine,
                                                  Preise und Rechnungen

  PDF-Erstellung          ReportLab               Rechnung im gewünschten
                                                  Layout erzeugen

  Tests                   pytest                  Berechnungen,
                                                  Kalenderlogik und
                                                  Datenbank prüfen

  Versionsverwaltung      Git + privates GitHub   Quellcode versionieren

  Späterer Betrieb        Linux-Server + VPN      Privater Zugriff rund
                                                  um die Uhr
  -----------------------------------------------------------------------

**Architekturentscheidung:** SQLite wird für dauerhaft gespeicherte
Trainings- und Rechnungsdaten verwendet. Preise und Einstellungen können
ebenfalls in SQLite gespeichert werden. So bleiben die Daten an einer
zentralen Stelle und können zuverlässig miteinander verknüpft werden.

------------------------------------------------------------------------

## 3. Architektur und Datenfluss

Die Anwendung besteht aus zwei Hauptteilen:

-   **Frontend:** HTML, CSS und JavaScript. Hier bedienst du Kalender,
    Eingaben, Einstellungen und Rechnungsansicht.
-   **Backend:** Python mit FastAPI. Hier liegen Datenbankzugriff,
    Kalenderlogik, Berechnungen und PDF-Erstellung.

Das Frontend kommuniziert ausschließlich über HTTP-API-Endpunkte mit dem
Backend. HTML und JavaScript greifen nicht direkt auf die Datenbank zu.

``` mermaid
flowchart TD
    A[index.html] --> B[app.js]
    B --> C[calendar.js]
    B --> D[trainings.js]
    B --> E[invoice.js]
    C --> F[FastAPI: main.py]
    D --> F
    E --> F
    F --> G[calendar_service.py]
    F --> H[calculation_service.py]
    F --> I[invoice_generator.py]
    F --> J[database.py]
    G --> J
    H --> J
    I --> H
    J --> K[(SQLite: ttc.db)]
    I --> L[PDF-Datei]
```

### Beispiel: Einen Trainingstag erfassen

1.  Du öffnest den Monatskalender im Browser.
2.  `calendar.js` zeigt die Tage und die aus dem Wochenplan erzeugten
    Standardtermine an.
3.  Du klickst einen Termin an und bestätigst, dass er stattgefunden
    hat.
4.  `trainings.js` sendet die Änderung über die API an `main.py`.
5.  FastAPI validiert die Eingabe und speichert sie über `database.py`.
6.  Die Berechnungslogik ermittelt den Betrag anhand der Tätigkeit, der
    Stunden und des für diesen Termin geltenden Preises.
7.  Der Kalender lädt die aktualisierten Daten und zeigt den Termin als
    durchgeführt an.
8.  Bei der Rechnungserstellung werden nur tatsächlich durchgeführte
    Termine des gewählten Monats berücksichtigt.

------------------------------------------------------------------------

## 4. Vorgeschlagene Projektstruktur

``` text
ttc-rechnungen/
│
├── frontend/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js
│       ├── calendar.js
│       ├── trainings.js
│       └── invoice.js
│
├── backend/
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   ├── calendar_service.py
│   ├── calculation_service.py
│   └── invoice_generator.py
│
├── templates/
│   └── rechnung_vorlage.pdf
│
├── data/
│   └── ttc.db
│
├── rechnungen/
│
├── tests/
│   ├── test_calendar.py
│   ├── test_calculations.py
│   └── test_invoice.py
│
├── requirements.txt
├── .gitignore
└── README.md
```

### Aufgaben der Dateien

  -----------------------------------------------------------------------
  Datei                               Verantwortlichkeit
  ----------------------------------- -----------------------------------
  `frontend/index.html`               Grundstruktur der
                                      Benutzeroberfläche

  `frontend/css/style.css`            Gestaltung, Kalenderdarstellung und
                                      responsive Layouts

  `frontend/js/app.js`                Initialisiert die Oberfläche und
                                      verbindet die JavaScript-Module

  `frontend/js/calendar.js`           Monatskalender, Navigation,
                                      Tagesauswahl und Markierungen

  `frontend/js/trainings.js`          Termine hinzufügen, bearbeiten,
                                      bestätigen und ausfallen lassen

  `frontend/js/invoice.js`            Abrechnungsmonat auswählen,
                                      Vorschau und PDF anfordern

  `backend/main.py`                   FastAPI-Anwendung und API-Endpunkte

  `backend/database.py`               SQLite-Verbindung und
                                      Datenbankoperationen

  `backend/models.py`                 Datenmodelle und Eingabevalidierung

  `backend/calendar_service.py`       Erzeugt Standardtermine aus dem
                                      Wochenplan und berücksichtigt
                                      Abweichungen

  `backend/calculation_service.py`    Berechnet Rechnungspositionen und
                                      Gesamtsumme

  `backend/invoice_generator.py`      Erstellt die PDF-Rechnung mit
                                      ReportLab

  `templates/rechnung_vorlage.pdf`    Optische Vorlage der
                                      Originalrechnung

  `data/ttc.db`                       Lokale SQLite-Datenbank

  `rechnungen/`                       Erzeugte PDF-Rechnungen

  `tests/`                            Automatisierte Tests

  `requirements.txt`                  Python-Abhängigkeiten

  `.gitignore`                        Schließt lokale Daten und
                                      Geheimnisse von Git aus

  `README.md`                         Installations-, Start- und
                                      Projektdokumentation
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 5. Datenmodell

Die Datenbank soll mindestens folgende Bereiche enthalten.

### A. Tätigkeitsarten und Preise

Es gibt vier konfigurierbare Tätigkeitsarten. Die bisher bekannten
Beispielpreise aus der Rechnungsvorlage sind:

  Tätigkeitsart                     Beispielpreis
  ---------------------------- ------------------
  Assistenz-Trainingseinheit                 20 €
  Trainingseinheit                           15 €
  Spielbetreuung                             12 €
  Vierte Tätigkeitsart           Noch festzulegen

Die Preise sind zentral konfigurierbar. Die vierte Tätigkeitsart und ihr
Preis müssen vor der endgültigen Nutzung ergänzt werden.

### B. Wochenplan

Der Wochenplan enthält die regulären Termine, beispielsweise:

-   Wochentag
-   Standard-Tätigkeitsart
-   Standard-Stundenzahl
-   Aktiv/inaktiv

Die konkreten Wochentage, Tätigkeiten und Stunden werden später anhand
des tatsächlichen Trainingsplans eingerichtet.

### C. Trainingstermine

Jeder einzelne Termin enthält mindestens:

-   Datum
-   Tätigkeitsart
-   Stunden
-   Status: geplant, durchgeführt oder ausgefallen
-   Optional eine Notiz
-   Den für den Termin geltenden Preis

Ein Tag kann mehrere Trainingseinträge enthalten.

### D. Rechnungen und Rechnungspositionen

Eine Rechnung speichert:

-   Abrechnungsmonat und Jahr
-   Rechnungsdatum
-   Rechnungsnummer, falls benötigt
-   Rechnungspositionen
-   Bezeichnung jeder Position
-   Datum, Stunden und Einzelbetrag
-   Verwendete Preise als feste Werte
-   Gesamtsumme
-   Dateiname und Speicherort der PDF

**Wichtig:** Die fertige Rechnung wird als eigener Datensatz mit ihren
Positionen und Preiswerten gespeichert. Sie darf nicht bei jedem Öffnen
anhand der aktuellen Preisliste neu berechnet werden.

------------------------------------------------------------------------

## 6. API-Schnittstellen

Das Frontend verwendet die folgenden Endpunkte. Die Monats- und
Jahreswerte sind dynamisch und keine fest codierten Werte.

  --------------------------------------------------------------------------------
  Methode                 Endpunkt                         Funktion
  ----------------------- -------------------------------- -----------------------
  `GET`                   `/api/settings`                  Preise und
                                                           Grundeinstellungen
                                                           laden

  `PUT`                   `/api/settings`                  Preise und
                                                           Einstellungen speichern

  `GET`                   `/api/weekly-plan`               Standard-Wochenplan
                                                           laden

  `PUT`                   `/api/weekly-plan`               Wochenplan bearbeiten

  `GET`                   `/api/calendar/{year}/{month}`   Monatskalender laden

  `POST`                  `/api/trainings`                 Termin hinzufügen

  `PUT`                   `/api/trainings/{id}`            Termin bearbeiten oder
                                                           Status ändern

  `DELETE`                `/api/trainings/{id}`            Termin löschen

  `POST`                  `/api/invoices/preview`          Rechnung berechnen und
                                                           Vorschau erzeugen

  `POST`                  `/api/invoices`                  Rechnung erstellen und
                                                           speichern

  `GET`                   `/api/invoices/{id}/pdf`         Gespeicherte PDF
                                                           abrufen
  --------------------------------------------------------------------------------

------------------------------------------------------------------------

## 7. Entwicklungsphasen

Die Umsetzung erfolgt in sechs Phasen. Nach jeder Phase wird getestet,
bevor die nächste beginnt.

### Phase 1 -- Projekt vorbereiten

**Geschätzter Aufwand: 1--2 Stunden**

Aufgaben:

-   Python-Version und Git auf dem Linux-Rechner prüfen.
-   Privates GitHub-Repository erstellen.
-   Projektordner und Unterordner anlegen.
-   Python Virtual Environment einrichten.
-   `requirements.txt` erstellen.
-   `.gitignore` konfigurieren.
-   Minimale FastAPI-Anwendung erstellen.
-   Test-Endpunkt einrichten.

**Ergebnis:** Ein sauberes, startfähiges Projekt.

### Phase 2 -- Datenbank und Backend

**Geschätzter Aufwand: 3--5 Stunden**

Aufgaben:

-   SQLite-Datenbank erstellen.
-   Tabellen für Tätigkeiten, Wochenplan, Trainingstermine, Rechnungen
    und Rechnungspositionen definieren.
-   Daten speichern, laden, ändern und löschen können.
-   FastAPI einrichten.
-   API-Endpunkte programmieren.
-   Eingabevalidierung und Fehlerbehandlung ergänzen.

**Ergebnis:** Die Anwendung kann Daten zuverlässig verwalten.

### Phase 3 -- Kalender und Benutzeroberfläche

**Geschätzter Aufwand: 4--7 Stunden**

Aufgaben:

-   HTML-Grundgerüst erstellen.
-   Monatskalender mit Vor- und Zurücknavigation bauen.
-   Reguläre Trainingstage aus dem Wochenplan vorausfüllen.
-   Termine anklicken und bearbeiten können.
-   Termine als durchgeführt oder ausgefallen markieren.
-   Zusätzliche Trainingstage hinzufügen.
-   Tätigkeit und Stunden individuell ändern.
-   Mehrere Tätigkeiten am selben Tag ermöglichen.
-   Smartphone- und Desktopdarstellung berücksichtigen.

**Ergebnis:** Der Trainingsmonat kann vollständig im Browser verwaltet
werden.

### Phase 4 -- Berechnung und Rechnungslogik

**Geschätzter Aufwand: 2--4 Stunden**

Aufgaben:

-   Preise zentral hinterlegen.
-   Betrag je Position aus Stunden × Preis berechnen.
-   Nur tatsächlich durchgeführte Termine berücksichtigen.
-   Zusätzliche Einsätze berücksichtigen.
-   Mehrere Tätigkeiten am selben Tag berücksichtigen.
-   Positionen entsprechend der Rechnungsvorlage darstellen.
-   Gesamtsumme berechnen.
-   Monatsübersicht anzeigen.
-   Verwendete Preise für Rechnungen unveränderlich speichern.

**Ergebnis:** Die Abrechnung stimmt rechnerisch.

### Phase 5 -- PDF-Generator

**Geschätzter Aufwand: 3--6 Stunden**

Aufgaben:

-   Original-PDF als Gestaltungsvorlage analysieren.
-   Absender, Empfänger, Anschrift und Kontaktdaten einbauen.
-   Rechnungsüberschrift und Abrechnungszeitraum automatisch erzeugen.
-   Rechnungsdatum einfügen.
-   Positionstabelle mit Trainingseinheit, Datum, Stunden und Betrag
    erstellen.
-   Gesamtsumme, Bankverbindung und Grußformel ergänzen.
-   Automatischen Dateinamen erzeugen: `Rechnung_TTC_YYYY-MM.pdf`.
-   PDF im Browser anzeigen und speichern.
-   Drucken ermöglichen.
-   PDF mit der Originalvorlage vergleichen.

**Ergebnis:** Eine fertige Rechnung im gewünschten Layout.

### Phase 6 -- Gesamttest und Hosting

**Geschätzter Aufwand: 3--6 Stunden**

Aufgaben:

-   Krankheitstage testen.
-   Zusätzliche Einsätze testen.
-   Mehrere Tätigkeiten an einem Tag testen.
-   Monats- und Jahreswechsel testen.
-   Preisänderungen testen.
-   PDF-Erstellung und Dateinamen testen.
-   Drucken und erneutes Öffnen gespeicherter Rechnungen testen.
-   Datenbank-Backups einrichten.
-   Anwendung auf privaten Server übertragen.
-   Zugriff über VPN absichern.

**Ergebnis:** Eine zuverlässige private Anwendung, die rund um die Uhr
erreichbar sein kann.

Die Zeitangaben sind grobe Schätzungen für eine KI-gestützte Umsetzung
einschließlich Tests und Korrekturen.

------------------------------------------------------------------------

## 8. KI-gestützte Arbeitsweise

Für jede Phase wird ein eigener Arbeitsauftrag an die KI gegeben. Die KI
soll den vorhandenen Projektstand berücksichtigen und nicht ungefragt
die Architektur umbauen.

### Allgemeiner Arbeitsauftrag für die KI

Diesen Auftrag zu Beginn einer Entwicklungsphase verwenden:

> # Arbeitsregeln für die Entwicklung der TT Rechnungsverwaltung
>
> Wir entwickeln eine kleine, private Rechnungsanwendung für meine
> Tätigkeit als Tischtennis-Trainer beim TTC Köln e.V.
>
> ## Technologie
>
> -   Frontend: HTML, CSS und Vanilla JavaScript
> -   Backend: Python mit FastAPI
> -   Datenbank: SQLite
> -   PDF-Erstellung: ReportLab
> -   Versionsverwaltung: Git und privates GitHub-Repository
>
> ## Grundregeln
>
> 1.  Halte dich an die bestehende Projektstruktur.
> 2.  Entwickle nur die Funktionen, die zum aktuellen Arbeitspaket
>     gehören.
> 3.  Ändere keine anderen Dateien ohne nachvollziehbaren Grund.
> 4.  Gib immer den vollständigen Inhalt neu erstellter oder geänderter
>     Dateien aus.
> 5.  Erkläre, in welchen Ordner jede Datei gehört.
> 6.  Erkläre, wie ich die Änderungen starte und teste.
> 7.  Schreibe verständlichen, modularen und kommentierten Code.
> 8.  Berücksichtige Fehlerbehandlung und Eingabevalidierung.
> 9.  Schreibe passende Tests für wichtige Berechnungen und
>     Datenbankfunktionen.
> 10. Erfinde keine fehlenden Preise, Tätigkeitsarten oder
>     Rechnungsdaten. Frage nach, wenn Angaben fehlen.
>
> ## Funktionsziel
>
> Die Anwendung soll einen flexiblen Monatskalender bieten. Reguläre
> Trainingstage werden aus einem Wochenplan vorausgefüllt. Ich bestätige
> tatsächlich durchgeführte Termine, markiere Krankheitstage als
> ausgefallen und kann zusätzliche Einsätze hinzufügen. Tätigkeiten und
> Stunden sind pro Termin änderbar.
>
> Nur tatsächlich durchgeführte Termine werden abgerechnet. Preise
> werden zentral verwaltet. Rechnungen speichern ihre verwendeten Preise
> unveränderlich.
>
> Die PDF-Rechnung soll der bereitgestellten TTC-Rechnungsvorlage
> möglichst genau entsprechen. Der Dateiname lautet
> `Rechnung_TTC_YYYY-MM.pdf`.
>
> ## Arbeitsweise
>
> Bearbeite jetzt ausschließlich das von mir beschriebene Arbeitspaket.
> Erkläre zuerst kurz deinen Lösungsansatz und liefere danach den Code,
> die Dateipfade und die Testanleitung. Warte anschließend auf mein
> Testergebnis, bevor du mit dem nächsten Arbeitspaket beginnst.

### Konkrete KI-Arbeitsaufträge

#### Phase 1 -- Projektgerüst erstellen

> Erstelle das Grundgerüst der TT Rechnungsverwaltung gemäß unserer
> vereinbarten Projektstruktur.
>
> Aufgaben: 1. Erstelle alle benötigten Ordner. 2. Erstelle eine
> `requirements.txt` mit FastAPI, Uvicorn, ReportLab und den benötigten
> Abhängigkeiten. 3. Erstelle eine passende `.gitignore`. 4. Erstelle
> eine `README.md` mit Installations- und Startanleitung. 5. Richte eine
> Python Virtual Environment ein. 6. Erstelle eine minimale
> FastAPI-Anwendung in `backend/main.py`. 7. Erstelle einen
> Test-Endpunkt, der eine erfolgreiche Verbindung bestätigt.
>
> Gib mir alle Terminalbefehle und Dateien vollständig aus. Erkläre, wie
> ich die Anwendung starte und teste.

#### Phase 2 -- Datenbank und Backend

> Entwickle jetzt das Datenbank- und Backend-Grundgerüst.
>
> Erstelle: - `backend/database.py` - `backend/models.py` -
> `backend/main.py`
>
> Lege Datenbankstrukturen für folgende Bereiche an: 1. Vier
> konfigurierbare Tätigkeitsarten mit Preisen. 2. Einen wiederkehrenden
> Wochenplan. 3. Einzelne Trainingstermine mit Datum, Stunden,
> Tätigkeit, Status und individuellem Preis. 4. Rechnungen mit
> gespeicherten Rechnungspositionen und festen Preisen.
>
> Erstelle die notwendigen FastAPI-Endpunkte zum Laden, Anlegen,
> Bearbeiten und Löschen dieser Daten.
>
> Wichtig: Bereits gespeicherte Rechnungen dürfen sich durch spätere
> Preisänderungen nicht verändern.
>
> Teste die Datenbankfunktionen und erkläre mir, wie ich sie lokal
> überprüfen kann.

#### Phase 3 -- Kalender und HTML-Oberfläche

> Entwickle die HTML-, CSS- und JavaScript-Benutzeroberfläche für die
> TT Rechnungsverwaltung.
>
> Anforderungen: 1. Monatskalender mit Vor- und Zurücknavigation. 2.
> Reguläre Trainingstage werden aus dem Wochenplan automatisch
> vorausgefüllt. 3. Jeder Termin kann angeklickt werden. 4. Ein Termin
> kann als durchgeführt oder ausgefallen markiert werden. 5. Zusätzliche
> Trainingstage können hinzugefügt werden. 6. Pro Termin können
> Tätigkeit und Stunden individuell geändert werden. 7. Mehrere
> Tätigkeiten am selben Tag müssen möglich sein. 8. Änderungen am
> einzelnen Termin dürfen den Wochenplan nicht verändern. 9. Die
> Oberfläche muss auf Desktop und Smartphone gut bedienbar sein.
>
> Verwende HTML, CSS und Vanilla JavaScript. Verbinde die Oberfläche
> über die vereinbarten FastAPI-Endpunkte mit dem Backend.
>
> Erstelle alle Dateien vollständig und erkläre die Testschritte.

#### Phase 4 -- Berechnungen

> Entwickle die Abrechnungslogik der TT Rechnungsverwaltung.
>
> Anforderungen: - Nur tatsächlich durchgeführte Termine werden
> berücksichtigt. - Ausgefallene Termine werden nicht berechnet. -
> Zusätzliche Einsätze werden berücksichtigt. - Mehrere Tätigkeiten pro
> Tag sind möglich. - Der Betrag einer Position ergibt sich aus Stunden
> multipliziert mit dem passenden Stundensatz. - Die Gesamtsumme wird
> automatisch berechnet. - Die Rechnung muss die zum
> Abrechnungszeitpunkt gültigen Preise festhalten. - Die Berechnung muss
> für jeden Abrechnungsmonat separat funktionieren.
>
> Zeige die berechneten Positionen und die Gesamtsumme in der
> HTML-Oberfläche an.
>
> Schreibe Tests für alle wichtigen Fälle, insbesondere Krankheitstage,
> zusätzliche Einsätze, mehrere Tätigkeiten an einem Tag und
> Preisänderungen.

#### Phase 5 -- PDF-Erstellung

> Entwickle den PDF-Rechnungsgenerator mit ReportLab.
>
> Verwende die bereitgestellte Originalrechnung des TTC Köln als
> Gestaltungsvorlage.
>
> Übernimm möglichst genau: - Absender und Empfänger - Anschrift und
> Kontaktdaten - Rechnungsüberschrift und Abrechnungszeitraum -
> Rechnungsdatum - Positionstabelle mit Trainingseinheit, Datum, Stunden
> und Betrag - Gesamtsumme - Bankverbindung - Grußformel und
> Unterschrift
>
> Die Daten sollen automatisch aus der Datenbank und der
> Berechnungslogik übernommen werden.
>
> Der Dateiname muss automatisch `Rechnung_TTC_YYYY-MM.pdf` lauten.
>
> Die fertige PDF soll über die Benutzeroberfläche angezeigt,
> gespeichert und gedruckt werden können.
>
> Teste das Layout durch Vergleich mit der Originalvorlage.

#### Phase 6 -- Gesamttest und Bereitstellung

> Prüfe die vollständige TT Rechnungsverwaltung auf Fehler und bereite
> sie für den späteren privaten Serverbetrieb vor.
>
> Teste: 1. Reguläre Trainingstage. 2. Krankheit und ausgefallene
> Termine. 3. Zusätzliche Einsätze. 4. Änderungen an Tätigkeit und
> Stunden. 5. Mehrere Tätigkeiten an einem Tag. 6. Monats- und
> Jahreswechsel. 7. Preisänderungen. 8. Erstellung und Speicherung von
> Rechnungen. 9. PDF-Dateinamen und PDF-Layout. 10. Drucken und erneutes
> Öffnen gespeicherter Rechnungen.
>
> Prüfe außerdem: - Datenbank-Backups. - Fehlerbehandlung. - Sichere
> Speicherung persönlicher Daten. - Keine persönlichen Daten, Bankdaten,
> Trainingsdaten oder fertigen Rechnungen in GitHub. - Geeignete
> Konfiguration für einen privaten Server und VPN-Zugriff.
>
> Erstelle eine abschließende Test- und Installationsanleitung.

------------------------------------------------------------------------

## 9. Testplan: Wann ist das Projekt fertig?

  Testfall                         Erwartetes Verhalten
  -------------------------------- ----------------------------------------
  Regulärer Dienstag               Termin erscheint vorausgefüllt
  Dienstag krank                   Keine Abrechnung
  Freitag ausgeholfen              Zusätzlicher Termin wird angelegt
  Tätigkeit geändert               Passender Preis wird verwendet
  Zwei Tätigkeiten am selben Tag   Beide Positionen werden berechnet
  Preis später geändert            Alte Rechnung bleibt unverändert
  Neuer Monat                      Neuer Kalender wird erzeugt
  Rechnung erstellt                PDF mit richtigem Monatsnamen
  Rechnung erneut geöffnet         Gespeicherte Rechnung bleibt identisch

Das Projekt gilt erst dann als fertig, wenn alle diese Fälle erfolgreich
getestet wurden.

------------------------------------------------------------------------

## 10. GitHub und Datensicherheit

GitHub soll ausschließlich den Programmcode verwalten.

**Nicht in GitHub speichern:**

-   `ttc.db`
-   persönliche Adress- und Bankdaten
-   tatsächliche Trainingsdaten
-   erzeugte Rechnungen
-   Zugangsdaten und Passwörter

Die `.gitignore` sollte unter anderem enthalten:

``` gitignore
.venv/
__pycache__/
*.pyc
.env
data/
rechnungen/
*.db
```

Die PDF-Vorlage sollte nur dann ins Repository, wenn die Berechtigung
besteht, sie dort abzulegen. Ansonsten bleibt sie lokal bzw. auf dem
Server.

Für den späteren Serverbetrieb sind regelmäßige Backups der Datenbank
und der Rechnungen notwendig. Der Zugriff soll über ein VPN abgesichert
werden; die Anwendung sollte nicht ungeschützt öffentlich erreichbar
sein.

------------------------------------------------------------------------

## 11. Projekt-Roadmap und Meilensteine

1.  **M1 -- Grundgerüst:** Python, GitHub, Ordnerstruktur und FastAPI
    funktionieren.
2.  **M2 -- Datenverwaltung:** Wochenplan, Tätigkeiten, Preise und
    Termine können gespeichert werden.
3.  **M3 -- Kalender:** Trainingstage können angeklickt, bestätigt und
    bearbeitet werden.
4.  **M4 -- Abrechnung:** Die Anwendung berechnet Beträge und
    Gesamtsumme korrekt.
5.  **M5 -- PDF:** Die Rechnung entspricht der Vorlage und lässt sich
    speichern und drucken.
6.  **M6 -- Serverbetrieb:** Backups, VPN und privater 24/7-Zugriff
    funktionieren.

------------------------------------------------------------------------

## 12. Konkreter Start

Wir beginnen ausschließlich mit **Phase 1 -- Projekt vorbereiten**.

Auf dem Linux-Rechner zunächst diese Befehle ausführen:

``` bash
python3 --version
git --version
```

Die Ausgaben notieren bzw. in den Chat kopieren. Danach richten wir das
Repository und die Projektstruktur ein.

**Wichtig:** Noch keine Kalenderoberfläche und keine PDF-Logik
programmieren. Erst wenn die technische Grundlage sauber funktioniert,
beginnen wir mit Phase 2.

------------------------------------------------------------------------

## Offene Angaben, die vor der fertigen Abrechnung geklärt werden müssen

-   Die vierte Tätigkeitsart und ihr Preis.
-   Die tatsächlichen regulären Trainingstage.
-   Die Standardtätigkeit und Stundenanzahl je Trainingstag.
-   Die noch fehlenden Rechnungsangaben, beispielsweise IBAN und
    gegebenenfalls Rechnungsnummer.
-   Ob die Rechnungspositionen einzeln nach Datum oder gruppiert nach
    Trainingseinheit dargestellt werden sollen -- maßgeblich ist
    zunächst die Originalvorlage.

Diese Angaben können während der Entwicklung ergänzt werden. Fehlende
Werte dürfen nicht von der KI erfunden werden.

------------------------------------------------------------------------

## 13. Erweiterung: Rechnungseinstellungen und Organisationsstruktur

Diese Ergänzung dokumentiert den Umsetzungsstand vom November 2026. Sie
erweitert die bestehende Anwendung, ersetzt aber nicht die ursprünglichen
Entwicklungsphasen.

### Rechnungseinstellungen

Der Bereich **Rechnungseinstellungen** verwaltet über die Oberfläche:

- Absender und Rechnungsempfänger mit Anschriften und Kontaktdaten.
- Bankverbindung und optionale steuerliche Angaben.
- Rechnungsnummern-Präfix, Zahlungsziel, Rechnungstext, Zahlungshinweis,
  Standard-Leistungsbeschreibung und Fußzeile.
- PNG- oder JPEG-Logo. Uploads sind auf 2 MB und höchstens 4000 × 4000
  Pixel beschränkt.

Telefon, BIC, Bankname und Steuerangaben sind optional. Rechnungsnummern
werden beim Erstellen serverseitig aus Präfix, Jahr und Zähler gebildet,
zum Beispiel `RE-2026-0001`; das Rechnungsdatum wird ebenfalls
serverseitig gesetzt.

### Datenbank, Migration und Rechnungssnapshots

`organizations` speichert die Rechnungseinstellungen und den
Rechnungsnummernzähler. Tätigkeiten, Wochenplan, Trainingstermine,
Rechnungen und Rechnungspositionen tragen eine `organization_id`. Die
Anwendung verwendet derzeit automatisch die Standardorganisation mit ID 1.
Benutzerkonten, Login, Registrierung und Mehrbenutzerbetrieb gehören nicht
zu dieser Erweiterung.

Die Datenbankmigrationen sind versioniert in `schema_migrations` und werden
beim Start ausgeführt. Vorhandene Datensätze werden der
Standardorganisation zugeordnet; bestehende Rechnungspositionen, Nummern
und PDF-Pfade bleiben erhalten. Die Migration erzeugt keine neuen PDFs.

Neue Rechnungen speichern die verwendeten Rechnungseinstellungen, Logo-
Daten und Positionen als Snapshot. Änderungen an Preisen, Adressen,
Bankdaten oder Logo wirken sich nicht auf bereits gespeicherte PDFs aus.
Ältere Rechnungen behalten ihre ursprüngliche PDF-Datei, erhalten aber
rückwirkend keinen Snapshot.

Logos und Rechnungssnapshots liegen in SQLite und werden vom bestehenden
Datenbank-Backup erfasst. Der Backup-Job kopiert den Ordner
`rechnungen/` mit den generierten PDF-Dateien nicht; diese Dateien müssen
separat gesichert werden.

### Ergänzte API

- `GET` / `PUT /api/organization/settings`: Organisationseinstellungen
  laden und speichern.
- `POST` / `GET` / `DELETE /api/organization/logo`: Logo hochladen,
  abrufen und entfernen.
- `POST /api/invoices`: Rechnungsdatum und Rechnungsnummer automatisch
  erzeugen und die Rechnung samt Einstellungen und Positionen speichern.
- `GET /api/invoices/{id}/pdf`: die gespeicherte PDF unverändert abrufen.

### Verifikation des Erweiterungsstands

Die automatisierte Suite umfasst Tests für Einstellungen, Validierung,
Logo-Upload, automatische Nummerierung und Datumsvergabe, historische
Snapshots, Legacy-Migration, PDF-Erzeugung und Backup-Wiederherstellung.
Zuletzt liefen alle **38 Tests erfolgreich**.

Die Rechnungseinstellungen sind für den lokalen Betrieb vorgesehen. Ein
Server-Deployment, Login und tatsächlicher Mehrbenutzerbetrieb sind nicht
Bestandteil dieser Erweiterung.

------------------------------------------------------------------------

## 14. Korrekturrunde: Wochenplan, Einstellungen und Rechnungsvorschau

Diese Ergänzung dokumentiert die Korrekturen vom 8. November 2026.

### Wochenplan und Trainingstermine

Beim Speichern des Wochenplans werden fehlende Termine für den aktuellen
und den Folgemonat als Datensätze mit Status `planned` angelegt. Beim
erstmaligen Abruf weiterer zukünftiger Monate werden die dort passenden
Termine ebenfalls erzeugt. Eine Zuordnung aus Wochenplan-ID und Datum
verhindert wiederholte Einfügungen. Vorhandene passende Termine werden
wiederverwendet, nicht mit Planstunden überschrieben; manuelle Änderungen,
abgeschlossene und ausgefallene Termine bleiben erhalten.

Die Migration Version 3 ergänzt `trainings.weekly_plan_id` und
`trainings.weekly_plan_date` sowie einen eindeutigen Index für
Planvorkommen. Sie verändert oder entfernt keine bestehenden Trainings.
Nach erfolgreichem Speichern wird der aktuell sichtbare Kalender neu
geladen.

### Rechnungseinstellungen und Vorschau

Die Oberfläche formatiert FastAPI-Feldvalidierungsfehler als lesbare
Meldungen statt einer allgemeinen HTTP-422-Nachricht. Die Logo-Anzeige
bleibt deaktiviert, solange kein Logo gespeichert ist; die serverseitige
Validierung bleibt bestehen.

Die Rechnungsvorschau zeigt Lade-, Leer-, API- und Netzwerkzustände
sichtbar an. Sie berücksichtigt ausschließlich gespeicherte
Trainingstermine mit Status `completed` und verwendet den am Termin
gespeicherten Preis-Snapshot. Die Vorschau speichert keine Rechnung.

### Prüfung

Die vollständige automatisierte Testsuite lief nach dieser Korrekturrunde
mit **41 erfolgreichen Tests**. Die manuelle Prüfung von Kalender-
Aktualisierung, Einstellungsformular und Vorschau im Browser bleibt
erforderlich.
