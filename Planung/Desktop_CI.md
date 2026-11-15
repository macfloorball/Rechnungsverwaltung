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
