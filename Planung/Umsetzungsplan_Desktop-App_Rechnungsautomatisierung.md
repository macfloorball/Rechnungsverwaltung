# Umsetzungsplan: Rechnungsautomatisierung als lokale Desktop-App

## Zielbild

Die bestehende Rechnungsautomatisierung wird schrittweise von einer
Webanwendung zu einer installierbaren Windows-Desktop-App
weiterentwickelt.

**Leitprinzip:** Zuerst entsteht eine zuverlässige, vollständig lokal
nutzbare Anwendung. Benutzerkonten, mehrere Geräte und
Cloud-Synchronisierung werden ausdrücklich erst in späteren Phasen
ergänzt. Die Architektur soll diese Erweiterungen ermöglichen, ohne sie
vorzeitig umzusetzen.

### Ziel der ersten Ausbaustufe

-   Installierbare Windows-App mit eigenem Fenster und
    Desktop-Verknüpfung
-   Bestehende Funktionen und Geschäftslogik möglichst weitgehend
    weiterverwenden
-   Lokale Datenbank und lokale Dokumentenspeicherung
-   Offlinebetrieb ohne Anmeldung und ohne Cloud-Abhängigkeit
-   Datenexport und verlässliche lokale Backups
-   Keine unbeabsichtigten Änderungen am bisherigen Funktionsumfang

### Vorgeschlagene technische Richtung

  -----------------------------------------------------------------------
  Bereich                             Erste Ausbaustufe
  ----------------------------------- -----------------------------------
  Desktop-Hülle                       Electron

  Oberfläche                          Bestehendes Frontend
                                      weiterverwenden

  Datenbank                           SQLite, lokal auf dem PC

  Backend                             Lokal eingebetteter bzw. lokal
                                      gestarteter Anwendungsdienst --
                                      passend zur bestehenden Architektur

  Dokumente                           Lokaler, konfigurierbarer
                                      Datenordner

  Installation                        Windows-Installer (z. B. `.exe`)

  Accounts                            Noch nicht implementieren

  Cloud / sciebo                      Noch nicht implementieren
  -----------------------------------------------------------------------

**Wichtige Architekturentscheidung:** Eine SQLite-Datenbankdatei sollte
nicht von mehreren PCs gleichzeitig über einen synchronisierten
sciebo-Ordner geöffnet werden. Eine spätere Mehrgeräte-Lösung benötigt
eine geeignete Synchronisations- oder Serverarchitektur. sciebo kann
später beispielsweise für Dokumente oder verschlüsselte Backups geprüft
werden.

------------------------------------------------------------------------

# Phase 0 -- Bestandsaufnahme und Vorbereitung

**Ziel:** Den aktuellen Stand des Repositorys verstehen und festlegen,
wie die Desktop-App ergänzt wird, ohne die bestehende Anwendung unnötig
umzubauen.

## Entwicklungsschritte

-   [x] Aktuelles Repository und den relevanten Entwicklungsbranch
    untersuchen.
-   [x] Verwendetes Frontend-Framework, Backend, Datenbank und
    Build-System dokumentieren.
-   [x] Prüfen, wie die Anwendung aktuell gestartet und gebaut wird.
-   [x] Alle vorhandenen Funktionen erfassen, insbesondere Kunden,
    Wochenplan, Termine, Statusverwaltung, Rechnungsentwürfe und finale
    Rechnungen.
-   [x] Ermitteln, wo Daten aktuell gespeichert werden und welche
    externen Dienste benötigt werden.
-   [x] Prüfen, ob die Anwendung bereits lokal ohne Internetverbindung
    laufen kann.
-   [x] Abhängigkeiten von Browserfunktionen, Server-URLs und externen
    APIs identifizieren.
-   [x] Bestehende Tests und bekannte Fehler dokumentieren.
-   [x] Festlegen, ob Electron in das bestehende Repository integriert
    wird. Grundsätzlich soll das bestehende Repository weiterverwendet
    werden, sofern die Bestandsaufnahme keinen gewichtigen Grund dagegen
    zeigt.
-   [x] Einen eigenen Branch für die Desktop-Umstellung anlegen.

Bestandsaufnahme und Entscheidungen: [Phase_0_Bestandsaufnahme_Desktop.md](Phase_0_Bestandsaufnahme_Desktop.md).

Die Entwicklungsschritte sind erledigt; die allgemeine Windows-Abnahme bleibt
in dieser Linux-Sitzung offen.

## Ergebnis / Abnahmekriterien

-   Die bestehende Architektur ist dokumentiert.
-   Es ist bekannt, welche Teile unverändert weiterverwendet werden
    können.
-   Risiken und notwendige Anpassungen sind identifiziert.
-   Die Desktop-Umstellung kann getrennt von der bisherigen Webanwendung
    entwickelt und getestet werden.

------------------------------------------------------------------------

# Phase 1 -- Desktop-Grundgerüst

**Ziel:** Die bestehende Anwendung soll erstmals als eigenständiges
Windows-Programm gestartet werden können.

**Stand 12.11.2026:** Technisch weitgehend umgesetzt; **Phase 1 ist noch
nicht vollständig abgenommen**. Der Windows-x64-Testbuild wurde erzeugt,
aber nicht nativ unter Windows ausgeführt. Die Tests unten beziehen sich
auf Linux beziehungsweise auf statische Prüfungen der Windows-Dateien.

Die Markierungen unter Entwicklungsschritte kennzeichnen die vorhandene
Implementierung. Sie ersetzen keine plattformbezogene Abnahme.

## Entwicklungsschritte

-   [x] Electron in das bestehende Projekt integrieren.
-   [x] Electron-Hauptprozess und Renderer-Prozess sauber einrichten.
-   [x] Die bestehende Benutzeroberfläche im Electron-Fenster laden.
-   [x] Entwicklungs- und Produktionsstart voneinander trennen.
-   [x] Fenstertitel, App-Name, Symbol und Fenstergröße festlegen.
-   [x] Fensterverhalten für Minimieren, Maximieren und Schließen
    umsetzen.
-   [x] Sichere Electron-Grundeinstellungen verwenden, insbesondere
    `contextIsolation` aktivieren und Node-Zugriff im Renderer
    deaktivieren.
-   [x] Eine klar begrenzte IPC-Schnittstelle für später benötigte
    Desktop-Funktionen vorsehen.
-   [x] Browser-spezifische Funktionen identifizieren und bei Bedarf
    durch Desktop-kompatible Lösungen ersetzen.
-   [ ] Prüfen, ob alle bisherigen Ansichten und Arbeitsabläufe im
    Desktop-Fenster funktionieren. Unter Linux in beiden Modi praktisch
    geprüft; native Windows-Prüfung, manuelle Betriebssystemdialoge und
    tatsächliche PDF-Darstellung im Standardbrowser noch offen.
-   [x] Einen ersten Windows-Build erzeugen.

## Ergebnis / Abnahmekriterien

| Kriterium | Nachweis / Status |
| --- | --- |
| Anwendung startet im eigenen Fenster | Unter Linux für Entwicklung und Produktion geprüft; native Windows-Abnahme offen |
| Hauptoberfläche benötigt kein manuelles Browseröffnen | Electron lädt sie selbst; Rechnungs-PDFs werden gezielt an den Standardbrowser übergeben |
| Wichtigste bestehende Funktionen erreichbar | Kalender, Monatswechsel, Terminbearbeitung und -abschluss, Wochenplan, Empfängereinstellungen, Vorschauaktualisierung, Finalisierung, Archiv, Download und Logo-Upload unter Linux geprüft |
| Rechnungslogik erhalten | Keine fachliche Umstellung; Regressionstests bestanden. Kalender-Ladefehler werden nach einer gezielten UI-Korrektur sichtbar angezeigt |
| Entwicklungsstart möglich | `npm run desktop:dev` startet Electron; Electron besitzt den Python-/Uvicorn-Prozess und wartet vor dem Laden auf dessen Bereitschaft |
| Windows-Start des Testbuilds | Noch nicht geprüft; eine erzeugte PE-Datei ist kein Nachweis erfolgreicher Windows-Ausführung |

## Vorhandene Architektur und Prüfung

- Electron-Main, sandboxfähiger Preload und Renderer sind getrennt.
  `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` und
  eine restriktive CSP sind aktiv. Fremde Navigation und beliebige neue
  Fenster bleiben blockiert.
- Die Bridge bietet nur `apiVersion` und den lesenden Versionsabruf
  `getVersion()` an. Der Main-Prozess prüft Absender, Hauptframe, Origin
  und Argumente. Keine Datei-, Datenbank- oder Prozess-API im Renderer.
- App-Name und Fenstertitel: **TT Rechnungsverwaltung**. PNG-/ICO-Symbol,
  Standardgröße 1280 × 800, Mindestgröße 1000 × 650; Begrenzung auf die
  verfügbare Arbeitsfläche. Minimieren, Wiederherstellen und Maximieren
  unter Linux/X11 geprüft; Windows-Skalierung und echte Mehrmonitortests offen.
- Electron startet und beendet nur sein eigenes Backend. Mehrfachstart,
  Portkonflikte, fehlendes Python, Backend-Ausfall, Schließen während einer
  laufenden Anfrage und harter Electron-Absturz wurden in temporären
  Testkopien geprüft. Der Steuerrohr-EOF-Fall lässt den Server nach einem
  Main-Prozessabbruch kontrolliert herunterfahren. Fremde Server bleiben erhalten.
- Entwicklung nutzt `frontend/` mit Backend-Reload. Produktion nutzt die
  unverändert kopierten Dateien unter `dist/frontend` ohne Reload und
  prüft deren Build-Kennung. Python und seine Pakete müssen lokal vorhanden sein.
- `npm run desktop:build:win` erzeugt einen entpackten x64-Testbuild unter
  `dist/windows/TT Rechnungsverwaltung-win32-x64/`. EXE-Format, Name,
  Version 0.1.0, eingebettete Icons, erforderliche Starterdateien und
  Ausschluss von Nutzerdaten/Entwicklungsumgebungen wurden geprüft.
  Der tatsächliche Paketinhalt wurde zusätzlich mit Linux-Electron aus
  temporärer Kopie gestartet, auch aus fremdem Arbeitsverzeichnis und
  mit Leerzeichen im Pfad. Das ersetzt keine Windows-Ausführung.
- Technische Abschlussprüfung am 12.11.2026: **42 JavaScript-Tests** mit
  `npm run desktop:check` und **53 Python-Tests** mit `python -m pytest -q`
  bestanden. Dazu praktische Linux-Prüfungen beider Desktop- und Webmodi.
  Geprüfter Code-Stand: `b0cd290`; weitere nachvollziehbare Stände:
  `5afa29b` (Backend-Lebenszyklus), `c331b2b` (Paketinhalt),
  `bde1c06` (sichtbare Kalenderfehler).

## Offene Abnahme und bekannte Einschränkungen

- [ ] Windows-EXE auf einem echten Windows-System ausführen: Start,
  Python-Erkennung, API, Fenstersteuerung, Mehrfachstart und Prozessbeendigung.
- [ ] Native Windows-Skalierung und Mehrmonitorverhalten praktisch prüfen.
- [ ] Datei-/Speicherdialoge und Bestätigungsfenster manuell bedienen.
  Die automatisierten Tests nutzten Testdateien, feste Downloadpfade und
  kontrollierte Bestätigungsantworten für Abbrechen/Bestätigen.
- [ ] PDF im tatsächlich gestarteten Standardbrowser anzeigen und drucken.
  PDF-Erzeugung, gespeicherter Download und validierte Browserübergabe sind
  geprüft; die Übergabe wurde im Test abgefangen.
- [ ] Betrieb mit tatsächlich deaktivierter Internetverbindung praktisch
  abnehmen. Bisher wurden externe Renderer-Verbindungen blockiert, während
  die lokalen Dienste weiter liefen; kein Netzwerkadapter wurde abgeschaltet.

Der Testbuild enthält noch keine Python-Laufzeit oder Python-Pakete und ist
**kein vollständig eigenständig verteilbares Desktop-Paket**. Nach einmaliger
Einrichtung einer lokalen Python-Umgebung startet Electron das Backend selbst.
Eine vollständige Laufzeit-Einbettung bleibt offen; sie wurde nicht als erledigt
markiert und muss vor einer eigenständig verteilbaren Version geklärt werden.

Datenbank und Rechnungen liegen weiterhin relativ zum Backend: im Checkout
`data/ttc.db` und `rechnungen/`, im Testbuild unter `resources/app/`.
Updatefeste Datenpfade, vollständige Backups, Installer und Updates sind
spätere Arbeiten. Keine dieser späteren Phasen wird hier als umgesetzt bewertet.

Ungespeicherte Formulareingaben werden nicht zuverlässig erkannt oder automatisch
vor dem Schließen geschützt. Bei einem dauerhaft blockierten Backend erfolgt
nach einem begrenzten Shutdown-Versuch eine protokollierte Eskalation; eine
Unterbrechung laufender Datenoperationen ist dann nicht vollständig auszuschließen.

Es gibt keine separate Kundenverwaltung; vorhanden sind Organisation und ein
Rechnungsempfänger in den Einstellungen. Die aktuelle Python-Abhängigkeitsliste
ist nicht versionsgebunden. Der Testbuild besitzt keinen Installer, keine
Signatur und keine automatische Update-Funktion.

**Abschlussbewertung:** Implementierung und ausführbare Linux-Prüfungen sind
weitgehend erledigt. Wegen der offenen Windows- und manuellen Abnahmen ist
Phase 1 nach der allgemeinen Definition of Done noch nicht vollständig
abgeschlossen. Eine Freigabe für spätere Arbeiten ist keine nachträgliche
Bestätigung dieser ungeprüften Eigenschaften.

------------------------------------------------------------------------

# Phase 2 -- Lokale Datenhaltung

**Ziel:** Die Anwendung speichert alle notwendigen Daten zuverlässig
lokal auf dem PC und benötigt dafür keine Cloud.

## Entwicklungsschritte

-   [ ] Bestehende Datenbank und Datenzugriffe vollständig analysieren.
-   [ ] Entscheiden, welche Daten künftig in SQLite gespeichert werden.
-   [ ] Ein lokales Datenbankmodul mit zentralem Zugriffspunkt
    einrichten.
-   [ ] Datenbankdatei in einem geeigneten Benutzer-Datenverzeichnis
    ablegen, nicht im Installationsordner der App.
-   [ ] Datenbankschema und Migrationen versionieren.
-   [ ] Datenbankzugriffe von der Benutzeroberfläche und der
    Rechnungslogik entkoppeln.
-   [ ] Bestehende Datenmodelle möglichst beibehalten und notwendige
    Anpassungen dokumentieren.
-   [ ] Prüfen, ob bestehende Daten aus der bisherigen Anwendung
    importiert werden müssen.
-   [ ] Einen kontrollierten Import bzw. eine Migration vorhandener
    Daten entwickeln, falls erforderlich.
-   [ ] Fehlerbehandlung für fehlende, beschädigte oder nicht
    erreichbare Datenbankdateien ergänzen.
-   [ ] Sicherstellen, dass ein App-Update vorhandene Daten nicht
    überschreibt oder löscht.
-   [ ] Datenbankzugriffe und wichtige Geschäftsabläufe automatisiert
    testen.

## Ergebnis / Abnahmekriterien

-   Kundendaten, Termine und Rechnungsdaten bleiben nach einem Neustart
    erhalten.
-   Die Datenbank liegt außerhalb des Installationsverzeichnisses.
-   Ein Update der App löscht keine Nutzerdaten.
-   Datenbankänderungen sind versioniert und kontrolliert ausführbar.
-   Die Anwendung funktioniert ohne externe Datenbankverbindung.

------------------------------------------------------------------------

# Phase 3 -- Lokale Dokumenten- und Dateiverwaltung

**Ziel:** Rechnungen, PDFs und weitere Anhänge werden zuverlässig lokal
verwaltet.

## Entwicklungsschritte

-   [x] Festlegen, in welchem lokalen Verzeichnis Anwendungsdokumente
    gespeichert werden. Zielentscheidung: `documents/` im bestehenden
    Desktop-Datenverzeichnis außerhalb der Installation; Webbetrieb ohne
    Datenpfad-Override behält `rechnungen/`. Details und Abgrenzung zum noch
    unveränderten Dateizugriff: [README.md](Technische_Dokumentation.md#dokumentenverzeichnis-phase-3-schritt-1).
-   [x] Einen zentralen Dienst für Dateiablage und Dateizugriff
    einrichten. `backend/document_storage.py` bündelt das exklusive Schreiben
    und Auffinden von Dokumenten. Die Rechnungs-API nutzt seit Schritt 4
    die zentrale Pfadauflösung einschließlich der Bestandsübernahme.
-   [x] Rechnungs-PDFs und weitere Anhänge eindeutig zuordnen.
    `backend/invoice_documents.py` prüft finale Rechnung, Zeitraum und
    eindeutigen Dateiverweis; Mehrfachzuordnungen werden auch bei
    unterschiedlicher Groß-/Kleinschreibung abgelehnt. Bestehende Logos und
    Logo-Snapshots bleiben ihren SQLite-Datensätzen zugeordnet; eine allgemeine
    Anhangsfunktion ist im bisherigen Funktionsumfang nicht vorhanden.
-   [x] Dateipfade nicht an verschiedenen Stellen im Programm fest
    verdrahten. `backend/paths.py` bestimmt Ziel- und bisherige Ablage;
    die Rechnungs-API nutzt diese Auflösung. Eindeutig zugeordnete Bestands-PDFs
    werden beim Start ohne Überschreiben oder Löschen der Quellen übernommen.
-   [x] Einen einstellbaren Speicherort vorsehen, sofern dies mit
    vertretbarem Aufwand möglich ist. `TTC_DOCUMENT_DIRECTORY` erlaubt einen
    absoluten Dokumentenpfad unabhängig von SQLite. Konfiguration erfolgt
    über die Startumgebung; sichere Übernahme aus der Standardablage und
    bewusster Wechsel zwischen eigenen Ordnern sind in der README beschrieben.
-   [x] Prüfen, ob vorhandene PDF-Erstellung und PDF-Vorschau in
    Electron funktionieren. Unter Linux mit echten Electron-Fenstern in
    Entwicklung und Produktion geprüft: HTML-Vorschau, Finalisierung,
    PDF-Download, erneute Vorschau und Archivöffnung. Reproduzierbarer
    Opt-in-Test: `tests/test_desktop_invoice.py`. Die Standardbrowser-Übergabe
    wird im Test abgefangen; native Windows-Ausführung sowie Darstellung
    und Drucken im tatsächlichen Standardbrowser bleiben offene Abnahmen.
-   [x] Speichern, Öffnen, Umbenennen und Löschen von Dateien
    kontrolliert umsetzen. Der Dokumentendienst veröffentlicht vollständige
    Dateien ohne Überschreiben, bietet geprüften Lesezugriff sowie Umbenennen
    ohne Zielersetzung und identitätsgeprüftes Löschen. Die Rechnungs-API nutzt
    den Dienst auch zur Fehlerbereinigung; Originalnamen finaler Rechnungen
    bleiben gemäß bestehender Zuordnung fest.
-   [x] Fehlerfälle behandeln, etwa fehlende Dateien oder fehlende
    Schreibrechte. Dokumentenfehler werden an API- und Startgrenzen in feste
    Handlungsanweisungen übersetzt, ohne interne Dateipfade weiterzugeben.
    Electron erkennt auch Dokumenten-Startfehler des Reload-Workers. PDF-Abrufe
    behandeln Lesefehler vor Übertragungsbeginn; Fehlerbehebung und erneutes
    Speichern sind mit echten Electron-Fenstern geprüft.
-   [x] Sicherstellen, dass das Löschen einer Rechnung nicht
    versehentlich nicht zugehörige Dokumente entfernt. Auswahl und exklusive
    Dateizuordnung werden beim Löschen unter SQLite-Schreibsperre erneut geprüft.
    Vor der PDF-Bereinigung verhindert eine weitere geschützte Zuordnungsprüfung
    konkurrierende Datenbankänderungen; geänderte Dateien und fremde Zuordnungen
    bleiben erhalten. Fehler-, Manipulations- und Konkurrenzfälle sind getestet.
-   [x] Bestehende Rechnungs- und Vorschauabläufe vollständig testen.
    Automatisierte Linux-Prüfung über API, Dateidienst und echte Electron-Fenster
    einschließlich Vorschauänderung, Finalisierung, Download, Löschabbruch,
    bestätigtem Löschen, Neu-Finalisierung und vollständigem App-Neustart.
    Entwicklung/Produktion werden jeweils mit Standardablage und eigenem
    Dokumentenordner geprüft. Native Windows-Abnahme, tatsächliche
    Standardbrowser-Darstellung und manuelle Betriebssystemdialoge bleiben offen.

## Ergebnis / Abnahmekriterien

-   Dokumente werden lokal gespeichert und wiedergefunden.
-   Rechnungen lassen sich erstellen, anzeigen und öffnen.
-   Dateioperationen funktionieren auch nach einem Neustart.
-   Die Anwendung kann mit fehlenden Dateien nachvollziehbar umgehen.

------------------------------------------------------------------------

# Phase 4 -- Vollständiger lokaler Betrieb und Funktionsprüfung

**Ziel:** Die Desktop-App soll alle benötigten Arbeitsabläufe ohne
Internet und ohne Anmeldung unterstützen.

## Entwicklungsschritte

-   [x] Alle externen Netzwerkabhängigkeiten der Anwendung erfassen.
    Quellcodebasierte Bestandsaufnahme einschließlich lokaler HTTP-Kommunikation,
    externer FastAPI-Dokumentationsressourcen, Einrichtung und Build sowie
    konfigurationsabhängiger Netzablagen durchgeführt.
    Bewertung siehe Schritt 2; die praktische Offline-Prüfung folgt separat.
-   [x] Prüfen, welche davon für den lokalen Betrieb zwingend notwendig
    sind.
    Keine externe Netzwerkverbindung ist für die fachlichen Arbeitsabläufe
    erforderlich. Der lokale HTTP-Dienst und installierte Laufzeitkomponenten
    bleiben notwendig; Einzelbewertung siehe unten.
-   [x] Nicht notwendige Cloud- oder Serverabhängigkeiten für den
    lokalen Modus entfernen oder deaktivieren.
    Die externen CDN-Ressourcen von Swagger UI und ReDoc entfallen durch
    Deaktivieren von `/docs`, `/redoc` und `/docs/oauth2-redirect` im gemeinsamen
    Backend (Desktop und Web). `/openapi.json`, Oberfläche und fachliche API
    bleiben verfügbar; Regressionstests sichern diese Abgrenzung ab.
-   [x] Prüfen, ob Schriftarten, Bibliotheken und andere Ressourcen
    lokal verfügbar sind.
    Quellfrontend, vorhandener Produktions-Build und Paketvorbereitung in
    temporärer Kopie geprüft; Ressourcen und lokale Laufzeit verfügbar.
    Details und Verteilungsgrenzen siehe Ressourcenprüfung unten.
-   [x] Die Anwendung mit deaktivierter Internetverbindung testen.
    Vier echte Electron-Durchläufe unter Linux in einem eigenen Netzwerk-
    Namespace ohne externe Netzverbindung bestanden: Entwicklung/Produktion
    jeweils mit Standard-/eigener Dokumentenablage und vollständigem Neustart.
    Nur Loopback aktiv; externe IPv4-/IPv6-Verbindungen scheitern nachweislich.
    Reproduktion und Abgrenzung siehe README und Offline-Prüfung unten.
-   [x] Kundenverwaltung vollständig testen.
    Bestehenden Umfang geprüft: ein Rechnungsempfänger in den
    Organisationseinstellungen, keine separate Kundenkartei. API- und echte
    Electron-Tests decken alle fünf Felder, Änderungen, Leeren, Validierung,
    Persistenz und unveränderte Empfänger-Snapshots finaler Rechnungen ab.
-   [x] Wochenplan und Terminverwaltung vollständig testen.
    API- und echte Offline-Electron-Tests für Planpflege, Kalendernavigation,
    Terminbearbeitung und Datenerhalt ergänzt. Zwei dabei gefundene Fehler
    korrigiert: deaktivierte Planeinträge bleiben beim Laden deaktiviert;
    bestehende Termine mit inzwischen inaktiver Tätigkeit bleiben bearbeitbar.
-   [x] Statusverwaltung für erledigte und nicht erledigte Termine
    testen.
    Alle Statusübergänge für manuelle und generierte Termine, Validierung,
    Wiederholung und Monatsaktion per API geprüft. Echte Offline-Electron-Tests
    ergänzen Checkbox, „Nicht gemacht“, Dialogkorrektur, Speicherfehler und
    Datenerhalt aller drei Statuswerte nach vollständigem App-Neustart.
-   [x] Rechnungsentwürfe und Rechnungsvorschauen testen.
    Gespeicherte Vorschauen als bestehende Entwurfsform geprüft: Aktualisieren,
    Leeren, Transaktionsfehler, ungültige Zeiträume und Datenerhalt. Echte
    Offline-Electron-Tests prüfen Anzeige, Monatswahl, Lade-/Fehlerzustände und
    Wiederholen. Falsche Vorschau-Jahresanzeige für Jahre unter 100 korrigiert.
-   [x] Finale Rechnungen, erneute Vorschauen und das Löschen finaler
    Rechnungen gemäß der vorgesehenen Geschäftslogik testen.
    Aktuelle Daten bei Finalisierung, unveränderte finale Snapshots/PDFs,
    erneute Vorschauen, Transaktionsfehler und Neu-Finalisierung nach Löschen
    ergänzt geprüft. Echte Offline-Electron-Tests sichern auch Monatswechsel,
    Löschfehler, erneuten Versuch und Datenerhalt nach App-Neustart ab.
-   [x] Prüfen, dass nur abrechnungsfähige bzw. erledigte Leistungen in
    Rechnungen einfließen.
    Filtermatrix für Status, manuelle/generierte Termine, Stunden/Pauschale
    und Monats-/Jahresgrenzen ergänzt. Vorschau, finale Positionen, Snapshot und
    PDF-Erzeugung enthalten ausschließlich erledigte Termine des gewählten Monats;
    gespeicherte Preise bleiben auch nach Deaktivierung der Tätigkeit maßgeblich.
-   [x] Fehler- und Grenzfälle testen, etwa doppelte Aktionen, fehlende
    Daten und Programmabstürze.
    Gleichzeitige API-Aktionen, Doppelklick und leere Oberfläche ergänzt.
    Echte Prozessabbrüche prüfen SQLite-Rollback, PDF-Veröffentlichung vor
    Datenbank-Commit sowie Electron-Absturz mit Backend-Beendigung und Wiederanlauf.
    Die bestehende Grenze zwischen Dateisystem und SQLite ist dokumentiert.
-   [x] Bestehende automatisierte Tests ausführen und bei Bedarf
    erweitern.
    Abschließende Linux-Prüfung: 355 Python-Tests einschließlich aller vier
    Offline-Electron-Varianten mit Absturzwiederanlauf ohne Überspringen bestanden;
    46 JavaScript-Tests, elf Starter-/Build-Syntaxprüfungen und Syntaxprüfung des
    Electron-Testtreibers bestanden. Paketvorbereitung und lokale Abhängigkeiten
    zusätzlich geprüft. Die Windows-Abnahme gemäß Definition of Done bleibt offen.

## Bewertung der Netzwerkabhängigkeiten (Schritt 2)

Die Bewertung bezieht sich auf den aus Phase 1–3 übernommenen Code und die
in Schritt 1 erfassten Abhängigkeiten. Sie unterscheidet den laufenden lokalen
Betrieb von der vorherigen Einrichtung und dem Erzeugen eines Builds.

| Abhängigkeit | Für den lokalen Betrieb zwingend? | Begründung / Folgerung |
| --- | --- | --- |
| HTTP über Loopback (`127.0.0.1` oder `::1`) | Ja, lokale Kommunikation | Electron lädt Oberfläche, Ressourcen und REST-API vom selbst gestarteten Python-/Uvicorn-Dienst; die Startprüfung benötigt dieselbe Origin. Kalender, Einstellungen, Wochenplan und Rechnungsabläufe verwenden relative `/api/...`-Pfade. Internet, DNS und ein externer Server sind dafür nicht erforderlich. Belege: `electron/config.cjs`, `electron/startup.cjs`, `scripts/run.cjs`, `frontend/js/`. |
| PDF-Abruf über den lokalen Dienst | Ja, für Anzeige und Download | Auch die an den Standardbrowser übergebene URL zeigt ausschließlich auf `/api/invoices/{id}/pdf` derselben Loopback-Origin. Der lokale Dienst muss während des Abrufs laufen; eine Internetverbindung benötigt dieser Abruf nicht. Beleg: `electron/browser-links.cjs`. Eigenes Netzwerkverhalten des Standardbrowsers gehört nicht zum PDF-Abruf der Anwendung. |
| CDN-Ressourcen der API-Dokumentation | Nein | FastAPIs automatisch registrierte `/docs`- und `/redoc`-Seiten binden JavaScript/CSS von `cdn.jsdelivr.net`, ein Favicon von `fastapi.tiangolo.com` und bei ReDoc Schrift-CSS von `fonts.googleapis.com` ein. Diese Hilfsseiten sind nicht Teil der Produktabläufe. Ihre externen Ressourcen können für den lokalen Modus in Schritt 3 deaktiviert oder ersetzt werden, ohne die fachliche REST-API zu entfernen. Beleg: `FastAPI(...)` in `backend/main.py` und die installierten FastAPI-Dokumentationsvorlagen. |
| GitHub, npm-Registry, Python-Paketquellen und Electron-Downloads | Nein, nach abgeschlossener Einrichtung | Repository-Bezug, Paketinstallation und ein nicht gecachter Windows-Build können Downloads benötigen. Der normale App-Start installiert oder lädt keine Pakete nach. Electron sowie Python mit FastAPI/Uvicorn und ReportLab müssen bereits lokal vorhanden sein; der Windows-Testbuild enthält weiterhin keine eingebettete Python-Umgebung. Belege: `README.md`, `package-lock.json`, `requirements.txt`, `scripts/package_windows.cjs`. Eine erstmalige Einrichtung ohne lokale Pakete wird damit nicht zugesichert. |
| Netzlaufwerke oder synchronisierte Speicherordner | Nein | Die Standardablagen für SQLite und Dokumente sind lokal. Benutzerdefinierte absolute Pfade können jedoch auf einen extern abhängigen Speicher zeigen. Für vollständig lokalen Betrieb müssen Datenbank, Dokumente und gegebenenfalls Importquellen auf erreichbaren lokalen Datenträgern liegen. Belege: `backend/paths.py`, `electron/main.cjs`, `electron/backend.cjs`. Es besteht keine eingebaute Cloud-Synchronisierung. |
| Externe fachliche Dienste, Konten und Cloud-Datenbank | Nein; nicht implementiert | Kunden-/Empfängereinstellungen, Termine, Status und Rechnungssnapshots werden in SQLite verarbeitet, PDFs im lokalen Dokumentendienst. Es gibt keine eingerichtete Anmeldung, externe Fach-API, Telemetrie oder automatische Updateprüfung. Belege: `backend/main.py`, `backend/database.py`, `backend/document_storage.py`, `electron/main.cjs`. |

**Ergebnis:** Für den vorgesehenen lokalen Betrieb muss keine externe
Netzwerkabhängigkeit erhalten bleiben. Die Kommunikation zwischen Oberfläche,
Backend und PDF-Browser über Loopback bleibt erhalten. Die externen Ressourcen
der API-Dokumentation sind der konkrete Ansatzpunkt für Schritt 3.
Lokale Schrift-/Bibliotheksverfügbarkeit wird erst in Schritt 4 vollständig
geprüft. Diese Quellcodebewertung ersetzt weder den praktischen Offline-Test
aus Schritt 5 noch die offene native Windows-Abnahme oder eine Messung möglichen
Hintergrundverkehrs von Chromium, Betriebssystem und Standardbrowser.

## Lokale Ressourcenprüfung (Schritt 4)

Prüfung am 13.11.2026 unter Linux, ohne Änderung vorhandener Builds oder
Nutzerdaten und ohne Download zusätzlicher Ressourcen:

- **Frontend:** Beide HTML-Ressourcen (`css/style.css`, `js/app.js`) und alle
  fünf ES-Module sind lokal vorhanden; sämtliche Modulimporte lassen sich
  lokal auflösen. CSS enthält weder `@import`, `@font-face` noch `url(...)`.
  Der vorhandene Produktions-Build stimmt für alle Quelldateien byteweise
  mit `frontend/` überein.
- **Oberflächenschriften:** `Inter` ist optional und wird nicht mitgeliefert
  oder nachgeladen. Die vorhandene CSS-Fallback-Liste verwendet lokale
  Systemschriften; `fc-match` löst hier sowohl `Inter` als auch `system-ui`
  auf die installierte Noto Sans auf. Auf Windows ist die konkrete Schrift
  systemabhängig; identische Darstellung über Betriebssysteme wird nicht
  zugesichert.
- **PDF und Logos:** ReportLabs Standardschriften `Helvetica` und
  `Helvetica-Bold` samt lokaler Zeichenbreitenberechnung für Umlaute, ß und €
  sind verfügbar. Es sind PDF-Standardschriften, keine nachzuladenden Webfonts.
  Logos gelangen als Bildbytes über `BytesIO` in die PDF-Erzeugung; Pillow
  ist lokal importierbar. PDF-/Logo-Verarbeitung wird zusätzlich durch die
  vorhandenen Rechnungs- und API-Tests geprüft. Die tatsächliche Anzeige im
  Standardbrowser bleibt eine separate Abnahme.
- **Python:** FastAPI, Uvicorn, Pydantic, ReportLab, Pillow, SQLite sowie
  die Testabhängigkeiten pytest und `httpx2` sind in der vorhandenen Umgebung
  verfügbar. Die Anwendung benötigt beim Start keine Paketinstallation.
- **Electron und Paketinhalt:** Die installierte Linux-Laufzeit enthält
  Ressourcenpakete, ICU-Daten, Snapshots und `locales/de.pak`; `ldd` meldet
  keine fehlenden Bibliotheken. `prepareWindowsSource()` wurde mit echten
  Projektquellen in einer temporären Kopie ausgeführt: Frontend samt
  Importkette und Build-Kennung, Backend-/Electron-Module, alle drei Icons,
  Startskripte und `requirements.txt` sind vollständig enthalten.

**Ergebnis:** Für die hier eingerichtete Umgebung fehlen keine benötigten
lokalen Ressourcen; zusätzliche Webfonts oder Frontend-Bibliotheken sind
nicht erforderlich. Der Windows-Testbuild enthält weiterhin keine Python-
Laufzeit oder Python-Pakete. Diese müssen vor dem Offlinebetrieb lokal
eingerichtet sein; eine eigenständig verteilbare Windows-Version oder native
Windows-Ausführung wird durch diese Paketvorbereitung nicht nachgewiesen.
Der Test mit tatsächlich deaktiviertem Internet bleibt Schritt 5.

## Praktische Offline-Prüfung (Schritt 5)

Am 13.11.2026 wurden alle vier Varianten aus `tests/test_desktop_invoice.py`
mit echten Electron-Fenstern, unverändertem Produktcode, eigenem Backend und
temporären Daten in einem isolierten Linux-Netzwerk-Namespace ausgeführt:
**4 Tests bestanden**. Der Namespace enthält ausschließlich die aktive
Loopback-Schnittstelle mit `127.0.0.1` und `::1`; Verbindungsversuche zu externen
IPv4-/IPv6-Testadressen scheitern mit `ENETUNREACH`. Der Python-Test prüft diese
Voraussetzung für jede Variante. Electron prüft bei Erststart und Neustart
denselben geerbten Namespace sowie die fehlende externe Erreichbarkeit.
Damit ist nicht nur eine Renderer-Anfrage blockiert: Auch Electron-Main und
das von ihm gestartete Python-Backend haben keine externe Netzverbindung.
Die Chromium-Sandbox bleibt eingeschaltet, die übrige Sitzung bleibt online.

Geprüft wurden Entwicklung und Produktion jeweils mit Standardablage und
eigenem Dokumentenordner. Der bestehende Test umfasst Start und lokale
Ressourcen, Termin-Testdaten, Vorschau und Vorschauänderung, Finalisierung,
PDF-Download, Archivöffnung, Löschabbruch/-bestätigung, erneute Finalisierung,
Fehlerbehebung an der Dokumentenablage und Datenerhalt nach vollständigem
App-Neustart. Alle vier Varianten liefen erfolgreich; die geprüften Beträge,
Nummernkreise und PDF-Dateien blieben nach dem Neustart erhalten.
Diese Offline-Durchläufe ersetzen nicht die noch folgenden vollständigen
fachlichen Einzelprüfungen der Schritte 6–12.

Der Aufruf mit `TTC_RUN_ELECTRON_TESTS=1` und `TTC_EXPECT_OFFLINE=1` innerhalb
von `unshare --user --map-current-user --net --keep-caps` ist in der README
dokumentiert. Das zweite Flag allein deaktiviert keine Verbindung, sondern
fordert die überprüfte Offline-Testumgebung an. Es gibt keine produktive
Netzwerkumschaltung und keine Änderung an Nutzerdaten oder Systemadaptern.
Native Windows-Ausführung und das physische Abschalten eines Netzwerkadapters
bleiben separat offen. Die PDF-Übergabe wird weiterhin abgefangen und Dialoge
werden kontrolliert beantwortet; Anzeige/Druck im tatsächlichen Standardbrowser
und manuelle Betriebssystemdialoge sind durch diesen Test nicht abgenommen.

## Empfängerverwaltung prüfen (Schritt 6)

Gemäß Bestandsaufnahme aus Phase 0 bedeutet Kundenverwaltung hier die
vorhandene Pflege eines Rechnungsempfängers in den Organisationseinstellungen.
Eine Kundenliste, mehrere Empfänger oder das Löschen eines Kundendatensatzes
sind nicht implementiert und wurden nicht neu eingeführt.

- `tests/test_api.py` ergänzt 24 Fälle: Laden und Speichern aller fünf Felder,
  Leerzeichenbereinigung, Unicode/Sonderzeichen, führende Null der Postleitzahl,
  Teiländerung, erneute Initialisierung und Leeren. Grenzwerte werden pro Feld
  akzeptiert; Überlängen, `null`, falsche Datentypen und ungültige E-Mail-Adressen
  werden abgelehnt, ohne andere Einstellungen teilweise zu ändern.
- Der bestehende Snapshot-Test prüft nun zusätzlich alle Empfängerfelder:
  Änderungen gelten für neue Rechnungen; ältere Snapshots und gespeicherte
  PDFs bleiben erhalten.
- Der echte Electron-Test verwendet das vorhandene Formular: ungültige
  E-Mail-Adresse abweisen, alle Felder ausfüllen und speichern, optionale
  E-Mail-Adresse wieder leeren, übrige Daten erhalten und nach Neuladen sowie
  vollständigem App-Neustart wieder anzeigen. Alle vier Varianten aus
  Entwicklung/Produktion und Standard-/eigener Ablage werden offline geprüft.

Die Tests verwenden ausschließlich temporäre Daten. Es war keine Änderung
am Produktcode erforderlich. Native Windows-Abnahme und tatsächliche
PDF-Darstellung im Standardbrowser bleiben wie bisher separat offen.

## Wochenplan und Terminverwaltung prüfen (Schritt 7)

Die API-Prüfung ergänzt 24 Fälle für den bestehenden Funktionsumfang:

- Alle sieben Wochentage, Jahreswechsel und Schaltjahr, keine automatische
  Generierung in vergangenen Monaten und keine Duplikate bei erneutem Laden.
- Planänderung, Deaktivierung und Entfernen ohne Verlust vorhandener Termine;
  neue Monate verwenden die geänderten Planwerte. Ungültige Stapel werden
  einschließlich vorheriger Änderungen vollständig zurückgerollt, auch bei
  doppelten oder unbekannten IDs und unbekannten Tätigkeiten.
- Manuelle Termine anlegen, auf einen anderen Tag verschieben, Tätigkeit und
  Stunden ändern, Notiz oder Stunden leeren und gezielt löschen. Andere Termine
  bleiben erhalten. Ungültige Daten, Datentypen, Überlängen und nicht mehr
  vorhandene IDs werden ohne unbeabsichtigte Änderungen behandelt.
- Inaktive Tätigkeiten erzeugen keine neuen Plantermine und sind für neue
  Termine gesperrt. Eine bereits zugeordnete, inzwischen deaktivierte Tätigkeit
  darf beim Bearbeiten eines bestehenden Termins beibehalten werden.

Die echten Electron-Tests ergänzen das Wochenplanformular (Anlegen, Stunden
ändern, Deaktivieren, Entfernen), Kalendernavigation und den Termindialog
(Abbrechen, Anlegen, Ändern und Pauschale ohne Stunden). Der zuletzt bearbeitete
Termin verwendet dabei eine inzwischen deaktivierte Tätigkeit. Plan und Termine
werden nach einem vollständigen App-Neustart erneut mit den gespeicherten Werten
verglichen, jeweils in Entwicklung/Produktion und Standard-/eigener Ablage.

Dabei wurden zwei Produktfehler behoben: Das Planformular wertet SQLite-`0`
nun korrekt als deaktiviert aus. Die Termin-API erlaubt das Beibehalten der
bereits zugeordneten inaktiven Tätigkeit; neue Zuordnungen zu anderen inaktiven
Tätigkeiten bleiben abgelehnt. Statuswechsel und Rechnungsregeln sind weiterhin
Gegenstand der folgenden Schritte. Native Windows-Abnahme bleibt offen.

## Statusverwaltung prüfen (Schritt 8)

Die ergänzten 31 API-Fälle prüfen alle neun Kombinationen aus `planned`,
`completed` und `cancelled` jeweils für manuelle und generierte Termine,
einschließlich unverändertem Status und Wiederholung. Andere Termindaten und
andere Termine bleiben unverändert; erneute Initialisierung und Kalenderabruf
erhalten den Status. Ungültige Werte einschließlich `null` und falscher
Datentypen werden beim Anlegen und Ändern ohne Teiländerungen abgelehnt.

Die Monatsaktion aktualisiert ausschließlich die berechtigten geplanten
Wochenplanvorkommen im ausgewählten Monat. Bereits durchgeführte, ausgefallene,
manuelle und verschobene Termine bleiben unverändert. Getrennte Monate,
wiederholter Abschluss mit Änderungszahl null, ein Monat ohne vorhandene
Termine und ungültige Zeiträume sind zusätzlich geprüft.

Der echte Electron-Test bedient Durchgeführt-Checkbox und „Nicht gemacht“,
prüft die gesperrten Schnellaktionen ausgefallener Termine und korrigiert einen
ausgefallenen Termin über den Dialog zurück auf geplant. Eine vorübergehend
nicht verfügbare Testdatenbank führt zu einer sichtbaren Fehlermeldung und
zurückgesetzter Checkbox; nach Wiederherstellung gelingt der erneute Versuch.
Abbruch, Bestätigung und Wiederholung der Monatsaktion werden mit kontrollierten
Bestätigungsantworten geprüft. Der anschließende vollständige App-Neustart
erhält alle drei Statuswerte und die übrigen Kalenderdaten.

Geprüft wird in allen vier Offline-Varianten aus Entwicklung/Produktion und
Standard-/eigener Dokumentenablage, ausschließlich mit temporären Daten.
Am Produktcode war für diesen Schritt keine Änderung erforderlich. Die
Abrechnungsfilter werden in den folgenden Schritten gesondert geprüft;
native Windows-Abnahme und manuelle Betriebssystemdialoge bleiben offen.

## Entwürfe und Rechnungsvorschauen prüfen (Schritt 9)

Die bestehende Entwurfsform ist die in SQLite gespeicherte, aktualisierbare
Vorschau (`is_preview = 1`); eine separate Entwurfsansicht oder manuelle
Positionsbearbeitung wurde nicht eingeführt.

13 zusätzliche API-Fälle sichern folgende Eigenschaften ab:

- Wiederholte Vorschauen aktualisieren denselben Entwurf und ersetzen dessen
  Positionen. Geänderte und gelöschte Termine werden bei Aktualisierung
  berücksichtigt; ein leer gewordener Monat enthält keine veralteten Positionen.
  Entwürfe anderer Monate bleiben erhalten.
- Vorschauen erzeugen weder PDF noch Rechnungsnummer oder Archiveintrag.
  Erneute Datenbankinitialisierung erhält den Entwurf. Eine vorhandene Position
  mit Preis null bleibt von einem Monat ohne Positionen unterscheidbar.
- Ein erzwungener SQLite-Fehler beim Ersetzen der Positionen rollt die gesamte
  Aktualisierung zurück; der vorherige Entwurf bleibt vollständig erhalten.
  Nach Beseitigung des Fehlers gelingt der erneute Versuch. Ungültige Zeiträume
  werden ohne Änderung des vorhandenen Entwurfs abgelehnt.

Die echten Electron-Tests prüfen Monatswahl und Ladezustand, leere Vorschauen,
Pauschalposition ohne Stunden, Preis null, sichere Textanzeige mit Sonderzeichen
sowie sichtbare Speicherfehler und erneuten Abruf. Ohne Finalisierung bleiben
Archiv, Dokumentenordner und Nummernkreis unverändert. Ein gespeicherter Entwurf
wird vor und nach vollständigem App-Neustart direkt aus SQLite verglichen,
damit ein neuer Vorschauabruf den Persistenznachweis nicht verdeckt.

Bei der Prüfung der gültigen Jahre 1 und 99 wurde eine falsche Jahresanzeige
gefunden: `Date.UTC` interpretiert diese als 1901 beziehungsweise 1999.
Die Vorschau setzt das UTC-Jahr jetzt ausdrücklich und zeigt den angeforderten
Zeitraum korrekt. Alle vier Offline-Varianten aus Entwicklung/Produktion und
Standard-/eigener Ablage werden geprüft. Finale Rechnungsabläufe und vollständige
Abrechnungsfilter folgen separat; native Windows-Abnahme bleibt offen.

## Finale Rechnungsabläufe prüfen (Schritt 10)

Fünf zusätzliche API-Fälle ergänzen die vorhandenen Rechnungs-, Datei- und
Konkurrenztests um folgende zusammenhängende Abläufe:

- Die Finalisierung berechnet aktuelle Termine neu, auch wenn der gespeicherte
  Entwurf inzwischen veraltet ist. Der Entwurf wird zur finalen Rechnung,
  Snapshots und PDF werden gespeichert und der Nummernkreis genau einmal erhöht.
  Ein erneuter Finalisierungsversuch verändert diese Rechnung nicht.
- Ein echter SQLite-Fehler beim Einfügen finaler Positionen rollt Entwurf,
  Positionen und Nummernkreis zurück. Die gerade erzeugte PDF wird bereinigt;
  andere Dokumente bleiben erhalten. Nach Fehlerbehebung gelingt die Finalisierung.
- Das Löschen der Quelltermine verändert weder finalen Snapshot noch PDF.
  Die gespeicherten Rechnungspositionen bleiben erhalten; lediglich ihre
  Fremdschlüssel zu gelöschten Terminen werden wie vorgesehen auf `null` gesetzt.
  Eine neue leere Vorschau ersetzt die finale Rechnung nicht.
- Rechnungslöschen erhält einen neuen Entwurf, andere Monatsrechnungen, deren
  PDFs, exportierte Kopien und den Nummernkreis. Danach kann der aktuelle
  Entwurf unter neuer Rechnungsnummer finalisiert werden. Wiederholtes Löschen
  und der Versuch, eine Vorschau als finale Rechnung zu löschen, sind abgesichert.
- Ein SQLite-Fehler vor der Datenbanklöschung erhält die Rechnung samt PDF;
  der anschließende erneute Löschversuch funktioniert.

Die echten Electron-Tests ergänzen den bisherigen vollständigen Rechnungsablauf
um Monatswechsel nach Finalisierung (keine veralteten PDF-Links in der neuen
Vorschau) und einen fehlgeschlagenen Löschversuch im Archiv. Fehleranzeige,
wieder freigegebener Löschbutton, unveränderte PDF und Nummernkreis sowie der
erfolgreiche erneute Versuch werden geprüft. Löschabbruch, bestätigtes Löschen,
Neu-Finalisierung und vollständiger App-Neustart bleiben Bestandteil aller vier
Offline-Varianten aus Entwicklung/Produktion und Standard-/eigener Ablage.

Am Produktcode war keine Änderung erforderlich. Die vollständige Prüfung der
Abrechnungsfilter folgt in Schritt 11. Native Windows-Ausführung, echte
Standardbrowser-Darstellung und manuelle Betriebssystemdialoge bleiben offen.

## Abrechnungsfähige Leistungen prüfen (Schritt 11)

Die dokumentierte Geschäftsregel wird unverändert beibehalten: Nur gespeicherte
Termine mit Status `completed` im ausgewählten Monat werden abgerechnet.
Wochenplanvorkommen sind zunächst geplant; `planned` und `cancelled` werden
nicht durch die Vorschau oder Finalisierung automatisch als erledigt behandelt.
Ein zusätzliches Abrechenbarkeitsfeld wurde nicht eingeführt.

39 zusätzliche API-Fälle prüfen:

- Eine Matrix aus drei Statuswerten, manueller/generierter Herkunft,
  Stunden/Pauschale sowie Terminen im vorherigen, ausgewählten und folgenden
  Monat. Sie umfasst den Jahreswechsel. Positionen und Summen werden in der
  Vorschau, der finalen Rechnung, dem gespeicherten Snapshot und den an den
  tatsächlichen PDF-Renderer übergebenen Positionen verglichen. Nicht
  abrechenbare Fälle erzeugen weder finale Rechnung noch PDF oder Nummernverbrauch.
- Ein nach der Vorschau auf geplant oder ausgefallen geänderter Termin darf
  nicht aus einem veralteten Entwurf finalisiert werden. Nur die anschließend
  erneut bestätigte Leistung fließt ein.
- Ein gemischter Monat enthält nur die ausdrücklich erwarteten erledigten
  Leistungen, einschließlich erster/letzter Monatstage und Pauschale. Spätere
  Preisänderung und Deaktivierung der Tätigkeit entfernen keine historischen
  erledigten Leistungen und ändern deren gespeicherten Preis nicht.

Die echten Electron-Tests ergänzen erledigte Testtermine außerhalb des Monats
sowie den Wechsel der einzigen berechtigten Leistung auf geplant/ausgefallen
und zurück. Leere Vorschau und gesperrte Finalisierung werden geprüft. Nach dem
vollständigen Rechnungsablauf enthält die finale Monatsrechnung ausschließlich
die erwartete erledigte Position; dies wird vor und nach App-Neustart direkt
in SQLite geprüft. Alle vier Offline-Varianten aus Entwicklung/Produktion und
Standard-/eigener Ablage sind einbezogen.

Am Produktcode war keine Änderung erforderlich. Native Windows-Abnahme und
tatsächliche Darstellung der PDF im Standardbrowser bleiben separat offen.

## Fehler, Grenzfälle und Abstürze prüfen (Schritt 12)

Die bisherigen Tests für fehlende/beschädigte/gesperrte Datenbanken, Dateifehler,
ungültige Eingaben, veränderte Zuordnungen, Portkonflikte und Prozessfehler bleiben
Teil der Regression. Fünf neue automatisierte Fälle ergänzen:

- Zwei gleichzeitige Vorschauanfragen erhalten einen Entwurf ohne doppelte
  Positionen. Zwei gleichzeitige Finalisierungen erzeugen genau eine finale
  Rechnung und PDF mit einmaligem Nummernverbrauch; die zweite Anfrage meldet
  einen Konflikt. Gleichzeitiges Löschen entfernt die Rechnung genau einmal.
- Ein eigener Schreibprozess wird während einer offenen SQLite-Transaktion mit
  vorhandenem Rollback-Journal hart beendet. Unbestätigte Änderungen an Empfänger,
  Nummernkreis und Terminen verschwinden beim Wiederöffnen; bestätigte Daten
  bleiben erhalten. Integritäts- und Fremdschlüsselprüfung sind erfolgreich.
- Ein eigener Prozess wird nach tatsächlicher PDF-Veröffentlichung und vor
  Aufruf der Datenbank-Finalisierung hart beendet. Entwurf und Nummernkreis
  bleiben erhalten. Die hinterlassene PDF wird bei Wiederholung nicht
  überschrieben (HTTP 409); nach ausdrücklicher Bestandssicherung/Freigabe des
  Dateinamens gelingt der erneute Versuch. Diese bestehende Grenze erfordert
  im betroffenen Absturzfenster eine manuelle Dateiprüfung, keine automatische
  Löschung möglicherweise fremder Dokumente. Hinweise stehen in der README.

Die echten Electron-Tests prüfen zusätzlich den Dialog ohne Tätigkeitsdaten,
ein leeres Archiv und den Doppelklick auf Finalisieren. Unter Linux folgt auf
den normalen Rechnungsablauf und Neustart ein tatsächlicher `SIGKILL` des
Test-Hauptprozesses. Das eigene Backend muss danach den lokalen Port freigeben.
Ein weiterer Start prüft die gespeicherten Rechnungen/PDFs, Einstellungen,
Kalenderdaten, Entwurf und Nummernkreis erneut. Alle vier Kombinationen aus
Entwicklung/Produktion und Standard-/eigener Ablage werden offline einbezogen.

Es werden ausschließlich temporäre Daten und eigene Testprozesse verwendet;
Produktcode bleibt unverändert. Die Tests decken die genannten Abbruchpunkte
ab, simulieren jedoch keinen Stromausfall und garantieren keine Wiederherstellung
beliebiger Hardware-/Dateisystemschäden. Native Windows-Absturzabnahme bleibt offen.

## Ergebnis / Abnahmekriterien

-   Die wesentlichen Arbeitsabläufe funktionieren offline.
-   Die bisherigen Geschäftsregeln bleiben erhalten.
-   Es ist keine Anmeldung erforderlich.
-   Ein Internet-Ausfall verhindert nicht die lokale
    Rechnungsbearbeitung.
-   Es gibt keine kritischen Datenverluste oder Fehler in den zentralen
    Rechnungsabläufen.

------------------------------------------------------------------------

# Phase 5 -- Backup, Wiederherstellung und Datenexport

**Ziel:** Die lokal gespeicherten Daten sind vor versehentlichem Verlust
geschützt.

**Implementierung:** Alle zehn Entwicklungsschritte sind umgesetzt.
Die Wiederherstellung erfolgt bewusst offline in einen neuen Datenordner;
eine vollständige Sicherheitskopie des aktuellen Bestands ist verpflichtend.
Bedienung, Format, Wiederherstellung und Einschränkungen:
[README.md](Technische_Dokumentation.md#vollständige-sicherungen-phase-5).
Die automatisierten Linux-Prüfungen umfassen echte Electron-Fenster in
Entwicklung/Produktion mit Standard- und eigener Dokumentenablage.
**Abnahme weiterhin offen:** native Windows-Ausführung und manuelle
Betriebssystemdialoge. Phase 5 ist nach der allgemeinen Definition of Done
noch nicht vollständig plattformübergreifend abgenommen.

## Entwicklungsschritte

-   [x] Einen vollständigen Backup-Umfang definieren: Datenbank,
    Rechnungs-PDFs, Anhänge und relevante Einstellungen.
-   [x] Eine manuelle Backup-Funktion in der Anwendung ergänzen.
-   [x] Einen frei wählbaren Zielordner für Backups ermöglichen.
-   [x] Backups mit Zeitstempel und nachvollziehbarer Struktur
    erstellen.
-   [x] SQLite-Backups mit einem geeigneten Verfahren erstellen, statt
    die Datenbankdatei während laufender Schreibvorgänge unkontrolliert
    zu kopieren.
-   [x] Eine Wiederherstellungsfunktion oder einen dokumentierten
    Wiederherstellungsprozess vorsehen.
-   [x] Vor dem Wiederherstellen eine Sicherheitskopie des aktuellen
    Datenbestands erstellen.
-   [x] Einen Export wichtiger Daten in geeigneten Formaten prüfen,
    beispielsweise CSV für Tabellen und PDF für Rechnungen.
-   [x] Backup und Wiederherstellung praktisch testen.
-   [x] Hinweise zur regelmäßigen Datensicherung in der Anwendung oder
    Dokumentation ergänzen.

## Ergebnis / Abnahmekriterien

-   Ein vollständiges Backup kann erstellt werden.
-   Ein Backup kann auf demselben oder einem anderen PC
    wiederhergestellt werden.
-   Rechnungs-PDFs und Anhänge sind im Backup enthalten.
-   Eine Wiederherstellung überschreibt Daten nicht ohne bewusste
    Bestätigung.

------------------------------------------------------------------------

# Phase 6 -- Windows-Installation und Updates

**Ziel:** Die Anwendung lässt sich wie ein normales Windows-Programm
installieren, starten und aktualisieren.

**Implementierungsstand:** Neun technische Arbeitsschritte sind umgesetzt.
Die nativen Installations-/Deinstallationstests (Schritt 5) und die Installation
auf einem zweiten Windows-System (Schritt 10) sind auf Wunsch als nächste
praktische Windows-Abnahmen zurückgestellt. Die vorhandene Windows-VM ist
der nächste Schritt. Automatisierte Linux- und Wine-Prüfungen ersetzen diese
Abnahmen nicht; **Phase 6 ist nach der allgemeinen Definition of Done noch
nicht vollständig abgenommen**. Vorgehen und Plattformgrenzen stehen in der
[README](Technische_Dokumentation.md#windows-installation-und-updates-phase-6), die native
Prüfanleitung in [Windows_Installationspruefung.md](Windows_Installationspruefung.md).

## Entwicklungsschritte

-   [x] Einen geeigneten Electron-Packager bzw. Installer konfigurieren.
-   [x] Einen Windows-Installer erstellen, beispielsweise als `.exe`.
-   [x] App-Name, Symbol, Versionsnummer und Herausgeberangaben
    festlegen.
-   [x] Desktop-Verknüpfung und Startmenü-Eintrag einrichten.
-   [ ] Installations- und Deinstallationsverhalten testen.
-   [x] Sicherstellen, dass eine Deinstallation lokale Nutzerdaten nicht
    ungefragt löscht.
-   [x] Update-Prozess festlegen.
-   [x] Vor Updates sicherstellen, dass Datenbank und Dokumente erhalten
    bleiben.
-   [x] Datenbankmigrationen beim Update kontrolliert ausführen.
-   [ ] Installation auf einem zweiten Windows-PC testen.
-   [x] Verhalten bei fehlenden Berechtigungen und unvollständigen
    Installationen prüfen.

## Ergebnis / Abnahmekriterien

-   Die App kann über einen Installer installiert werden.
-   Sie lässt sich über das Startmenü und eine Desktop-Verknüpfung
    starten.
-   Updates überschreiben keine Nutzerdaten.
-   Eine Deinstallation entfernt die Anwendung, aber nicht ungefragt die
    persönlichen Rechnungsdaten.
-   Die Installation funktioniert auf einem sauberen Windows-System.

------------------------------------------------------------------------

# Phase 7 -- Stabilisierung und erste produktive Version

**Ziel:** Eine zuverlässige lokale Version veröffentlichen, die im
Alltag eingesetzt werden kann.

## Entwicklungsschritte

-   [ ] Gesamte Anwendung auf einem produktiven Windows-PC testen.
-   [ ] Installation, Neustart, Backup und Wiederherstellung
    durchspielen.
-   [ ] Alle wichtigen Rechnungsabläufe mit realistischen Testdaten
    prüfen.
-   [ ] Fehlerprotokollierung ergänzen, ohne sensible Rechnungs- oder
    Kundendaten unnötig zu protokollieren.
-   [ ] Performance und Speicherverbrauch prüfen.
-   [ ] Bekannte Einschränkungen dokumentieren.
-   [ ] Versionsnummer und Release-Notizen erstellen.
-   [ ] Einen stabilen Release-Branch bzw. ein Release-Tag anlegen.
-   [ ] Einen finalen Installer bereitstellen.

## Ergebnis / Abnahmekriterien

-   Die lokale Desktop-App ist im Alltag einsetzbar.
-   Die Datenhaltung ist nachvollziehbar und abgesichert.
-   Die zentralen Funktionen sind getestet.
-   Es existiert ein reproduzierbarer Installations- und Updateprozess.

------------------------------------------------------------------------

# Phase 8 -- Vorbereitung auf Benutzerkonten

**Erst umsetzen, wenn die lokale Version stabil läuft.**

**Ziel:** Die Datenstruktur und Anwendungslogik so erweitern, dass
später mehrere Benutzer unterstützt werden können.

## Entwicklungsschritte

-   [ ] Festlegen, ob Benutzer nur lokal auf einem PC oder später
    geräteübergreifend angemeldet werden sollen.
-   [ ] Benutzer, Rollen und Berechtigungen fachlich definieren.
-   [ ] Festlegen, welche Daten einem Benutzer, einer Organisation oder
    einem gemeinsamen Datenbestand gehören.
-   [ ] Datenmodell um geeignete Organisations- und Benutzerzuordnungen
    erweitern, falls erforderlich.
-   [ ] Bestehende lokale Daten einem ersten lokalen Eigentümer bzw.
    einer Organisation zuordnen, ohne Daten zu verlieren.
-   [ ] Benutzerverwaltung von der Rechnungs- und Terminlogik trennen.
-   [ ] Authentifizierung und sichere Speicherung von Zugangsdaten
    konzipieren.
-   [ ] Rechteprüfungen nicht nur in der Oberfläche, sondern auch in der
    Datenzugriffsschicht vorsehen.
-   [ ] Migrations- und Rückfallkonzept für bestehende lokale
    Installationen erstellen.

## Ergebnis / Abnahmekriterien

-   Das Datenmodell kann mehrere Benutzer und Organisationen abbilden.
-   Bestehende lokale Daten bleiben erhalten.
-   Die bisherige lokale Nutzung wird nicht unnötig von einem
    Online-Account abhängig.
-   Sicherheits- und Berechtigungskonzept sind dokumentiert.

------------------------------------------------------------------------

# Phase 9 -- Cloud, sciebo und geräteübergreifende Nutzung

**Erst umsetzen, wenn Benutzerkonten und lokale Nutzung zuverlässig
funktionieren.**

**Ziel:** Die Anwendung optional um Cloud-Funktionen und die Nutzung auf
mehreren Geräten erweitern.

## Entwicklungsschritte

-   [ ] Anforderungen an die Synchronisierung festlegen: Welche Daten
    und Dokumente sollen zwischen Geräten geteilt werden?
-   [ ] Prüfen, ob sciebo für den vorgesehenen Nutzungszweck und die
    betreffenden personenbezogenen Daten verwendet werden darf.
-   [ ] Technische Möglichkeiten und Einschränkungen von sciebo prüfen.
-   [ ] Entscheiden, ob sciebo nur Dokumente und Backups oder auch einen
    Synchronisationsmechanismus bereitstellen soll.
-   [ ] Keine gemeinsam genutzte SQLite-Datei als Mehrgeräte-Datenbank
    über einen synchronisierten Ordner verwenden.
-   [ ] Für echte gleichzeitige Mehrgeräte-Nutzung eine geeignete
    Serverdatenbank und API oder einen anderen kontrollierten
    Synchronisationsdienst vorsehen.
-   [ ] Konfliktbehandlung für gleichzeitig geänderte Datensätze
    definieren.
-   [ ] Authentifizierung, Berechtigungen und sichere Datenübertragung
    umsetzen.
-   [ ] Verschlüsselung und Schutz sensibler Daten prüfen.
-   [ ] Synchronisierung zunächst mit Testdaten und wenigen Geräten
    erproben.
-   [ ] Wiederherstellung nach Verbindungsabbruch und Konflikten testen.
-   [ ] Optionalen Cloud-Modus so gestalten, dass die lokale Nutzung
    weiterhin möglich bleibt, sofern dies fachlich und technisch
    vorgesehen ist.

## Ergebnis / Abnahmekriterien

-   Die Cloud-Funktionen sind optional und klar vom lokalen Betrieb
    getrennt.
-   Mehrere Geräte können Daten kontrolliert austauschen.
-   Gleichzeitige Änderungen führen nicht zu unbemerktem Datenverlust.
-   Der lokale Betrieb bleibt auch bei fehlender Internetverbindung
    nutzbar, soweit die gewählte Synchronisationsarchitektur dies
    unterstützt.
-   Datenschutz, Berechtigungen und Backup-Konzept sind geklärt.

------------------------------------------------------------------------

# Empfohlene Reihenfolge und Prioritäten

  Phase   Schwerpunkt                               Priorität
  ------- ----------------------------------------- -----------
  0       Bestandsaufnahme                          Pflicht
  1       Electron-Grundgerüst                      Pflicht
  2       Lokale Datenbank                          Pflicht
  3       Lokale Dokumente                          Pflicht
  4       Offlinebetrieb und Funktionstests         Pflicht
  5       Backup und Wiederherstellung              Pflicht
  6       Windows-Installer und Updates             Pflicht
  7       Stabilisierung und Release                Pflicht
  8       Benutzerkonten vorbereiten und ergänzen   Später
  9       Cloud und Mehrgeräte-Synchronisierung     Später

## Grundregeln für die Umsetzung

1.  **Bestehende Funktionen erhalten:** Die Umstellung auf Desktop darf
    keine bereits funktionierenden Rechnungs-, Termin- oder
    Kundenfunktionen unbeabsichtigt verändern.
2.  **Schrittweise arbeiten:** Jede Phase soll einzeln umgesetzt,
    getestet und erst danach als abgeschlossen markiert werden.
3.  **Keine vorschnelle Cloud-Entwicklung:** In den Phasen 0 bis 7
    werden keine Accounts und keine Cloud-Synchronisierung
    implementiert.
4.  **Daten schützen:** Datenbank, PDFs und Anhänge dürfen bei Updates,
    Neuinstallationen oder Fehlern nicht unkontrolliert verloren gehen.
5.  **Geschäftslogik getrennt halten:** Rechnungsberechnung und
    fachliche Regeln sollen nicht von Electron oder der
    Benutzeroberfläche abhängen.
6.  **Keine unnötige Neuimplementierung:** Vorhandene Komponenten und
    Funktionen sollen nach Möglichkeit weiterverwendet werden.
7.  **Änderungen nachvollziehbar halten:** Jede Phase erhält einen
    eigenen überprüfbaren Entwicklungsstand und passende Tests.

## Definition of Done für jede Phase

Eine Phase gilt erst als abgeschlossen, wenn:

-   [ ] alle zugehörigen Entwicklungsschritte umgesetzt oder begründet
    zurückgestellt wurden,
-   [ ] die relevanten Tests erfolgreich sind,
-   [ ] keine bestehenden Kernfunktionen unbeabsichtigt beschädigt
    wurden,
-   [ ] Änderungen und technische Entscheidungen dokumentiert sind,
-   [ ] der Stand auf dem vorgesehenen Windows-System geprüft wurde,
-   [ ] ein nachvollziehbarer Commit bzw. Release-Stand vorhanden ist.

**Startpunkt:** Mit Phase 0 beginnen. Erst nach der Bestandsaufnahme
entscheiden, wie Electron, SQLite und die vorhandene Backend-Struktur
konkret in das bestehende Repository integriert werden.
