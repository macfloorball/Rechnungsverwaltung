# Issue 81 – UI, Steuerhinweis und PDF-Downloads

## Verhalten

- „Alle durchgeführt“ verwendet einen nativen HTML-Dialog im vorhandenen
  App-Design. Er nennt Monat, Profilbezug und betroffene geplante
  Wochenplan-Termine. Abbrechen ist fokussiert; Escape verwirft, Tab bleibt
  im Dialog. Ein laufender Dialog beziehungsweise Auftrag sperrt Doppelaufrufe.
  Der bestehende POST-Endpunkt, seine Regeln und Fehlerbehandlung bleiben erhalten.
- „Verwerfen“ verwendet `secondary-button`. Wochenplankarten fließen in zwei
  Spalten in Dokumentreihenfolge von oben nach unten; schmale Fenster verwenden
  eine Spalte. Karten und Einträge behalten ihre natürliche Höhe.
- Das vorhandene optionale Feld `additional_tax_info` heißt nach Rückfrage
  „Hinweis zur Umsatzsteuer“. Keine Vorbelegung und keine neue Steuerberechnung.
  Es bleibt pro Profil in SQLite gespeichert (bestehende Grenze: 1000 Zeichen).
  Neue Vorschauen und PDFs zeigen es unter der Endsumme mit umbrochenen Zeilen.
  Leere Werte erzeugen keinen zusätzlichen Hinweisblock. Gespeicherte PDFs
  bleiben unverändert; bei ausdrücklich neu erzeugten PDFs wird der historische
  Text aus dem bestehenden Rechnungssnapshot verwendet.
- Auf ausdrücklichen Wunsch kann die Electron-App pro Profil einen PDF-Zielordner
  wählen oder wieder auf Standarddownload zurücksetzen. Die native Ordnerauswahl
  liefert den Pfad; der Renderer erhält keine freie Dateischreibschnittstelle.
  `invoice-export-folders.json` unter Electron-`userData` speichert die Zuordnung
  atomar und unabhängig von der internen Dokumentenablage. Diese lokalen,
  gerätebezogenen Download-Einstellungen gehören nicht zur Datenbanksicherung.
  Downloads überschreiben keine älteren Kopien (UUID im Dateinamen).
  Fehlender Ordner und abgebrochene Downloads werden gemeldet. Abgebrochene
  Ordnerauswahl erhält den bisherigen Wert. Webbrowser behalten ihre eigenen
  Download-Einstellungen; das Desktop-Feld wird dort nicht angezeigt.

## Windows-Installer und Lizenzentscheidung

Windows verwendet weiterhin den per Benutzer installierenden NSIS-Assistenten
von electron-builder 26.18.0. App-Symbole, App-Farben, Schrift, Markenkennung und Installationstexte
sind angepasst; Installationspfad, Datenablage und Updateübergabe bleiben gleich.
Die Darstellung bleibt innerhalb der Möglichkeiten des nativen NSIS-Assistenten.

Beim Build entsteht ein SHA-256 des tatsächlich angezeigten
`build/windows/DISTRIBUTION-LICENSE.txt`, mit Canonicalization-Präfix
`ttc-agreement-v1`, ohne BOM und mit LF-Zeilenumbrüchen. Die App-Version ist
kein Teil des Vergleichs. Der Text enthält die bisherige Projektvereinbarung
und die zustimmungspflichtigen Windows-Laufzeitbedingungen. Das allgemeine
Drittanbieterinventar `THIRD_PARTY_NOTICES.md` und die ausgelieferten Lizenzdateien
bleiben unabhängig zugänglich und lösen keine erneute Zustimmung aus.

Die NSIS-Lizenzseite wird anhand des Hashs übersprungen, nicht anhand des
Update-Flags. Eine ausdrücklich bestätigte Vereinbarung wird erst im erfolgreichen
Installationsabschnitt unter
`HKCU\Software\mac-floorball\TT Rechnungsverwaltung\Agreements\AcceptedSHA256`
gespeichert. Erstinstallation, geänderter Text und Altinstallation ohne Nachweis
benötigen interaktive Zustimmung. Es wird keine Zustimmung aus einer vorhandenen
App-Version abgeleitet. Stille Installationen ohne passenden Nachweis enden mit
Code 6; der vorhandene App-Updater startet das Setup interaktiv.

Die private Kopie des fest versionierten NSIS-Templates wird vor Änderung gehasht;
bei unbekanntem Template muss die Integration erneut geprüft werden. Auch die
BOM-Konvertierung des Lizenztexts findet nur im temporären Buildverzeichnis statt.

Linux-AppImage-Updates ersetzen die Datei über den vorhandenen Helfer; RPM-Updates
gehören DNF. Beide haben keinen NSIS-Assistenten und keine entsprechende
Lizenzzustimmungsseite. Diese Abläufe wurden für Issue 81 nicht umgebaut.

## Prüfungen und manuelle Abnahme

Automatisierte Regressionen decken Bestätigen/Abbrechen/Doppelaktivierung und
Fehlerwiederholung, Lizenzidentität und Template-Hooks, Zielordnerpersistenz,
Abbruch, Profiltrennung, fehlende Verzeichnisse und IPC-Abgrenzung ab.
Python prüft Profilpersistenz, Vorschau, finale PDF-Ausgabe und Erhalt gespeicherter
PDFs. Die Textextraktion benötigt Poppler; ohne Poppler ist dieser Teil explizit
übersprungen. `tests/issue81_check.cjs` läuft über den vorhandenen opt-in
Electron-Test mit temporärer App und temporären Daten in Entwicklung und
Produktion, einschließlich Neustart und echtem Download.

Vor einer Freigabe manuell unter Windows prüfen:

1. Neues Setup: Gestaltung, Tastatur und Lizenz-Checkbox; Abbrechen schreibt
   keinen Zustimmungsnachweis.
2. Erfolgreiche Installation und Update mit unverändertem Text: keine Lizenzseite.
3. Update mit geändertem Text sowie Altinstallation ohne Hash: erneute Zustimmung;
   Ablehnung erhält Daten und bisherigen Zustimmungsstand.
4. Native Hooktests über `scripts/check_native_installer_hooks.ps1` einschließlich
   neuer Zustimmungsregression ausführen. Hier ist keine NSIS-Toolchain vorhanden.
5. Echte Windows-Downloads, Ordnerauswahl, nicht mehr erreichbare Netzlaufwerke
   und Schreibfehler prüfen. Die automatisierte Electron-Abnahme hier läuft Linux.

Es wurde kein Release erstellt oder veröffentlicht.

Abschlussprüfung auf dem Issue-Branch: Frontend-Build und `git diff --check`
erfolgreich; 254 Node-Tests bestanden, 10 optionale Prüfungen übersprungen;
107 relevante Python-Tests bestanden; beide Electron-Durchläufe (Entwicklung
und Produktion, jeweils mit Neustart) bestanden. Visuell geprüft wurden
Dialog, Wochenplan bei 480/980/1800 Pixeln sowie tabellarische Vorschau und
PDF mit mehrzeiligem und langem Steuerhinweis. Die native Windows-Abnahme
oben bleibt ausdrücklich offen.
