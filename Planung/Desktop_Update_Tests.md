# Desktop-Updates: Regressionstestmatrix

Aktualisierung 18.11.2026: Außerhalb der Agent-Sandbox wurde inzwischen ein
nativer FUSE-Testwechsel A→B mit echtem Helfer, neuem Mount und Rechnungs-/PDF-
Erhalt erfolgreich geprüft. Feed und Zustimmung sind Testadapter; die vollständige
Windows-/Distributions-/Fehlerfall-/Live-Verteilabnahme bleibt offen.
Die folgenden älteren Prüfergebnisse beschreiben ihren damaligen Stand.
Aktueller Nachweis und Befehle: [Abnahmeprotokoll](Desktop_Update_Stand_2026-11-18.md#nachprüfung-im-selben-arbeitsauftrag).
Restaufgaben: [Issue #32](https://github.com/macfloorball/Rechnungsverwaltung/issues/32).

Stand: 15.11.2026, Umsetzungsschritt 11. Die Tests verwenden temporäre Profile,
Testschlüssel und Paketfixtures. Sie erzeugen keine GitHub-Releases und richten
keine produktiven Schlüssel oder Zugänge ein. Produktive Updates bleiben gesperrt.

## Automatisierte Abdeckung

| Gegenstand | Prüfungen |
| --- | --- |
| Versionierung und Downgrade-Sperre | `electron/version.test.cjs`, `scripts/desktop_release.test.cjs`, `tests/test_desktop_release.py`: stabile Versionen, Tags, Paketmetadaten, höherer Versionsstand erforderlich. |
| Erkennung und manuelle Prüfung | `electron/updates.test.cjs`, `update_controller.test.cjs`, `update_ipc.test.cjs`: verzögerte/wiederkehrende Prüfung, begrenzte Wartezeit, zusammengeführte Anfragen, explizite IPC, Wiederholung nach Fehler. |
| Jetzt, später und Abbruch | `scripts/update_ui.test.cjs`, `electron/update_ui_ipc.test.cjs`, `update_controller.test.cjs`: Zustimmung, Zurückstellen, alte Versions-/Statusantworten, Konkurrenz und Abbruch. |
| Vertrauensprüfung und Transport | `electron/update_manifest.test.cjs`, `update_transport.test.cjs`, `update_credentials.test.cjs`: Ed25519, exakte Manifestbytes, Repository-/Paketbindung, HTTPS, Redirectgrenzen und keine Zugangsdaten am CDN. |
| Paketdownload | `electron/update_download.test.cjs`: Länge, Hash, Speicherplatz, Timeout, Abbruch, Bereinigung nach Prozessabbruch, erneuter Versuch und kein Wiederbeleben durch verspätete Antworten. |
| Installationsübergabe | `electron/windows_update.test.cjs`, `linux_update.test.cjs`, `tests/test_linux_update_helper.py`, `test_desktop_update_gate.py`: zweite Zustimmung, Ablaufreihenfolge, Backend-Drain, Fehlschlag und Wiederanlauf; Linux zusätzlich reale Dateisystem-/Prozessoperationen mit Testprogrammen. |
| Komponenten zusammen | `electron/update_pipeline.test.cjs`: 14 Fälle aus Windows-/Linux-Koordinator × Erfolg, Netzwerkfehler mit Wiederholung, falsche Signatur, manipuliertes Paket, Downgrade, spätere Installation und fehlgeschlagene Übergabe. |
| Bestehende Daten und Rechnungen | Vorhandene Python-Suite und `tests/test_desktop_invoice.py`: Rechnungen, PDFs, Sicherung, Export, Wiederherstellung und Absturzwiederanlauf. Die Integrationskette prüft zusätzlich unveränderte Daten-/PDF-Sentinels. |
| CI-Verträge | `tests/test_desktop_ci.py` und Release-/Buildtests: bestehende PR-/Buildtrennung und Freigabesperren. Neue JavaScript-Integrationstests werden durch den vorhandenen CI-Glob `electron/*.test.cjs` aufgenommen; Linux-Koordinatorfälle laufen ausschließlich auf Linux. |

Die Integrationskette verwendet echte Signaturen und die produktiven Komponenten
für Erkennung, HTTPS-Transportlogik, Streaming, Dateiverifikation, Controller und
Installationskoordination. HTTP-Antworten, native Dialogbestätigung, Backend und
Installationshelfer sind dort Testadapter. Sie führt keinen Windows-Installer aus
und ersetzt kein laufendes AppImage. Die Pipelinefälle prüfen auch, dass vor der
Zustimmung kein Paket abgerufen wird und Fehlerstatus weder Token noch private
Pfade oder rohe Netzwerkdiagnosen enthalten.

## Zwei reproduzierbar behobene Regressionen

- Beim parallelen Löschen derselben Rechnung konnte eine bereits gelöschte Zeile
  die vorherige Dokumentenzuordnung ungültig machen und HTTP 500 statt 404
  auslösen. Ein synchronisierter Zwei-Anfragen-Test erzwingt diesen Ablauf und
  prüft Dokumentenbestand und unveränderten Nummernzähler. Wirklich unsichere
  Dokumentenzuordnungen bleiben gesperrt.
- Der Entwicklungs-Dateiwächter hielt das ursprüngliche Stop-Ereignis fest,
  während der Supervisor nachträglich ein anderes Ereignis verwendete. Beide
  Signale werden jetzt ausdrücklich gesetzt. Zwei echte Prozessprüfungen mit
  60 Sekunden Dateiwächter-Wartezeit verlangen das Beenden innerhalb von fünf
  Sekunden, sowohl per Shutdown-Befehl als auch bei geschlossenem Kontrollkanal.
  Die vorhandenen vier Prüfungen laufender Anfragen bleiben erhalten; produktive
  Shutdown-Zeitlimits wurden nicht erhöht.

## Reproduktion und tatsächlich ausgeführte Prüfungen

Auf diesem Linux-Host wurden Python 3.13.18 mit `requirements-ci.txt`, Node
24.22.3 und Electron 45.3.1 verwendet. Die regulären Prüfungen sind:

```sh
PYTHONDONTWRITEBYTECODE=1 python -m pytest -q
npm run desktop:check
TTC_RUN_ELECTRON_TESTS=1 PYTHONDONTWRITEBYTECODE=1 python -m pytest -q -s tests/test_desktop_update_ui.py
```

- Python: **409 bestanden, 13 optionale/plattformabhängige Tests übersprungen**.
- JavaScript: **200 bestanden, ein nativer Windows-Parsertest übersprungen**.
  Die vorhandenen NSIS-Schutzmakros wurden mit lokalem `makensis` und Plugins
  tatsächlich kompiliert (`TTC_MAKENSIS`, `TTC_NSIS_PLUGINS`).
- Echte Electron-Update-Oberfläche unter Linux: **sechs Fälle bestanden**, jeweils
  Dialog, Fixture-Download und Nutzerabbruch in Entwicklung und Produktion.
  Transport und Zugang bleiben Testadapter; die Electron-Sandbox bleibt aktiv.
- Echte Offline-Electron-Rechnungstests: **vier Fälle bestanden**, Entwicklung
  und Produktion jeweils mit Standard- und eigener Dokumentenablage. Nur
  Loopback war erreichbar; der aktivierte Update-Testdienst scheiterte mit
  echtem fetch/DNS sicher. Rechnungen, PDFs, Sicherung, Export, wiederhergestellte
  Profile und Wiederanlauf nach hartem Absturz wurden geprüft.
- Echter ENOSPC-Durchlauf im privaten 64-MiB-tmpfs bestanden: fehlgeschlagener
  Schreibzugriff, entfernte Teildateien und unveränderte lokale Testdaten geprüft.
- AppImage erfolgreich gebaut und entpackt; `scripts/check_appimage.cjs` hat das
  vollständige Installationsmanifest, die Versionsbindung und den Starter mit
  aktivierter Sandbox erfolgreich geprüft. Dies war ein Entwicklungsbuild der
  Version 0.1.0 ohne produktive Release-Signatur.
- Die vorhandenen Linux-Laufzeit- und portablen Paketprüfungen bestanden mit der
  Python-Laufzeit aus diesem entpackten AppImage: **13 bestanden**, einschließlich
  Migration und Backend-Lebenszyklus. Dafür wurde `TTC_LINUX_PYTHON` auf dessen
  `runtime/python/bin/python3.13` gesetzt und
  `python -m pytest -q tests/test_linux_runtime.py tests/test_windows_runtime.py`
  ausgeführt. Der historische Dateiname bezeichnet hier keine Windows-Ausführung.

Ein erster Offline-Durchlauf bestand drei von vier GUI-Varianten; die vierte
erreichte nach den fachlichen Prüfungen das Testlimit beim Screenshot. Der
Treiber wartete dort ohne Begrenzung auf `requestAnimationFrame` eines verdeckten
Fensters. Wie im Update-UI-Treiber ist dieses reine Screenshot-Warten nun auf
250 ms begrenzt und die Hintergrunddrosselung nur im Test deaktiviert. Fachliche
Assertions und produktive Wartezeiten bleiben unverändert.
Der anschließende vollständige Offline-Durchlauf bestand alle vier Varianten
in 63,43 Sekunden.

Die ergänzenden nativen Offline- und Speicherplatzprüfungen sind unter
[Offlinebetrieb und Fehlerbehandlung](Desktop_Update_Fehlerbehandlung.md)
beschrieben. Für Offline-Tests wird eine eigene Netzwerk-Namespace verwendet,
die nur Loopback erlaubt; der Test prüft die Isolation selbst. Der ENOSPC-Treiber
läuft ausschließlich in einem eigenen, höchstens 64 MiB großen tmpfs in einer
privaten Mount-Namespace. Hostdateisysteme werden dafür nicht gefüllt.

## Aussagegrenzen

Eine NSIS-Kompilierung und Koordinatoradapter sind keine native Windows-Abnahme.
Windows-Authenticode, sichtbarer Installer, tatsächliche Installation, Neustart
und Datenerhalt auf einer Windows-VM bleiben praktisch zu prüfen. Auf diesem
Linux-Host fehlt `/dev/fuse`; ein vollständiger Austausch zweier tatsächlich
gemounteter AppImages bleibt ebenfalls offen. Reale Linux-Helferprozesse mit
ELF-Testprogrammen ersetzen diese Prüfung nicht. Die vorhandenen
[Windows-](Desktop_Windows_Update.md) und [Linux-Anleitungen](Desktop_Linux_Update.md)
beschreiben die Voraussetzungen. GitHub Actions wurden hier nicht auf GitHub
ausgelöst; geprüft wurden die lokalen Tests und Workflow-Verträge.
