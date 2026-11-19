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

### Ergänzende Nachweise im Linux-AppImage

Unter `resources/app/runtime/python/licenses/` werden die Sammlungen
`python-linux`, `pydantic-core` und `desktop-linux` mitgeliefert. Die
Paketierung prüft die SHA-256 aller in den Provenienzdateien genannten Texte,
bevor sie in das AppDir und dessen Installationsmanifest aufgenommen werden.

- **CPython 3.13.18, Build 20261110:** Die 20 Originaltexte stammen aus dem
  hashgeprüften vollständigen python-build-standalone-Archiv desselben Builds.
  Dessen originale `PYTHON.json` dokumentiert Abhängigkeiten, Linkinformationen
  und zugehörige Lizenzen; das schlanke Laufzeitarchiv enthält diese Nachweise
  nicht vollständig. Dazu gehört `_dbm` mit statisch eingebundenem Berkeley DB
  (Sleepycat); erforderliche Quellenbereitstellung bleibt eine Releaseaufgabe.
  Zusätzlich liegen der bytegenau aus CPython 3.13.18 abgeglichene HACL*-MIT-
  Hinweis sowie die Originaltexte für die von der eingebetteten Laufzeit
  gemeldeten Unicode-Daten 15.1.0 unter `desktop-linux/`.
- **pydantic_core 2.50.4:** Alle 101 Crate-Namen, Versionen und Archivhashes
  des tatsächlichen Linux-Wheel-SBOMs stimmen mit der vorhandenen Sammlung
  überein. Diese enthält auch Build- und fremde Zielplattformen, keine reine
  Liste gelinkter Komponenten. Die nativen Wheeldateien wurden bytegenau
  abgeglichen. Die ELF nennt Rust-Revision
  `58cf8f9c35b355199727627d07ae34a4e2846d67`; der Standardbibliothekshinweis
  stammt aus dem hashgeprüften Linux-rustc-1.99.1-Archiv dieser Revision.
- **Pillow 13.0.0:** Die nativen Dateien, gebündelten Shared Libraries und
  SBOMs wurden gegen das offizielle Linux-Wheel geprüft. Der vollständige
  Wheel-Lizenztext bleibt erhalten, einschließlich der Xau-/XCB-, Codec-,
  FreeType- und IJG-Texte. Diese Software basiert teilweise auf der Arbeit
  des FreeType-Teams und der Independent JPEG Group.
- **ReportLab:** Das verbliebene `hb-test.ttf` ist bytegleich zum auf Windows
  geprüften Subset; der Noto-OFL-Text wird auch auf Linux mitgeliefert.
  Vera, CALLIG15 und DarkGarden samt Lizenz- und Quelldateien bleiben erhalten;
  die unten ausdrücklich aufgeführten 32 AFM-/PFB-Dateien werden ausgelassen.

- **Electron/FFmpeg auf Linux:** `libffmpeg.so`, Electron-Lizenz und Chromium-
  Credits wurden bytegenau gegen das offizielle Linux-x64-Releasearchiv
  abgeglichen. Archiv- und Datei-SHA-256 stehen unter
  `third_party/sources/electron-ffmpeg-linux.json`. Der Generator
  `scripts/prepare_ffmpeg_sources.py` bereitet die zum festgelegten Stand
  gehörenden FFmpeg-Quellen mit Electron-Patches und beiden Plattform-
  konfigurationen vor. Vor Veröffentlichung fehlen noch ein dauerhafter
  Quellenbezugsort und die Klärung der gemeinsamen Codec-Weitergabefragen.

Konkrete Archiv-/Wheelquellen, Binär- und Nachweishashes stehen unter
`third_party/licenses/desktop-linux/provenance.json`. Diese technische
Zuordnung ersetzt nicht die Quellenbereitstellung bei Veröffentlichung oder
noch offene gemeinsame FFmpeg-/Codec-Weitergabefragen.

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
  Die OFL dieser Version deklariert keinen Reserved Font Name. Die
  Namensbedingung in Ziffer 3 erfordert für dieses Subset keine Umbenennung.

Der vollständige Expat-Text für CPythons Expat 2.8.5 steht bereits unter
„Expat XML Parser“ in `LICENSES.chromium.html`. Derselbe Lizenztext und
Copyright-Hinweis wie für CPythons zlib 1.3.1 steht dort im Abschnitt „zlib“
mit der Versionsüberschrift 1.2.12. Die Überschrift bezeichnet den Eintrag
der Chromium-Credits. Die CPython-Versionen sind in `provenance.json` belegt.

Diese Zuordnungen beziehen sich auf die geprüfte Windows-Laufzeit. Bei einem
Versionswechsel sind sie erneut abzugleichen.

### Native Komponenten im Windows-Installer

- **pydantic_core 2.50.4:** Unter `runtime/python/licenses/pydantic-core/`
  (relativ zu `resources/app`) liegen die Nachweise zu den 101 Crates des
  offiziellen Windows-Wheel-SBOMs. Das SBOM enthält auch Build- und
  zielplattformspezifische Einträge. Der zur Binärdatei passende Rust-1.99.1-
  Standardbibliothekshinweis und der Rust-MIT-Text liegen unter
  `runtime/python/licenses/desktop-windows/`. Der Apache-2.0-Text steht bereits
  in den Chromium-Credits und in den Crate-Nachweisen.
- **Pillow 13.0.0:** Die Wheel-Lizenz enthält die Texte der nativen
  Bibliotheken mit Versionsangaben. Für den AV1-Decoder dav1d 1.5.3 liefert
  der Windows-Installer zusätzlich dessen Originaltext. Für AOM 3.14.1
  stehen Lizenz und Patenttext bereits vollständig in `LICENSES.chromium.html`.
  Diese Software basiert teilweise auf der Arbeit des
  [FreeType-Teams](https://freetype.org/).
  This software is based in part on the work of the Independent JPEG Group.
- **FFmpeg in Electron 45.3.1:** Die DLL stammt aus dem offiziellen
  Windows-x64-Archiv. Der Chromium-FFmpeg-Stand und die Electron-Patches
  sind in der Windows-Provenienz festgehalten. Der Build verwendet eine
  separate DLL mit Chrome-Branding und proprietären Codecs. Die geprüfte
  Windows-x64-Konfiguration hat GPL-, Nonfree- und Version-3-Optionen
  deaktiviert. Der LGPL-2.1-Text und die FFmpeg-Hinweise stehen bereits in
  `LICENSES.chromium.html`. Die zugängliche Bereitstellung des entsprechend
  gepatchten Quellcodes samt Buildinformationen ist Teil der
  Binärveröffentlichung.
- **Microsoft-Dateien:** Der CPython-Text enthält den Hinweis zu Microsoft
  Distributable Code. Die Herkunft und Microsoft-Signatur von
  `vcruntime140.dll`, `vcruntime140_1.dll` und `d3dcompiler_47.dll` sind
  verifiziert. Die jeweils anwendbare Weitergabeberechtigung bleibt für die
  konkrete Verteilung zu belegen.
- **NSIS:** Das Paket führt die Originalhinweise aus der 3.0.4.1-Toolchain
  sowie aus den bytegleich zugeordneten UAC-, StdUtils-, Nsis7z- und
  nsProcess-Archiven mit. Für StdUtils enthält es den LGPL-Zusatz des
  Autors. Erforderliche Quellbereitstellung bleibt Teil der Veröffentlichung.
  Für die zugeordneten Fassungen von WinShell und nsProcess ist ein
  belastbarer Nachweis des Weitergaberechts noch offen.

### Weitere Schriften in ReportLab 5.1.0

- **DarkGarden 1.1** wird als Type-1-Schriftprogramm und AFM-Metrik mit
  GPL-2.0-or-later und Einbettungsausnahme mitgeliefert. Im Windows-Paket
  entsprechen `DarkGarden.sfd`, README, ChangeLog und beide Lizenzdateien
  unter `reportlab/fonts/` bis auf die Zeilenenden sämtlichen Dateien im
  [Quellarchiv des Autors](https://downloads.sourceforge.net/darkgarden/darkgarden-1.1.src.zip).
  Die Zuordnung mit Prüfsummen steht in `provenance.json`. Der Export des
  konkreten Type-1-Schriftprogramms wurde nicht bytegenau reproduziert.
- **Adobe-/Monotype-Dateien**: Die Desktoppakete für Windows und Linux lassen
  die folgenden AFM-Metriken und PFB-Schriftprogramme aus, da der Nachweis
  der Weitergaberechte offen ist. Adobes Core-14-AFM-Hinweis bezieht sich auf
  die Metriken in jenem Archiv.

  | Schriftgruppe | Ausgelassene Dateien in `reportlab/fonts/` |
  | --- | --- |
  | Arial | `_a______.afm`, `_a______.pfb`, `_ab_____.afm`, `_ab_____.pfb`, `_abi____.afm`, `_abi____.pfb`, `_ai_____.afm`, `_ai_____.pfb` |
  | Times New Roman | `_eb_____.afm`, `_eb_____.pfb`, `_ebi____.afm`, `_ebi____.pfb`, `_ei_____.afm`, `_ei_____.pfb`, `_er_____.afm`, `_er_____.pfb` |
  | Courier | `cob_____.afm`, `cob_____.pfb`, `cobo____.afm`, `cobo____.pfb`, `com_____.afm`, `com_____.pfb`, `coo_____.afm`, `coo_____.pfb` |
  | Symbol | `sy______.afm`, `sy______.pfb` |
  | Zapf Dingbats | `zd______.afm`, `zd______.pfb` |
  | AdobeSansMM | `zx______.afm`, `zx______.pfb` |
  | AdobeSerifMM | `zy______.afm`, `zy______.pfb` |

  Die Anwendung verwendet Helvetica und Helvetica-Bold als PDF-Standardfonts.
  Symbol und ZapfDingbats stehen weiterhin als Standardfont-Fallbacks zur
  Verfügung. ReportLabs optionale Einbettung über `std14Embed` und direkte
  Registrierungen aus den ausgelassenen Dateien stehen in den Paketen nicht
  zur Verfügung. Die Anwendung bietet dafür keine Einstellung.

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
