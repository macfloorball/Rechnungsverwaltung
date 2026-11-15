# SignPath: Antragsvorbereitung

Stand: 16.11.2026. Kein Antrag versendet, keine Aufnahme bestätigt.

## Projektangaben

- Projekt: TT Rechnungsverwaltung
- Repository: https://github.com/macfloorball/Rechnungsverwaltung
- Maintainer: macfloorball (Paketautor: mac-floorball)
- Zweck: lokale Vereinsabrechnung mit Electron, Python, SQLite und PDF-Ausgabe.
- Lizenz: MIT für eigenen Code, Commit `f3f71b3`; noch auf GitHub zu übernehmen.
- Gewünschte Signierung: Windows-App und NSIS-Installer; Linux-Updates erhalten
  separat eine Ed25519-Manifestsignatur.

## Vor dem Antrag klären

1. GitHub-MFA ist laut Bestätigung des Maintainers aktiviert; später auch
   SignPath-MFA einrichten.
2. Drittkomponenten und ihre Lizenznachweise vollständig prüfen.
3. Noch fehlenden veröffentlichten Paketstand mit SignPath klären: Die
   Bedingungen verlangen bereits veröffentlichte Pakete. Produktionssperren
   werden dafür nicht umgangen. Auch die geforderte Projektreputation ist
   durch SignPath zu bewerten.
4. Rollen, Datenschutzangaben und „Code signing policy“ vorbereiten. Eine
   Förderung erst nach tatsächlicher Zusage als solche ausweisen.
5. Electron-App, NSIS-Installer und Uninstaller sowie deren Herkunftsnachweis
   mit SignPath abstimmen; fremde Laufzeitdateien nicht als Eigenentwicklung
   signieren.

## Technische Folgearbeit

Der jetzige Workflow erwartet einen isolierten Signierrechner und ein
Zertifikat im Windows-Store. SignPath ist kein direkter Ersatz dafür.
Ein geprüfter Adapter muss Signierfreigaben, Herkunft, Produktmetadaten,
Signaturprüfung und Paketierung erhalten. Zertifikatsidentität erst nach
Zusage festlegen. `desktop-release-policy.json` bleibt deaktiviert; die dort
noch private Sichtbarkeit ist vor Aktivierung gesondert anzupassen.

Quellen: [Bedingungen](https://signpath.org/terms),
[Antrag](https://signpath.org/apply). Aufnahme nicht garantiert.
