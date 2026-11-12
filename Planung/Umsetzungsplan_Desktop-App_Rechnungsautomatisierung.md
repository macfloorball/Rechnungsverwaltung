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

-   [ ] Aktuelles Repository und den relevanten Entwicklungsbranch
    untersuchen.
-   [ ] Verwendetes Frontend-Framework, Backend, Datenbank und
    Build-System dokumentieren.
-   [ ] Prüfen, wie die Anwendung aktuell gestartet und gebaut wird.
-   [ ] Alle vorhandenen Funktionen erfassen, insbesondere Kunden,
    Wochenplan, Termine, Statusverwaltung, Rechnungsentwürfe und finale
    Rechnungen.
-   [ ] Ermitteln, wo Daten aktuell gespeichert werden und welche
    externen Dienste benötigt werden.
-   [ ] Prüfen, ob die Anwendung bereits lokal ohne Internetverbindung
    laufen kann.
-   [ ] Abhängigkeiten von Browserfunktionen, Server-URLs und externen
    APIs identifizieren.
-   [ ] Bestehende Tests und bekannte Fehler dokumentieren.
-   [ ] Festlegen, ob Electron in das bestehende Repository integriert
    wird. Grundsätzlich soll das bestehende Repository weiterverwendet
    werden, sofern die Bestandsaufnahme keinen gewichtigen Grund dagegen
    zeigt.
-   [ ] Einen eigenen Branch für die Desktop-Umstellung anlegen.

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

## Entwicklungsschritte

-   [ ] Electron in das bestehende Projekt integrieren.
-   [ ] Electron-Hauptprozess und Renderer-Prozess sauber einrichten.
-   [ ] Die bestehende Benutzeroberfläche im Electron-Fenster laden.
-   [ ] Entwicklungs- und Produktionsstart voneinander trennen.
-   [ ] Fenstertitel, App-Name, Symbol und Fenstergröße festlegen.
-   [ ] Fensterverhalten für Minimieren, Maximieren und Schließen
    umsetzen.
-   [ ] Sichere Electron-Grundeinstellungen verwenden, insbesondere
    `contextIsolation` aktivieren und Node-Zugriff im Renderer
    deaktivieren.
-   [ ] Eine klar begrenzte IPC-Schnittstelle für später benötigte
    Desktop-Funktionen vorsehen.
-   [ ] Browser-spezifische Funktionen identifizieren und bei Bedarf
    durch Desktop-kompatible Lösungen ersetzen.
-   [ ] Prüfen, ob alle bisherigen Ansichten und Arbeitsabläufe im
    Desktop-Fenster funktionieren.
-   [ ] Einen ersten Windows-Build erzeugen.

## Ergebnis / Abnahmekriterien

-   Die Anwendung startet in einem eigenen Fenster.
-   Es ist kein manuelles Öffnen des Browsers erforderlich.
-   Die wichtigsten bestehenden Funktionen sind weiterhin erreichbar.
-   Es gibt keine unnötigen Änderungen an der Rechnungslogik.
-   Die Desktop-App kann im Entwicklungsmodus gestartet werden.

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

-   [ ] Festlegen, in welchem lokalen Verzeichnis Anwendungsdokumente
    gespeichert werden.
-   [ ] Einen zentralen Dienst für Dateiablage und Dateizugriff
    einrichten.
-   [ ] Rechnungs-PDFs und weitere Anhänge eindeutig zuordnen.
-   [ ] Dateipfade nicht an verschiedenen Stellen im Programm fest
    verdrahten.
-   [ ] Einen einstellbaren Speicherort vorsehen, sofern dies mit
    vertretbarem Aufwand möglich ist.
-   [ ] Prüfen, ob vorhandene PDF-Erstellung und PDF-Vorschau in
    Electron funktionieren.
-   [ ] Speichern, Öffnen, Umbenennen und Löschen von Dateien
    kontrolliert umsetzen.
-   [ ] Fehlerfälle behandeln, etwa fehlende Dateien oder fehlende
    Schreibrechte.
-   [ ] Sicherstellen, dass das Löschen einer Rechnung nicht
    versehentlich nicht zugehörige Dokumente entfernt.
-   [ ] Bestehende Rechnungs- und Vorschauabläufe vollständig testen.

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

-   [ ] Alle externen Netzwerkabhängigkeiten der Anwendung erfassen.
-   [ ] Prüfen, welche davon für den lokalen Betrieb zwingend notwendig
    sind.
-   [ ] Nicht notwendige Cloud- oder Serverabhängigkeiten für den
    lokalen Modus entfernen oder deaktivieren.
-   [ ] Prüfen, ob Schriftarten, Bibliotheken und andere Ressourcen
    lokal verfügbar sind.
-   [ ] Die Anwendung mit deaktivierter Internetverbindung testen.
-   [ ] Kundenverwaltung vollständig testen.
-   [ ] Wochenplan und Terminverwaltung vollständig testen.
-   [ ] Statusverwaltung für erledigte und nicht erledigte Termine
    testen.
-   [ ] Rechnungsentwürfe und Rechnungsvorschauen testen.
-   [ ] Finale Rechnungen, erneute Vorschauen und das Löschen finaler
    Rechnungen gemäß der vorgesehenen Geschäftslogik testen.
-   [ ] Prüfen, dass nur abrechnungsfähige bzw. erledigte Leistungen in
    Rechnungen einfließen.
-   [ ] Fehler- und Grenzfälle testen, etwa doppelte Aktionen, fehlende
    Daten und Programmabstürze.
-   [ ] Bestehende automatisierte Tests ausführen und bei Bedarf
    erweitern.

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

## Entwicklungsschritte

-   [ ] Einen vollständigen Backup-Umfang definieren: Datenbank,
    Rechnungs-PDFs, Anhänge und relevante Einstellungen.
-   [ ] Eine manuelle Backup-Funktion in der Anwendung ergänzen.
-   [ ] Einen frei wählbaren Zielordner für Backups ermöglichen.
-   [ ] Backups mit Zeitstempel und nachvollziehbarer Struktur
    erstellen.
-   [ ] SQLite-Backups mit einem geeigneten Verfahren erstellen, statt
    die Datenbankdatei während laufender Schreibvorgänge unkontrolliert
    zu kopieren.
-   [ ] Eine Wiederherstellungsfunktion oder einen dokumentierten
    Wiederherstellungsprozess vorsehen.
-   [ ] Vor dem Wiederherstellen eine Sicherheitskopie des aktuellen
    Datenbestands erstellen.
-   [ ] Einen Export wichtiger Daten in geeigneten Formaten prüfen,
    beispielsweise CSV für Tabellen und PDF für Rechnungen.
-   [ ] Backup und Wiederherstellung praktisch testen.
-   [ ] Hinweise zur regelmäßigen Datensicherung in der Anwendung oder
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

## Entwicklungsschritte

-   [ ] Einen geeigneten Electron-Packager bzw. Installer konfigurieren.
-   [ ] Einen Windows-Installer erstellen, beispielsweise als `.exe`.
-   [ ] App-Name, Symbol, Versionsnummer und Herausgeberangaben
    festlegen.
-   [ ] Desktop-Verknüpfung und Startmenü-Eintrag einrichten.
-   [ ] Installations- und Deinstallationsverhalten testen.
-   [ ] Sicherstellen, dass eine Deinstallation lokale Nutzerdaten nicht
    ungefragt löscht.
-   [ ] Update-Prozess festlegen.
-   [ ] Vor Updates sicherstellen, dass Datenbank und Dokumente erhalten
    bleiben.
-   [ ] Datenbankmigrationen beim Update kontrolliert ausführen.
-   [ ] Installation auf einem zweiten Windows-PC testen.
-   [ ] Verhalten bei fehlenden Berechtigungen und unvollständigen
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
