# Offlinebetrieb und Update-Fehlerbehandlung

Stand: 15.11.2026, Umsetzungsschritt 10. Dieser Schritt sichert die vorhandenen
Updatekomponenten ab. Paketformate, Releasefreigaben und Signaturvoraussetzungen
werden nicht erweitert. Produktive Updates bleiben bis zur echten Einrichtung
gesperrt; Windows- und vollständige AppImage-/FUSE-Abnahme stehen weiterhin aus.

## Verhalten im Fehlerfall

- Update-Prüfungen bleiben optional und zeitlich begrenzt. DNS-, Verbindungs- und
  Serverfehler liefern verständliche statische Meldungen; lokale Rechnungs-,
  Dokumenten-, Einstellungs- und Sicherungsabläufe bleiben verfügbar.
- Der Transport bricht auch wartende Metadatenleser ab. Fehlerantworten und zu
  große Antworten werden geschlossen, statt ungenutzte HTTP-Bodies offen zu
  halten. Nach einem Timeout oder App-Ende startet eine verspätet abgeschlossene
  Versionsabfrage keinen weiteren Netzwerkzugriff.
- Manuelle Prüfungen teilen sich bereits vor dem ersten asynchronen Zurücksetzen
  dieselbe laufende Aktion. Zugangsbearbeitung, Prüfung, Abbruch und Installation
  sind gegeneinander gesperrt. Wiederholte Downloadanforderungen starten keine
  zweite Übertragung, auch nicht über synchrone Statusbeobachter.
- Wiederkehrende Hintergrundprüfungen verändern während eines aktiven Downloads
  oder einer Installation nicht die aktuelle verifizierte Freigabe.
- Statusmeldungen besitzen eine aufsteigende Revision. Der Renderer verwirft
  ältere RPC-/Ereignisantworten, sodass verspätete Ergebnisse keinen neueren
  Downloadfortschritt oder Abbruchstatus zurücksetzen.

## Nutzerabbruch und Speicherplatz

„Download abbrechen“ ist im Dialog und im Desktop-Abschnitt verfügbar. Der
versionsgebundene Aufruf `cancelUpdateDownload(version)` besitzt dieselben
Argument-, Hauptframe- und Originprüfungen wie die übrigen benannten Methoden.
Es gibt weiterhin keine frei wählbaren Pfade, URLs oder Installationsbefehle.

Ein Abbruch schließt den Transport, wartet auf die Bereinigung der Teildatei und
zeigt einen eigenen Abbruchstatus. Ein bereits abgeschlossener anderer Download
wird durch einen verspäteten Abbruch nicht gelöscht. Ein Schreibcallback, der erst
nach dem Abbruch zurückkehrt, kann weder Fortschritt noch Paketfreigabe wieder
aktivieren. Bereits abgebrochene Zeitgeber werden nicht neu gestartet.
Ein erneuter Versuch benötigt manuelle Prüfung und neue Downloadzustimmung.
„Im Hintergrund weiterladen“ schließt dagegen ausschließlich den Dialog.

Die vorhandene Speicher-Vorprüfung bleibt bestehen. Reale `ENOSPC`-/Quota-Fehler
während des Schreibens werden ebenfalls als Speicherplatzfehler gemeldet;
Teildateien werden entfernt und kein Installationspaket freigegeben. Wenn das
Betriebssystem eine Bereinigung verweigert, bleibt die Installation gesperrt und
der Nutzer erhält einen Speicherzugriffsfehler. Es gibt keinen Löschversuch an
persönlichen Daten, um Platz für ein Update zu schaffen.

## Neustart und verbliebene Sitzungsdateien

Nach Fenster-/Backendstart prüft der Downloader im aktivierten Updateweg seinen
privaten Cache und verwirft alte zufällige Downloadslots. Gespeicherte Zugänge,
Datenbank, Dokumente und unbekannte Verzeichnisse werden nicht angefasst. Ein nach
einem Prozessabsturz verbliebenes Paket wird niemals als bereits geprüft geladen
oder automatisch installiert. Die Prüfung liest keine Netzwerkquelle.

Der Linux-Helfer kennzeichnet sein privates Zwischenverzeichnis neben dem
AppImage mit App-ID und dem ursprünglichen Dateinamen. Beim nächsten Start können
nur passend zugeordnete, benutzereigene Verzeichnisse mit ausschließlich bekannten
regulären Dateien entfernt werden. Fremde Zielnamen, Symlinks, unbekannte Dateien
oder unklare Eigentümer werden erhalten. Verwaiste private Hilfsruntime-Verzeichnisse
werden nach Prüfung der Profilsperre bereinigt. Unbekannte oder nicht eindeutig
zuordenbare Reste werden nicht als Programmdateien wiederverwendet.

Die vorhandenen Übergabeprotokolle erfordern weiterhin ein abschließendes
Startsignal. App-Abbruch nach Commit-Bestätigung, aber vor diesem Signal, führt
nicht zum Austausch. Journale erlauben nur Diagnose und sichere Bereinigung,
keine unbeaufsichtigte Wiederholung oder Datenbank-Rollbacks.

## Tatsächlich ausgeführte Prüfungen

- **186 JavaScript-Tests bestanden**, ein nativer Windows-Parsertest übersprungen.
  NSIS-Schutzmakros wurden tatsächlich kompiliert. Neue Fälle decken DNS/Reset,
  Metadatenleser-Abbruch, spät zurückkehrende Anfragen/Schreibcallbacks,
  parallele Aktionen, Nutzerabbruch, alte UI-Revisionen und Neustart-Bereinigung ab.
- **406 Python-Tests bestanden**, 13 optionale/plattformabhängige Tests übersprungen.
  Darunter der neue Prozessabbruch nach Commit ohne Startsignal. Ein vollständiger
  Lauf meldete im bestehenden parallelen Rechnungs-Löschtest einmal HTTP 500.
  Die gezielte Wiederholung und der folgende vollständige Lauf bestanden. Die
  betroffenen Backend-/Datenbank-/Dokumentenroutinen wurden hier nicht geändert;
  diese Beobachtung bleibt für die umfassende Regression in Schritt 11 relevant.
- **Vier native Electron-Rechnungs-/Datenerhalt-Szenarien in einer echten isolierten
  Netzwerk-Namespace bestanden.** Verifiziert wurden ausschließlich Loopback,
  `ENETUNREACH` für externe IPv4/IPv6-Ziele sowie ein aktivierter Test-Update-Dienst
  mit echtem fetch/DNS statt Netzwerk-Mock. Die Tests nutzen eine feste öffentliche
  Testquelle ohne Token; keine Rechnung oder persönlicher Pfad wird übertragen.
  Updatefehler verhinderten weder Rechnungserstellung, Dokumente, vollständige
  Sicherung, Export, Wiederanlauf noch die vorhandene Hard-Crash-Wiederherstellung.
- **Sechs native Electron-Update-UI-Szenarien bestanden:** Dialog, verifizierter
  Fixture-Download und Nutzerabbruch jeweils in Entwicklungs-/Produktionsmodus.
  Token-/Transportadapter bleiben hier isolierte Testadapter. Der Testtreiber
  wartet nicht unbegrenzt auf Zeichenframes verdeckter Fenster; seine
  Hintergrunddrosselung wird nur im Test deaktiviert. Ein Entwicklungslauf
  erreichte beim gleichzeitigen Build einmal das bestehende Reload-Shutdown-Limit;
  der anschließende isolierte Lauf aller sechs Fälle bestand. Produktions- oder
  Backend-Zeitlimits wurden dafür nicht erhöht.
- **Echter ENOSPC-Test bestanden:** In einer eigenen Mount-Namespace wurde ein
  64-MiB-tmpfs nach erfolgreicher Vorprüfung gefüllt. Der Paket-Schreibzugriff
  scheiterte tatsächlich am Dateisystem; Fehlercode, Teildateibereinigung und
  unveränderte lokale Testdaten wurden geprüft. Kein Dateisystem des Hosts wurde
  gefüllt oder umkonfiguriert.
- Ein echter, ausschließlich für den Test gestarteter Downloaderprozess wurde
  während einer Teildatei hart beendet. Die nächste Instanz entfernte den Rest
  ohne Zugriff auf Zugangsdatei oder persönliche Testdaten.
- AppImage-Build und Prüfung des entpackten Installationsmanifests erfolgreich.

Die echten Offline-Prüfungen verwenden `unshare --user --map-current-user --net
--keep-caps` und aktivieren nur `lo`. Der ENOSPC-Treiber
`tests/native_update_space_check.cjs` darf ausschließlich mit einem eigenen,
kleinen tmpfs unter `TTC_TEST_SPACE_DIRECTORY` laufen; er prüft Dateisystemtyp und
maximale Größe vor dem Füllen. Diese Treiber sind keine Anwendungsdateien und
werden nicht mit ausgeliefert.

Es wurde keine native Windows-Installation oder vollständige FUSE-Aktualisierung
behauptet, kein produktiver Release ausgelöst und keine Signaturinfrastruktur
ersetzt. Der vollständige Testausbau und die Abnahme gehören zu Schritt 11/12.
