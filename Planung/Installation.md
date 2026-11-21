# App herunterladen und installieren

Stand: 21.11.2026. Diese Anleitung gilt für die fertige **TT Rechnungsverwaltung**.
Python, Node.js, npm, Git und Testwerkzeuge sind dafür nicht erforderlich;
die Laufzeiten sind enthalten. Internet wird für Downloads und Updateprüfungen
benötigt. Die Rechnungsverwaltung arbeitet lokal ohne Benutzerkonto.

## 1. Passende Ausgabe wählen

| System | Download / Installationsweg | Nachweis und Grenze |
| --- | --- | --- |
| Windows 10/11, x64 (Intel/AMD 64 Bit) | [Desktop 0.2.0: Setup-EXE](https://github.com/macfloorball/Rechnungsverwaltung/releases/download/desktop-v0.2.0/ttc-rechnungsverwaltung-0.2.0-windows-x64-setup.exe) | Windows-Live-Update 0.1.2 → 0.1.3 belegt; neue Features in CI geprüft, zusätzliche Sonderfälle siehe [#46](https://github.com/macfloorball/Rechnungsverwaltung/issues/46) |
| Linux, x86_64 / amd64 | [Desktop 0.2.0: AppImage](https://github.com/macfloorball/Rechnungsverwaltung/releases/download/desktop-v0.2.0/ttc-rechnungsverwaltung-0.2.0-linux-x64.AppImage) | Native Fedora-45-Nachweise für Vorgängerversionen; Ubuntu 24.04 LTS ist Ziel-/CI-System, keine vollständige GUI-Abnahme |
| Fedora 45, x86_64 | [Signiertes DNF-Repository](https://macfloorball.github.io/Rechnungsverwaltung/rpm/) | RPM 0.2.0-1; Installation, Update, Entfernung und Signaturablehnung im isolierten Fedora-Container geprüft |

Für ARM und macOS sind keine fertigen Pakete veröffentlicht. Andere
Linux-Distributionen sind nicht pauschal als geprüft zugesagt. Auf Fedora ist
DNF der integrierte Installationsweg; das AppImage ist eine separate Alternative.
Beide Linux-Ausgaben teilen das Benutzerprofil: vor einem Wechsel sichern und
alle Instanzen schließen. Nicht gleichzeitig mit demselben Datenbestand starten.

Der [stabile Desktop-Release 0.2.0](https://github.com/macfloorball/Rechnungsverwaltung/releases/tag/desktop-v0.2.0)
enthält beide Desktopdateien. Unter „Assets“ die oben genannte Datei wählen,
nicht „Source code“, `desktop-update.json` oder die Drittanbieter-Quellarchive.
Der neueste allgemeine GitHub-Release kann stattdessen ein RPM-Release sein.

### Update auf 0.2.0

Vor Installation beziehungsweise DNF-Upgrade eine **vollständige App-Sicherung**
mit Datenbank und Dokumenten erstellen und die App schließen. Der erste Start
migriert die Datenbank für Profile, Wiederholungen und Jahresnummernkreise.
Der vorhandene Einzelprofilbestand erscheint im Profil TTC. Historische
Rechnungen und PDFs bleiben unverändert. Bei unklaren alten Nummern können
konservative Nummernlücken entstehen. Eine ältere Appversion darf nicht einfach
mit der migrierten Datenbank betrieben werden; für eine Rückkehr wird eine
passende Sicherung benötigt. Details zur Bedienung stehen in der README.

## 2. Windows installieren und starten

1. Die oben verlinkte Datei `ttc-rechnungsverwaltung-0.2.0-windows-x64-setup.exe`
   herunterladen, zum Beispiel in „Downloads“.
2. Optional die Datei [SHA256SUMS](https://github.com/macfloorball/Rechnungsverwaltung/releases/download/desktop-v0.2.0/SHA256SUMS)
   desselben Releases herunterladen. Im Downloadordner in PowerShell prüfen:

   ```powershell
   Get-FileHash -Algorithm SHA256 .\ttc-rechnungsverwaltung-0.2.0-windows-x64-setup.exe
   ```

   Den vollständigen Hash mit der Zeile für genau diesen Dateinamen vergleichen.
   Bei Abweichung die Datei nicht ausführen und erneut aus der offiziellen Quelle laden.
3. Die Setup-EXE als normaler Benutzer öffnen und den Installationsdialogen folgen.
   Die Installation erfolgt pro Benutzer mit festem Programmziel; Administratorrechte
   und ein eigener Installationspfad sind nicht vorgesehen.
4. „TT Rechnungsverwaltung“ über Desktop-Verknüpfung oder Startmenü starten.
   Ein Terminal oder ein separat gestarteter Server ist nicht nötig.

**Windows-Warnungen:** Der Installer besitzt derzeit keine Authenticode-Signatur;
Windows oder der Browser können daher vor einem unbekannten Herausgeber warnen.
Der Name in den Dateimetadaten ersetzt keine Signatur. Quelle, Dateiname und
Prüfsumme vor der Ausführung prüfen. Sicherheitsfunktionen eingeschaltet lassen;
bei einer administrativen Sperre die zuständige Administration kontaktieren.
Das Ed25519-signierte Update-Manifest ist eine eigene Prüfung der App und ersetzt
keine Windows-Herausgebersignatur.

**Updates:** Die installierte Desktop-App prüft kurz nach dem Start und danach
ungefähr alle sechs Stunden auf Updates. Auch eine manuelle Prüfung ist über die
Update-Oberfläche möglich. Download und Installation erfolgen erst nach Zustimmung;
vor dem sichtbaren Installer wird erneut bestätigt. Vorher eine vollständige
Sicherung erstellen und Eingaben speichern. App und lokaler Server werden
kontrolliert beendet. Persönliche Daten liegen getrennt vom Programm und bleiben
erhalten. Bei abgebrochenem Update kann der vollständige aktuelle Installer bei
geschlossener App erneut ausgeführt werden. Ältere Versionen werden gesperrt.

**Einmalige Reparatur für Windows 0.1.0 und 0.1.1:** Diese Versionen können
beim Beenden des Backends vor dem Installerstart abbrechen. Ab Version 0.1.2 ist
die Korrektur enthalten. Weil der Fehler in der installierten Ausgangsversion auftritt,
einmal vollständig sichern, die App schließen und das oben verlinkte aktuelle Setup
im selben Windows-Konto über die bestehende Installation ausführen. Nicht vorher
deinstallieren oder Datenordner löschen. Ein erfolgreicher manueller Wechsel
ersetzt die noch offene Live-Update-Abnahme aus Issue #32 nicht.

**Deinstallieren:** App vollständig schließen, dann in den Windows-Einstellungen
unter „Apps“ / „Installierte Apps“ die TT Rechnungsverwaltung deinstallieren.
Programm, eigene Verknüpfungen und Registrierung werden entfernt; Benutzerprofil,
Rechnungen, eigene Dokumentenablage und Sicherungen bleiben erhalten. Der
Uninstaller bietet keine Löschung persönlicher Daten an. Bei Neuinstallation
wird das bestehende Profil wiederverwendet.

## 3. Linux-AppImage ablegen und starten

1. Das oben verlinkte AppImage herunterladen. Im Dateimanager einen eigenen Ordner
   `Anwendungen/TT-Rechnungsverwaltung` im persönlichen Ordner anlegen und die
   Datei dorthin verschieben. Alternativ im Terminal (Datei zuvor dort ablegen):

   ```sh
   mkdir -p "$HOME/Anwendungen/TT-Rechnungsverwaltung"
   cd "$HOME/Anwendungen/TT-Rechnungsverwaltung"
   chmod u+rwx ttc-rechnungsverwaltung-0.2.0-linux-x64.AppImage
   ```

2. Optional `SHA256SUMS` vom Desktop-Release in denselben Ordner herunterladen
   und den Wert für das AppImage mit dieser Ausgabe vergleichen:

   ```sh
   sha256sum ttc-rechnungsverwaltung-0.2.0-linux-x64.AppImage
   ```

   Bei Abweichung nicht starten.
3. Die Datei im Dateimanager öffnen oder im Terminal starten:

   ```sh
   cd "$HOME/Anwendungen/TT-Rechnungsverwaltung"
   ./ttc-rechnungsverwaltung-0.2.0-linux-x64.AppImage
   ```

   Später denselben Start wiederholen. Ein automatischer Menüeintrag wird für das
   AppImage nicht zugesagt. Die App als eigenen Benutzer starten.

### FUSE und Linux-Voraussetzungen

AppImages benötigen einen funktionierenden FUSE-Zugriff des Benutzers auf dem
Host. Die mitgelieferte moderne Type-2-Laufzeit bindet libfuse statisch ein;
`libfuse2` ist deshalb keine pauschale Voraussetzung dieser Ausgabe
([offizielle Type-2-Dokumentation](https://github.com/AppImage/type2-runtime)).
FUSE im Kernel und die distributionsseitige Einrichtung bleiben erforderlich.

Bei einer FUSE-Fehlermeldung zunächst den genauen Text und die Distribution prüfen.
Die [offizielle AppImage-Fehlerhilfe](https://docs.appimage.org/user-guide/troubleshooting/fuse.html)
beschreibt auch ältere Laufzeiten: Dort ist für Ubuntu 22.04 `libfuse2`, für
Ubuntu 24.04 `libfuse2t64` angegeben. Diese Hinweise sind distributions- und
laufzeitabhängig, keine Aufforderung, FUSE 3 zu ersetzen. Auf Fedora die
FUSE-Einrichtung über die Paketverwaltung/Administration prüfen oder das RPM
verwenden. Bei Sandbox-/AppArmor-/User-Namespace-Fehlern die Systemrichtlinie
mit der Administration klären. Weder als root starten noch die Sandbox oder
Sicherheitsrichtlinien abschalten; keine pauschalen Dateirechte vergeben.

### AppImage aktualisieren und entfernen

Die Updateprüfung und Zustimmung funktionieren wie oben beschrieben. Ein eigener
Austausch ist nur beim regulär über FUSE gestarteten AppImage möglich: Datei und
Zielordner müssen dem Benutzer gehören und sicher beschreibbar sein, auf einem
unterstützten lokalen Dateisystem liegen und dürfen keine symbolischen Links sein.
Die Datei braucht Lese-, Schreib- und Ausführrecht für den Eigentümer; Datei und
Pfad dürfen nicht für andere Benutzer beschreibbar sein. Auch genügend freier
Speicher und ein zugängliches Benutzerprofil sind nötig. Die App prüft diese
Bedingungen selbst. Systemweite, schreibgeschützte, verlinkte oder Netzlaufwerk-
Ablagen sowie entpackte Starts sind kein zugesagter Selbstupdateweg.

Nach Bestätigung beendet die App ihren Server, ersetzt das geprüfte AppImage
am bisherigen Ort und startet neu. Bei einem Hinweis auf manuelle Aktualisierung:
sichern, App schließen, das neue freigegebene AppImage herunterladen, Prüfsumme
vergleichen, im eigenen Ordner ablegen und ausführbar machen. Dafür keine
Rechteerhöhung verwenden. Zum Entfernen nur die AppImage-Programmdatei bei
geschlossener App im Dateimanager entfernen; persönliche Daten bleiben erhalten.

## 4. Fedora 45 mit DNF

1. Terminal öffnen. Falls `dnf config-manager` fehlt, dessen Plugin installieren:

   ```sh
   sudo dnf install dnf5-plugins
   ```

2. Das veröffentlichte Repository hinzufügen:

   ```sh
   sudo dnf config-manager addrepo --from-repofile=https://macfloorball.github.io/Rechnungsverwaltung/rpm/ttc-rechnungsverwaltung.repo
   ```

3. App installieren:

   ```sh
   sudo dnf install ttc-rechnungsverwaltung
   ```

   Beim angebotenen Schlüsselimport den **vollständigen Fingerprint** vergleichen:

   ```text
   60A0 54FE 4617 3E37 41B6 0A37 186E D775 C7DC 9771
   ```

   Er stammt aus der [RPM-Repository-Policy](../rpm-repository-policy.json).
   Nur bei Übereinstimmung zustimmen; bei Abweichung abbrechen und melden.
   DNF kann für Metadaten und Pakete getrennt nach dem Schlüssel fragen.
   Die veröffentlichte Konfiguration aktiviert `gpgcheck=1`, `repo_gpgcheck=1`
   und HTTPS-Prüfung. Diese Prüfungen eingeschaltet lassen.
4. Über den Menüeintrag „TT Rechnungsverwaltung“ oder als normaler Benutzer starten:

   ```sh
   ttc-rechnungsverwaltung
   ```

5. Vor Updates sichern und die App **vollständig schließen**, dann:

   ```sh
   sudo dnf upgrade ttc-rechnungsverwaltung
   ```

   RPM-Updates verwaltet DNF; die App bietet dafür keinen AppImage-Austausch an.
   Das Paket verweigert den Dateiaustausch bei laufender RPM-App und beendet
   keine Prozesse erzwungen. Danach über den Menüeintrag erneut starten.
6. Zum Deinstallieren ebenfalls zuerst schließen:

   ```sh
   sudo dnf remove ttc-rechnungsverwaltung
   ```

   Benutzerprofil, Dokumente und Sicherungen bleiben erhalten. Die Paketdateien
   liegen unter `/usr/libexec/ttc-rechnungsverwaltung`, getrennt von Nutzerdaten.

Die Befehle entsprechen dem [Repository-Leitfaden](Linux_RPM_Repository.md)
und der [offiziellen DNF5-Syntax](https://dnf5.readthedocs.io/en/latest/dnf5_plugins/config-manager.8.html).
Andere Fedora-Versionen oder RPM-Distributionen sind damit nicht als geprüft erklärt.

## Bedienung über getrennte Ansichten

Beim Start öffnet sich „Kalender / Übersicht“. Unter dem Kalender stehen Vorschau
und endgültige Rechnung für den gewählten Monat einschließlich PDF-Aktionen.
Den Monat über die Pfeile im Kalender wechseln. Weitere Bereiche erreichst du
über „Rechnung konfigurieren“, „Wochenplan konfigurieren“, „Tätigkeiten und Preise“
und „Verwaltung / App-Einstellungen“. Letztere enthält Sicherung, Export und die
plattformabhängigen Desktop-Updates; bei RPM bleibt DNF zuständig.

Eingaben bleiben bei Ansichtswechseln erhalten. Gespeichert wird ausschließlich
über den jeweiligen Speichern-Button. Auch bei einer fehlgeschlagenen Anfrage
bleiben die Eingaben erhalten; die Fehlermeldung steht im betroffenen Bereich.
Vor Schließen oder Neuladen der App alle gewünschten Änderungen speichern.
Tab und Eingabetaste bedienen die Navigation; der Fokus folgt der neuen Ansicht.

## 5. Daten und Sicherungen

| Inhalt | Standardort |
| --- | --- |
| Windows-Profil | `%APPDATA%\ttc-rechnungsverwaltung` |
| Linux-Profil (AppImage und RPM) | `~/.config/ttc-rechnungsverwaltung`, bei gesetztem `XDG_CONFIG_HOME` darunter |
| Datenbank mit Einstellungen, Terminen und Rechnungsdaten | `ttc.db` im Datenverzeichnis |
| Rechnungs-PDFs und Dokumente | `documents/` im Datenverzeichnis |
| Vollständige Sicherungen | `ttc-rechnungsverwaltung-backups` im persönlichen Benutzerordner |

`TTC_DATA_DIRECTORY` kann das Datenverzeichnis überschreiben;
`TTC_DOCUMENT_DIRECTORY` die Dokumentenablage unabhängig davon. Bei solchen
Anpassungen auch diese tatsächlichen Orte berücksichtigen. Datenbank nicht
parallel über synchronisierte oder gemeinsam geöffnete Ordner betreiben.

1. In der App unter „Verwaltung / App-Einstellungen“ → „Datensicherung“ auf „Sicherung erstellen“ klicken.
   Ein leerer Zielpfad verwendet den oben genannten Sicherungsordner; alternativ
   einen absoluten Zielpfad außerhalb der Dokumentenablage eingeben.
2. Erfolgsmeldung und den angezeigten ZIP-Pfad prüfen. Die Sicherung enthält
   Datenbank einschließlich gespeicherter Einstellungen und Dokumente samt
   Prüfsummen; sie sichert nicht das komplette Electron-Profil oder Zugangsdaten.
3. Die Datei `ttc-backup-…zip` zusätzlich auf einem getrennten Datenträger sichern.
   Das Archiv enthält sensible Daten und ist geschützt aufzubewahren.

Vor Updates, Neuinstallation oder Wechsel zwischen RPM und AppImage sichern.
Automatische SQLite-Sicherungen vor Migrationen ersetzen dieses vollständige
Backup nicht. Das Entwickler-Skript `backup_database.py` sichert keine PDFs.
Eine Wiederherstellung ist derzeit ein technischer Offlinevorgang ohne eigenen
Installationsassistenten; dafür Hilfe hinzuziehen und das
[Wiederherstellungsverfahren](../README.md#wiederherstellung-bei-beendeter-app)
verwenden. Originalprofil und Sicherungen behalten, keine Nutzerdaten löschen.

## 6. Kurze Fehlerhilfe und Prüfgrenzen

- **Falsche Datei / Start nicht möglich:** Architektur und Dateiname aus Abschnitt 1
  prüfen; vollständig herunterladen und Hash vergleichen. „Source code“ ist kein Installer.
- **AppImage „Permission denied“:** Ausführrecht wie oben setzen und einen eigenen
  lokalen Ordner verwenden. Bei einem `noexec`-Datenträger einen geeigneten Ort
  wählen, keine systemweiten Rechte lockern.
- **Windows-Installation blockiert / RPM-App läuft:** Vorgänge speichern, alle
  Appfenster schließen und erneut versuchen. Keine fremden Prozesse beenden.
- **Beschädigte Installation:** Originaldaten behalten. Unter Windows aktuellen
  vollständigen Installer erneut ausführen; AppImage erneut laden. Bei RPM mit
  geschlossener App `sudo dnf reinstall ttc-rechnungsverwaltung` verwenden.
- **Updateprüfung ohne Netz oder mit Fehler:** Lokal weiterarbeiten und später
  erneut prüfen. Keine Signaturprüfung umgehen und keinen GitHub-Token für die
  öffentliche Erstinstallation beschaffen.
- **Datenpfad, Port oder Speicherplatz nicht verfügbar:** Fehlertext notieren,
  freien Speicher und Zugriff auf das eigene Datenverzeichnis prüfen; weitere
  Appinstanzen schließen. Kein leeres Ersatzprofil anlegen und keine Daten löschen.
- **Problem melden:** [Issue anlegen](https://github.com/macfloorball/Rechnungsverwaltung/issues)
  mit Appversion, Betriebssystem, Architektur und Fehlertext; keine Datenbank,
  Rechnungen, Zugangsdaten oder personenbezogenen Screenshots veröffentlichen.

Die [native Windows-Teilprüfung vom 13.11.2026](Windows_Installationspruefung.md)
belegt Installation, Start ohne Entwicklungswerkzeuge, Desktopstart, Datenerhalt,
Neuinstallation und einen Versionswechsel in einer Windows-11-VM. Sie ersetzt
keine vollständige Prüfung des aktuellen öffentlichen Updatewegs. Die unabhängige
zweite Windows-Umgebung und die Windows-Live-Abnahme aus
[Issue #32](https://github.com/macfloorball/Rechnungsverwaltung/issues/32)
bleiben offen. Historische Protokolle enthalten ihren damaligen Stand.
