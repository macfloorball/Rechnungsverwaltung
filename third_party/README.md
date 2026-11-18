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

Jeder Unterordner enthält `provenance.json` mit Quellen und SHA-256-Prüfsummen.
Die Crate-Archive wurden gegen die Prüfsummen der Cargo.lock aus dem
PyPI-Quellarchiv geprüft. Zusätzliche Originaldateien sind gegebenenfalls unter
`additionalSources` mit dem konkreten Quellcommit dokumentiert. Die `.txt`-
Dateien dieser Sammlung enthalten unveränderte Textinhalte, bei Cargo mit
Trennzeilen für die ursprünglichen Dateipfade.

Die Sammlung enthält keine ausführbaren Dateien, Schlüssel oder Benutzerdaten.
Sie ist noch nicht in die Desktop-Paketierung integriert und ersetzt weder
erforderliche Quellcodebeigaben noch eine abschließende Lizenzfreigabe.
Versionen und Prüfsummen bei Änderungen der Laufzeiten erneut abgleichen.

Prüfstand und verbleibende Aufgaben:
[`Planung/Desktop_Lizenzpruefung.md`](../Planung/Desktop_Lizenzpruefung.md).
