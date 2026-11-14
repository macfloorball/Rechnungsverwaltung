# Automatische Desktop-Updates – Architekturentscheidung

Stand: 14.11.2026. **Schritt 1: Bestandsaufnahme und Entwurf, noch keine
Implementierung oder Release-Freigabe.** Die folgenden Soll-Abläufe müssen in
den nachfolgenden einzeln freizugebenden Schritten umgesetzt und geprüft werden.

**Fortschreibung in Schritt 4:** Auf ausdrücklichen Anwenderwunsch werden
Releases zunächst im bestehenden **privaten** Repository bereitgestellt. Das
ursprünglich erwogene separate öffentliche Binärrepository entfällt. Konkrete
Einrichtung und der gesperrte Implementierungsstand stehen in
[Desktop_Release_Einrichtung.md](Desktop_Release_Einrichtung.md).

## Ausgangspunkt und Arbeitszweig

- Repository: `macfloorball/Rechnungsverwaltung`, Remote über SSH.
- `git fetch origin Entwicklung-App` wurde erfolgreich ausgeführt. Lokaler
  `Entwicklung-App`, `origin/Entwicklung-App`, `FETCH_HEAD` und Ausgangs-HEAD
  stimmen auf `0f8065088cf29c76b57cf5116e8a2f4038f3fbc3` überein. Damit ist
  der Entwicklungsstand zum Abrufzeitpunkt aktuell; spätere Änderungen sind
  vor Integration erneut abzugleichen.
- Der Arbeitsbaum war zu Beginn sauber. Auf ausdrückliche Korrektur des
  Anwenders wird der vorhandene Branch
  `22-automatisches-update-system-mit-github-releases-und-in-app-updatebenachrichtigung`
  weiterverwendet; der ursprünglich gewünschte neue Feature-Branch entfällt.
- `main` bleibt unverändert. Kein selbstständiger Merge, Push oder produktiver
  Release. Jeder Schritt endet mit eigenem Commit und wartet auf „Go“.

## Nachgewiesener Ist-Zustand

| Bereich | Befund und maßgebliche Dateien |
| --- | --- |
| Electron | `package.json`: Electron **45.3.1**, `@electron/packager` **20.3.0**, `electron-builder` **26.18.0**, Node-Anforderung `>=22.12.0`; feste JS-Versionen mit `package-lock.json`. `electron-updater` ist keine direkte Abhängigkeit. |
| Prozesse | `electron/main.cjs` verwaltet Einzelinstanz, Fenster und eigenes lokales Python-Backend. `backend.cjs` nutzt `scripts/run.cjs` und `managed_server.py`; kooperatives Beenden mit begrenzter Wartezeit und anschließend möglicher erzwungener Bereinigung. Installierte Builds starten über `bootstrap.cjs` mit Installationsprüfung. |
| Renderer | Lokales Frontend über Loopback, Sandbox, Context Isolation, kein Node-Zugriff, restriktive CSP und Netzfreigabe nur für die lokale Origin (`window.cjs`). `preload.cjs` bietet ausschließlich eine benannte Versionsabfrage; `ipc.cjs` prüft Fenster, Hauptframe, Origin, Pfad und Argumente. |
| Versionen | Desktop-Paketversion **0.1.0** aus `package.json`, übernommen in Windows-Paket und Installer. Kein eigener Desktop-Tag-/Releaseprüfer. Das native Protokoll erwähnt zusätzlich einen Testinstaller 0.1.1; das ist keine Änderung der aktuellen Paketversion. |
| Windows | `package_windows.cjs` selektiert Programmdateien; `build_installer.cjs` ergänzt Python, Manifest und NSIS. Windows 10/11 **x64**, pro Benutzer, ohne Elevation oder freie Pfadwahl. App-ID `de.mac-floorball.ttc-rechnungsverwaltung`, Produktname `TTC Rechnungsverwaltung`, technischer Profilname `ttc-rechnungsverwaltung`. |
| Windows-Laufzeit | `prepare_windows_runtime.py`: eingebettetes Python **3.13.17**, Archiv mit festem SHA-256; Windows-Wheels aus versionsgebundener `requirements-windows.txt`. Installierte Builds akzeptieren keine Ersatzlaufzeit aus System oder `TTC_PYTHON`. |
| Installer-Sperren | `build/windows/installer.nsh`: registrierte höhere Version verhindert Downgrade (Exitcode 3); `/D=` blockiert (4); `--delete-app-data` blockiert (2). `deleteAppDataOnUninstall: false`. Keine automatische Installation oder Veröffentlichung, `publish: null`, `runAfterFinish: false`. |
| Bisherige Verifikation | `installation.cjs` prüft Vollständigkeit und SHA-256 der Programmdateien. Installer erhält `.sha256`. Beide sind **kein Authentizitätsnachweis**. Windows-Code-Signierung ist deaktiviert; vorhandene Schlüssel/Zertifikate sind nicht nachgewiesen. |
| Linux | Entwicklung, Webbetrieb und Tests vorhanden. **Keine** AppImage-, DEB- oder RPM-Buildpipeline und keine ausgelieferte Linux-Python-Laufzeit. Der installierte Laufzeitpfad in `scripts/run.cjs` ist bisher Windows-spezifisch (`python.exe`). |
| Daten | `identity.cjs` erhält das technische Profil: Windows `%APPDATA%\ttc-rechnungsverwaltung`, Linux standardmäßig `$XDG_CONFIG_HOME/ttc-rechnungsverwaltung` bzw. `~/.config/ttc-rechnungsverwaltung`. `main.cjs` übergibt dieses als `TTC_DATA_DIRECTORY`; explizite Pfade bleiben bestehen. `backend/paths.py`: `ttc.db`, Standardablage `documents/`, alternativ `TTC_DOCUMENT_DIRECTORY`. Direkter Webstart behält `data/` und `rechnungen/`. |
| Datenbank | `backend/database.py`: Schema **6**, geordnete Migrationen, Ablehnung neuerer Schemata, SQLite-Sicherung vor Migration, Transaktionsrollback. Vollständiges Backup und Offline-Wiederherstellung aus Phase 5 bestehen separat. |
| CI | Im geprüften Git-Baum existiert **kein `.github/`-Verzeichnis** und damit kein versionierter GitHub-Actions-Workflow. Remote-Berechtigungen, Rulesets und Secrets sind damit nicht ermittelt. Python-Entwicklungspakete in `requirements.txt` sind noch nicht versionsgebunden. |

Roadmap: [Desktop-Umsetzungsplan](Umsetzungsplan_Desktop-App_Rechnungsautomatisierung.md),
insbesondere Phasen 5–7. Phase 6 ist noch nicht vollständig nativ abgenommen.
[Windows-Protokoll](Windows_Installationspruefung.md) berichtet erfolgreiche
Installations-/Update-/Datenerhaltfälle in einer Windows-11-VM, lässt aber unter
anderem unabhängiges Zweitsystem, PDF-Prüfsummen, Fehler- und Rechtefälle offen.
Der dort erwähnte Rechnungs-Ladefehler wurde inzwischen im Ausgangsstand durch
PR #23 behandelt; das historische Testprotokoll wird hier nicht umgeschrieben.

## Entscheidung: zentraler Dienst mit signiertem Release-Manifest

Ein kleiner, separat testbarer Update-Dienst im Electron-Main-Prozess übernimmt
Prüfung, Download und Verifikation. Plattformadapter übernehmen ausschließlich
die jeweils erlaubte Installation. Netzwerkzugriffe gehören weder ins Backend
noch in die Renderer-Session; deren lokale Netzsperren bleiben bestehen.

**Abgewogene Alternativen:**

- Electrons eingebauter `autoUpdater` passt nicht zum vorhandenen NSIS-Prozess
  und bietet keine eingebaute Linux-Unterstützung.
- `electron-updater` ist eine geeignete Standardlösung für NSIS und AppImage.
  Eine Integration müsste jedoch das bestehende `prepackaged`-Verfahren,
  Metadatenerzeugung, Signaturprüfung und das kontrollierte Backend-Beenden
  ausdrücklich integrieren. Ein bloßes Hinzufügen und Aktivieren der Bibliothek
  erfüllt die bestehende Sicherheits- und Installationslogik nicht.
- **Gewählt:** eigener begrenzter Dienst mit Node-HTTPS/Crypto, vollständigen
  Paketen und eigenem Ed25519-signiertem Manifest; bestehender NSIS-Installer
  bleibt Installationswerkzeug. Keine Delta-Updates, keine eigene NSIS-Engine,
  keine automatische Installation beim Beenden. So gibt es eine gemeinsame,
  explizite Vertrauensprüfung für Windows und Linux ohne parallele Updatefeeds.
  Die zusätzliche Verantwortung für Download-, Signatur- und Zustandslogik ist
  durch Negativtests und native Abnahme zu tragen.

### Plattformmatrix des geplanten ersten Releases

| Installation | Ziel und Updateverhalten |
| --- | --- |
| Windows x64, bestehendes NSIS | Vollständigen Installer nach Zustimmung laden, verifizieren, App/Backend kontrolliert beenden und ohne Adminrechte über die bestehende Installation ausführen. Normale sichtbare Installerführung; keine unbeaufsichtigte Installation. Neustart nach erfolgreichem Abschluss ergänzen und nativ prüfen. |
| Linux x86_64, AppImage | **Neu einzuführendes erstes Linux-Distributionsformat**, einschließlich eigener portabler Python-Laufzeit. Verifiziertes vollständiges AppImage nach Zustimmung ersetzen, wenn Datei und Elternverzeichnis dem Benutzer gehören und sicher beschreibbar sind. Gleiche Datenpfade wie bisher. Erst nach Build- und nativen Tests als unterstützt veröffentlichen. |
| AppImage schreibgeschützt, systemweit oder aus unklarem Pfad | Nur Benachrichtigung und geprüfte manuelle Aktualisierung; keine Rechteausweitung. |
| DEB/RPM und distributionsverwaltete Pakete | Im ersten Release keine eigenen DEB/RPM-Artefakte, keine In-App-Installation. Bei späterer Unterstützung ausschließlich Übergabe an den zuständigen Paketmanager mit dessen Vertrauenskette; keine aus dem Renderer generierten Befehle und kein `sudo`/Root-Start heruntergeladener Dateien. |
| Entwicklungs-/Webstart, entpackter Testbuild, unbekanntes Format | Keine automatische Installation. Entwicklung prüft nur über explizite Testkonfiguration; Webbetrieb bekommt keine Desktop-Releaseversion aufgezwungen. |

Die Linux-Laufzeit muss vor der ersten Linux-Veröffentlichung mit konkreter
Version, Bezugsquelle, Lizenz, Archivhash und Paket-Lock festgelegt werden.
Build auf einer festgelegten glibc-Basis, Tests mindestens unter Ubuntu LTS und
Fedora; genaue Versionen/FUSE-Anforderungen sind in Schritt 3 zu fixieren.
Kein Rückfall auf System-Python im installierten AppImage. Laufzeitauswahl und
Installationsmanifest müssen plattformbewusst erweitert werden; der jetzige
Windows-Prüfer darf nicht unverändert als Linux-Prüfer eingesetzt werden.

## Vertrauensmodell und Downloadprotokoll

Bedrohungen: manipulierte Metadaten/Downloads, umgeleitete Quellen, alte gültige
Releases, falsche Plattform, Teilpakete und Pfadmanipulation. Vollständig
kompromittierte Benutzerkonten, lokale Administratoren oder ein gestohlener
Release-Signierschlüssel lassen sich durch diesen Updater allein nicht absichern.

1. Dasselbe private Repository `macfloorball/Rechnungsverwaltung`, fest auf ID
   `1447003404` gebunden, liefert explizit freigegebene Release-Artefakte.
   Kein vom Renderer wählbarer Feed und kein eingebettetes gemeinsames Token.
   Endnutzer benötigen eigenen GitHub-Lesezugriff; die sichere optionale
   Client-Anmeldung ist in den folgenden Update-Schritten umzusetzen.
2. `desktop-update.json` (UTF-8, begrenzte Größe) und eine getrennte
   `desktop-update.json.sig` enthalten die Freigabe. Die Signatur gilt für die
   **exakten Manifestbytes**, nicht für neu serialisiertes JSON. Der erste
   vertrauenswürdig verteilte Installer enthält den Ed25519-Public-Key und seine
   Key-ID. Der private Schlüssel bleibt ausschließlich in geschützter
   Release-Infrastruktur.
3. Manifestformat 1 bindet mindestens App-ID, `stable`-Kanal, SemVer, Tag,
   Quellcommit, Veröffentlichungs-/Ablaufzeit, Key-ID und pro Artefakt Plattform,
   Architektur, Paketformat, festen Dateinamen, HTTPS-URL, Bytezahl und SHA-256.
   Release Notes sind begrenzter Text, kein ausführbares HTML. Striktes Schema,
   keine doppelten JSON-Schlüssel, unbekannte Formate ablehnen. Erst Signatur,
   dann fachliche Metadaten prüfen; niemals ungeprüfte URLs übernehmen.
4. Nur stabile `desktop-vX.Y.Z`-Releases, exakt passende Plattform und strikt
   höhere Version als `app.getVersion()` und gespeicherter Versionshöchststand
   werden angeboten. Prereleases, Entwürfe, Rückstufungen und inkonsistente
   Tag-/Paketversionen werden abgelehnt. Gleiche Version ist ausschließlich
   manueller Reparaturfall. Versionshöchststand erst nach erfolgreicher
   Artefaktverifikation persistieren, nicht aus ungeprüften Netzantworten.
5. HTTPS ohne TLS-Ausnahmen. Repositorypfade und Redirectziele eng begrenzen;
   GitHub-Asset-Redirects nur auf ausdrücklich konfigurierte GitHub-Downloadhosts
   mit HTTPS, maximal fünf Sprünge. Keine Cookies, Zugangsdaten oder frei
   wählbaren Header; niemals Verifikationsfehler ignorieren.
6. Download in zufällige, benutzereigene Staging-Verzeichnisse mit restriktiven
   Rechten/ACLs; keine globalen temporären Dateinamen, Symlinks oder fremden
   Dateien. Streaming mit Größenlimit, freiem Speicher als Vorprüfung und
   kontrollierter Behandlung von `ENOSPC`. Exakte Bytezahl und SHA-256 gegen das
   signierte Manifest prüfen; vor Installation erneut prüfen. Partielle Pakete
   bereinigen, maximal zwei begrenzte Wiederholungen, keine Endlosschleifen.
7. Ablaufzeit und persistierter Versionshöchststand erschweren Replay-Angriffe.
   Eine frische Installation kann ohne zusätzliche vertrauenswürdige Uhr bzw.
   externen Versionsanker keine vollständige Aktualitätsgarantie erhalten.
   Abgelaufene Manifeste oder unplausible lokale Uhr sperren die automatische
   Installation mit erklärbarem Fehler; Offlinearbeit bleibt möglich.

Die Ed25519-Signatur authentifiziert die über ihren Hash gebundenen Pakete;
SHA-256-Dateien neben Downloads bleiben nur zusätzliche Diagnosehilfen.
Zusätzlich ist für produktive Windows-Releases Authenticode für Installer und
App-EXE mit geprüftem Herausgeber/Zertifikat und Zeitstempel vorgesehen. Die
finalen, bereits codesignierten Pakete werden gehasht und im Manifest signiert.
Keine Signaturinfrastruktur gilt derzeit als eingerichtet. Produktionsinstallation
bleibt gesperrt, solange Public-Key/Releasequelle oder erforderliche
Windows-Verifikation fehlen; Testschlüssel dürfen keinen Produktionsbuild freigeben.

Key-Rotation benötigt eine mit dem alten Schlüssel authentifizierte neue
Vertrauenskonfiguration oder einen separat vertrauenswürdig ausgelieferten
Installer. Ein neuer Schlüssel aus demselben Downloadfeed allein ist unzulässig.
Bei Schlüsselkompromittierung: Veröffentlichung stoppen, Schlüsselzugang sperren,
separaten vertrauenswürdigen Wiederanlauf organisieren; kein stiller Trust-Reset.

## Dienst, Nutzerzustimmung und Prozessgrenzen

- Zustände: deaktiviert, bereit, prüfend, verfügbar, herunterladend,
  verifiziert, Installation vorbereitet, Fehler. Nur eine Prüfung bzw. ein
  Download gleichzeitig. Geplanter Start nach geöffnetem Hauptfenster, dann
  alle sechs Stunden mit Jitter; manuelle Prüfung verwendet dieselbe Sperre.
- Metadatenanfragen höchstens 15 Sekunden insgesamt; Download mit
  Inaktivitätslimit 30 Sekunden und Gesamtlaufzeitlimit 30 Minuten. Alle
  Netzfehler lokal behandeln; kein ungefangener Fehler im globalen `fail()` und
  keine Startverzögerung der Rechnungsverwaltung. Keine Erreichbarkeitsprobe bei
  fremden Diensten, keine Rechnungs-, Nutzer- oder Datenpfadinformationen senden.
  GitHub sieht unvermeidlich IP-Adresse und normale HTTP-Verbindungsdaten.
- Benannte Preload-Methoden für Prüfen, Zustimmung, Aufschieben, Abbrechen und
  Statusabonnement; dieselbe Hauptframe-/Originprüfung wie die Versions-IPC.
  Renderer liefert keine URL, Dateipfade, Versionsfreigabe oder Shellbefehle.
  Alle Installationsentscheidungen verbleiben im Main-Prozess.
- „Jetzt aktualisieren“ erlaubt den Download und den angekündigten Ablauf;
  nach Fertigstellung explizite Bestätigung zum Schließen/Installieren.
  „Später“ unterdrückt weitere automatische Dialoge derselben Version in dieser
  Sitzung. Kein Installieren bei normalem App-Ende, Timeout oder Neustart.
- Vor Installation neue Schreibaktionen sperren und laufende Rechnungs-,
  Dokumenten-, Backup- und Datenbankoperationen kontrolliert auslaufen lassen.
  Dafür fehlt derzeit eine vollständige Update-Wartungsbarriere: in Schritt 8
  ergänzen. Rein im Renderer deaktivierte Buttons reichen nicht.
- Das bestehende `backend.stop()` abwarten. Bei erzwungenem Beenden, offenem
  Schreibvorgang oder unklarem Prozessende **Installation abbrechen** und eine
  verständliche Meldung anbieten. Vorher vollständige Sicherung empfehlen und
  ihren bestehenden Ablauf zugänglich halten. Installerzugriff nur auf Programmdateien.
- AppImage: geprüfte neue Datei im selben Dateisystem vorbereiten; nur feste
  eigene Hilfsroutine zum Warten auf Prozessende und atomaren Ersetzen starten.
  Dateieigentümer, Verzeichnis, Identität und Hash unmittelbar erneut prüfen,
  Synchronisieren und Zustand protokollieren. Auf ungeeigneten Dateisystemen
  manuelles Update anbieten. Keine Ausführung ungeprüfter temporärer Dateien.

## Veröffentlichung und externe Voraussetzungen

Das private Quellrepository bleibt privat. PR-/Merge-CI testet Python, JS,
Windows-NSIS und Linux-AppImage mit festgelegten Werkzeugen, gelockten Paketen
und möglichst auf Commit-SHA fixierten Actions. Keine Release-Secrets für PRs,
insbesondere keine privilegierten Builds fremder Änderungen über
`pull_request_target`. Buildumgebung und Abhängigkeiten sollen reproduzierbar
sein; Zeitstempel/Signierung erlauben nicht automatisch byteidentische Pakete.

Releasepipeline ausschließlich für `desktop-vX.Y.Z`: Version validieren,
Tag-Commit als Vorfahr des aktuellen freigegebenen `Entwicklung-App` nachweisen,
erfolgreiche Checks und geschützte manuelle Freigabe prüfen. Vorfahr allein ist
kein Freigabenachweis. Beide Plattformen aus exakt diesem Commit bauen/testen,
signieren und nur vollständige Artefaktliste in einen neuen Release-Entwurf
übertragen. Hashes nach Upload erneut prüfen; stabilen Release erst als letzte
Aktion veröffentlichen. Bestehende Tags/Assets niemals automatisch überschreiben.
Fehlschlag lässt den Entwurf unveröffentlicht; normale Merges erzeugen keinen Release.

Vor Aktivierung des in Schritt 4 vorbereiteten Workflows sind diese Einrichtungen erforderlich; hier
werden weder Repositories angelegt noch Secrets oder Berechtigungen verändert:

1. Bestehendes Repository privat lassen; die Release-Pipeline auf seine geprüfte
   Identität binden. Artefakte vor Upload anhand einer Positivliste prüfen:
   keine `.git`, Tests, Entwicklungsdaten, Backups, Secrets oder Quellarchive
   aus CI. Ein separates öffentliches Repository wird derzeit nicht angelegt.
2. Im privaten Repository `Entwicklung-App` durch PR-Pflicht und erfolgreiche
   Checks schützen; Tag-Ruleset für `desktop-v*` nur für Release-Verantwortliche.
   Geschützte Release-Environment mit Freigabe einrichten und deren Verfügbarkeit
   im verwendeten GitHub-Tarif prüfen. Release-Verantwortliche und Wiederanlauf
   nach fehlgeschlagener Freigabe festlegen.
3. Nur der letzte Publishjob erhält das eingebaute `GITHUB_TOKEN` mit
   `contents: write` auf dasselbe Repository. Buildjobs erhalten Leserechte.
   Für nicht lesbare Schutzkonfiguration kann ein separat begrenzter
   `DESKTOP_POLICY_READ_TOKEN` erforderlich sein. Keine GitHub App und kein
   Cross-Repository-Schreibrecht nötig; kein Workflowtoken gelangt in die App.
4. Ed25519-Release-Schlüsselpaar in kontrollierter Umgebung erzeugen,
   Public-Key/Fingerprint unabhängig prüfen und im Build verankern. Privatschlüssel
   in geschütztem Secret/Signierdienst hinterlegen, sicheren Offline-Backup- und
   Rotationsprozess festlegen. Vorgesehener Secretname: `DESKTOP_UPDATE_PRIVATE_KEY`;
   Bindung nur im geschützten Publishjob, kein privates Schlüsselmaterial im Repository.
5. Windows-Code-Signing-Zertifikat bzw. geeigneten Hardware-/Cloud-Signierdienst
   beschaffen, Herausgeber, Zugriff, Zeitstempelserver und Zertifikatswechsel
   festlegen; Berechtigungen nur für den freigegebenen Signierjob. Stabile Builds
   erzwingen Signierung, Entwicklungsbuilds bleiben ausdrücklich unsigniert.
   Ohne reale Vertrauenskonfiguration werden stabile Builds abgelehnt.
6. Erstinstallation und bestehende 0.1.0-Installationen einmalig manuell über
   einen unabhängig verifizierten, updaterfähigen Installer aktualisieren.
   Die bisherige Version kann keinen neuen Public-Key automatisch kennenlernen.

**Grenze der Quellcode-Vertraulichkeit:** Das heutige Paket enthält notwendige
Python-/JS-Programmdateien unverschlüsselt (`asar: false`). Auch Electron-ASAR
ist kein Geheimnisschutz. Derzeit bleiben Repository, Releases und Pakete privat.
Eine spätere öffentliche Repository-Sichtbarkeit würde auch Git-Historie und
Quellarchive öffentlich machen und wird nicht automatisch geändert. Die
Release-Richtlinie lehnt unerwartete Änderungen der Sichtbarkeit ab. Eine
öffentliche Verteilung benötigt eine eigene bewusste Freigabe.

## Datenerhalt, Wiederanlauf und Abnahmegrenzen

Programmdateien, Update-Staging, Datenprofil, eigene Dokumentenablage und externe
Backups bleiben getrennt. App-ID, NSIS-Installationsidentität und Datenpfade
bleiben konstant. Die vorhandenen NSIS-Sperren bleiben aktiv, auch wenn der
Main-Prozess vorher bereits die Version geprüft hat.

Eine persistierte Installationsabsicht ist kein Erfolgsnachweis. Nach Neustart
Paketversion, Installationsmanifest und Backend-Bereitschaft prüfen; ohne Erfolg
Update als fehlgeschlagen behandeln und keine Endlosinstallation auslösen.
Bei Windows-Fehlern vollständigen Installer derselben oder einer neueren Version
zur Reparatur verwenden. Kein garantierter atomarer NSIS-Dateirollback.

AppImage darf die alte Programmdatei als Reparaturbestand aufbewahren, aber nach
Start einer neuen Version nicht automatisch auf eine niedrigere Version schalten:
die Datenbank könnte bereits migriert sein. **Keine automatische Datenbank-
Rückmigration.** Migrationen/Sicherungen aus Phase 5/6 bleiben maßgeblich.
Wiederherstellung nur offline aus vollständiger Sicherung in neuen Datenordner
mit passender Version und ausdrücklicher Nutzerentscheidung. Das ist ein
gesonderter administrativer Wiederherstellungsweg, keine Downgrade-Freigabe
des Update-Dienstes.

Spätere Abnahme muss mindestens Offline-Start, DNS/TLS/Timeouts, abgebrochene
Downloads, manipulierte Signaturen/Hashes, falsche Plattformen/Versionen,
Replay, belegte Pfade, Speicherplatzmangel, laufende Schreib-/Backupvorgänge,
Nutzerabbruch, Prozessneustart und Installationsfehler prüfen. Datenerhalt mit
DB-Inhalten und PDF-Prüfsummen vor/nach Update bei Standard- und eigener Ablage
nachweisen. Native Windows-VM, unabhängiges Windows-Zweitsystem und die
festgelegten Linux-Systeme bleiben verpflichtend; simulierte Tests ersetzen sie nicht.

## Prüfung dieses Architekturschritts

Nur dieses Dokument wird ergänzt; Anwendung, Versionsdateien, Installer und
Workflows werden in Schritt 1 nicht verändert. Vorhandene Regressionstests:

- JavaScript über die vorhandene Electron-Node-Laufzeit:
  `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test --test-isolation=none electron/*.test.cjs scripts/*.test.cjs`:
  **62 bestanden, 1 übersprungen**, keine Fehler. Die optionale NSIS-Kompilation
  benötigt `TTC_MAKENSIS` und `TTC_NSIS_PLUGINS` und wurde nicht ausgeführt.
- `.venv/bin/python -m pytest -q tests/test_storage_update.py tests/test_storage_paths.py tests/test_database.py`:
  **33 bestanden**, einschließlich Datenerhalt beim Austausch der Installation.
- Beide erfolgreichen Läufe erfolgten außerhalb der Sandbox: Der erste
  JS-Lauf scheiterte unter anderem an einer gesperrten lokalen Portbindung;
  der erste Python-Lauf hatte zwei Unterprozess-Zeitüberschreitungen.
- Keine nativen Installations- oder Updateversuche, kein Release-Probelauf und
  keine vollständige Python-Testsuite in diesem Dokumentationsschritt.

## Technische Primärquellen

Abgerufen am 14.11.2026; Online-Dokumentation kann neuere Versionen beschreiben.
Vor Übernahme von APIs immer mit den tatsächlich fixierten Paketen abgleichen.

- [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater): Plattformgrenzen des eingebauten Updaters.
- [electron-builder Auto Update](https://www.electron.build/docs/features/auto-update/): NSIS/AppImage und Update-Metadaten als bewertete Alternative.
- [electron-builder Veröffentlichung](https://www.electron.build/docs/publish/): Providerkonfiguration und Vertrauensrisiko umbenannter Release-Repositories.
- [electron-builder NSIS](https://www.electron.build/nsis/): bestehende Installationsbasis.
