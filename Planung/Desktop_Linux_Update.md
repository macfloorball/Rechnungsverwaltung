# Sichere Linux-Updates für AppImage

Stand: 15.11.2026, Umsetzungsschritt 9. Umfang bleibt wie festgelegt:
Linux-x86_64-AppImage. DEB, RPM, Flatpak, Paketquellen und Paketmanagerintegration
werden in diesem Schritt nicht eingeführt. Windows-Installer, App-ID,
Datenverzeichnisse und Releasefreigaben behalten ihre bisherige Bedeutung.

## Unterstützte automatische Aktualisierung

`electron/linux_update.cjs` ergänzt für Linux dieselbe benannte,
versionsgebundene `installUpdate(version)`-Schnittstelle wie Schritt 8.
Der Dienst verwendet ausschließlich das bereits signatur- und hashgeprüfte
AppImage aus dem zentralen Download. Vor Vorbereitung und nach kontrolliertem
Backendende prüft Main die exakten Ed25519-Manifestbytes erneut, einschließlich
Version, Plattform, Paketformat, Ablaufzeit und unveränderter aktueller Freigabe.
Es gibt keinen vom Renderer wählbaren Zielpfad, Befehl oder Download-Ursprung.

Automatisches Ersetzen wird nur angeboten, wenn alle Voraussetzungen passen:

- Installierter stabiler AppImage-Build mit aktivierter eingebetteter
  Vertrauenskonfiguration; kein Entwicklungs-/Web-/entpackter Start.
- Standard-AppImage-Laufzeit: `APPDIR` passt zu App-Verzeichnis und laufender
  ausführbarer Datei; `/proc/self/mountinfo` bestätigt einen bekannten,
  schreibgeschützten AppImage-/Squashfuse-Mount. `APPIMAGE` ist ein absoluter,
  nicht umgeleiteter Originalpfad. Die [Laufzeitvariablen](https://docs.appimage.org/packaging-guide/environment-variables.html)
  werden mit dem tatsächlichen Prozesslayout und Kernel-Mountdaten abgeglichen.
- Reguläre Type-2-AppImage-Datei für x64, Eigentümer aktueller Benutzer,
  genau ein Hardlink, Besitzerrechte Lesen/Schreiben/Ausführen, keine fremden
  Schreibrechte, keine Setuid-/Setgid-Bits oder Symlinks.
- Sicher beschreibbares, benutzereigenes Elternverzeichnis ohne umgeleitete
  Vorfahren oder fremde Schreibrechte. Root-eigene Sticky-Vorfahren wie `/tmp`
  sind erlaubt; `/tmp` selbst ist kein geeignetes Zielverzeichnis.
- Lokales Dateisystem mit bekannter atomarer Rename-Semantik: ext-Familie,
  Btrfs, XFS, tmpfs oder Overlay. Fremde/systemweite, schreibgeschützte,
  Netzwerk-/unbekannte Dateisysteme und Root-Ausführung bleiben gesperrt.

Bei fehlenden Voraussetzungen zeigt die Oberfläche bereits vor dem Download
an, dass das freigegebene AppImage manuell aus dem GitHub-Repository aktualisiert
werden muss. „Update herunterladen“ bleibt als verifizierter Download möglich;
eine automatische Installation wird nicht angeboten. Es gibt kein `sudo`, keine
Rechteausweitung und keinen Versuch, Paketmanagerdateien zu überschreiben.

## Zustimmung und Übergabe

Wie unter Windows ist eine zweite native Bestätigung erforderlich. Sie warnt vor
ungespeicherten Eingaben und nennt App-/Serverende, Dateitausch und Neustart.
„Abbrechen“ ist vorausgewählt. Andere Arbeitsdialoge bzw. mit `aria-busy` markierte
Vorgänge sperren die Vorbereitung. Nach Bestätigung wird die Oberfläche gegen
weitere Eingaben gesperrt.

Der vorhandene Backend-Schutz aus Schritt 8 sperrt neue API-Vorgänge, lässt
aktive Rechnungs-, Dokumenten- und Sicherungsoperationen auslaufen und beendet
den eigenen Server ausschließlich kooperativ. Bei unklarem/erzwungenem Ende
beginnt kein Dateitausch. Eine fehlgeschlagene Vorbereitung gibt die bisherige
App wieder frei bzw. startet ihren unveränderten Backend-Build erneut.

Der separate Helfer `backend/linux_update_helper.py` benötigt nur die
Standardbibliothek. Main kopiert ihn und die benötigte, manifestgeprüfte private
Python-Laufzeit in ein zufälliges Verzeichnis unter `<userData>/updates`.
`site-packages` und persönliche Dateien werden nicht kopiert. Dateien werden vor
dem Schreiben gegen das Installationsmanifest gehasht; die kopierte Laufzeit
wird isoliert getestet. Sie benötigt keinen System-Python und funktioniert
unabhängig vom alten AppImage-Mount. Zusätzlicher freier Platz für die Hilfslaufzeit
wird vorab geprüft.

Die Übergabe nutzt stdin/Statusmarker mit getrennten Phasen für Bereitschaft,
Commit-Bestätigung und abschließendes Startsignal. Ohne letztes Signal führt
weder EOF noch Prozessabbruch zum Austausch. Linux-`pidfd` bindet den Helfer an den
tatsächlichen Elternprozess; vor dem Austausch wartet er auf dessen Ende.
Unzureichende Kernelunterstützung führt zum manuellen Updateweg.

## Dateitausch und Neustart

Der Helfer läuft ohne Root-Rechte und überprüft Eigentümer, Verzeichnisse,
Dateitypen, Rechte, Größe, AppImage-Header und SHA-256 erneut. Er hält exklusive
`flock`-Sperren auf Originaldatei und Profilsperre. Ein neuer Appstart prüft diese
Sperre vor dem Backendstart und beginnt keine parallelen Datenoperationen.

Die neue Datei wird in ein zufälliges privates Unterverzeichnis **neben dem
Original-AppImage** kopiert. So funktioniert der Austausch auch dann, wenn der
Downloadcache auf einem anderen Dateisystem liegt. Datei und Hash werden vom
Datenträger geprüft und synchronisiert. Vor dem Ersetzen werden Ablaufzeit,
ursprüngliches Gerät/Inode, Größe und Änderungszeiten sowie Verzeichnisidentität
nochmals abgeglichen. Verzeichnis-Deskriptoren und `O_NOFOLLOW` vermeiden eine
Übergabe an fremde Pfade.

`os.replace` ersetzt die vollständige Datei atomar auf demselben Dateisystem.
Anschließend werden Elternverzeichnis und Ergebnis synchronisiert bzw. geprüft.
Der ursprüngliche Dateiname bleibt bestehen, damit vorhandene Startverknüpfungen
weiter passen. Erst jetzt startet `execve` die geprüfte neue Datei. Alte
AppImage-/Python-/Bibliothekspfadvariablen werden entfernt; die neue Laufzeit setzt
ihr eigenes Layout auf. Es gibt keinen Start des ungeprüften temporären Pakets.

Vor dem Austausch bleibt bei einem Fehler das Original erhalten. Nach einem
Austausch gibt es keinen automatischen Rücktausch: Eine neue App könnte bereits
Datenbankschemata migrieren. Programmdatei- und Datenbank-Rollback bleiben
getrennt; Datenbanken, Rechnungen und Einstellungen werden nie vom Helfer ersetzt.
Schlägt ein späterer Start fehl, ist eine vollständige gleiche oder neuere,
vertrauenswürdig freigegebene AppImage-Datei der manuelle Reparaturweg.

Das private Journal `updates/linux-install-state.json` enthält nur Versionen,
Phase und den eigenen Hilfsverzeichnisnamen, keine Token oder Befehle. Der nächste
erfolgreiche Start der passenden Version bestätigt `replaced` und entfernt den
Hilfsruntime-Rest und den zugehörigen privaten Downloadslot. Nicht bestätigte/fehlgeschlagene Abläufe werden sichtbar gemeldet.
Sitzungsreste werden nicht ungeprüft als Installationspakete wiederverwendet.

## Tatsächlich ausgeführte Prüfungen und Grenzen

- 174 JavaScript-Tests bestanden, ein nativer Windows-Parsertest übersprungen;
  inklusive NSIS-Hook-Kompilierung, Linux-Pfad-/Rechte-/Fallbackprüfungen und
  bestehender Windows-Regressionen.
- 405 Python-Tests bestanden, elf optionale/plattformabhängige Tests übersprungen.
  Die nativen Linux-Helferfälle prüfen atomaren Austausch, Neustart eines
  isolierten ELF-Testprogramms, Datenerhalt, Abbruch, Hashmanipulation,
  abgelaufene Freigabe, Zieländerung, Symlink-/Rechtesperre, Profil-Lock sowie
  den tatsächlichen Wechsel zwischen zwei Dateisystemen.
- Acht gesondert aktivierte native Linux-Electron-Szenarien bestanden:
  Dialog/Download in Entwicklungs-/Produktionsmodus und vier vorhandene
  Rechnungs-/Sicherungs-/Neustartprüfungen mit Standard-/eigenem Dokumentenort.
- Linux-AppImage gebaut und nach Entpacken über Installationsmanifest,
  Versionsmetadaten und freigegebenen Starter geprüft. Die kopierte gebündelte
  Python-Hilfslaufzeit bestand eine separate Relokationsprobe.

Die ELF-Testprogramme sind ausschließlich isolierte Testdaten. Sie ersetzen
keine Abnahme eines vollständigen AppImage-/FUSE-Updatezyklus. Auf diesem Host
fehlt `/dev/fuse`; deshalb wurde kein solcher erfolgreicher FUSE-Zyklus behauptet.
Auf Ubuntu LTS und Fedora mit funktionierendem FUSE sind noch zwei tatsächlich
signierte stabile Versionen mit echten Test-Vertrauensankern zu aktualisieren:
Zustimmung/Abbruch, Datenerhalt, fehlende Rechte, Parallelstart, Strom-/Prozessabbruch
und neuer Backendstart müssen geprüft werden. Private Release-Infrastruktur und
native Windows-Abnahme bleiben ebenfalls offen; produktive Updates sind weiterhin
gesperrt. Es wurde kein Release ausgelöst und kein Paketformat hinzugefügt.
