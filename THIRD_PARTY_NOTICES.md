# Drittkomponenten in TT Rechnungsverwaltung

Die MIT-Lizenz in `LICENSE` betrifft den eigenen Projektcode. Fremdkomponenten
behalten ihre jeweiligen Urheberrechte und Lizenzbedingungen. Diese Übersicht
ersetzt keine mitgelieferten vollständigen Lizenztexte.

## Lizenztexte im installierten Paket

- Electron mit Chromium und Node.js: `LICENSE` bzw. `LICENSE.electron.txt` und
  `LICENSES.chromium.html` im Electron-Programmverzeichnis. Diese Dateien sind
  von der Projektlizenz unter `resources/app/LICENSE` zu unterscheiden.
- Eingebettetes Python: Windows `resources/app/runtime/python/LICENSE.txt`,
  Linux `resources/app/runtime/python/lib/python3.13/LICENSE.txt`.
- Python-Pakete: unter dem jeweiligen `site-packages`-Verzeichnis in
  `<paket>-<version>.dist-info/licenses/`.
- ReportLab enthält zusätzliche Lizenztexte in `reportlab/license.txt` und
  `reportlab/fonts/`, unter anderem für Bitstream Vera und DarkGarden.
- Das mit Linux-Python ausgelieferte pip enthält weitere Komponenten samt
  Lizenzdateien unter `pip/_vendor/` und `pip-*.dist-info/licenses/`.

### Ergänzende Nachweise im Windows-Installer

Unter `resources/app/runtime/python/licenses/desktop-windows/` liegen die
Originaltexte mit Quellen und SHA-256-Prüfsummen in `provenance.json`:

- distlib 0.4.0 (PSF-2.0) für die eingebetteten Launcher in
  `fastapi.exe`, `idna.exe`, `normalizer.exe` und `uvicorn.exe`.
- libmpdec 4.0.0 (BSD), Unicode Character Database 15.1.0 (Unicode License V3
  und Release-Copyright-Hinweis) sowie die MIT-Copyright- und Lizenzangaben
  aus dem von CPython 3.13.17 eingebundenen HACL*-Quellcode.
- Noto Sans Khmer 2.004 (SIL OFL 1.1) für die bearbeitete Testschrift
  `reportlab/fonts/hb-test.ttf` aus ReportLab 5.1.0.

Der vollständige Expat-Text für CPythons Expat 2.8.5 steht bereits unter
„Expat XML Parser“ in `LICENSES.chromium.html`. Derselbe Lizenztext und
Copyright-Hinweis wie für CPythons zlib 1.3.1 steht dort im Abschnitt „zlib“
mit der Versionsüberschrift 1.2.12. Die Überschrift bezeichnet den Eintrag
der Chromium-Credits. Die CPython-Versionen sind in `provenance.json` belegt.

Diese Zuordnungen beziehen sich auf die geprüfte Windows-Laufzeit. Bei einem
Versionswechsel sind sie erneut abzugleichen.

## Direkte Python-Abhängigkeiten

Stand der lokal geprüften Windows- und Linux-Laufzeiten: 16.11.2026.
Versionen entsprechen `requirements-windows.txt` und `requirements-linux.txt`.

| Komponente | Version | Lizenz laut Paketmetadaten |
| --- | --- | --- |
| annotated-doc | 0.0.5 | MIT |
| annotated-types | 0.8.0 | MIT |
| anyio | 4.16.0 | MIT |
| charset-normalizer | 3.5.2 | MIT |
| click | 8.5.0 | BSD-3-Clause |
| fastapi | 0.162.0 | MIT |
| h11 | 0.16.0 | MIT |
| idna | 3.20 | BSD-3-Clause |
| opentelemetry-api | 1.45.2 | Apache-2.0 |
| pillow | 13.0.0 | MIT-CMU |
| pydantic | 2.14.3 | MIT |
| pydantic_core | 2.50.4 | MIT |
| reportlab | 5.1.0 | BSD; zusätzliche Schriftlizenzen |
| starlette | 1.10.0 | BSD-3-Clause |
| typing-inspection | 0.4.5 | MIT |
| typing_extensions | 4.16.0 | PSF-2.0 |
| uvicorn | 0.54.0 | BSD-3-Clause |

Native Bibliotheken und mitgelieferte Schriften können zusätzliche Bedingungen
haben. Die Tabelle ist keine vollständige Aufstellung aller Unterkomponenten
und keine abschließende Freigabe zur Binärveröffentlichung.

Quellen: die Lizenzdateien und METADATA der konkreten Laufzeitpakete;
[Electron-Lizenz](https://github.com/electron/electron/blob/main/LICENSE).


## Reproduzierbares Inventar eines konkreten Pakets

Nach Entpacken des jeweiligen Pakets:

```sh
python scripts/inventory_desktop_licenses.py /absoluter/Programmordner --output /absoluter/neuer/inventar.json
```

Der Programmordner enthält `resources/app` und die Electron-Dateien (bei Linux
`squashfs-root`, bei Windows das entpackte Programmverzeichnis). Der Bericht
enthält relative Pfade und SHA-256 der vorhandenen Lizenznachweise, Python-
Paketmetadaten sowie native Laufzeitdateien und Schriften zur weiteren Prüfung.
Für native Laufzeitdateien und Schriften nennt `distributionOwners` die
liefernde Python-Distribution anhand ihrer `RECORD`-Datei. Leere Zuordnungen
bleiben ausdrücklich offen, insbesondere Dateien der eingebetteten Python-
Laufzeit. Eine solche Dateizuordnung bestätigt keine Lizenz der enthaltenen
Unterkomponenten. Beispielsweise bleiben Pillow-Bibliotheken und die einzelnen
ReportLab-Schriften trotz zugeordneter Distribution separat zu prüfen.
Zusätzliche Lizenzdateien mit Namen wie `bitstream-vera-license.txt` oder
`DarkGarden-copying-gpl.txt` werden mit Pfad und Hash erfasst.
Die Ausgabedatei muss neu sein. Fehlende bekannte Hauptnachweise führen zu
Exitcode 1. Ein fehlerfreies Inventar bestätigt vorhandene Dateien; die
vollständige Zuordnung nativer Unterkomponenten, erforderliche Quellangebote
und die Freigabe zur Binärverteilung bleiben eine gesonderte Prüfung.
