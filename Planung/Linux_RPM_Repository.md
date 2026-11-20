# Signiertes RPM-Repository für Fedora

Die RPM-Distribution verwendet DNF für Installation und Updates. Die App zeigt
für diese Installationsart den Hinweis auf die Softwareverwaltung und bietet
keinen AppImage-Austausch an. Zunächst wird Fedora 45 auf x86_64 geprüft.

## Installation nach der ersten Veröffentlichung

Die folgenden Befehle funktionieren erst nach Aktivierung und Veröffentlichung
des Repositorys unter der in `rpm-repository-policy.json` festgelegten URL:

```sh
sudo dnf config-manager addrepo --from-repofile=https://macfloorball.github.io/Rechnungsverwaltung/rpm/ttc-rechnungsverwaltung.repo
sudo dnf install ttc-rechnungsverwaltung
```

Falls `config-manager` fehlt, ist unter Fedora das Paket `dnf5-plugins` nötig.
Den angebotenen Schlüsselfingerprint mit dem im Repository festgelegten öffentlichen
Schlüssel vergleichen. Paket- und Metadatensignaturen sind beide vorgeschrieben;
Signaturprüfungen nicht abschalten.

Die App vor Aktualisierung oder Deinstallation vollständig schließen:

```sh
sudo dnf upgrade ttc-rechnungsverwaltung
sudo dnf remove ttc-rechnungsverwaltung
```

Das Paket installiert unter `/usr/libexec/ttc-rechnungsverwaltung`, mit Menüeintrag
und Startbefehl `ttc-rechnungsverwaltung`. RPM-Skripte verweigern den Dateiaustausch
bei laufender RPM-App und beenden keine Prozesse. Benutzerprofile, Rechnungen,
Belege und Sicherungen liegen außerhalb des Pakets und bleiben bei Entfernung
erhalten. Die bestehende Profil- und Datenbankinitialisierung wird weiterverwendet.
AppImage und RPM teilen das technische Benutzerprofil: vor einem Wechsel die
App schließen und die vorhandene Sicherungsfunktion verwenden.

## Getrennte Veröffentlichung

`rpm-v<VERSION>-<REVISION>` bezeichnet einen RPM-Release, beispielsweise
`rpm-v0.1.1-1`. Version und Revision müssen zum Build passen. Die Revision ist eine
positive Ganzzahl; eine neue Revision kann Paketierungsänderungen derselben
Appversion veröffentlichen. Tags zeigen exakt auf saubere, vollständig ausgecheckte
Commits aus `Entwicklung-App`. Alle fünf Desktop-CI-Jobs müssen für genau den
Commit erfolgreich sein. `main` wird dafür nicht verändert.

RPM-Dateien, Build-Nachweis, Prüfsummen und `repository-metadata.tar.gz` liegen
in einem eigenen GitHub-Release. Die sechs Assets der Desktop-AppImage-/NSIS-
Releases bleiben ein unabhängiger Updatekanal. Das RPM verwendet einen eigenen
OpenPGP-Schlüssel (RSA mindestens 3072 Bit), keinen Desktop-Ed25519-Schlüssel.

GitHub Pages liefert nur die kleinen Repository-Dateien unter `/rpm/`; die
Metadaten verweisen auf die versionierten RPM-Assets im GitHub-Release. Alte
gehashte Metadaten bleiben für zwischengespeicherte DNF-Abfragen erhalten. Der
Workflow übernimmt sie nur aus zuvor signierten, geprüften Archiven.

## Einmalige Einrichtung durch den Repository-Verantwortlichen

Die produktive Veröffentlichung bleibt durch `enabled: false` gesperrt, bis
folgende Einrichtung ausdrücklich freigegeben und durchgeführt wurde:

1. Einen separaten produktiven RSA-Signierschlüssel erzeugen und geschützt sichern.
   Öffentlichen ASCII-Schlüssel unter `build/linux/rpm/RPM-GPG-KEY-ttc.asc`
   committen. Fingerprint und SHA-256 in `rpm-repository-policy.json` festlegen und
   erst dann `enabled` aktivieren. Den privaten Schlüssel ausschließlich als
   Environment-Secret `rpm-repository/RPM_REPOSITORY_PRIVATE_KEY` hinterlegen.
2. GitHub Pages mit Buildtyp `workflow` und HTTPS für die festgelegte Projekt-URL
   aktivieren. Die Environments `rpm-repository` und `github-pages` benötigen
   vorgeschriebene Reviewer, deaktivierten Administrator-Bypass und ausschließlich
   die Tag-Deploymentregel `rpm-v*`.
3. Ein aktives Tag-Ruleset muss Erstellen, Ändern und Löschen von `rpm-v*`
   einschränken. Den bestehenden erforderlichen Branchprüfungen den Check
   `Fedora RPM repository acceptance` hinzufügen. Das vorhandene ausschließlich
   lesend verwendete `DESKTOP_POLICY_READ_TOKEN` dient auch den RPM-Gate-Prüfungen
   für geschützte Repository-Einstellungen.
4. Änderungen über PR nach `Entwicklung-App` übernehmen, die fünf CI-Jobs auf dem
   exakten Mergecommit abwarten und den ersten RPM-Tag freigeben/erstellen.

Der Workflow `rpm-release.yml` baut aus den aktuellen Quellen mit derselben
Linux-Stagingfunktion wie das AppImage. Der geschützte Signierjob prüft zusätzlich
Build-Prüfsummen und RPM-Header einschließlich Quellcommit, importiert den privaten
Schlüssel in einen temporären Schlüsselbund, verifiziert dessen Fingerprint,
signiert Paket und Metadaten und lädt alle Assets erneut zum Vergleich herunter.
Er veröffentlicht erst abschließend. Fehler lassen einen Entwurf zur Prüfung
zurück; der Workflow überschreibt oder löscht keine Releases.

Ein zweiter geschützter Job prüft das signierte Archiv, den festgelegten Schlüssel
und die aus dem Quellcode erzeugten Installationshinweise, bevor er Pages ausrollt.
Er benötigt keinen privaten Signierschlüssel. Die beiden Freigaben bleiben bestehen.
Bei einem Pages-Fehler nach erfolgreicher RPM-Veröffentlichung nur den fehlgeschlagenen
Pages-Job innerhalb der siebentägigen Artefaktaufbewahrung erneut ausführen;
keinen Ersatz-Release für denselben Tag erstellen. Bis zum Pages-Erfolg bleibt
das bisherige Repository aktiv. Nach Ablauf der Aufbewahrung ist eine geprüfte
Wiederherstellung aus dem veröffentlichten Metadatenarchiv erforderlich.

## Lokale Entwicklung und Prüfung

```sh
npm ci --no-audit --no-fund
python scripts/prepare_linux_runtime.py dist/python-linux
podman build -t ttc-rpm-tools -f build/linux/rpm/Containerfile build/linux/rpm
podman run --rm --security-opt label=disable -v "$PWD:/work:rw" -w /work \
  ttc-rpm-tools node scripts/rpm_package.cjs dist/rpm
```

Ohne produktiven Tag entsteht eine Entwicklungsversion `0.<REVISION>.dev`.
`TTC_RPM_RELEASE_NUMBER` legt die Revision fest. Die Fedora-CI baut zwei solche
Versionen und prüft echte DNF-Installation, verweigertes Update bei laufender App,
Update nach deren Ende, Datenerhalt und Entfernung. Unsignierte Pakete und
manipulierte Metadaten müssen abgelehnt werden. Ein zusätzlicher kleiner nativer
Prüflauf kontrolliert den Signier- und Pages-Archivpfad mit einem Wegwerfschlüssel.
Diese Prüfungen laufen ausschließlich im Container und verändern die RPM-Datenbank
des Laptops nicht. Die Containerbasis ist per Digest festgelegt; bei deren
Aktualisierung wird die native Abnahme erneut ausgeführt.
