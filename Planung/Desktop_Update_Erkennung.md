# Update-Erkennung im Desktop-Main-Prozess

Stand: 14.11.2026, Umsetzungsschritt 5. Dieser Schritt implementiert Erkennung,
Metadatenprüfung, Zeitplanung und die lesenden IPC-Schnittstellen. Update-Dialog,
GitHub-Zugangsoberfläche, Paketdownload und Installation folgen in den nächsten
einzeln freizugebenden Schritten. Es gibt noch keinen automatischen Paketdownload.

## Aktivierung und laufender Dienst

`electron/main.cjs` erzeugt nach Backend-Bereitschaft und Fenstererzeugung den
optionalen Dienst aus `electron/updates.cjs`. Fehler bei seiner Initialisierung
führen nicht in den globalen App-Fehlerhandler. Beim Beenden werden Zeitplan und
laufende Prüfung abgebrochen, bevor das vorhandene Backend kontrolliert stoppt.

Eine automatische Prüfung wird nach drei Sekunden geplant, danach alle sechs
Stunden mit ±10 % Zufallsversatz. Der App-Start wartet nicht auf diese Prüfung.
Start/Stop sind idempotent; Hintergrundtimer halten keinen eigenen Prozess offen.
Automatische und manuelle Anfragen teilen sich eine laufende Promise. Nach
Abschluss werden weitere Prüfungen bis 30 Sekunden nach dem Prüfungsbeginn aus
dem bisherigen Status beantwortet, statt unkontrolliert neue Anfragen zu senden.

Der Dienst ist nur für installierte stabile Windows-x64-NSIS- und Linux-x64-
AppImage-Builds mit gültiger eingebetteter `desktopUpdateTrust` aktiv. Technische
App-ID, installierte Version, Paketformat und Ed25519-Fingerprint müssen passen.
Es gibt keine Feed-URL aus dem Renderer und keinen Aktivierungsschalter über eine
Umgebungsvariable. Entwicklungsbuilds und nicht eingerichtete Builds bleiben ohne
Netzwerkzugriff deaktiviert; ungültige lokale Vertrauensdaten sperren die Funktion.

## GitHub-Erkennung und private Downloads

`electron/update_transport.cjs` führt ausschließlich begrenzte HTTPS-GETs aus:
Repository-Identität/Sichtbarkeit prüfen, Release-Seiten lesen und nötigenfalls
Manifest plus Signatur abrufen. Alle Anfragen zusammen einschließlich
Zugangsentschlüsselung haben ein **Gesamtzeitlimit von 15 Sekunden**.

Die Suche verwendet die Release-Liste mit höchstens zehn Seiten zu je 100
Einträgen. Sie wählt die höchste numerische stabile `desktop-vX.Y.Z`-Version
oberhalb der aktuellen Version bzw. eines vom Main-Prozess vorgegebenen
Versionshöchststands. Web-Tags, Entwürfe, Prereleases, ungültige Versionen und
Downgrades werden ignoriert. Bei unvollständig gelesener Liste wird ein Fehler
gemeldet, nicht fälschlich „aktuell“. Es gibt keinen Rückfall auf ein älteres
Update, wenn die Metadaten der höchsten angebotenen Version ungültig sind.

Der private Repository-Modus verlangt eigenen GitHub-Lesezugriff. Fehlt dieser,
lautet der Status `authentication_required`, ohne einen anonymen Netzwerkversuch
oder einen Startdialog. Es wird kein gemeinsames oder eingebettetes Token
verwendet. Die Bedienung zur Einrichtung dieses Zugangs folgt in Schritt 6.

Zugriffstokens werden ausschließlich an `api.github.com` übertragen. Für
Metadaten-Assets akzeptiert der Transport höchstens fünf HTTPS-Umleitungen auf
`release-assets.githubusercontent.com` oder `objects.githubusercontent.com`,
ohne fremde Ports, Zugangsdaten im URL oder andere Hosts. Der Token-Header wird
bei der ersten Umleitung entfernt und nicht wieder angefügt. API-JSON-Anfragen
folgen keinen automatischen Redirects. Renderer-CSP und dessen ausschließlich
lokale Netzfreigabe bleiben unverändert.

Es werden keine Rechnungen, Datenbanken, Namen, Datenpfade oder Gerätekennungen
übermittelt. GitHub sieht die notwendige Authentifizierung, Repository-/Asset-
Anfragen, den generischen Updater-User-Agent und gewöhnliche Verbindungsdaten wie
die IP-Adresse. Response-Bodies, Tokens und rohe Netzwerkfehler werden nicht in
Statusmeldungen oder Logs ausgegeben.

## Signierte Metadaten

`electron/update_manifest.cjs` überprüft die tatsächlichen Manifestbytes mit dem
im Installer verankerten Ed25519-Public-Key, bevor deren Inhalt angeboten wird.
Der Parser weist doppelte JSON-Schlüssel einschließlich Unicode-Escape-Varianten,
übermäßige Verschachtelung, ungültiges UTF-8 und Manifeste über 64 KiB zurück.
Die Signatur muss genau 64 Byte lang sein.

Das Schema stimmt mit dem Publisher aus Schritt 4 überein und bindet:

- App-ID, stabile Version, Tag und tatsächlichen Quellcommit;
- Repository-Name, feste Repository-ID, Sichtbarkeit und Schlüssel-ID;
- Veröffentlichungs-/Ablaufzeit, maximal ein Jahr Gültigkeit und höchstens fünf
  Minuten tolerierte Zukunftsabweichung der Systemuhr;
- beide tatsächlich vorhandenen Plattformpakete mit festen Dateinamen, x64,
  Paketformat, Größe, SHA-256, Asset-ID und exakt daraus gebildeter API-URL;
- Windows-Quittung entsprechend dem lokal eingebetteten Modus: `NotSigned`/
  ProductVersion für `ed25519-only`, zusätzlich Zertifikatsidentität und Zeitstempel
  für `authenticode-required`;
- begrenzte Release Notes als **Text**, der später nicht als HTML auszuführen ist.

Die vollständige Assetliste muss die sechs durch den Publisher vorgesehenen
Dateien enthalten. Manipulierte, abgelaufene oder unpassende Freigaben ergeben
keinen verfügbaren Installationskandidaten. Release-Notes aus unbestätigten
GitHub-Release-Bodies werden nicht als Update-Information übernommen.

Die Main-interne Kandidatenansicht enthält das verifizierte Manifest und das
passende Paket. JSON-Objekte sind eingefroren, Binärpuffer werden bei Zugriff
kopiert; ein abgelaufener Kandidat wird nicht zur Installation zurückgegeben.
An den Renderer gehen nur Zustand, aktuelle/verfügbare Version, signierte Notes,
Zeitstempel und festgelegte Fehlermeldungen. Er bekommt weder Quellenwahl noch
Installationsbefehle oder Zugangstokens.

Der persistierte Versionshöchststand wird erst nach erfolgreicher Prüfung eines
vollständigen Binärdownloads in Schritt 7 geschrieben. Die Erkennung akzeptiert
dafür bereits einen Main-internen Getter; sie erhöht diesen Stand nicht allein
aufgrund empfangener Metadaten. Die installierte Version bildet stets die
Untergrenze.

## Persönlicher Zugang und geschützter Speicher

`electron/update_credentials.cjs` stellt ausschließlich im Main-Prozess Lesen,
Setzen und Entfernen eines persönlichen Tokens bereit. Die UI-Bindung wird in
Schritt 6 ergänzt; es gibt keine lesende Token-IPC zum Renderer.

Der Speicher verwendet die asynchronen Electron-45-APIs
`isAsyncEncryptionAvailable`, `encryptStringAsync` und `decryptStringAsync`.
Windows verwendet den vom Betriebssystem bereitgestellten Schutz. Unter Linux
werden nur ein erkannter libsecret-/KWallet-Backend und verfügbare Verschlüsselung
akzeptiert. `basic_text` und `unknown` werden abgelehnt. Es gibt keinen Klartext-
Fallback und keine Änderung der Betriebssystem-Schlüsselverwaltung durch die App.

Die verschlüsselte Datei liegt unter `<userData>/updates/github-access.enc`.
Datei-/Verzeichnisrechte und Eigentümer werden unter Linux geprüft; Verknüpfungen
werden zurückgewiesen. Schreibzugriffe laufen seriell über eine zufällige neue
Datei mit anschließender Umbenennung. Nach einer vom Betriebssystem gemeldeten
Schlüsselrotation wird erneut verschlüsselt. Eine nicht vorhandene Datei verlangt
keine Initialisierung des OS-Schlüsselspeichers. Vorhandene Geschäfts-Backups
nehmen weiterhin nur die festgelegten Datenbank-/Dokumentendateien auf, nicht
diese Zugangsdatei.

Die Zugangsinformation wird nicht an das Python-Backend übergeben und nicht in
Programmdateien oder Freigabemetadaten geschrieben. Derselbe Betriebssystem-
Benutzer und lokale Administratoren sind keine durch diesen Speicher isolierten
Angreifer; ein kompromittiertes Benutzerkonto kann damit nicht abgesichert werden.

## IPC und Fehlerzustände

Zusätzlich zur vorhandenen Versionsabfrage bietet der Preload benannte Methoden:

| Methode | Fester Kanal | Argumente |
| --- | --- | --- |
| `getUpdateStatus()` | `ttc:request:updates:get-status` | keine |
| `checkForUpdates()` | `ttc:request:updates:check` | keine |

Die bestehenden Hauptfenster-/Hauptframe-/Loopback-Origin-/Pfadprüfungen gelten
für alle drei Anfragen. Fremde Frames, URLs, zusätzliche Argumente oder generische
Channel-Aufrufe sind nicht erlaubt. Handler werden beim Beenden entfernt.

Zustände: `disabled`, `idle`, `checking`, `available`, `up_to_date`,
`authentication_required`, `error`. DNS-/TLS-/Netzfehler, fehlende Zugriffsrechte,
Rate Limits, Zeitüberschreitungen, untrusted Redirects, fehlerhafte oder abgelaufene
Metadaten werden kontrolliert behandelt. Weder synchrone noch asynchron abgelehnte
Status-Listener dürfen einen App-Abbruch auslösen. Eine fehlgeschlagene Prüfung
erzeugt keinen Download und verhindert keine lokale Rechnungsbearbeitung.

## Tatsächlich durchgeführte Prüfungen und Grenzen

- Node 24.22.3: **121 JavaScript-Tests bestanden**, 1 optionale NSIS-
  Hookkompilation übersprungen. JavaScript-Syntax und beide Workflow-Dateien
  wurden erfolgreich geprüft.
- Linux-Entwicklungs-AppImage erneut gebaut und entpackt: endgültiges
  Installationsmanifest geprüft, neue Update-Module aus dem tatsächlichen Paket
  geladen und deaktivierten Entwicklungsstatus bestätigt. Kein produktiver
  Release und kein GitHub-Schreibzugriff.
- Vollständige Python-Suite mit Python 3.13.18 und CI-Pins: **393 bestanden**,
  7 optionale Fälle übersprungen.
- Die vier vorhandenen echten Electron-GUI-Regressionen wurden unter Linux
  zusätzlich ausgeführt: **4 bestanden**, Entwicklung/Produktion jeweils mit
  Standard- und eigener Dokumentenablage. Sie prüfen nun auch Status-/Prüf-IPC
  sowie unveränderte Geschäftsabläufe mit temporären Profilen. Diese Läufe
  verwendeten keine getrennte Offline-Netzwerk-Namespace und keine Windows-VM.
- JavaScript-Tests prüfen echte Ed25519-Signaturen aus dem Publisherformat,
  Versionsauswahl, private API-Anfragen, Redirectschutz, Ablaufzeiten,
  Manipulationen, parallele Prüfungen, Deadline/Abbruch, Fehler-Wiederholung,
  Zeitplan, IPC-Abweisung und vom Appstart isolierte Dienstfehler.
- Der Credential-Provider wird im Test durch einen Vertragspartner mit
  temporärer AES-Verschlüsselung ersetzt. Native DPAPI-/KWallet-/libsecret-
  Speicherung wurde nicht als erfolgreich abgenommen behauptet.
- Ein realer erfolgreicher Abruf eines produktiv signierten GitHub-Releases
  bleibt mangels aktivierter Release-Infrastruktur und Client-Zugang offen.
  UI, Binärdownload und Installation sind noch nicht Bestandteil dieses Schritts.

Primärquellen: [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage),
[GitHub Release-API](https://docs.github.com/en/rest/releases/releases).
Verwendete API-Signaturen wurden mit den lokal installierten Electron-45.3.1-
Typen abgeglichen; es werden keine entfernten Electron-46-Signaturen vorausgesetzt.
