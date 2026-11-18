# Verifizierter Desktop-Paketdownload

Stand: 15.11.2026, Umsetzungsschritt 7. Die inzwischen ergänzte
[Windows-Installation aus Schritt 8](Desktop_Windows_Update.md) baut hierauf auf. Die automatische Installation gehört
weiterhin zu Schritt 8 (Windows) und Schritt 9 (Linux). Dieser Schritt lädt nach
Nutzerzustimmung das passende Paket herunter und prüft es; er startet keine
Installationsdatei, ersetzt keine Programmdateien und verändert keine Nutzdaten.

## Vertrauen und Quelle

Der Main-Prozess erzeugt `electron/update_download.cjs` mit der bereits geprüften,
eingebetteten Konfiguration aus Schritt 5. Entwicklungsbuilds und Builds ohne
aktivierte Vertrauensdaten starten keine Downloads. Der produktive Releaseprozess
bleibt gemäß `desktop-release-policy.json` bis zur echten Einrichtung gesperrt.
Es wurden keine Ersatzschlüssel eingerichtet oder Repository-Einstellungen geändert.

`requestUpdate(version)` ist der vorhandene, versionsgebundene IPC-Aufruf nach
„Jetzt aktualisieren“. Der Renderer kann weder URLs, Dateinamen, lokale Pfade noch
Installationsbefehle bestimmen. Main prüft vor Beginn erneut die exakten
Manifestbytes mit dem eingebetteten Ed25519-Schlüssel, Ablaufzeit, Version über der
installierten Version sowie Plattform und Paketformat. Die Authentizität beruht
auf dieser Signatur, welche auch Größe und SHA-256 des Pakets bindet.

Vor dem Paketabruf prüft der Transport erneut die feste GitHub-Repository-ID,
den Namen, die Sichtbarkeit und den konkreten veröffentlichten Release über
seine ID. Die gespeicherte Signatur muss auch zu dessen aktuellen Assetangaben
passen. Drafts, Prereleases, geänderte Assets oder eine andere Quelle scheitern.
Downloadziele entstehen ausschließlich aus der gebundenen Asset-ID am festen
GitHub-API-Ursprung. HTTPS-Weiterleitungen sind nur zu
`release-assets.githubusercontent.com` und `objects.githubusercontent.com`
erlaubt. Token werden ausschließlich an die GitHub-API gesendet und vor einer
CDN-Weiterleitung entfernt. Cookies und automatische Redirects sind deaktiviert.

Windows lädt ausschließlich das signierte NSIS-Asset, Linux ausschließlich das
AppImage für x64. Die im signierten Manifest gebundene Windows-Signaturquittung
wird weiterhin geprüft. **Die native Windows-Modusprüfung unmittelbar vor einer
Installation gehört zu Schritt 8.** Der Download führt keine Datei aus.

## Streaming, Prüfung und Dateien

- Der Transport schreibt mit Rückstaukontrolle, ohne das gesamte Paket im RAM zu
  sammeln. Erwartete Länge und Obergrenze stammen aus dem signierten Manifest
  (maximal 1 GiB). Widersprechende Content-Length, Teilantworten, Content-Range,
  komprimierte Übertragung, zusätzliche oder fehlende Bytes werden verworfen.
- Speicherprüfung vor Beginn: Paketgröße plus 16 MiB Reserve müssen verfügbar
  sein. Tatsächliche `ENOSPC`/Quota-Fehler werden ebenfalls kontrolliert gemeldet.
- Profil und Vorfahren dürfen keine symbolischen Verknüpfungen sein. Cachepfad:
  `<userData>/updates/downloads/download-<zufällig>/package.part`. Main erzeugt
  private Verzeichnisse und eine exklusiv neu angelegte, nicht ausführbar gesetzte
  Datei. Unter Linux werden Eigentümer und Rechte geprüft (Verzeichnisse 0700,
  Dateien 0600). Unter Windows gilt das geerbte Benutzerprofil-ACL; die native
  Windows-ACL-/Installer-Abnahme ist noch offen. Der Cache erhält keinen
  benutzerwählbaren Pfad und wird nicht als ausführbares Programmverzeichnis benutzt.
- Nach vollständigem Schreiben wird synchronisiert und **die Datei erneut vom
  Datenträger gelesen und gehasht**. Größe, regulärer Dateityp, Dateiidentität und
  Linkanzahl werden überprüft. Erst nach passendem signierten SHA-256,
  erneuter Manifestprüfung und unveränderter lokaler Freigabe wird innerhalb des
  privaten Verzeichnisses atomar auf den signierten Paketnamen umbenannt.
- Nur Main besitzt einen internen Deskriptor des geprüften Pakets. Statusereignisse
  enthalten weder Dateipfade, Token, signierte Download-URLs noch rohe Exceptions.
  Eine spätere Installation muss Datei, Vertrauen und Plattform erneut prüfen.

## Laufzeit, Fehler und Oberfläche

Pro App läuft höchstens ein Download. Parallele Anforderungen werden abgewiesen;
eine manuelle Prüfung während des Downloads startet keine zweite Übertragung.
Der Download hat zehn Minuten Gesamtlimit und 30 Sekunden Stillstandsgrenze,
einschließlich Zugangsbeschaffung und Antwortaufbau. Abbruch schließt auch einen
wartenden Streamleser. Es gibt keinen automatischen Retry, keine Fortsetzung von
Teildateien und keinen Hintergrunddownload ohne vorherige Zustimmung.

Die Oberfläche zeigt tatsächlich geschriebene Bytes, Prozentfortschritt und eine
anschließende Prüfphase. „Im Hintergrund weiterladen“ schließt nur den Dialog;
der Desktop-Abschnitt zeigt weiter den Fortschritt. Nach Erfolg zeigt die App
„heruntergeladen und geprüft“ und nennt die derzeit noch fehlende automatische
Installation. Diese Meldung ist keine Installationsfreigabe.

Fehlerhafte oder abgebrochene Dateien werden vor der Fehlermeldung entfernt.
Wenn das Betriebssystem die Bereinigung verweigert, meldet Main einen
Speicherzugriffsfehler und gibt kein Paket frei. Ein neuer Versuch benötigt eine
manuelle Prüfung und neue Downloadzustimmung. Entfernen/Ändern des GitHub-Zugangs
bricht laufende Transfers ab und verwirft alte Ergebnisse. Beenden stoppt den
Download und entfernt auch geprüfte Sitzungspakete; ein Bereinigungsfehler
verhindert nicht das kontrollierte Beenden des lokalen Backends.

Nach einem Prozessabsturz können private Sitzungsdateien zurückbleiben. Beim
nächsten Downloadversuch entfernt Main ausschließlich die eigenen zufälligen
`download-XXXXXX`-Unterverzeichnisse im geprüften privaten Cache. Solche Dateien
werden nicht als geprüft wiederverwendet. Weitere Neustart-/Abbruchabläufe gehören
zur Absicherung in Schritt 10.

## Dateien und tatsächlich ausgeführte Prüfungen

Neue Module: `electron/update_download.cjs` und `electron/update_download.test.cjs`.
Angepasst: Transport, Update-Dienst, Controller, Main-Shutdown, statische IPC-Fehler,
Installationsmanifest, Frontend-Statusanzeige, Prüfskript und bestehende
Renderer-/Transport-/native Dialogtests. Die README verlinkt diese Anleitung.

```sh
npm run desktop:check
python -m pytest -q
TTC_RUN_ELECTRON_TESTS=1 python -m pytest -q -s tests/test_desktop_update_ui.py tests/test_desktop_invoice.py
npm run desktop:build:linux
```

- 151 JavaScript-Tests bestanden; ein optionaler NSIS-Artefakttest übersprungen.
- 393 Python-Tests bestanden; elf opt-in-/plattformabhängige Tests übersprungen.
- Acht gesondert aktivierte **native Linux-Electron-Szenarien** bestanden:
  Dialogprüfung und zustimmungsgesteuerter Download jeweils im Entwicklungs- und
  Produktionsmodus, dazu vier Rechnungs-/Datenerhalt-/Neustartregressionen mit
  Standard- und eigenem Dokumentenort. Der echte Fortschritt wurde bei 39 %
  angehalten und als Screenshot kontrolliert; anschließend wurden die vollständigen
  geprüften Dateibytes verglichen.
- AppImage-Build erfolgreich; das entpackte Paket bestand die Prüfung von
  Installationsmanifest, Versionsmetadaten und freigegebenem Starter.
- Signierte Testpakete decken Manipulation, Disk-Veränderung, falsche Länge,
  Streamabbruch, Encoding/Teilantwort, Zeitlimits, Zugangsentfernung,
  Speicherknappheit, Symlinks, abgelaufene/geänderte Freigaben, expliziten Retry und
  verwaiste Sitzungsslots ab. Redirectprüfungen testen auch die Tokenentfernung.

Die Downloadtests nutzen echte Signatur-/Hashprüfung, Dateien, Streamtransport,
Main/IPC und Renderer; HTTPS-Antworten und Zugangsspeicher sind isolierte
Testadapter. Es wurde kein echter GitHub-Release heruntergeladen oder veröffentlicht.
Keine native Windows-Installation, Authenticode-Abnahme oder echte Schlüsselbund-
Anmeldung wurde hier durchgeführt. Produktive Signatur-/Freigabeinfrastruktur
und die Installationsschritte bleiben offen.
