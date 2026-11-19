# Gesammelte Drittanbieter-Lizenznachweise

Diese Texte gehören als überprüfbare Nachweise ins Repository. Sie sind keine
temporären Downloads und werden nicht unter die Projekt-MIT-Lizenz gestellt.
Die jeweiligen Originalbedingungen und Urheberhinweise bleiben erhalten.

- `licenses/python-linux/`: 20 Lizenztexte aus dem vollständigen
  python-build-standalone-Archiv für CPython 3.13.18, Build 20261110.
  Das schlanke Laufzeitarchiv enthält diese zusätzliche Sammlung nicht.
- `licenses/pydantic-core/`: Lizenz- und Urheberhinweise zu allen 101 in den
  geprüften Windows-/Linux-Wheel-SBOMs von pydantic-core 2.50.4 aufgeführten
  Cargo-Komponenten. Die Liste umfasst auch Build- und andere Zielplattformen;
  sie ist kein Nachweis, dass jede Komponente in unsere Binärdatei gelinkt ist.
- `licenses/desktop-windows/`: Originaltexte für die geprüften Windows-Launcher,
  CPython-Unterkomponenten, ReportLabs Noto-Sans-Khmer-Testschrift sowie die
  nachgewiesenen nativen Komponenten des Windows-Installers.
  Der Windows-Installer liefert dieses Verzeichnis mit.

Jeder Unterordner enthält `provenance.json` mit Quellen und SHA-256-Prüfsummen.
Die Crate-Archive wurden gegen die Prüfsummen der Cargo.lock aus dem
PyPI-Quellarchiv geprüft. Zusätzliche Originaldateien sind gegebenenfalls unter
`additionalSources` mit dem konkreten Quellcommit dokumentiert. Die `.txt`-
Dateien dieser Sammlung enthalten unveränderte Textinhalte, bei Cargo mit
Trennzeilen für die ursprünglichen Dateipfade.

Die Sammlung enthält keine ausführbaren Dateien, Schlüssel oder Benutzerdaten.
Der Windows-Installer liefert auch `pydantic-core` mit. Das Linux-AppImage liefert `python-linux`, `pydantic-core` und
`desktop-linux` mit. Letztere Sammlung enthält das originale Python-Buildmanifest,
den Linux-Rust-Standardbibliothekshinweis und den Noto-OFL-Nachweis mit
Linux-spezifischen Wheel-/Binärprüfsummen.
Die Nachweise ersetzen weder erforderliche
Quellcodebeigaben noch eine abschließende Lizenzfreigabe.
Versionen und Prüfsummen bei Änderungen der Laufzeiten erneut abgleichen.

Prüfstand und verbleibende Aufgaben:
[`Planung/Desktop_Lizenzpruefung.md`](../Planung/Desktop_Lizenzpruefung.md).


## FFmpeg-Quellpaket vorbereiten

```sh
python scripts/prepare_ffmpeg_sources.py dist/license-sources/ffmpeg-electron-45.3.1-source.tar.gz
```

Benötigt Netzwerkzugriff auf die offiziellen Quellen und das übliche `patch`.
Das Ziel muss neu sein. Der Generator übernimmt alle vier Electron-Patches
in ihrer Reihenfolge und prüft die Windows-/Linux-x64-Konfigurationen. Er legt
Originalarchiv, gepatchten Quellbaum, Originalpatches, Buildinformationen und
Provenienz gemeinsam ab. Er veröffentlicht nichts. Der Inhalt des Gitiles-
Archivs ist über alle Dateinamen, Dateiinhalte und Ausführrechte per SHA-256
gebunden; sein Tar-/Kompressionswrapper kann abweichen. Der initiale Inhalt
wurde zusätzlich gegen sämtliche Git-Blobs des festgelegten Commits geprüft.

Vor Binärverteilung muss das erzeugte Quellpaket unter einer dauerhaften,
zugänglichen URL bereitgestellt und diese mit Prüfsumme dokumentiert werden.
Es darf nicht als siebtes Asset an einen Desktop-Release gehängt werden, dessen
Updater exakt sechs Assets verlangt. Ein separater Quellen-Verteilort benötigt
seine eigene Freigabe. Das Paket behauptet weder bitgenaue Rekonstruktion der
Binärdatei noch eine Patent-/Codec-Freigabe. Weitere Quellenpflichten, etwa aus
der Python-Laufzeit oder den Windows-Installer-Plug-ins, bleiben gesondert.
