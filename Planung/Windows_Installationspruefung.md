# Windows-Installationsprüfung für Phase 6

Dies ist eine Testanleitung, kein Nachweis bereits durchgeführter Windows-Tests.
Die native Ausführung wird als nächster Schritt in einer Windows-VM geprüft.
Die zweite Windows-Maschine ist eine gesonderte Abnahme.

## Vorbereitung

- Eine Windows-10/11-x64-VM mit Snapshot und einem normalen Benutzer verwenden.
- Auf der sauberen Zielinstallation sind Python, Node.js und npm nicht erforderlich.
- Installer und zugehörige `.sha256`-Datei aus `dist/installer/` übertragen.
- In PowerShell mit `Get-FileHash -Algorithm SHA256 '.\TTC Rechnungsverwaltung-0.1.0-windows-x64-setup.exe'`
  den Hash mit der Textdatei vergleichen.
- Ausschließlich Testdaten verwenden; vor Update-/Deinstallationstests eine
  vollständige Sicherung über die Anwendung anlegen und außerhalb der VM sichern.
- Einen VM-Snapshot unmittelbar vor Installation und einen weiteren mit
  eingerichtetem Testbestand behalten. Keine produktiven Profile löschen.

## Installation und Deinstallation (Schritt 5)

1. Installer als normaler Benutzer starten. Erwartung: keine Administratorrechte
   nötig, deutscher Dialog, App-Name und Herausgeber `mac-floorball`.
   Der unsignierte Build kann eine SmartScreen-Warnung auslösen.
2. Installation abschließen. Desktop-Verknüpfung und Startmenü-Eintrag kontrollieren.
   Beide jeweils bei geschlossener App starten. Erwartung: eigenes Fenster,
   kein manuelles Terminal und kein separates Starten eines Servers.
3. Eine Tätigkeit, einen erledigten Termin, Empfängereinstellungen und eine finale
   Rechnung mit PDF anlegen. App schließen und neu starten; Bestand vergleichen.
4. In den Windows-Einstellungen unter Apps deinstallieren. Erwartung: Anwendung,
   Registrierung und eigene Verknüpfungen entfernt; Datenprofil unter
   `%APPDATA%\ttc-rechnungsverwaltung` und eine eigene Dokumentenablage erhalten.
5. Denselben Installer erneut installieren. Erwartung: vorhandene Einstellungen,
   Termine, Rechnung, PDF und Rechnungsnummernkreis nach Start wieder vorhanden.
6. Installation vor Abschluss abbrechen und danach erneut starten. Erwartung:
   verständliches Ergebnis, kein Verlust des bestehenden Datenprofils.

Je Fall Windows-Version, Benutzerrechte, Installer-Hash, tatsächliches Ergebnis
und Fehlertext festhalten. Ein erzeugter Installer oder ein Test unter Wine
ersetzt diese native Abnahme nicht.

## Update und Datenerhalt (Schritte 7 und 8)

1. Den Testbestand vollständig sichern. PDF-Prüfsummen und Rechnungsnummern
   festhalten, App schließen, Installer erneut ausführen, danach Bestand prüfen.
2. Den Ablauf mit einer neueren Testversion wiederholen, sobald eine solche
   vorliegt. Gleichversionige Reparatur allein beweist keinen Versionswechsel.
3. Nach erfolgreichem Update einen älteren Installer versuchen. Erwartung:
   Abbruch mit Exitcode 3, aktuelle Installation und Daten bleiben erhalten.
4. Installer mit `/D=C:\TTC-Testdaten` versuchen. Erwartung: Exitcode 4 ohne
   Änderung dieses Ordners. Nur einen eigens angelegten Testordner verwenden.
5. Den Uninstaller mit `--delete-app-data` versuchen. Erwartung: Exitcode 2,
   Programm und Daten bleiben erhalten. Anschließend normal deinstallieren.
6. Die Fälle mit einer eigenen Dokumentenablage wiederholen. PDFs, externe
   Sicherungen und Anhänge müssen auch nach Deinstallation erhalten bleiben.
