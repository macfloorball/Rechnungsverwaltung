# Desktop-CI: Tests und Entwicklungsbuilds

Stand: 14.11.2026, Umsetzungsschritt 3. Workflow:
[desktop-ci.yml](../.github/workflows/desktop-ci.yml).
Produktive Signierung, Tagfreigabe und Veröffentlichung gehören zu Schritt 4;
dieser Workflow enthält keine Release-Aktion und verwendet keine Release-Secrets.

## Auslöser und Checks

- Pull Requests gegen `Entwicklung-App`.
- Pushes auf `Entwicklung-App`, `feature/**` sowie den derzeit verwendeten
  Update-Feature-Branch. Kein Push-Auslöser für `main` oder Tags.
- Manuelle Ausführung über `workflow_dispatch`.
- Zwei Testjobs: `Tests (ubuntu-24.04)` und `Tests (windows-2025)` führen nach
  `npm ci` und Installation von `requirements-ci.txt` die Versionsprüfung,
  JavaScript-/Electron-Komponententests und die gesamte Python-Testsuite aus.
- Nur wenn beide Testjobs erfolgreich sind, folgen `Windows NSIS x64 build`
  auf `windows-2025` und `Linux AppImage x64 build` auf `ubuntu-24.04`.
  Plattformfehler brechen den jeweils anderen Testjob nicht vorzeitig ab.
- Versions-/Buildfehler erscheinen beim verantwortlichen Schritt. Der Windows-
  Job prüft zusätzlich den fertigen NSIS-Installer samt MZ-Kennung, Mindestgröße,
  Version, Plattform, Hash und Buildinformationen. Ein entpacktes Paket allein
  gilt nicht als erfolgreicher Installer-Build.
- Überholte Läufe derselben Referenz werden abgebrochen, Laufzeiten sind begrenzt.

Die benannten Checks können nach ihrem ersten GitHub-Lauf als erforderliche
Branch-Checks eingerichtet werden. GitHub Actions muss im privaten Repository
freigeschaltet sein; Windows-/Linux-Runner benötigen Internet für die festgelegten
Pakete und Buildwerkzeuge sowie ausreichendes Actions-Kontingent. Die Einrichtung
dieser Repository-Einstellungen wurde hier nicht verändert.

## Festgelegte Werkzeuge und Abhängigkeiten

| Teil | Festlegung |
| --- | --- |
| Node | 24.22.3, passend zur Engine-Anforderung der bestehenden Electron-Werkzeuge |
| CI-Python | 3.13.17, pip 26.1.2; exakt verfügbar für Windows x64 und Ubuntu 24.04 x64 |
| JavaScript | `npm ci` mit bestehendem `package-lock.json`, einschließlich Electron 45.3.1 und electron-builder 26.18.0 |
| Testpakete | `requirements-ci.txt`, exakte Versionen einschließlich transitiver Laufzeitpakete und Windows-spezifischem colorama |
| Windows-Laufzeit | Bestehendes CPython 3.13.17 Embedded, festgelegter Archivhash und `requirements-windows.txt` unverändert |
| Linux-Laufzeit | Astral python-build-standalone CPython 3.13.18, Build 20261110, GIL-fähiges x86_64 GNU/Linux `install_only_stripped`-Archiv |
| Linux-Archivhash | SHA-256 `f2d2199eb25880e07863b391cf7124e7ffa1338b0d65600dfcec117c4223a7fb` |
| Linux-Wheels | `requirements-linux.txt`, ausschließlich Binärpakete für CPython 3.13 und explizite manylinux-2.28-/2.17-Plattformtags |
| AppImage-Werkzeuge | electron-builder-Toolset 1.0.3; Downloadhash wird vom festgelegten builder-Paket geprüft |
| Actions | checkout v7.0.1, setup-node v7.1.0 und setup-python v7.1.0, jeweils auf vollständigen Commit-SHA fixiert |

Die Windows-Laufzeit wird bewusst nicht nebenbei auf eine andere Python-Version
umgestellt. Die gemeinsame Anwendungs-/Installer-Version bleibt davon unabhängig
und wird weiterhin in Schritt 2 geprüft. Python-/JS-Pakete werden nicht auf dem
Zielgerät installiert. Distributions- und Wheel-Lizenzen werden mit der Laufzeit
übernommen, insbesondere `lib/python3.13/LICENSE.txt` und `.dist-info/licenses`.

Korrektur vom 15.11.2026: Der bisherige CI-Pin 3.13.18 scheiterte auf
`windows-2025` bereits in `setup-python`. Das offizielle
[Versionsmanifest von actions/python-versions](https://raw.githubusercontent.com/actions/python-versions/main/versions-manifest.json)
enthält für die hier benötigten Ziele 3.13.18 nur für Ubuntu 24.04 x64,
3.13.17 dagegen auch für Windows x64. Alle fünf `setup-python`-Aufrufe in Desktop-CI und
Release-Workflow verwenden deshalb einheitlich 3.13.17. Die eingebetteten
Laufzeiten und deren Archivhashes/Paketpins bleiben unverändert. Der erfolgreiche
vollständige Remote-CI-Lauf muss nach Übertragung dieser Korrektur noch bestätigt
werden; die reine Manifestprüfung belegt keine ausgeführten Windows-Tests.

Der [nachfolgende Lauf für da4ebbe](https://github.com/macfloorball/Rechnungsverwaltung/actions/runs/43722267205)
bestätigte die erfolgreiche Einrichtung von Python 3.13.17 auf beiden Runnern.
Er scheiterte danach an vier Portabilitätsannahmen in Tests:

- Der AppImage-Test übernahm das Windows-Verzeichnis `Lib` aus seiner ersten
  Fixture. Unter Windows kollidierte es mit Linux-`lib`. Die Windows-Laufzeit
  wird jetzt vor Aufbau der Linux-Testlaufzeit vollständig aus der Fixture entfernt.
- Der Kalender-Test entfernte den Modulimport nur bei LF-Zeilenenden. Er
  akzeptiert jetzt auch CRLF und prüft HTTP-/Netzwerkfehler mit beiden Varianten.
- Die Release-Fixture verwendete Nodes Windows-Gerätepfad `\\.\nul` als globale
  Git-Konfiguration. Ein eigenes leeres Konfigurationsfile außerhalb des
  Testrepositories ersetzt diesen für Git ungeeigneten Pfad.
- Der Linux-Dateisystemtest benötigte einen bereits vorhandenen `dist`-Ordner.
  Jetzt liegt nur sein Download in einem privaten temporären Verzeichnis unter
  `/dev/shm`; der Helfer muss ihn vor Start auf das Zieldateisystem kopieren.
  Ohne zweites beschreibbares Dateisystem wird der Fall ausdrücklich übersprungen.

Nach Korrektur bestanden lokal **202 JavaScript-Tests, einer übersprungen**
(einschließlich NSIS-Hook-Kompilierung) und **409 Python-Tests, 13 übersprungen**.
Die gezielten zehn Linux-Helfertests liefen ohne Skip. Lokale Werkzeuge: Node
24.22.3 und Python 3.13.18 mit den bestehenden CI-Paketpins. Die Korrektur ändert
Testfixtures und Dokumentation, keine produktive Verifikation oder Laufzeit.
Ein neuer vollständiger GitHub-Lauf einschließlich Windows bleibt nach dem
erneuten Push erforderlich; beide Paketbuilds des verlinkten Laufs wurden wegen
der Testfehler übersprungen.

Der [Lauf für 6e01579](https://github.com/macfloorball/Rechnungsverwaltung/actions/runs/43722880049)
bestätigte anschließend den vollständigen Ubuntu-Testjob und die Windows-
JavaScript-Prüfung. Die Windows-Python-Suite meldete 26 Fehler, 367 bestandene
und 29 übersprungene Tests; beide Paketbuilds blieben dadurch übersprungen.
Die Fehlergruppen werden getrennt behandelt:

- Sicherung, Export und Altdatenimport öffneten ihre eigenen temporären Dateien
  vor `os.fsync` nur lesend. Windows benötigt dafür einen schreibbaren Handle;
  die drei Stellen verwenden jetzt `r+b`, ohne Trunkierung. Synchronisierung
  und anschließende Veröffentlichung bleiben verpflichtend. Neue Regressionen
  verlangen bei Synchronisierungsfehlern unveränderte Quelldaten und kein
  veröffentlichtes Ergebnis.
- Die POSIX-Rechteassertions im Datenbank-Backuptest gelten jetzt nur unter
  POSIX. Unter Windows bleibt die Integritäts-/Inhaltsprüfung aktiv; POSIX-
  Modusbits sind dort kein Nachweis für private NTFS-ACLs.
- Sechs Reload-/Lebenszyklustests erreichten unter Windows ihr Startlimit.
  Der bisherige Fehlerbericht enthielt die Serverlogs nicht. Die unveränderten
  Limits geben jetzt den jeweiligen temporären Serverlog mit aus. Die Ursache
  des Windows-Reload-Startfehlers ist noch nicht bestätigt; diese Diagnose-
  ergänzung wird nicht als behobener Reload-Fehler gewertet.

Nach diesen Änderungen bestanden lokal unter Python 3.13.18 **412 Tests mit
13 optionalen/plattformabhängigen Skips** sowie **vier echte Offline-Electron-
Rechnungs-/Sicherungs-/Export-/Wiederherstellungsszenarien** unter Linux. Die
Windows-Bestätigung und die weiterhin offene Reload-Diagnose benötigen den
nächsten Remote-Lauf. Produktive Releasefreigaben bleiben deaktiviert.

Der [Lauf für 7cbd454](https://github.com/macfloorball/Rechnungsverwaltung/actions/runs/43730518602)
bestätigte erneut Ubuntu und die Windows-JavaScript-Prüfung. Unter Windows
bestanden jetzt auch Sicherung, Export und Import; übrig blieben sieben Fehler
bei 389 bestandenen und 29 übersprungenen Python-Tests:

- Sechs Reload-Startfälle: Die neuen Logs zeigen den gestarteten Supervisor,
  aber keinen gestarteten Worker. Uvicorns Prozessfabrik fragt vor dem Spawn
  `sys.stdin.fileno()` ab, während der Kontrollthread bereits aus demselben
  gepufferten Stream liest. Der Owner-Kanal wird nun vorübergehend aus
  `sys.stdin` genommen, wenn Worker gestartet werden; Uvicorn unterstützt den
  Wert `None`. Der Kontrollthread behält ausdrücklich seine eigene Referenz.
  Das gilt für Erststart und Dateireload. Beim Dateireload wird der bisherige
  Worker außerdem kooperativ geweckt und beendet, bevor das gemeinsame
  Stop-Ereignis zurückgesetzt und erneut verwendet wird.
- Ein Dateinamensfall: Auf einem Dateisystem ohne Unterscheidung der Groß-
  und Kleinschreibung kann die Testfixture `Beleg.pdf` und `beleg.pdf` nicht
  gleichzeitig anlegen. Der Test verwendet jetzt exklusives Anlegen und
  überspringt ausschließlich diesen nicht darstellbaren Fall. Ein zusätzlicher
  plattformunabhängiger ZIP-Wiederherstellungstest verlangt weiterhin die
  Ablehnung beider Namen in einem manipulierten Archiv.

Die beiden bestehenden Langzeit-Dateiwächtertests verweigern jetzt jeden
Descriptorzugriff auf den Owner-Kanal und prüfen echten Start, Neustart nach
Dateiänderung sowie Beenden per Befehl/EOF. Eine temporäre Kopie des bisherigen
Supervisors scheitert an beiden neuen Kanalprüfungen; die korrigierte gezielte
Suite besteht **41 Tests**. Start-, Drain- und Shutdown-Zeitlimits wurden nicht
erhöht. Ein erfolgreicher nativer Windows-Lauf und die dadurch freigegebenen
Paketbuilds müssen weiterhin nach dem nächsten Push bestätigt werden.

Die abschließende lokale Prüfung dieser Änderungen bestand mit **413 Python-
Tests, 13 optionalen/plattformabhängigen Skips** und **vier echten Offline-
Electron-Szenarien** (Entwicklung/Produktion und Standard-/eigene Dokumentenablage).
Sicherung, Export, Wiederherstellung und Wiederanlauf nach Absturz wurden dabei
erneut geprüft. Diese Linux-Ergebnisse ersetzen die Windows-CI-Bestätigung nicht.

Der [Windows-Lauf für 935dcf9](https://github.com/macfloorball/Rechnungsverwaltung/actions/runs/43732206912)
belegt diese Grenze: JavaScript und Ubuntu blieben erfolgreich, die Windows-
Python-Suite meldete weiterhin sechs Reload-Startfehler und zusätzlich einen
Shutdown-Timeout ohne Reload (389 bestanden, 30 übersprungen). Die bisherigen
Änderungen haben den nativen Windows-Start damit noch nicht nachweislich behoben.

Als nächster Diagnoseschritt aktivieren ausschließlich die temporären
Server-Testprozesse über ihre lokale `sitecustomize.py` alle fünf Sekunden
`faulthandler`-Stackausgaben. Dies erfasst Supervisor und Spawn-Worker, ohne
Variableninhalte auszugeben. Auch ein Shutdown-Timeout gibt jetzt den zugehörigen
Serverlog aus. Produktivcode und sämtliche Zeitlimits bleiben in diesem
Diagnoseschritt unverändert. Die Stackposition im nächsten Windows-Lauf soll
die tatsächlich blockierende Stelle bestimmen, statt weitere unbestätigte
Anwendungsänderungen vorzunehmen.
Die elf betroffenen Server-/Lebenszyklustests bestanden lokal mit dieser
Diagnoseergänzung; der native Windows-Fehler bleibt bis zur Auswertung offen.

Beim ersten Lauf von
[54b985c](https://github.com/macfloorball/Rechnungsverwaltung/actions/runs/43747857838)
scheiterte Windows schon vor Python an einem zeitabhängigen Downloadtest. Zwei
Abbruchtests warteten pauschal 15 ms und konnten dadurch vor dem tatsächlichen
Streamstart abbrechen. Sie warten jetzt mit begrenzter Frist auf 20 tatsächlich
geschriebene Bytes, bevor sie den Abbruch bzw. das Entfernen des Zugangs prüfen.
Die 21 Downloadtests und die vollständige lokale JavaScript-Suite (202 bestanden,
ein plattformabhängiger Skip, einschließlich NSIS-Hook-Kompilierung) bestanden.

Eine gezielte Wiederholung des Windows-Jobs erreichte Python und meldete sechs
Reload-Fehler bei 390 bestandenen und 30 übersprungenen Tests. Die Stacks zeigen
den Supervisor bereits im Dateiwächter sowie den Resource-Sharer beim Warten
auf Verbindungen. Sie bestätigen somit nicht die zuvor vermutete Blockade beim
stdin-Zugriff. Der Worker ist im bisherigen Log nicht sichtbar; die bisherigen
Anwendungsänderungen gelten weiterhin nicht als erfolgreiche Windows-Korrektur.

Der Diagnosehelfer `tests/server_diagnostics.py` gibt Spawn-Workern nun eigene
temporäre `worker-<PID>.log`-Dateien für stdout/stderr. Stackausgaben und auch
frühe normale Python-Fehler werden damit unabhängig von der Vererbung der
Windows-Standardhandles erfasst. Fehlerberichte lesen Supervisor- und Workerlogs
zusammen. Die Dateien liegen außerhalb des beobachteten Quellordners; Logs
sollen den Dateiwächtertest nicht selbst wecken. Lokal bestanden damit alle elf
Server-/Lebenszyklustests; zehn erfasste Workerlogs enthielten echte Startmeldungen.
Diese Änderung betrifft nur Testdiagnose und Test-Synchronisation, nicht den
produktiven Server oder dessen Zeitlimits. Die native Windows-Ursache bleibt
bis zum nächsten Lauf mit sichtbarer Workerausgabe offen.

Der [Lauf für f16300e](https://github.com/macfloorball/Rechnungsverwaltung/actions/runs/43748976061)
bestand unter Ubuntu und in der Windows-JavaScript-Prüfung. Die Windows-Python-
Suite meldete weiterhin ausschließlich sechs Reload-Fehler (390 bestanden,
30 übersprungen). In den Fehlerberichten erschienen keine Workerdateien. Die
Erkennung über `--multiprocessing-fork` wird deshalb in der reinen Testdiagnose
nicht mehr vorausgesetzt: Jeder testgestartete Python-Prozess schreibt ab
`sitecustomize` in eine eigene `python-<PID>.log`. Zusätzlich werden ausführbarer
Python-Pfad, Prozessargumente/-flags und vom Supervisor beobachtete Worker-PIDs
samt Exitcode protokolliert. So werden auch fehlender Eintritt in die Python-
Initialisierung oder ein sehr früher Worker-Abbruch unterscheidbar. Die Ausgabe
ist auf temporäre Testprozesse beschränkt; Produktivcode und Zeitlimits bleiben
unverändert. Der Windows-Reload-Fehler ist weiterhin offen.
Lokal bestanden die elf Server-/Lebenszyklustests. Die erzeugten Diagnose-
dateien enthielten Prozessstarts, Workerstarts/-exits und die erwartete Meldung
für eine absichtlich beschädigte Testdatenbank.

Versionspins ersetzen keine Lieferkettenprüfung. Updates dieser Pins sollen in
eigenen geprüften Änderungen erfolgen. Die Hosted-Runner-Images werden trotz
festgelegter OS-Generation von GitHub aktualisiert; Signaturen und Zeitstempel
können ebenfalls variieren. Byteidentische Builds werden nicht behauptet.

## Linux-AppImage-Build

```sh
npm ci
python -m pip install --only-binary=:all: pip==26.1.2
python scripts/prepare_linux_runtime.py dist/python-linux
npm run desktop:build:linux
```

`dist/python-linux` muss für einen neuen Lauf neu sein; vorhandene Laufzeiten
werden nicht still überschrieben. Bei Paketänderungen eine frische Laufzeit
vorbereiten. Das geprüfte Archiv wird in einer temporären Ablage sicher entpackt;
Pfadausbrüche, externe Verknüpfungen und Spezialdateien sind nicht erlaubt.
Interne Python-Dateialiasse werden als reguläre Dateien übernommen. Der Build
prüft anschließend Laufzeitdateien und den Hash der Paketliste.

Die bestehende Positivliste der Windows-Quellpaketierung wird für Linux
wiederverwendet. Datenbanken, Dokumente, `.git`, Entwicklungsumgebungen und
Testdateien gelangen nicht in das Anwendungspaket. Das AppImage enthält das
lokale Backend und eine eigene Laufzeit; `-I -B` ignoriert fremde Python-Pfade und
vermeidet Bytecode-Schreibzugriffe in der schreibgeschützten Installation.
Der Startprüfer unterscheidet Windows-Installer und Linux-AppImage und lehnt
falsche Plattformen und veränderte Dateien ab. Windows-Manifeste des bisherigen
Formatstands ohne Plattformfeld bleiben als Windows-Manifeste interpretierbar.

Ausgabe unter `dist/appimage/`: Entwicklungs-AppImage, SHA-256-Datei und
unsignierte `.release.json`-Buildinformation. Erst nach vollständigem Build werden
fertige Dateien aus dem Staging auf demselben Dateisystem umbenannt.
Es werden **keine DEB-/RPM-Pakete** erzeugt. Geplante native Zielsysteme sind
Ubuntu 24.04 LTS und Fedora 45 auf x86_64; der Paket-Build ist keine vollständige
Zertifizierung ihrer Benutzeroberfläche oder Betriebssystemintegration.

### Sandbox und Paketprüfung

Der Standard-AppImage-Starter des festgelegten Builders kann bei einem
fehlgeschlagenen User-Namespace-Test `--no-sandbox` ergänzen. Das Projekt
überschreibt ihn deshalb mit [AppRun](../build/linux/AppRun), der keine Sandbox-
Abschaltung ergänzt. Verweigert das Zielsystem die erforderlichen Sandbox-
Mechanismen, muss der Start fehlschlagen; Betriebssystemrichtlinien werden nicht
automatisch gelockert. AppArmor-/User-Namespace-Konfiguration, FUSE und tatsächliche
GUI-Nutzung sind Gegenstand der nativen Linux-Abnahme.

CI entpackt das AppImage über `--appimage-extract` ohne FUSE und prüft mit
`scripts/check_appimage.cjs` das endgültige Installationsmanifest, die Release-
Metadaten sowie den exakten AppRun-/Desktopstarter. Anschließend laufen über die
enthaltene Python-Laufzeit dieselben Migrations-, Start-/Beendigungs- und
ungültige-Datenpfad-Prüfungen wie beim Windows-Paket. Alle Daten entstehen in
temporären Profilen, auch bei eigenen Dokumentenpfaden.

## Berechtigungen und Veröffentlichungsgrenze

`contents: read`, keine persistierten Checkout-Zugangsdaten, kein
`pull_request_target`, keine geschützte Release-Environment und keine Secrets.
Builds bleiben ausdrücklich `development`; der Release-Tag-Schalter wird vor
Build und Versionsprüfung entfernt. Caches der setup-node-Action sind deaktiviert.
Dieser Workflow lädt auch keine internen Artefakte hoch; damit entsteht hier
kein zusätzlicher Distributionskanal für den in Paketen enthaltenen Anwendungscode.
Ein normaler Merge erzeugt weder GitHub Release noch öffentliche Binärdateien.

## Tatsächlich durchgeführte Prüfungen und offene Grenzen

- Vollständige Python-Suite in isoliertem Python 3.13.18 mit den festgelegten
  CI-Paketen: **391 bestanden, 7 übersprungen** (4 GUI-Opt-in-Fälle, 3 optionale
  Prüfungen ohne ausgewählte paketierte Laufzeit). Ein früherer Lauf unter dem
  vorhandenen Python 3.15 bestand ebenfalls, vor Ergänzung der 3 Workflowtests.
- JavaScript unter Node 24.22.3: **77 bestanden, 1 übersprungen** (optionale
  NSIS-Hookkompilation). Alle `.cjs`-Dateien und der Bash-Starter sind syntaktisch
  geprüft; die Versionsabfrage liefert unverändert 0.1.0 im Entwicklungskanal.
- Unter Fedora 45 wurde ein vollständiges x86_64-AppImage gebaut und entpackt.
  Der eigene Starter, das endgültige Datei-Manifest und die Release-Metadaten
  wurden geprüft. Paketierte Python-Prüfungen liefen gegen dieses AppImage.
  **13 Prüfungen bestanden** einschließlich Laufzeitarchiv-Negativtests.
- Lokaler Windows-Crossbuild: entpacktes Windows-Paket erstellt, NSIS-Abschluss
  scheitert an fehlendem Wine (`spawn wine ENOENT`). Vorhandene fertige Installer
  wurden vom fehlgeschlagenen Staging nicht ersetzt. Die native Windows-CI muss
  den vollständigen NSIS-Build noch nachweisen.
- Workflow lokal mit actionlint 1.7.12 geprüft. Kein Push und kein GitHub-
  Workflowlauf aus dieser Sitzung; keine GitHub-Laufnummer behauptet.
- GUI-Opt-in-Tests, optionale lokale NSIS-Hookkompilation, native Windows-
  Installation und manuelle Linux-GUI-/Updateabnahme wurden nicht ausgeführt.
  Die neue Pipeline ersetzt diese Abnahmen nicht.

## Primärquellen

- [Python Build Standalone](https://github.com/astral-sh/python-build-standalone/releases/tag/20261110), [Distributionsformat](https://github.com/astral-sh/python-build-standalone/blob/main/docs/distributions.rst).
- [checkout](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node](https://github.com/actions/setup-node/releases/tag/v7.1.0), [setup-python](https://github.com/actions/setup-python/releases/tag/v7.1.0).
- [actionlint](https://github.com/rhysd/actionlint/releases/tag/v1.7.12).

Hashes und Release-Metadaten wurden am 14.11.2026 direkt von den jeweiligen
Upstream-Repositories über HTTPS abgerufen; es wurden keine Schlüssel oder
GitHub-Tokens in das Projekt eingebettet.
