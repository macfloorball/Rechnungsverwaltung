# Desktop-Releases: Betriebs- und native Abnahmeanleitung

Stand: 19.11.2026. Historisches Testprotokoll: [Protokoll](Desktop_Update_Stand_2026-11-18.md). Dieses Dokument beschreibt die
auszuführenden Schritte und erforderlichen Nachweise, keine bereits bestandene
native Installationsabnahme. Einrichtung von Schlüsseln und GitHub-Schutzregeln:
[Desktop_Release_Einrichtung.md](Desktop_Release_Einrichtung.md).
Automatisierte Testmatrix: [Desktop_Update_Tests.md](Desktop_Update_Tests.md).

## Zuständigkeiten und Freigabe vor dem ersten Release

| Verantwortlich | Erforderliche Einrichtung/Nachweis |
| --- | --- |
| Repository-Administration | Actions aktiviert, notwendiges Kontingent, `Entwicklung-App` mit PR-Freigaben und vier erforderlichen CI-Checks geschützt; aktives Tag-Ruleset für `refs/tags/desktop-v*` mit Erstellungs-/Änderungs-/Löschsperre und begrenztem Bypass. |
| Release-Verantwortliche | `desktop-release` mit Required reviewer, geklärter Selbstfreigabe, deaktiviertem Admin-Bypass und genau einer Deploymentregel vom Typ Tag `desktop-v*`. Required-reviewer-Freigabe im öffentlichen Repository tatsächlich prüfen. |
| Signierverantwortliche (nur `authenticode-required`, aktuell zurückgestellt) | Isolierter Windows-x64-Runner mit Label `desktop-release-signing`, PowerShell 7 und Windows SDK; echter Code-Signing-Schlüssel im Store des Runner-Kontos; Zugriff technisch auf vertrauenswürdigen Release-Workflow beschränken. |
| Update-Schlüsselverantwortliche | Echtes Ed25519-Paar, unabhängige Prüfung von öffentlichem Schlüssel/Fingerprint, geschützte Sicherung und Rotation; privater PKCS8-PEM nur als Environment-Secret `DESKTOP_UPDATE_PRIVATE_KEY`. |
| Repository-Administration, bei API-Lesefehlern | Optional `DESKTOP_POLICY_READ_TOKEN` als Repository-Secret: Fine-grained, nur dieses Repository, Contents/Actions/Environments jeweils Read. Keine Schreibrechte. Zugänglichkeit der tatsächlichen Gate-Endpunkte prüfen. |
| Testverantwortliche | Windows-x64-VM und Ubuntu-LTS-/Fedora-x86_64-Systeme mit funktionierendem FUSE und Schlüsselbund; Snapshots und ausschließlich Testdaten; Befunde mit Paket-/Commit-/Systembezug festhalten. |
| Endnutzer privater Releases | Eigenes berechtigtes GitHub-Konto und persönlicher Lesetoken mit Contents Read für dieses Repository; Eingabe nur im Desktop-Updateabschnitt. Kein gemeinsames eingebautes Token. |

Das automatische `GITHUB_TOKEN` besitzt im Release-Gate Leserechte und erst im
Publishjob `contents: write`; es ist kein Client-Zugang. Der Windows-Schlüssel
ist kein zusätzliches PFX-Secret dieses Workflows. Private Schlüssel und Tokens
gehören weder in Testprotokolle, Screenshots, Repositorydateien noch Release-Assets.

Das Repository `macfloorball/Rechnungsverwaltung` (ID 1447003404) ist öffentlich.
Die aktuelle Policy verwendet `visibility: public`; öffentliche Clients benötigen
keinen GitHub-Token. Private Verteilung bleibt ein gesonderter Konfigurationsfall.
Die Sichtbarkeit ersetzt weder die Manifestprüfung noch die Freigabe des
Release-Environments. Dessen Required reviewer, Selbstfreigabe, Admin-Bypass und
Tag-Deploymentregel sowie die Leserechte des Release-Gates sind vor Aktivierung
an der tatsächlichen Konfiguration nachzuweisen.

## Nachgewiesene Integration, noch keine Produktionsfreigabe

[PR #33](https://github.com/macfloorball/Rechnungsverwaltung/pull/33) wurde am
18.11.2026 nach `Entwicklung-App` integriert. Der vollständige
[Push-CI-Lauf 44416112471](https://github.com/macfloorball/Rechnungsverwaltung/actions/runs/44416112471)
für Commit `5814b07d96fbc8b7f0018bb0798fed62f0895d95` bestand:

| Job | Nachweis |
| --- | --- |
| Ubuntu-Tests | 220 JavaScript-Tests bestanden, 2 übersprungen; 414 Python-Tests bestanden, 14 übersprungen. |
| Windows-Tests | 197 JavaScript-Tests bestanden, 25 übersprungen; 398 Python-Tests bestanden, 30 übersprungen. |
| Windows NSIS x64 build | Entwicklungsinstaller gebaut; 7 paketierte Laufzeittests bestanden. |
| Linux AppImage x64 build | Entwicklungs-AppImage gebaut; 13 paketierte Laufzeittests bestanden, AppImage hierfür extrahiert. |

Diese vorhandenen CI-Logs wurden am 19.11.2026 geprüft. Sie ersetzen weder eine
interaktive Windows-11-Abnahme noch native FUSE-Fehlerfälle oder die wiederholte
Windows-Shutdown-Diagnose. Für spätere Quelländerungen ist erneut CI für genau
deren Commit erforderlich. Die Policy bleibt deaktiviert, Produktionsvertrauen
ist nicht eingerichtet. Die nachstehenden Abnahmeschritte bleiben erforderlich.

## Branch, Version und kontrollierter Release-Ablauf

1. Änderungen im bestehenden Feature-Branch prüfen und später ausdrücklich über
   PR nach `Entwicklung-App` freigeben. `main` bleibt Web-Branch. Dieser Ablauf
   führt keinen Merge selbst aus.
2. Eine höhere stabile Desktop-Version `X.Y.Z` in `package.json` sowie beiden
   Versionsfeldern von `package-lock.json` setzen. Kein Prerelease-Tag und kein
   Downgrade. App-ID `de.mac-floorball.ttc-rechnungsverwaltung`, technischer
   Profilname `ttc-rechnungsverwaltung` und Windows-GUID bleiben unverändert.
3. Die vollständige `desktop-ci.yml` für genau den freigegebenen Commit als
   **Push auf Entwicklung-App** abwarten: beide OS-Testjobs und beide Builds.
   Ein erfolgreicher Feature-PR-Lauf allein genügt dem Gate nicht.
4. Nach Einrichtung aller Vertrauensdaten die Policy ausdrücklich freigeben und
   ebenfalls durch PR/CI prüfen. Erst dann den exakten Commit als
   `desktop-vX.Y.Z` taggen und nach ausdrücklicher Release-Freigabe pushen.
   Das Tag-Push-Ereignis startet `desktop-release.yml`; bloße Merges tun das nicht.
5. Gate prüft Repository, Schutz, Tagziel, Abstammung und erfolgreiche CI für
   genau diesen Commit. Linux wird auf Ubuntu gebaut. Den geschützten
   Windows-Buildjob erst nach Review freigeben. Im aktuellen `ed25519-only`-Modus
   ist kein Signierrechner nötig. Nur im strengen Modus App-EXE, NSIS und
   Uninstaller signieren; beide Paketprüfungen müssen bestehen.
6. Den Publishjob erst freigeben, wenn beide vollständigen Pakete vorliegen und
   die vorgesehene erste Verteilung/Abnahme geklärt ist. **Dieser Job veröffentlicht
   nach seinen Prüfungen einen stabilen Release**; er ist kein Dry-Run. Es gibt
   keinen separaten Workflow-Schalter, der nur einen Testentwurf erzeugt.
7. Publisher prüft lokale Pakete und den konfigurierten Windows-Modus, erstellt einen neuen
   Entwurf, lädt nur die sechs erlaubten Dateien hoch, lädt sie erneut herunter
   und prüft die Bytes. Das Ed25519-Manifest bindet beide tatsächlichen Asset-IDs.
   Erst nach erneuter Gate-Prüfung wird der vollständige Release stabil.
8. Release-URL, Workflowlauf/-versuch, Commit, Tag, sechs Assetnamen, Größen,
   Hashes, Manifestablauf, Key-ID, Windows-Modus und gegebenenfalls Zertifikatsfingerprint protokollieren.
   `make_latest: false` bleibt bestehen; Desktop-Clients wählen stabile
   `desktop-v*` nach Version. Keine Pakete eines veröffentlichten Tags ersetzen.

Eine Live-Generalprobe mit zwei Releases ist von berechtigten Clients abrufbar.
Dafür vorher einen ausdrücklich freigegebenen privaten Testbestand und die
betroffenen Nutzer festlegen. Nicht ohne Freigabe Versionsnummern im echten
Repository verbrauchen. Ein separates Testrepository benötigt eine ausdrücklich
angepasste Repository-ID/Trustkonfiguration und ersetzt die spätere Prüfung des
echten Verteilwegs nicht. Testschlüssel niemals als Produktionsvertrauen ausliefern.

## Dateiverteilung und manuelles Prüfen

Die erlaubten Dateien sind Windows-NSIS und Linux-AppImage sowie
`desktop-update.json`, dessen binäre 64-Byte-Signatur `desktop-update.json.sig`,
`RELEASE_NOTES.md` und `SHA256SUMS`. Die Pakete heißen
`ttc-rechnungsverwaltung-X.Y.Z-windows-x64-setup.exe` bzw.
`ttc-rechnungsverwaltung-X.Y.Z-linux-x64.AppImage`.
Im gewählten öffentlichen Repository sind freigegebene Release-Assets ohne
GitHub-Token abrufbar. Ein tatsächlich veröffentlichter und nativ abgenommener
Updatekanal ist damit noch nicht nachgewiesen. Pakete enthalten extrahierbaren
Anwendungscode.

Manuelle Verteilung benötigt einen unabhängig bestätigten Vertrauensanker und
die signierten Metadaten. Zuerst die Ed25519-Signatur über die unveränderten
Manifestbytes mit dem bereits vertrauenswürdig bezogenen öffentlichen Schlüssel
prüfen; danach App-ID, Repository-ID/Sichtbarkeit, Version/Tag/Commit, Plattform,
Zeitgültigkeit, Größe und SHA-256 des ausgewählten Pakets prüfen. Einen neuen
öffentlichen Schlüssel aus demselben ungeprüften Download nicht selbst als
Vertrauensanker übernehmen. Eine alleinige SHA256SUMS-Datei authentifiziert
keinen Download. Abgelaufene Metadaten erfordern eine neue Freigabe oder eine
unabhängige authentifizierte Paketfreigabe; nicht die Systemzeit zurückstellen.

Unter Windows zusätzlich mit Bordmitteln das ausgewählte Paket prüfen:

```powershell
$setup = 'C:\Abnahme\ttc-rechnungsverwaltung-X.Y.Z-windows-x64-setup.exe'
$signature = Get-AuthenticodeSignature -LiteralPath $setup
$signature | Select-Object Status, StatusMessage
$signature.SignerCertificate | Select-Object Subject, NotAfter
$signature.SignerCertificate.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256)
$signature.TimeStamperCertificate | Select-Object Subject, NotAfter
(Get-Item -LiteralPath $setup).VersionInfo | Select-Object ProductVersion, FileVersion
Get-FileHash -LiteralPath $setup -Algorithm SHA256
```

`X.Y.Z` durch die freigegebene Version ersetzen. Im aktuellen Modus `ed25519-only` ausschließlich bei `NotSigned` und passender
ProductVersion fortfahren; Publisher/Zertifikat/Zeitstempel werden nicht behauptet.
Im Modus `authenticode-required` nur bei `Valid`, vorhandenem Zeitstempel,
erwartetem exaktem Publisher/Fingerprint und passender Version fortfahren.
Eine fehlerhafte Signatur darf nicht als unsigniert behandelt werden. Mit den unabhängig bestätigten Freigabedaten vergleichen, nicht
allein mit sich selbst. Der Client benötigt weder Node/npm noch Windows SDK.
Die Prüfung ist kein Ersatz für die Ed25519-Paketbindung.

## Gemeinsamer Testbestand und Nachweis des Datenerhalts

Für jeden Fehlerfall zum VM-/Systemsnapshot der alten Version zurückkehren.
Nicht mit echten Rechnungen testen. Zwei mit demselben Ed25519-Testschlüssel autorisierte stabile Testbuilds
**A < B** derselben Vertrauenskonfiguration bereitstellen; die bisherige Version
0.1.0 ohne eingerichtetes Vertrauen ist kein automatischer Update-Ausgangspunkt.

1. In A Testorganisation, Empfänger mit Umlauten, Einstellungen, Nummernkreis,
   geplante/abgesagte/abgeschlossene Termine und eine finale Rechnung mit PDF
   sowie einen Entwurf anlegen. Erwartete IDs, Beträge, Nummern und Status
   protokollieren. Zusätzlich eine fremde Datei im Dokumentenordner ablegen.
2. Vollständiges App-Backup außerhalb von Installation und Dokumentenordner
   erstellen. App schließen, Backendende abwarten; Profil und Dokumente zusätzlich
   im Snapshot erhalten. Standardablage und eigene Dokumentenablage getrennt testen.
3. Dateiliste und SHA-256 aller PDFs und fremden Dateien vor/nach dem Update
   vergleichen. Backup nicht im gerade verglichenen Dokumentenordner speichern.
   Unter Linux beispielsweise:

   ```sh
   cd /absoluter/Testdokumentenordner
   find . -type f -print0 | sort -z | xargs -0 -r sha256sum > /absoluter/Abnahme/pdf-vorher.sha256
   # Nach dem Update im selben Dokumentenordner:
   sha256sum -c /absoluter/Abnahme/pdf-vorher.sha256
   ```

   Zusätzlich neue/fehlende Namen gegen die ursprüngliche Liste prüfen. Windows:

   ```powershell
   $docs = 'C:\Abnahme\Testdokumente'
   function Read-DocumentInventory {
     Get-ChildItem -LiteralPath $docs -File -Recurse | ForEach-Object {
       [pscustomobject]@{Path=$_.FullName.Substring($docs.Length); Hash=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
     } | Sort-Object Path
   }
   Read-DocumentInventory | Export-Csv -NoTypeInformation 'C:\Abnahme\pdf-vorher.csv'
   # Nach dem Update, vor neuen Dokumenten:
   Compare-Object (Import-Csv 'C:\Abnahme\pdf-vorher.csv') (Read-DocumentInventory) -Property Path,Hash
   ```

4. Nach Start von B alle erfassten fachlichen Werte prüfen und bestehende PDFs
   öffnen. Ein Datenbank-Dateihash allein ist kein Datenerhaltsnachweis: reguläre
   Migrationen/WAL können Bytes ändern. Bei Migration zusätzlich Schemazustand,
   erwartete Transformationen und `ttc.db.before-migration-*.sqlite3` prüfen.
   Erst danach eine neue Rechnung erzeugen und die Fortsetzung des Nummernkreises
   prüfen. Eine neue vollständige Sicherung erstellen und in ein **neues** Profil
   wiederherstellen; Originalbestand nicht überschreiben.
5. Als Ergebnis pro Fall `bestanden`/`fehlgeschlagen`/`nicht ausgeführt`, OS-/Kernel-
   bzw. Windows-Build, Paketversion/Hash, Commit, Profil-/Dokumentenvariante,
   beobachtete Meldung und Nachweise festhalten. Keine geheimen Zugänge erfassen.

## Native Windows-x64-Abnahme

Windows-VM als normaler Benutzer mit Snapshot und korrekter Uhr verwenden.
Im Authenticode-Modus zusätzlich erreichbare Zertifikats-/Sperrprüfung. A über den vorhandenen NSIS-Installer
installieren, keine manuell entpackte Variante. Registrierung unter
`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\da941357-9ae2-5f27-a221-a8db9727ec79`
auf DisplayVersion prüfen; InstallLocation steht unter
`HKCU\Software\da941357-9ae2-5f27-a221-a8db9727ec79`. Profil bleibt unter
`%APPDATA%\ttc-rechnungsverwaltung`; eigene Dokumentenpfade beibehalten.

| Fall | Vorgehen und erwartetes Ergebnis |
| --- | --- |
| Erkennung/Später | Im öffentlichen Modus ohne Token prüfen; nur im privaten Testmodus persönlichen Lesetoken verwenden. A erkennt B verzögert oder per manueller Prüfung; signierte Notes und Version stimmen. „Später“/Escape lädt kein Paket und unterbricht keine Arbeit. |
| Jetzt/zweite Zustimmung | Paket laden, echten Fortschritt beobachten, dann native Installationsbestätigung abbrechen. A bleibt nutzbar und Paket erneut installierbar. Erst bei erneuter Zustimmung folgen Backendende und sichtbarer NSIS ohne Administratoranforderung. |
| Erfolgreicher Wechsel | B über A installieren, nicht vorher deinstallieren. Erst nach geprüftem Installerende startet B. Version, Registry, App-EXE-Windows-Modus, Manifest und Datenerhalt vergleichen. Danach normal beenden und erneut starten. |
| Aktive Arbeit | Während Rechnung/Sicherung bzw. offenem Arbeitsdialog Installation anfordern: ablehnen oder laufende Arbeit abwarten. Bei Drain-/Shutdown-Timeout keine Installation und kein erzwungenes Beenden einer Schreiboperation. |
| Netzwerk/Platz/Abbruch | Verbindung vor Start und während des Downloads trennen; unzureichenden Platz nur in begrenztem Testvolume erzeugen. Lokale Funktionen bleiben nutzbar, keine Teilinstallation. Nutzerabbruch entfernt Teildateien; manuelle Wiederholung nach Wiederherstellung gelingt. |
| Vertrauensfehler | In separater kontrollierter Testumgebung falsche Manifestsignatur, Paketmanipulation, abgelaufenes Manifest, falschen Windows-Modus (`NotSigned` gegen strengen Client, `HashMismatch`/`NotTrusted` gegen beide), im strengen Modus falschen Publisher/Zertifikat oder fehlende Registryzuordnung anbieten. Keine Installerausführung. Für nachgelagerte Windows-Prüfungen eine absichtlich passende Test-Manifestsignatur verwenden, sonst blockiert bereits die frühere Stufe. |
| Dateischutz/Parallelität | Testcache mit Reparse Point/fremder Schreib-ACL bzw. parallelen Appstart prüfen. Übergabe muss sperren; kein fremder Pfad wird ausgeführt, kein zweites Backend startet während der Installation. |
| Fehler/Neustart | NSIS abbrechen; VM vor/nach Übergabe und während NSIS hart stoppen, jeweils aus eigenem Snapshot. Nach Neustart keine unbeaufsichtigte Installation, keine Datenlöschung. Bei beschädigten Programmdateien gleiche oder höhere vollständige signierte Version zur Reparatur verwenden. |
| Downgrade | B darf A nicht als Update anbieten; der Installer von A muss die vorhandene höhere registrierte Version ablehnen. Keine ältere App auf die migrierte Datenbank zwingen. |

Die Dateioperationen des NSIS sind nicht transaktional. Ein Abbruch während des
Dateiersatzes darf eine Reparatur erfordern; automatisches Programm-/DB-Rollback
wird nicht als bestanden gewertet. Zusätzlich Pfade/Benutzernamen mit Leerzeichen
und Umlauten testen. Details: [Desktop_Windows_Update.md](Desktop_Windows_Update.md).

## Native Linux-AppImage-Abnahme

Mindestens Ubuntu 24.04 LTS und ein aktuelles Fedora-x86_64 mit funktionierendem
`/dev/fuse`, passender Type-2-AppImage-Unterstützung und entsperrtem GNOME-/KWallet-
Schlüsselbund verwenden. Kernel muss `pidfd` unterstützen. Tatsächlich getestete
Distribution, Kernel und Dateisystem notieren; diese Zielmatrix ist noch keine
Zusage bereits bestandener Distributionsabnahme. Keine Root-Ausführung und kein
Abschalten der Electron-Sandbox. Ein extrahierter oder `--appimage-extract-and-run`
gestarteter Build genügt für den automatischen Dateitausch nicht.

A in einem privaten, benutzereigenen Verzeichnis auf ext4/Btrfs/XFS ablegen,
z. B. `$HOME/Anwendungen/TTC-Abnahme/TTC.AppImage`, mit Besitzerrechten `0700`
für Verzeichnis/Datei. Keine Symlinks, fremden Schreibrechte oder Hardlinks.
Direkt starten. Standardprofil liegt unter
`${XDG_CONFIG_HOME:-$HOME/.config}/ttc-rechnungsverwaltung`; eine separate Test-VM
verhindert Vermischung mit realen Daten. Cache und AppImage möglichst auch auf
verschiedenen lokalen Dateisystemen testen.

| Fall | Vorgehen und erwartetes Ergebnis |
| --- | --- |
| Erfolg | Gemeinsame Fälle für Erkennung, Jetzt/Später, Download, zweite Bestätigung und aktive Arbeit ausführen. B ersetzt A atomar am **gleichen ursprünglichen Dateinamen** und startet mit eigenem Mount. Version, Dokumentenbestand und normaler Folgestart stimmen. |
| Helferlaufzeit | Beim Wechsel muss der Helfer unabhängig vom ausgehängten A funktionieren; kein System-Python erforderlich. Nach erfolgreichem Backendstart werden eigene Helfer-/Downloadreste entfernt. Journal darf keine Zugangsdaten enthalten. |
| Ungeeigneter Pfad | In separaten Snapshots root-eigene/systemweite, nur lesbare, verlinkte und Netzwerkpfade prüfen: verständlicher manueller Updateweg, kein `sudo`, kein Dateiersatz. Keine fremden Systemdateien zu Testzwecken verändern. |
| Fehlender Schlüsselbund | Ohne unterstützte sichere Ablage Token-Speichern ablehnen; kein Klartext-Fallback. Lokale Rechnungsverwaltung bleibt nutzbar. |
| Manipulation/Abbruch | Signatur/Hash/Version/Zeitgültigkeit und Zieländerung zwischen Vorbereitung und Austausch prüfen. Vor Ersetzen bleibt A erhalten. Abbruch ohne finales Startsignal darf auch nach Main-Ende keinen Austausch auslösen. |
| Platz/Absturz/Parallelstart | Begrenztes Testvolume statt Hostdateisystem füllen; vor und nach atomarem Replace hart stoppen. Keine halbe ausführbare Datei, keine Datenlöschung. Journal meldet unbestätigten Abschluss; Sperre verhindert Parallelstart während der Übergabe. Nach Ersetzen kein automatischer Rücktausch. |
| Offline/Wiederholung | A und B ohne Internet starten; Rechnungen/PDF/Sicherung vollständig lokal bedienen. Updatefehler beheben und manuell erneut prüfen. Downgrade bleibt gesperrt. |

Die vorhandene lokale FUSE-Teststrecke kann alle zehn isolierten Szenarien
mit einem einzigen Paar temporärer Testimages ausführen:

```sh
node scripts/check_native_appimage_update.cjs /absoluter/Pfad/squashfs-root --all
```

Alternativ das letzte Argument durch `success`, `offline`, `signature`, `hash`,
`interrupted`, `defer`, `cancel-install`, `read-only`, `writable-directory` oder
`hardlink` ersetzen. `--locations` führt nur die letzten drei Ortsprüfungen aus. Ohne letztes Argument wird
nur `success` ausgeführt. Jeder Fall erhält eigene Profile und Dokumente. Vor
der expliziten Wiederholung prüfen Fehlerfälle das unveränderte A-Image sowie
Rechnung, PDF und Nummernkreis; danach folgt der echte FUSE-Wechsel zu B.
Fehlerhafte Downloads müssen ihre Teildateien entfernen. Aufschieben darf keinen
Download auslösen, Installationsabbruch muss das geprüfte Paket erneut anbieten.

Ausschließlich ein entpacktes Entwicklungs-AppImage mit deaktiviertem Vertrauen
verwenden. Der Prüfer baut getrennte A/B-Testimages mit flüchtigem Testschlüssel
und künstlichen Commitdaten. Feed, Netzwerkfehler und Zustimmungen sind
Testadapter; Windows-Metadaten sind ein Platzhalter. Die Strecke ist kein
GitHub-Liverelease, keine Windows-Abnahme und kein vollständiger OS-Netzausfall.
Die Ortsprüfungen ändern ausschließlich temporäre Testverzeichnisse bzw.
erzeugen einen eigenen Hardlink; anschließend werden sichere Bedingungen
wiederhergestellt und das Update erneut angeboten. Systemabsturz, Ubuntu-
Zielmatrix, systemweite/verlinkte Installationsorte und parallele Starts bleiben zusätzlich nach obigem Katalog zu prüfen. Testschlüssel dürfen
nicht als Produktionsvertrauen ausgeliefert werden.

DEB, RPM und Paketmanagerintegration sind nicht Teil dieser Abnahme. Details und
konservative Pfadvoraussetzungen: [Desktop_Linux_Update.md](Desktop_Linux_Update.md).

## Fehlerbehandlung, manuelle Updates und Wiederherstellung

- Fehlende Anmeldung, DNS/Timeout oder Verifikationsfehler: lokale App weiter
  nutzen, Zugriffs-/Netzwerkproblem beheben und manuell erneut prüfen. Keine
  Vertrauensprüfung deaktivieren. Bei beschädigtem Download neu herunterladen.
- Windows manuell: vollständige Sicherung, App/Backend schließen, unabhängig
  authentifizierten gleichen oder höheren vollständigen Installer als derselbe
  Benutzer sichtbar über die Installation ausführen. Keine Vorab-Deinstallation
  oder Löschung von Datenordnern. Bei Erfolg Bestand wie oben prüfen.
- Linux manuell: vollständige Sicherung, App/Backend schließen, verifiziertes
  gleiches oder höheres AppImage im benutzereigenen Installationsverzeichnis
  ersetzen und Besitzer-Ausführrecht setzen. Persönliche Datenverzeichnisse
  nicht verschieben. Bei systemverwalteten Pfaden Installation durch deren
  zuständige Verwaltung durchführen lassen, nicht durch den Updater.
- Keine automatische Wiederherstellung älterer Datenbankschemata. Eine vollständige
  Sicherung ausschließlich mit dem bestehenden Offline-Wiederherstellungsweg in
  einen **neuen** Datenordner übernehmen; ursprüngliche DB und Dokumente behalten.
  Beide Speicherpfade bewusst konfigurieren. Konkrete Befehle und Grenzen stehen
  in [README: Wiederherstellung bei beendeter App](../README.md#wiederherstellung-bei-beendeter-app).
- Fehlgeschlagener Publisher: Entwurf nicht selbst stabil setzen. Assets/Logs und
  Ursache prüfen; vorhandene Entwürfe nur bewusst durch Verantwortliche bereinigen.
  Bei unklarer Publish-Netzantwort zuerst tatsächlichen GitHub-Status lesen.
  Kein blindes Wiederholen, Löschen oder Ersetzen veröffentlichter Dateien.
  Ein fehlerhafter veröffentlichter Stand benötigt eine höhere korrigierte Version.

## Lokal ausführbare Release-Generalprobe

Ohne produktive Infrastruktur sind folgende Prüfungen möglich:

```sh
node --test scripts/desktop_release.test.cjs scripts/release_policy.test.cjs scripts/release_gate.test.cjs scripts/release_bundle.test.cjs scripts/publish_desktop.test.cjs scripts/github_api.test.cjs electron/update_manifest.test.cjs electron/update_pipeline.test.cjs
```

Am 15.11.2026 bestanden mit Node 24.22.3 **43 Tests**. Sie verwenden echte
Ed25519-Testsignaturen, simulierte GitHub-Antworten und OS-Installationsadapter.
Geprüft wurden vollständige Upload-/Rückleseprüfung, endgültiges Publizieren als
letzte Mutation, fehlerhafte Uploads, zusätzliche Dateien, zurückgezogene
Freigabe, falsche Schlüssel, bestehende/neue Releases und die Clientkette. Ein
vollständiger Lauf mit den nötigen lokalen Prozessrechten bestand. Dies ist
**kein** GitHub-Live-Release und keine native Authenticode-Abnahme.
Die vorhandenen Python-Vertragstests für CI und Release-Versionierung bestanden
ebenfalls (**fünf Tests**); 29 lokale Dokumentationsverweise einschließlich ihrer
Zielüberschriften wurden geprüft.

Zusätzlich wurden `scripts/release_gate.cjs` und `scripts/publish_desktop.cjs`
mit leerer Umgebung ohne Tokens/Secrets direkt aufgerufen: beide endeten
erwartet mit Exitcode 1 und der Policy-Sperre, bevor ihr GitHub-API-Client erzeugt
wird. `enabled: false`, fehlende Schlüssel und Windows-Vertrauensdaten blieben
unverändert. Kein Tag, Draft, Release, Merge oder Push wurde dadurch erzeugt.

Ein echter signierter Live-Probelauf bleibt bis zur obigen Einrichtung und
ausdrücklichen Veröffentlichungsfreigabe ausstehend. Die lokalen Proben ersetzen
weder funktionierende GitHub-Automatisierung noch die nativen A→B-Abnahmen.
