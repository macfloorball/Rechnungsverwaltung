# Lizenzprüfung der Desktop-Verteilung

Stand: 16.11.2026. Erste Bestandsprüfung, keine abschließende Release-Freigabe.

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
