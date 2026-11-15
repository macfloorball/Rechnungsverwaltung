# Vorbereitung der öffentlichen Repository-Freigabe

Stand: 15.11.2026. Der Eigentümer sieht eine spätere öffentliche Bereitstellung
des gesamten Repositorys grundsätzlich vor. Die tatsächliche Änderung ist noch
nicht freigegeben. Repository und Release-Policy bleiben privat, produktive
Updates deaktiviert. Ein Release-Umbau nur wegen GitHub Pro ist nicht vorgesehen.

## Geprüfter Umfang

Ausgangscommit des Update-Branches:
`14d583a7aaf50f1b023ce3c029b7e7cb39d1332d`.
`main` steht unverändert auf `d8106d30c39bf72c2d1ec0becb68a84dffcf8fc6`.
Repository-ID: `1447003404`, Name: `macfloorball/Rechnungsverwaltung`.
Die GitHub-API bestätigte die private Sichtbarkeit.

`origin` und Tags wurden aktualisiert, zusätzlich die 21 PR-Kopfstände in einen
ausschließlich lokalen Audit-Refbereich abgerufen. Es erfolgten keine Pushes,
Merges oder Änderungen an Remote-Refs. Die vollständige erreichbare Historie
einschließlich dieser PR-Stände enthält **379 Commits und 714 unterschiedliche
Datei-Blobs** mit 11.213.388 Bytes. Aktuell sind 168 Dateien versioniert.
Nicht erreichbare Serverobjekte, unbekannte externe Kopien und lokale Reflogs
sind dadurch nicht vollständig erfasst.

Scanner: **Gitleaks 8.30.1**, offizielles Linux-x64-Archiv, SHA-256 gegen die
veröffentlichte Prüfsummenliste geprüft:
`551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`.
Die Scans liefen lokal; kein Quellcode wurde an einen Scandienst übertragen.

| Bereich | Ergebnis |
| --- | --- |
| Git-Historie | Gitleaks ohne Befund, 235 vom Scanner ausgewertete Commits mit Diffs. Zusätzlich alle 714 Blobs unabhängig als Dateien ohne Befund gescannt. |
| Aktueller Stand | Separater `git archive HEAD`-Export ohne Secret-Befund. Ignorierte lokale Laufzeiten und Benutzerdaten wurden nicht aufgenommen. |
| Historische Dateitypen | Keine versionierten Datenbanken, Rechnungs-PDFs, Backuparchive, `.env`-Dateien oder privaten Schlüsseldateien gefunden. Zwei binäre Versionen: App-Icon als PNG und ICO; SVG ebenfalls versioniert. |
| Weitere Textprüfung | E-Mail-Kandidaten sind Test-/Beispieladressen, bewusst ungültige Authentifizierungs-URLs, ein Paket-Maintainerkontakt und ein Regex-Fehlalarm. IBAN-Literale liegen in Tests, Benutzerpfade sind Beispiele. Das bestätigt keine tatsächliche Kontoinhaberschaft der Beispiel-IBANs. |
| Commit-Metadaten | Eine persönliche E-Mail-Identität neben einer GitHub-Systemadresse. Die persönliche Adresse wird hier nicht ausgeschrieben. Der Eigentümer hat am 15.11.2026 ausdrücklich bestätigt, dass die bestehende Historie mit dieser Adresse später öffentlich bleiben darf. |
| Issues/PRs | 23 Einträge: zwei Issues und 21 PRs. Vollständige Titel/Beschreibungen zusätzlich lokal ohne Secret-Befund gescannt; keine Issue- oder Inline-PR-Kommentare vorhanden. Reviewtexte, Commit-Kommentare und ein möglicher separater Wiki-Bestand sind nicht vollständig geprüft. |
| Releases/Actions | Keine Releases oder Entwürfe. Ein Actions-Lauf mit zwei ausgeführten Jobs, beide verfügbaren Logs lokal ohne Secret-Befund gescannt; zwei Buildjobs übersprungen und keine Artefakte für diesen Lauf. Normale Konto-/Commit-/Runnermetadaten in Logs würden ebenfalls öffentlich. |
| Lizenz | Der Eigentümer hat am 15.11.2026 Variante 3 gewählt: spätere öffentliche Einsicht, vorerst keine allgemeine Lizenz zur Weiterverwendung des eigenen Projektcodes. Der Hinweis steht in der README; Drittanbieterlizenzen bleiben maßgeblich. |

Ein Scan ohne Befund beweist nicht die Abwesenheit beliebiger vertraulicher
Inhalte. Neue Commits, Kommentare, Logs und Artefakte erfordern vor einer
tatsächlichen Veröffentlichung eine erneute Prüfung.

## Vor der Freigabe noch klären

1. **Commit-E-Mail – geklärt:** Der Eigentümer hat am 15.11.2026 die spätere
   öffentliche Sichtbarkeit der bestehenden Historie einschließlich seiner
   Hochschul-E-Mail ausdrücklich akzeptiert. Eine Bereinigung ist dafür nicht
   erforderlich. Diese Entscheidung erlaubt noch keine Sichtbarkeitsänderung
   des Repositorys. Eine zukünftige `noreply`-Adresse würde alte Commits nicht ändern.
2. **Lizenz – geklärt:** Der Eigentümer hat am 15.11.2026 die spätere öffentliche
   Einsicht ohne allgemeine Weiterverwendungslizenz für den eigenen Projektcode
   gewählt. Eine Open-Source-Lizenz wird vorerst nicht hinzugefügt. Gesetzliche
   Befugnisse, GitHub-Nutzungsbedingungen und Drittanbieterlizenzen bleiben
   unberührt. Diese Entscheidung ist keine Freigabe der Sichtbarkeitsänderung.
3. **GitHub-Inhalte:** Review-/Commit-Kommentare, Wiki und neue Uploads/Logs/
   Artefakte unmittelbar vor der Umstellung abschließend prüfen. Ein Löschen im
   aktuellen Quellstand entfernt alte Inhalte nicht aus der Historie.
4. **Schutz:** `Entwicklung-App` ist laut aktueller API-Abfrage ungeschützt,
   die Repository-Rulesetliste leer. Branchschutz, erforderliche CI-Checks und
   Desktop-Tag-Ruleset nach [Release-Einrichtung](Desktop_Release_Einrichtung.md)
   einrichten. Diese Prüfung hat keine Einstellungen geändert.
5. **Getrennter CI-Blocker:** Der vorhandene
   [Desktop-CI-Lauf](https://github.com/macfloorball/Rechnungsverwaltung/actions/runs/43654985422)
   für `b8fe7c3` bestand unter Ubuntu, scheiterte unter Windows jedoch bereits
   beim Bereitstellen von Python 3.13.18: Diese Version war dort nicht verfügbar.
   Beide Paketbuilds wurden übersprungen. In einer nachfolgenden Korrektur wurde
   der CI-Pin auf das laut offiziellem Actions-Manifest unter Windows x64 und
   Ubuntu 24.04 x64 verfügbare Python 3.13.17 vereinheitlicht; siehe
   [Desktop-CI](Desktop_CI.md). Die eingebetteten Laufzeiten bleiben davon
   getrennt. Ein neuer erfolgreicher vollständiger Remote-Lauf ist weiterhin
   nachzuweisen.

Quellen: [GitHub: Commit-E-Mail](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address),
[Lizenzierung](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).

## Spätere Umstellung und Update-Vertrauen

Dasselbe öffentliche Repository kann den vorbereiteten Releaseprozess mit
Pflichtfreigabe verwenden. Die Umstellung möglichst **vor der ersten tatsächlich
ausgelieferten stabilen Updateversion** durchführen; aktuell existieren keine
GitHub-Releases. Nach Klärung der offenen Punkte:

1. Ausdrückliche Sichtbarkeitsfreigabe für genau dieses Repository und die
   überprüfte Historie einholen. Erst dann unter **Settings → General → Danger
   Zone → Change visibility → Public** umstellen. Nicht nur ein Branch oder
   Installer wird öffentlich; spätere private Sichtbarkeit holt vorhandene
   Forks/Kopien nicht zuverlässig zurück.
2. Schutzregeln danach erneut prüfen. GitHub deaktiviert bei dieser Änderung
   Push-Rulesets; deren Funktion von den erforderlichen Branch-/Tag-Regeln
   unterscheiden. Environment `desktop-release` mit Pflichtfreigabe und genau
   der Tagregel `desktop-v*` einrichten. Signierrechner weiterhin technisch gegen
   nicht vertrauenswürdige Workflows isolieren.
3. In einer eigenen geprüften Änderung `visibility` in
   `desktop-release-policy.json` von `private` auf `public` umstellen.
   Repository-ID und Name beibehalten. `enabled: false` bleibt bestehen, bis
   echte Schlüssel, Windows-Code-Signierung und sämtliche Freigaben geprüft sind.
   Die Sichtbarkeitsänderung selbst aktiviert keine produktiven Updates.
4. Änderung über Desktop-PR/CI integrieren; `main` bleibt unverändert. Erst mit
   vollständiger erfolgreicher CI und eingerichteten Signaturen einen stabilen
   öffentlichen Build ausdrücklich freigeben. Die erste Installation benötigt
   ein unabhängig authentifiziertes Paket.
5. Der öffentliche stabile Build enthält das passende öffentliche Update-
   Vertrauen. Erkennung/Download benötigen dann keinen persönlichen Lesetoken.
   Signatur, Ablaufzeit, Repository-/Paketbindung und Downgrade-Sperre bleiben.
6. Bereits ausgelieferte private stabile Builds würden die geänderte Sichtbarkeit
   absichtlich ablehnen: Ein GitHub-/Feedwechsel migriert deren eingebettetes
   Vertrauen nicht. Falls bis dahin solche Builds verteilt werden, einen
   gesonderten verifizierten Übergangs-/manuellen Installationsweg planen.

Unmittelbar vor der tatsächlichen Freigabe den Scan mit dem geprüften Werkzeug
wiederholen:

```sh
gitleaks git . --log-opts='--all --full-history --root -m' --ignore-gitleaks-allow --redact=100 --no-banner --no-color
```

Zusätzlich aktuellen Git-Export, alle erreichbaren Datei-Blobs, Commit-Metadaten
und GitHub-Inhalte wie oben prüfen. Private Rohberichte außerhalb des Repositorys
aufbewahren; keine möglicherweise vertraulichen Fundstellen committen.
Scanner und heruntergeladene Dateien blieben hier unter `/tmp`.

Quellen: [Sichtbarkeitsänderung und Folgen](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility),
[Deployment-Freigaben](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
[Gitleaks 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1).
