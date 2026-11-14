# Sichere Desktop-Releases: Einrichtung und Freigabe

Stand: 14.11.2026, Umsetzungsschritt 4. Die Implementierung ist **vorbereitet,
aber für produktive Releases gesperrt**. In `desktop-release-policy.json` stehen
`enabled: false` und nicht eingerichtete Signaturfelder auf `null`. Das bedeutet
Abbruch vor Veröffentlichung, keine Ersatzschlüssel oder umgehbare Signaturprüfung.

## Entscheidung: dasselbe private Repository

Auf ausdrücklichen Wunsch bleiben Releases in `macfloorball/Rechnungsverwaltung`,
Repository-ID **1447003404**, derzeit privat. Ein separates öffentliches
Binärrepository wurde bewertet und verworfen. Für diese Variante sind weder
eine zusätzliche GitHub App noch ein fremdes Publish-Repository notwendig.

Private Releases und ihre Assets erfordern für Endnutzer eigenen GitHub-Zugriff
auf dieses Repository. Ein Lesetoken bzw. eine eigene GitHub-Anmeldung muss später
im Update-Dienst gesondert eingerichtet werden; es gibt kein gemeinsames App-Token.
Ohne Anmeldung funktionieren die lokale Anwendung und der manuelle Updateweg
weiter. Die Client-Authentifizierung gehört zu den folgenden Update-Schritten,
sie wird durch diesen Release-Workflow noch nicht implementiert.

Eine spätere Umstellung des gesamten Repositorys auf öffentlich macht auch
Quellcode, Git-Historie und automatisch von GitHub angebotene Quellarchive
öffentlich. Der Workflow ändert **niemals** die Repository-Sichtbarkeit. Ändert
sie sich außerhalb der konfigurierten Freigabe, bricht die Release-Prüfung ab.
Eine bewusste spätere Umstellung benötigt eine geprüfte Anpassung von
`visibility` in der Richtlinie. Bereits ausgelieferter Electron-/Python-Code
ist aus Paketen grundsätzlich extrahierbar; unter der privaten Verteilung haben
ohnehin nur berechtigte Repository-Nutzer Zugriff auf die Downloads.

## Vor der Aktivierung manuell einrichten

### 1. Branch, Tags und vollständige CI schützen

In GitHub unter **Settings → Rules → Rulesets**:

- `Entwicklung-App` schützen: Änderungen über freigegebene Pull Requests,
  erfolgreiche erforderliche Checks. Mindestens die vier Checks aus
  [Desktop_CI.md](Desktop_CI.md) verlangen.
- Ein aktives Tag-Ruleset für **`refs/tags/desktop-v*`** einrichten, ohne
  Ausnahmen im Ref-Muster. Regeln **Restrict creations**, **Restrict updates**
  und **Restrict deletions** aktivieren. Nur festgelegte Release-Verantwortliche
  dürfen die notwendigen Bypass-Rechte besitzen.
- Den bestehenden Feature-Branch nicht automatisch integrieren. Erst der
  freigegebene Stand in `Entwicklung-App` mit vollständig erfolgreicher CI ist
  eine zulässige Tagbasis. Tags können auf einem älteren Vorfahren liegen,
  aber nur mit nachgewiesener erfolgreicher CI für genau diesen Commit.

Der Release-Prüfer fragt Repository-ID/Sichtbarkeit, Branchschutz, Tagziel,
Abstammung und Tag-Ruleset über die GitHub-API ab. Er akzeptiert ausschließlich
erfolgreiche `desktop-ci.yml`-Push-Läufe auf `Entwicklung-App` für den identischen
Quellcommit, einschließlich beider Tests und beider Plattformbuilds. Fehlende,
übersprungene oder nicht lesbare Nachweise sperren den Release.

### 2. Geschützte Release-Environment einrichten

Unter **Settings → Environments** die Environment **`desktop-release`** anlegen:

- Mindestens einen verantwortlichen **Required reviewer** festlegen.
- Die gewünschten Regeln für Selbstfreigabe festlegen; Administrator-Bypass
  deaktivieren. Die Freigabe ist eine echte Release-Entscheidung und kein Ersatz
  für erfolgreiche Tests oder gültige Signaturen.
- Deployment-Regeln auf **Selected branches and tags** setzen und ausschließlich
  einen **Tag**-Eintrag **`desktop-v*`** zulassen. Keine Branch- oder `*`-Freigabe.
- GitHub muss diese Schutzregeln im verwendeten Tarif für **private** Repositories
  unterstützen. Diese Verfügbarkeit ist nicht nachgewiesen. Ist sie nicht
  vorhanden, bleibt der Workflow gesperrt; eine andere Freigabearchitektur muss
  ausdrücklich festgelegt werden, statt Schutzregeln wegzulassen.

Die API-Prüfung bestätigt erforderliche Reviewer und die ausschließliche Tagregel;
die tatsächlichen Jobfreigaben erzwingt GitHub. Es gibt zwei geschützte Jobs:
Zugriff auf den Windows-Signierrechner und anschließend die eigentliche
Veröffentlichung nach Vorliegen beider Pakete.

Wenn das eingebaute `GITHUB_TOKEN` die Schutzkonfiguration nicht lesen darf:
einen **fine-grained Lesetoken ausschließlich für dieses Repository** mit
**Contents: Read**, **Actions: Read**, **Environments: Read** erstellen und unter
**Settings → Secrets and variables → Actions → Repository secrets** als
**`DESKTOP_POLICY_READ_TOKEN`** hinterlegen. Er ist optional, aber bei HTTP 403
kein Anlass, Prüfungen zu umgehen. Kein Schreibrecht und keine Ausgabe des
Tokens in Logs oder in der Anwendung. Die konkrete API-Berechtigung und
Tarifunterstützung müssen vor Aktivierung tatsächlich geprüft werden.

### 3. Windows-Code-Signierung bereitstellen

Die vorbereitete Variante verwendet einen **dedizierten Windows-x64-
Signierrechner** mit:

- Aktuellem GitHub-Actions-Runner und Label **`desktop-release-signing`**,
  PowerShell **7**, Git und Microsoft Windows SDK mit x64-`signtool.exe`.
- Vertrauenswürdigem, gültigem Code-Signing-Zertifikat unter
  **`Cert:/CurrentUser/My` des Runner-Kontos**, mit zugänglichem privatem
  Schlüssel. Ein HSM-/Hardware-/Cloud-Schlüssel ist möglich, wenn dessen
  unterstützter Windows-Key-Provider den Zugriff über diesen Store ermöglicht.
  Für andere Cloud-Verfahren ist zuerst ein passender Adapter nötig.
- Passenden Root-/Zwischenzertifikaten, erreichbarer Sperrprüfung und einem vom
  Zertifikatsanbieter unterstützten **HTTPS-RFC3161-Zeitstempeldienst**.
- Erzwungener Isolation von untrusted Workflows: der Signierrechner bzw.
  Signierschlüssel darf **nicht** für PR-Code oder beliebige Repository-
  Workflows verfügbar sein. Ein Runner-Label allein ist keine Sicherheitsgrenze.
  Eine durchgesetzte Runnergruppen-/Workflowfreigabe oder entsprechend isolierte
  externe Signierinfrastruktur ist Voraussetzung. Kann das bestehende Konto
  dies nicht bereitstellen, den vorbereiteten Runner nicht mit Produktions-
  Schlüsseln betreiben; zuerst eine geeignete Signierlösung festlegen.

Store und Zertifikatsmetadaten lassen sich auf dem Signierrechner prüfen:

```powershell
Get-ChildItem Cert:/CurrentUser/My -CodeSigningCert |
  Select-Object Thumbprint, Subject, NotAfter, HasPrivateKey
```

Das tatsächlich freigegebene Zertifikat auswählen. Dessen SHA-1-Thumbprint
(nur Store-Auswahl, nicht Signaturalgorithmus), SHA-256-Zertifikatsfingerprint
und exakten Subject-DN in `desktop-release-policy.json` eintragen. SHA-256 erhält
man mit `GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256)`
am ausgewählten Zertifikat. Fingerprints kleingeschrieben eintragen.
`timestampUrl` muss der bestätigte HTTPS-Dienst sein.

App-EXE wird ausdrücklich **vor** der NSIS-Paketierung signiert, weil
`electron-builder` sie bei `prepackaged` überspringt. NSIS-Installer und
Uninstaller werden über die verpflichtende Signierkonfiguration erzeugt.
App und Installer müssen mit Windows SDK und Windows-Vertrauenskette gültig sein;
Herausgeber, Zertifikatsfingerprint, Zeitstempel und die tatsächlich signierte
ProductVersion werden geprüft. Kein
`forceCodeSigning: false` für stabile Builds, kein unsigned Fallback.

### 4. Ed25519-Update-Schlüssel einrichten

Ein echtes Ed25519-Schlüsselpaar auf einem kontrollierten Rechner **außerhalb
des Repositorys** erzeugen, sicher sichern und Zugriffsrechte einschränken.
Beispiel in einer administrierten POSIX-Umgebung mit OpenSSL:

```sh
umask 077
mkdir -m 700 /sicherer/schluesselordner
openssl genpkey -algorithm ED25519 -out /sicherer/schluesselordner/desktop-update-private.pem
openssl pkey -in /sicherer/schluesselordner/desktop-update-private.pem -pubout -out /sicherer/schluesselordner/desktop-update-public.pem
node scripts/release_policy.cjs --fingerprint /sicherer/schluesselordner/desktop-update-public.pem
```

Den Beispielpfad zuerst durch eine tatsächlich geschützte Ablage ersetzen. Unter
Windows entsprechend restriktive NTFS-ACLs und eine kontrollierte OpenSSL-
Installation verwenden. Es wurde in dieser Sitzung **kein Produktionsschlüssel
erzeugt**. Der Fingerprint-Helfer akzeptiert nur öffentliche SPKI-PEM-Schlüssel.

- **Öffentlichen** PEM-Inhalt und den ausgegebenen SHA-256-Fingerprint unter
  `publicKeyPem` und `keyId` in der Richtlinie eintragen und unabhängig prüfen.
- Privaten **PKCS8-PEM** ausschließlich als Environment-Secret
  **`DESKTOP_UPDATE_PRIVATE_KEY`** unter **`desktop-release`** hinterlegen,
  nicht als Repository-Secret und nicht im Chat oder in Programmdateien.
- Offline-Backup, Verantwortliche und Verfahren bei Verlust/Kompromittierung
  festlegen. Ein anderer Schlüssel aus dem Updatefeed darf die Vertrauenswurzel
  nicht selbst ersetzen; Rotation benötigt eine bereits vertrauenswürdig
  autorisierte Aktualisierung oder einen unabhängig verifizierten Installer.

Stabile Pakete enthalten nur Public-Key, Fingerprint, Repository-ID und
Windows-Zertifikatsidentität. Entwicklungsbuilds erhalten
`desktopUpdateTrust: { enabled: false }`. Die Richtlinie selbst, private PEMs,
Build-/Signierwerkzeuge und GitHub-Tokens werden nicht in die App kopiert.

### 5. Richtlinie freigeben und Release auslösen

Erst nach realer Prüfung aller Voraussetzungen `enabled` auf `true` ändern,
die Änderung prüfen/committen und über einen freigegebenen PR nach
`Entwicklung-App` bringen. Die Anwendungsversionsnummer muss zum gewünschten
Tag passen. Die erfolgreiche vollständige CI für diesen Commit abwarten.

Ein Release-Verantwortlicher erstellt und pusht dann einen Tag wie
**`desktop-vX.Y.Z`** auf genau diesen Commit. Das ist eine bewusste Release-
Handlung; diese Sitzung erstellt oder pusht keinen solchen Tag. Normale Merges
starten ausschließlich die gewöhnliche Desktop-CI.

## Ablauf und veröffentlichte Dateien

1. `release_gate.cjs`: alle Voraussetzungen read-only prüfen; kein Secret für
   Update-Signierung und kein Schreibrecht im Gate-Job.
2. Linux-AppImage und nativen signierten Windows-Installer aus demselben Commit
   bauen. Beide Pakete prüfen, darunter ihre eingebetteten Laufzeiten.
3. Ausschließlich je drei freigegebene Paket-/Metadatendateien als interne
   Actions-Artefakte im privaten Repository bereitstellen, Aufbewahrung ein Tag.
4. Nach Erfolg beider Builds den geschützten Publishjob freigeben. Er prüft die
   Binärpakete, Versionen, Hashes und Windows-Authenticode erneut, bevor er einen
   neuen GitHub-Release-Entwurf anlegt. Existiert bereits ein Release oder Entwurf
   für den Tag, bricht er ab; kein Ersetzen, Löschen oder automatischer Retry.
5. Beide Pakete unter festen ASCII-Namen hochladen und die hochgeladenen Bytes
   erneut herunterladen und hashen. GitHub-API-Token folgen niemals einem
   Downloadredirect auf den Asset-CDN-Host.
6. Exakte Manifestbytes mit Ed25519 signieren, selbst verifizieren und zusammen
   mit Signatur, Release Notes und Prüfsummen hochladen. Alle Dateien erneut
   prüfen; die vollständige Assetliste darf keine zusätzlichen Dateien enthalten.
7. Branch/Tag/Schutz/CI erneut prüfen, neuere Releases ausschließen, **zuletzt**
   den vollständigen Entwurf stabil setzen. `make_latest: false` schützt die
   gemeinsame Web-/Desktop-Repository-Nutzung vor unbeabsichtigtem Umsortieren
   der generischen Latest-Freigabe. Clients müssen ausschließlich stabile
   `desktop-v*`-Releases nach Version auswählen, nicht blind `/releases/latest`.

Die sechs Release-Assets sind:

- `ttc-rechnungsverwaltung-X.Y.Z-windows-x64-setup.exe`
- `ttc-rechnungsverwaltung-X.Y.Z-linux-x64.AppImage`
- `desktop-update.json`
- `desktop-update.json.sig` (64 Byte Ed25519-Signatur)
- `RELEASE_NOTES.md`
- `SHA256SUMS`

Manifestformat 1 bindet App-ID, Version, Tag, Quellcommit, Repository-ID und
Sichtbarkeit, Schlüssel-ID, Veröffentlichungs-/Ablaufzeit, Release Notes sowie
Plattform, Größe, SHA-256 und tatsächliche GitHub-Asset-ID beider Pakete.
Die API-Asset-URL ist für private Downloads mit eigenem Nutzerzugriff geeignet.
Die Signatur gilt für die exakten UTF-8-Bytes, nicht für neu formatiertes JSON.
SHA-256-Dateien sind keine eigenständige Authentizitätsprüfung.

Manifestgültigkeit ist initial 90 Tage, maximal 365 Tage konfigurierbar.
Abgelaufene Manifeste dürfen später keine automatische Installation erlauben.
Bei längerer Releasepause ist ein neuer freigegebener Release bzw. ein manuell
verifizierter Installer notwendig; kein stilles Umgehen der Gültigkeit.

Nur der letzte Job erhält das eingebaute `GITHUB_TOKEN` mit `contents: write`.
Andere Jobs haben Leserechte; Checkout-Zugangsdaten werden nicht persistiert.
Es gibt weder Repository-Sichtbarkeitsänderungen noch Commits/Merges durch den
Releasecode. Actions sind auf Commit-SHAs, Werkzeuge und Pakete auf feste
Versionen fixiert; Byteidentität und vollständige Hardware-/Lieferketten-
Absicherung werden dadurch nicht garantiert.

## Abbruch und Wiederanlauf

Vor der letzten Mutation bleibt jeder Fehler ein nicht veröffentlichter Entwurf.
Unklare Netzantwort nach dem finalen Publish-Aufruf erfordert eine manuelle
Statusprüfung; nicht automatisch erneut veröffentlichen. Ein vorhandener Entwurf
muss vom Release-Verantwortlichen geprüft und bewusst bereinigt werden, bevor
ein neuer Lauf erlaubt wird. Für veröffentlichte Fehler eine höhere Version
freigeben; keine Ersetzung bereits ausgelieferter Pakete und keine Downgrades.
Die separate Wiederherstellung von Datenbanken bleibt der Offline-Sicherung
vorbehalten, sie wird durch diesen Workflow nicht verändert.

## Nachweisgrenzen dieses Schritts

Offline-Tests verwenden frisch erzeugte **Testschlüssel** und simulierte
GitHub-Antworten. Sie prüfen echte Ed25519-Signaturen, Manipulationserkennung,
fehlende Plattformen, Versions-/Tag-/CI-Sperren, fehlende Schutzregeln, tokenfreie
CDN-Redirects, Uploadfehler und den Ausschluss unvollständiger stabiler Releases.
Die Windows-Signierkonfiguration wird gegen das installierte Builder-Schema
geprüft. Das ist kein Nachweis tatsächlich erfolgter Windows-Code-Signierung.

Tatsächliche lokale Ergebnisse dieses Schritts:

- Node 24.22.3: **96 JavaScript-Tests bestanden**, 1 optionale NSIS-
  Hookkompilation übersprungen.
- Python 3.13.18 mit CI-Pins: **393 Tests bestanden**, 7 optionale Fälle
  übersprungen (GUI und paketierte Laufzeit ohne explizite Auswahl).
- Linux-Entwicklungs-AppImage unter Fedora 45 erneut gebaut, entpackt und geprüft;
  enthaltene Update-Vertrauenskonfiguration bleibt deaktiviert. **13** gesonderte
  Laufzeit-/Archivprüfungen gegen dieses Paket bestanden.
- Beide Workflows mit actionlint 1.7.12 geprüft; alle JavaScript-Dateien bestehen
  die Syntaxprüfung. Custom-Runner-Label ist in `.github/actionlint.yaml` deklariert.
- Reale lokale Aufrufe von Gate und Publisher ohne Secrets enden mit Exitcode 1
  und erklärter Release-Sperre, bevor ein GitHub-Schreibzugriff erfolgt.

Nicht vorhanden/nicht nachgewiesen: Produktionsschlüssel, Code-Signing-
Zertifikat/Signierrechner, geschützte GitHub-Environment und Rulesets, ihre
Tarif-/API-Verfügbarkeit sowie ein realer signierter Release-Lauf. Es wurden
keine GitHub-Einstellungen geändert, keine Secrets gelesen/gesetzt und keine
Release-Assets oder Produktionsreleases veröffentlicht. Die vollständige
Update-Definition-of-Done ist weiterhin offen.

Primärquellen: [GitHub Environments](https://docs.github.com/en/rest/deployments/environments),
[Release-API](https://docs.github.com/en/rest/releases/releases),
[private Release-Assets](https://docs.github.com/en/rest/releases/assets),
[electron-builder Windows-Code-Signierung](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/).
