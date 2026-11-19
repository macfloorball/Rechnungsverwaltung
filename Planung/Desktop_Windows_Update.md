# Windows-Updateinstallation über den vorhandenen NSIS-Installer

Aktualisierung 18.11.2026: Gemeinsame Ed25519-Prüfung bleibt zwingend. Aktuell
ist `ed25519-only` ohne Windows-Code-Signierung explizit konfiguriert; keine
Akzeptanz von `HashMismatch`/`NotTrusted` als Fallback. Fehlender Modus bedeutet
weiterhin verpflichtendes Authenticode. Windows-Warnungen sind möglich.
Bestehende Installationen mit privater Sichtbarkeit/anderem Modus benötigen eine
manuelle geprüfte Erstinstallation. Native A→B-Abnahme bleibt offen.


Stand: 15.11.2026, Umsetzungsschritt 8. Diese Implementierung ergänzt den
[verifizierten Download](Desktop_Update_Download.md). Produktive Signatur- und
Freigabeinfrastruktur ist weiterhin nicht eingerichtet; die Release-Policy bleibt
**deaktiviert**. Eine echte native Windows-Abnahme steht aus. Linux-Installation
ist inzwischen im [AppImage-Updateweg](Desktop_Linux_Update.md) ergänzt.

## Zustimmung, laufende Vorgänge und Beenden

Ein geprüftes Windows-Paket bietet „Jetzt installieren“ bzw. „Update installieren
und App neu starten“. Die benannte IPC-Methode `installUpdate(version)` akzeptiert
nur eine gültige Version, keine Befehle oder Dateipfade. Main verlangt einen
installierten stabilen Windows-x64-Build und passende aktuelle Vertrauensdaten.
Das Paket muss weiterhin zur aktuell verifizierten Freigabe gehören. Abgelaufene
oder inzwischen verworfene Freigaben werden abgelehnt.

Main prüft offene Arbeitsdialoge und `aria-busy`, bevor ein eigener nativer Dialog
erscheint. Dieser nennt App-/Serverende, ungespeicherte Eingaben und Neustart.
„Abbrechen“ ist vorausgewählt; die Downloadzustimmung ersetzt diese Bestätigung
nicht. Danach wird die Oberfläche vorübergehend gegen Eingaben gesperrt. App-
und Fensterende werden während der Vorbereitung abgefangen, bis die sichere
Übergabe freigegeben wurde.

Der Backend-Launcher erzeugt pro Start ein zufälliges 256-Bit-Steuergeheimnis.
Nur Main kennt es; es wird weder über IPC noch über URLs oder Antworten ausgegeben.
`DesktopUpdateGate` erlaubt Pause/Freigabe ausschließlich per authentifizierter
Loopback-POST-Anfrage. Normale Webstarts besitzen keinen solchen Steuerzugang.
Die Pause sperrt neue API-Vorgänge und wartet bis zum vollständigen Abschluss
aller bereits aktiven API-Antworten einschließlich Dateiausgabe/Hintergrundabschluss.
Rechnungs-, Dokumenten-, Einstellungs- und Sicherungsoperationen werden so nicht
für das Update unterbrochen. Der reine Healthcheck bleibt verfügbar.

Nach 20 Sekunden ohne erfolgreichen Abschluss wird die Pause aufgehoben; es
beginnt keine Installation. Nur nach erfolgreicher Pause wird der eigene Python-
Prozess kooperativ beendet. Der neue Update-Shutdown verwendet weder `taskkill`
noch SIGTERM/SIGKILL als Eskalation. Ist das Ende nicht fehlerfrei bestätigt,
wird nicht installiert. Eine fehlgeschlagene Vorbereitung gibt das Backend wieder
frei bzw. startet den bisherigen Backend-Build neu. Falls dessen Wiederanlauf
selbst scheitert, bleibt die manuelle Reparatur erforderlich; Daten werden nicht
zurückgesetzt.

## Separater Windows-Helfer und Verifikation

`windows_update_helper.cjs` enthält ausschließlich statischen PowerShell-Code.
Ein kurzer Starter in der eingebetteten Python-Laufzeit startet die Windows-eigene
PowerShell über ihren vollständigen Systempfad und gibt seine Programmdateien vor
dem NSIS-Start frei. Die PowerShell läuft nach dem App-Ende weiter. Sie bestätigt
den Übergabebefehl über die Pipe, bevor die App beendet wird. Der Start verwendet
keine Shell, PATH-Suche, Elevation oder Änderung der ExecutionPolicy. Code und
JSON-Kontext sind getrennt: Code als konstantes EncodedCommand, Werte über UTF-8-
stdin. Publisher-/Benutzerpfade werden niemals zu PowerShell-Code zusammengesetzt.
Es werden weder zusätzliches PowerShell 7 noch Windows SDK am Zielgerät benötigt.

Der Helfer prüft vor seiner Bereitschaft:

- Private Profil-/Cachepfade ohne Reparse Points; ACLs dürfen keinem fremden SID
  Schreib-/Lösch-/Berechtigungsänderungsrechte geben. SYSTEM und Administratoren
  bleiben Teil des dokumentierten lokalen Vertrauensmodells. Reine InheritOnly-
  Regeln gelten nicht als Zugriffsrecht auf das geprüfte Objekt.
- Eine exklusive Profilsperre gegen parallelen Appstart während der Installation.
- Erneute Dateigröße und SHA-256. Der Installer wird über einen Dateihandle gegen
  Schreiben und Löschen gesperrt gehalten, bis er vollständig beendet ist.
- Native `Get-AuthenticodeSignature` gemäß eingebettetem Modus: aktuell
  `ed25519-only` verlangt `NotSigned` und exakte ProductVersion. Nur im Modus
  `authenticode-required`: `Valid`, Zeitstempelzertifikat, exakt
  eingebetteter SHA-256-Zertifikatsfingerprint, Publisher-Subject und Zielversion.
  Fehler oder fehlendes Vertrauen führen zum Abbruch; es gibt keinen Fallback
  auf alleinige Dateiprüfsummen oder eine ignorierte Zertifikatsprüfung.
- Exakt vorhandene HKCU-Installation mit passendem InstallLocation und aktueller
  Version; Zielversion strikt höher. Der bestehende aus der App-ID abgeleitete
  GUID bleibt `da941357-9ae2-5f27-a221-a8db9727ec79`.

Erst danach werden Backend und App beendet. Main verlangt eine bestätigte
Commit-Übergabe und ein abschließendes Startsignal an den Helfer und übergibt dessen Paket aus der Downloadbereinigung.
Der Helfer wartet auf das Ende des exakt identifizierten Main-Prozesses und prüft
Signatur/Hash sowie den Ablaufzeitpunkt der Freigabe noch einmal unmittelbar vor dem Start. Er führt den Installer
**sichtbar ohne `/S`, `/D`, Elevation oder beliebige Argumente** aus.

Der NSIS-Hook `customCheckAppRunning` verweigert jetzt Installation und
Deinstallation, solange die App noch läuft. Der Standardmechanismus, der lebende
App-Prozesse zwangsweise beendet, wird ersetzt. Nur der dokumentierte
[nsProcess-Rückgabecode 603](https://nsis.sourceforge.io/NsProcess_plugin) bestätigt
einen fehlenden Prozess; auch unbekannte Prüffehler sperren die Installation. Bestehende Per-User-Installation,
App-ID, Pfadschutz, Downgrade-Sperre und Verbot von `--delete-app-data` bleiben.

## Abschluss, Neustart und Fehlergrenzen

Nach Installer-Exitcode 0 prüft der Helfer zusätzlich Zielversion/App-ID/Distributions-
und Releasekanal im neuen Paket, den gebundenen Release-Commit, sämtliche Pflichtmodule und Dateien des Installationsmanifests,
die neue App-EXE gemäß eingebettetem Windows-Modus sowie die registrierte Version.
Zusätzlich müssen Modus, Repository-ID/Sichtbarkeit und Schlüssel-ID des neuen
Clients unverändert sein. Erst dann werden
Sitzungspaket und Sperre freigegeben und die neue App gestartet. Bei Abbruch oder
unvollständigem Ergebnis gibt es eine verständliche native Fehlermeldung und
keinen automatischen Start ungeprüfter Programmdateien.

`<userData>/updates/windows-install-state.json` protokolliert nur Versionen,
Zeitpunkt und `handoff`/`installed`/`failed`, ohne Zugangsdaten oder Befehle. Beim
nächsten erfolgreichen Backendstart entfernt Main einen zur installierten Version
passenden Abschluss. Andere Ergebnisse werden als nicht vollständig bestätigte
Aktualisierung angezeigt. Ein aktiver/gesperrter Installations-Lock verhindert
vor Backendstart eine neue Instanz. Ein verwaister, nicht mehr gesperrter Lock
blockiert den Start nicht dauerhaft. Das normale Bootstrap-Installationsmanifest
verweigert weiterhin unvollständige Programmdateien schon vor Main/Backend.

NSIS ersetzt Programmdateien; es ist kein transaktionales Dateisystem-Rollback.
Bei Abbruch nach dem Entfernen alter Dateien kann ein vollständiger gleicher oder
neuerer Installer zur Reparatur nötig sein. `%APPDATA%\ttc-rechnungsverwaltung`,
Datenbank, Dokumente und Einstellungen werden nicht gelöscht. Es gibt weder eine
automatische Rückinstallation alter Programmdateien noch die Wiederherstellung
älterer Datenbankschemata. Neue Datenbankmigrationen laufen ausschließlich beim
regulären Start der neuen App; Schemafehler werden mit erhaltenen Daten gemeldet.

## Tatsächlich geprüfter Stand

- 165 JavaScript-Tests bestanden, einschließlich gezielter Übergabe-/Abbruchfälle,
  versionsgebundener Installations-IPC, Wiederanlauf, Journal und tatsächlicher
  NSIS-Hook-Kompilierung. Ein nativer PowerShell-Parsertest ist unter Linux
  übersprungen; er läuft in der vorhandenen Windows-CI ohne Installer-Ausführung.
- 396 Python-Tests bestanden, elf optionale/plattformabhängige Tests übersprungen.
  Neue Gate-Tests prüfen auslaufende Rechnungs-/Sicherungsvorgänge, Sperre neuer
  Operationen, ungültigen Steuerzugang und Freigabe nach Timeout.
- Acht native Linux-Electron-Regressionen bestanden (Dialog/Download jeweils
  Entwicklungs-/Produktionsmodus und vier Rechnungs-/Sicherungs-/Neustartfälle).
  Sie belegen den erhaltenen lokalen Betrieb, keine Windows-Installation.
- Linux-AppImage-Build erfolgreich; neue Pflichtmodule sind im Installations-
  manifest enthalten. Workflow-Lint und Git-Diff-Prüfung erfolgreich.

Die Windows-Koordinatortests verwenden echte signierte Metadaten und lokale
Dateien, aber einen isolierten Helfer-/Dialog-/Backendadapter. Unter Linux wurde
kein NSIS-Installer ausgeführt, kein Windows-Zertifikat geprüft und kein realer
Windows-Neustart nach Installation getestet. Die produktive Einrichtung bleibt
bis zur dokumentierten Signatur-/Freigabeeinrichtung gesperrt.

## Noch erforderliche native Windows-Abnahme

Die zusammengeführte [Betriebs- und Abnahmeanleitung](Desktop_Update_Abnahme.md)
enthält Vorbereitung, Testbestand, Dateivergleiche, Fehlerfälle und Protokollvorgaben.

In einer isolierten Windows-x64-VM mit Snapshot und ausschließlich Testdaten:

1. Zwei freigegebene, tatsächlich signierte stabile Versionen mit demselben
   App-ID/GUID und den eingebetteten echten Test-Vertrauensankern bereitstellen.
   Anfangsbestand von Datenbank, Rechnungs-PDFs, Terminen und Einstellungen sichern.
2. Alte Version installieren; normale Per-User-Registryeinträge und Profilpfad
   prüfen. Update laden, zweite Zustimmung ablehnen: App und Daten bleiben nutzbar.
3. Rechnungserstellung/Sicherung laufen lassen: Update wartet oder lehnt ab;
   Timeout darf weder Prozess noch Schreiboperation abbrechen. Nach Abschluss
   erneut zustimmen und den sichtbaren NSIS-Ablauf ohne vorherige Deinstallation
   vollständig durchführen. Neuer Start muss korrekte Version und alle Daten zeigen.
4. Installer abbrechen, beschädigtes Paket, falschen Publisher, ungültige/abgelaufene
   Signatur, ACL-/Reparse-Manipulation und fehlende Registryzuordnung prüfen:
   keine Ausführung ungeprüfter Dateien, kein Downgrade, verständliche Meldung.
5. Parallelstart während der Übergabe/Installation, Prozessabsturz, Neustart des
   PCs und unvollständige Programmdateien prüfen. Sperre/Journal dürfen nicht zu
   stiller Neuinstallation oder Datenlöschung führen. Reparatur mit gleichem oder
   neuerem vollständigem Installer muss möglich bleiben.
6. Profil-/Dokumentenbestand vergleichen, erfolgreichen neuen Backendstart und
   Registry-/Manifest-/Authenticode-Abschluss prüfen. Unterschiedliche Benutzer-
   und Installationspfade einschließlich Leerzeichen und Umlauten testen.

Erst diese Abnahme zusammen mit echter Release-Infrastruktur belegt den nativen
Windows-Updateablauf. Hier wurde kein produktiver Release ausgelöst.
