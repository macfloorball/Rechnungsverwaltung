# Lizenznachweise der Desktop-Verteilung

Stand: 19.11.2026. Dieser technische Nachweis dokumentiert die konkrete
Paketierung; die Veröffentlichung erfolgt über den geschützten Releaseprozess.

Die Laufzeitnachweise werden inzwischen auf beiden Plattformen mitgeliefert.
Die 32 ungeklärten Adobe-/Monotype-Schriftdateien sind ausgeschlossen.
WinShell und nsProcess sind durch Windows-APIs ersetzt. Die unveränderten
Microsoft-Laufzeitdateien behalten ihre Hinweise; CPythons zusätzliche
Weitergabebedingungen erscheinen auch auf der Installer-Lizenzseite.
Die Herkunfts- und Hashnachweise stehen in den jeweiligen Provenienzdateien.

Das [öffentliche Quellenangebot](https://github.com/macfloorball/Rechnungsverwaltung/releases/tag/desktop-sources-2026-11-19)
enthält FFmpeg, StdUtils, Linux-Python/Berkeley DB und AppImage-/FUSE-Quellen.
Alle hochgeladenen Dateien wurden nach Download erneut geprüft; die
Einzelarchive und SHA-256 stehen in
`third_party/sources/desktop-source-publication.json`. DarkGarden-Quellen und
Begleittexte liegen bereits neben den Fonts in der Anwendung. Patentfreiheit
von Multimedia-Codecs wird nicht zugesichert; dies ist von den konkreten
Softwarelizenz- und Quellenpflichten zu unterscheiden.

Die folgenden Abschnitte dokumentieren die frühere Bestandsaufnahme. Bei
Abweichungen gelten die aktuellen Provenienzdateien, Paketierung und Hinweise
in `THIRD_PARTY_NOTICES.md`.

## Gesicherte Nachweise der Folgeprüfung

- 20 zusätzliche CPython-/Bibliothekslizenztexte aus dem vollständigen
  Linux-Archiv und 101 Cargo-Lizenzsammlungen für pydantic-core sind mit
  Quellen und Datei-Prüfsummen unter `third_party/licenses/` abgelegt.
  Die Zuordnung deckt die 101 Einträge beider lokal geprüften Wheel-SBOMs ab;
  die SBOM enthält auch Komponenten anderer Zielplattformen.
- ReportLab enthält für DarkGarden bereits `DarkGarden.sfd` (bearbeitbare
  FontForge-Quelle), `DarkGarden-copying.txt` (Lizenz und Dokumentausnahme)
  und `DarkGarden-copying-gpl.txt` (GPL-Text). Die frühere Frage nach einer
  fehlenden Schriftquelle ist damit für diese lokalen Laufzeiten geklärt.
- Die AppImage-Laufzeit 20251108 und NSIS-Plugins enthalten weitere Komponenten
  mit eigenen Bedingungen, darunter LGPL-Komponenten. Ihre vollständigen
  Beigaben und die genaue Zuordnung zu künftigen Endpaketen bleiben vor einer
  Binärweitergabe zu prüfen; die Sammlung allein schließt das nicht ab.

## Geprüft

- Beide Requirements-Dateien enthalten dieselben 17 Laufzeitpakete. In den
  vorhandenen lokalen Bäumen `dist/python-windows` und `dist/python-linux`
  wurden die installierten METADATA und Lizenzdateien geprüft. Für alle 17
  Pakete liegen Texte unter `.dist-info/licenses` vor.
- Beide Python-Distributionen enthalten die Python-Lizenz. Linux enthält
  zusätzlich pip 26.3 mit eigenen und vendorten Lizenztexten.
- Der vorhandene entpackte Windows-Build enthält Electron-`LICENSE` und
  `LICENSES.chromium.html`. Das ist kein Nachweis für einen neuen NSIS-Build.
- Im Frontend wurden keine externen Script-, CSS- oder Font-Downloads gefunden.
  npm-Entwicklungsabhängigkeiten werden nicht als `node_modules` in die App
  kopiert; Electron enthält eigene Unterkomponenten.
- Die gemeinsame Quellpaketierung für Windows und Linux kopiert jetzt auch
  Projektlizenz und `THIRD_PARTY_NOTICES.md`. Der Paketierungstest prüft den
  tatsächlichen Dateiinhalt.

## Vor einer Binärfreigabe noch offen

1. Native Unterkomponenten von CPython, Pillow und pydantic-core sowie
   Electron/Chromium, AppImage-Laufzeit und NSIS vollständig inventarisieren.
   Lizenztexte, etwaige NOTICE-Dateien und Quellcodepflichten je konkretem
   Binärartefakt prüfen. Vorhandene Hauptlizenzen allein reichen nicht.
2. ReportLab-Schriften gesondert behandeln: `DarkGarden-copying.txt` nennt
   GPL-2.0-or-later und eine Ausnahme für Dokumenteinbettung. Diese Ausnahme
   ersetzt keine Prüfung der Weitergabe der Schriftdatei selbst. Notwendige
   Quellen und Bezugswege klären; keine pauschale MIT-Freigabe behaupten.
3. Herkunft der Projektgrafiken anhand ihrer Entstehung bestätigen.
4. Nach Neubau unter beiden Plattformen die Lizenzdateien auch im tatsächlich
   installierten bzw. extrahierten Endpaket kontrollieren. Ältere lokale
   Entwicklungsartefakte sind kein Nachweis für den aktuellen Quellstand.
5. Ergebnisse und verbleibende Bedingungen für SignPath transparent angeben.

Es wurden keine Abhängigkeiten entfernt, Lizenztexte überschrieben oder
Produktionssperren verändert. Die Bestandsliste steht in
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).
