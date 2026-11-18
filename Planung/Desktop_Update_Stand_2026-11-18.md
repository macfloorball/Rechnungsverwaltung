# Umsetzungs- und Abnahmeprotokoll vom 18.11.2026

## Ergebnis und Freigabegrenze

Gemeinsamer Ed25519-Updateweg mit explizitem Windows-Modus ohne Authenticode
implementiert; **keine vollständige native Abnahme und keine produktive Freigabe**.
`desktop-release-policy.json` bleibt `enabled: false`, Public-Key und Key-ID bleiben
`null`. Es wurden keine Produktionsschlüssel erzeugt oder hinterlegt, keine
GitHub-Einstellungen geändert und nichts gepusht, gemergt, getaggt oder veröffentlicht.
Lizenznachweise bleiben erhalten; offene Pflichten vor öffentlicher Binärverteilung
sind durch diese Arbeit nicht erledigt.

Ausgangsstand: sauberer Arbeitsbaum auf
`22-automatisches-update-system-mit-github-releases-und-in-app-updatebenachrichtigung`,
HEAD `eb231b3b6d56e1fa6f1c64729d266c9a9b9dff8d`. Keine geltenden `AGENTS.md`
im Projekt/übergeordneten Projektverzeichnis gefunden. Keine vorhandenen Änderungen
wurden überschrieben. GitHub-Repository-ID **1447003404** und `visibility: public`
wurden über den GitHub-Connector read-only bestätigt.

## Commits

- `e96cbfa`: kooperativer Wiederanlauf nach Update-Shutdown-Fehlern.
- `67e0403`: expliziter Ed25519-only-Modus, Release-Runner und Regressionen.
- Der folgende Dokumentationscommit enthält dieses Protokoll und den Übergabeauftrag.

## Implementierung

- Expliziter Modus `ed25519-only`: keine Authenticode-Signierung; native Prüfung
  verlangt `NotSigned` und passende ProductVersion. Fehlerhafte oder fremde
  Windows-Signaturen sind kein Fallback. Ed25519 ist immer verpflichtend.
- `authenticode-required` bleibt verfügbar, einschließlich bisherigem dediziertem
  Runner, Zertifikat, Publisher und Zeitstempel. Ein fehlender Modus bleibt streng.
- Modus wird in den paketierten Client eingebettet, vom signierten Manifest mit
  passender Windows-Quittung bestätigt und bei der nativen Übergabe erneut geprüft.
  Der Feed kann den Modus nicht lockern. Nach Installation kontrolliert der Helfer
  auch den unveränderten Vertrauensanker und die Paketvollständigkeit.
- Gate wählt nach erfolgreicher Prüfung `windows-2025` für den aktuellen Modus.
  Beide Pakete stammen weiterhin von `github.sha`; Publish benötigt beide Builds,
  geschützte manuelle Freigabe und erneute Paket-/Upload-/Gateprüfung.
- Öffentliche Policy berichtigt. Frühere private/strenge/unkonfigurierte Clients
  benötigen eine unabhängig geprüfte manuelle Erstinstallation für diesen Modus.
- Fehler beim kooperativen Update-Shutdown dürfen im Wiederanlauf keine erzwungene
  Prozessbereinigung auslösen. Wiederanlauf bestätigt zunächst erneut das saubere
  Backendende; schlägt es fehl, startet kein neues Backend. Regression prüft den
  aktiven Writer und einen später erfolgreich abgeschlossenen Shutdown.

## Ausgeführte Prüfungen

| Prüfung | Ergebnis / Aussagegrenze |
| --- | --- |
| Vollständiger `desktop:check` aus package.json (Syntax + alle JS-Tests), Node 24.22.1 | 220 bestanden, 2 native/optionale Fälle übersprungen. Beide Windows-Modi in der vollständigen simulierten Updatekette. |
| Vollständiges `.venv/bin/python -m pytest -q`, Python 3.15.0 | 413 bestanden, 14 übersprungen. Lokale Python-Version weicht vom CI-Pin 3.13.17 ab. |
| Linux-Backend-Lebenszyklus `tests/test_managed_server.py` | 6 bestanden, 1 Windows-spezifischer Fall übersprungen. Echte eigene Serverprozesse und aktive Schreibanfrage; kein Installer. |
| Linux-Entwicklungs-AppImage gebaut | Erfolgreich mit vorhandener gepinnter CPython-3.13.18-Laufzeit und electron-builder 26.18.0; Vertrauen bleibt deaktiviert. |
| Neues AppImage entpackt und `check_appimage.cjs` | Vollständigkeit, Hashes, Starter/Sandbox und Entwicklungsmetadaten bestanden. |
| `TTC_LINUX_PYTHON=<neues entpacktes Paket>/.../bin/python3.13 python -m pytest -q tests/test_linux_runtime.py tests/test_windows_runtime.py` | 13 bestanden, einschließlich echter Backendstarts/Migrationen mit temporären Profilen. Kein FUSE-Start. |
| Signierte Updatekette mit beiden Modi und beiden Plattformen | Echte flüchtige Ed25519-Testsignaturen, echte Downloads/Dateien; simulierte GitHub-/OS-Installationsadapter. Erfolg, Offline/Wiederholung, Manipulation, Downgrade, Aufschieben und Installationsfehler; Datensentinels erhalten. |
| Direkte CLI-Sperrprüfung | `desktop_release.cjs` liefert development; Gate und Publisher enden mit Exitcode 1 an der deaktivierten Policy vor GitHub-Zugriff. |
| Release-/Policy-Vertragstests | Beide Pakete/Quellcommits, native Quittung, keine unvollständige Veröffentlichung; Signatur/Expiry und Verbot einer Feed-Lockerung. |

Server-/Prozesstests benötigen Ausführung außerhalb der Agent-Sandbox. Im ersten
Sandboxlauf blockierten Sockets/Prozessstarts mit `EPERM`; die Wiederholung mit
entsprechenden Rechten bestand. Keine Tests deaktiviert oder Zeitlimits erhöht.
Lokale Tests ersetzen keinen neuen vollständigen GitHub-Lauf mit beiden OS und
beiden Paketbuilds. Es wurde kein solcher Lauf ausgelöst, da Pushes nicht autorisiert sind.

## Windows-Shutdown: gesicherte Erkenntnisse und offene Ursache

Read-only geprüft: [CI-Lauf 43732206912](https://github.com/macfloorball/Rechnungsverwaltung/actions/runs/43732206912),
Windows-Job **132866916366**. Dieser ältere Lauf meldet 7 Fehler, 389 Erfolge,
30 übersprungene Fälle. Sechs Fehler betreffen den bereits früher untersuchten
Reload-Start; getrennt davon überschritt
`test_restart_preserves_recipient_plan_status_invoice_and_pdf[False-False]`
beim Prozessende ohne Reload 10 Sekunden. Der Log enthält für diesen Timeout
keinen beweiskräftigen Python-Stack. Daraus lässt sich **keine Ursache** des
sporadischen Windows-Shutdowns ableiten. Der früher behobene Handle-Vererbungsfehler
ist kein ausreichender Nachweis für diesen getrennten Fehler.

Die in dieser Arbeit belegte Wiederanlauf-Lücke ist ein separater Sicherheitsfehler
im Aufrufpfad, kein behaupteter Fix des nativen Timeouts. Weitere Diagnose bleibt
auf Windows erforderlich. Vorhandene `server_diagnostics` bewahren Supervisor- und
Workerstacks auf; keine pauschale Timeout-Erhöhung und kein Entfernen von Tests.

## Ausführbarer Übergabeauftrag: Windows

Zuständig: Maintainer mit sauberer Windows-x64-Test-VM, normalem Benutzer,
Symlink-Recht für die vollständige Testsuite, Node **24.22.3**, Python **3.13.17**,
PowerShell 7 und Snapshot. Ausschließlich dieses Branch-Commit verwenden, keine
Produktionsprofile/-tokens/-schlüssel importieren. Nach autorisierter Übernahme:

```powershell
npm ci --no-audit --no-fund
python -m pip install --only-binary=:all: pip==26.1.2
python -m pip install --only-binary=:all: -r requirements-ci.txt
npm run desktop:check
python -m pytest -q

# Wiederholte gezielte Timeout-Diagnose mit erhaltenen separaten Belegen:
$evidence = Join-Path $env:TEMP ('ttc-shutdown-' + [guid]::NewGuid())
New-Item -ItemType Directory $evidence | Out-Null
for ($iteration = 1; $iteration -le 20; $iteration++) {
  $base = Join-Path $evidence ('profiles-' + $iteration)
  $log = Join-Path $evidence ('run-' + $iteration + '.log')
  python -m pytest -vv tests/test_managed_server.py tests/test_storage_lifecycle.py --basetemp $base *> $log
  if ($LASTEXITCODE -ne 0) { throw "Diagnose fehlgeschlagen; Belege unter $evidence behalten und auswerten" }
}
python scripts/prepare_windows_runtime.py dist/python-windows
npm run desktop:installer:win
node scripts/check_installer.cjs
$appRoot = (Resolve-Path 'dist/windows/TT Rechnungsverwaltung-win32-x64/resources/app').Path
$env:TTC_WINDOWS_PYTHON = Join-Path $appRoot 'runtime/python/python.exe'
python -m pytest -q tests/test_windows_runtime.py
Remove-Item Env:TTC_WINDOWS_PYTHON
```

Bei Timeout: jeweilige `process.log`, `server.log` und `python-*.log` unter dem
zugehörigen Testprofil sichern; Stack des Kontrollthreads, Event-Waiters,
Hauptthreads/ASGI-Lifespans und tatsächlichen Prozessstatus vergleichen. Zuerst
reproduzierbaren Auslöser und failing regression ermitteln, dann korrigieren.
Die Befehle bauen zunächst **Entwicklungsinstaller**, keinen freigegebenen
stabilen Update-Ausgangspunkt.

Anschließend zwei stabile Testbuilds A < B mit identischem **separatem Testvertrauen**
in isolierter Testquelle bereitstellen, einschließlich Linux-Paket vom jeweils
gleichen Commit und realer Ed25519-Manifestsignatur. Die Einrichtung erfolgt in
einem separaten Testcheckout/-repository; Produktionspolicy und Produktions-
Environment bleiben gesperrt. Keine Testschlüssel als Produktionsvertrauen verteilen.
Keinen öffentlichen Testrelease ohne eigene Freigabe veröffentlichen.

A nativ mit NSIS installieren, Testorganisation/-daten/PDFs wie in der
[Abnahmeanleitung](Desktop_Update_Abnahme.md#gemeinsamer-testbestand-und-nachweis-des-datenerhalts)
anlegen und Inventar sichern. Den kompletten dortigen Windows-Fallkatalog
abarbeiten: B erfolgreich installieren, danach Datenwerte, PDF-Hashes,
Nummernkreis, Einstellungen und Profilpfade vergleichen. Offlinebetrieb,
Downloadabbruch, ungültige Signatur, manipuliertes Paket, falsche Plattform,
Ablaufzeit, Downgrade, NSIS-Abbruch, Schreibsperren und manuellen Wiederanlauf
mit eigenen Snapshots testen. Zusätzlich beide Modusverwechslungen prüfen.
OS-/Paketversionen, Commit, Hashes, Meldungen und Belege pro Fall protokollieren.

## Ausführbarer Übergabeauftrag: Linux/FUSE

Zuständig: Maintainer mit echter Ubuntu-/Fedora-x64-Testumgebung, `/dev/fuse`,
`pidfd`, aktiver Electron-Sandbox und entsperrtem Schlüsselbund, soweit benötigt.
Hier fehlt `/dev/fuse`; keine normale FUSE-Ausführung und kein echter atomarer
A→B-Updateversuch wurden durchgeführt.

```sh
npm ci --no-audit --no-fund
python -m pip install --only-binary=:all: pip==26.1.2
python -m pip install --only-binary=:all: -r requirements-ci.txt
npm run desktop:check
python -m pytest -q
python scripts/prepare_linux_runtime.py dist/python-linux
npm run desktop:build:linux
# Im ausschließlich für diese Abnahme vorgesehenen Verzeichnis:
mkdir -m 700 -p "$HOME/Anwendungen/TTC-Abnahme"
test -c /dev/fuse
```

Die Entwicklungs-AppImages reichen für eine stabile Update-Abnahme nicht aus.
Die zum Windows-Test passenden stabilen Testbuilds A/B aus identischen freigegebenen
Testcommits verwenden. A als `TTC.AppImage` in obigem Verzeichnis mit Modus 0700
direkt starten; keine Extraktion und kein `APPIMAGE_EXTRACT_AND_RUN`. Ein separates
OS-Testkonto/VM trennt das Standardprofil von echten Daten. Kompletten
[Linux-Fallkatalog](Desktop_Update_Abnahme.md#native-linux-appimage-abnahme)
abarbeiten: echtes A→B, Ausführungsrechte, eigener Mount und Folgestart, DB/PDFs/
Einstellungen/Pfade, Offline/Abbruch/Manipulation/Fehler und manuelle Wiederholung.
Zusätzlich read-only/systemweiten/verlinkten Ort prüfen: manueller Weg ohne `sudo`.
Kein Datenbank-Rollback und kein Abschalten der Sandbox für einen grünen Test.

## Voraussetzungen vor Produktion

Neuer vollständiger GitHub-CI-Lauf, nativer Windows-NSIS-Test und normaler
Linux-FUSE-Test einschließlich A→B und sämtlicher Fehlerfälle; Windows-Timeout
mit Ursache/Regression klären. Danach reale Branch-/Tag-/Environment-Regeln
nachweisen, Lizenzpflichten für beide tatsächlichen Binärpakete schließen und
Ed25519-Produktionsschlüssel **erst nach gesonderter ausdrücklicher Freigabe**
außerhalb des Repositorys erzeugen/sichern. Öffentlichen Schlüssel/Fingerprint
unabhängig prüfen und integrieren; privaten Schlüssel ausschließlich ins
Release-Environment. Erst nach dokumentierter Abnahme und ausdrücklicher
Freigabe die produktive Policy aktivieren.
