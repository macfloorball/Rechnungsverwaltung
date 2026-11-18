# Gemeinsame Desktop-Updates: Architektur

Stand 18.11.2026. Implementierung vorbereitet; produktive Updates bleiben gesperrt.
Native Gesamt-Abnahme ist offen, siehe [Abnahme](Desktop_Update_Abnahme.md) und
[aktuelles Protokoll](Desktop_Update_Stand_2026-11-18.md).

## Quelle und Vertrauensanker

Ein GitHub-Release in `macfloorball/Rechnungsverwaltung`, Repository-ID
1447003404, Sichtbarkeit `public`, enthält dieselbe stabile Version für Windows
x64 (NSIS) und Linux x64 (AppImage). DEB/RPM werden nicht angeboten.
Die Clientkonfiguration stammt ausschließlich aus `desktopUpdateTrust` im
paketierten `package.json`; Entwicklungsbuilds besitzen keinen Update-Vertrauensanker.
Öffentliche Downloads benötigen keinen persönlichen GitHub-Token. Bestehende
Unterstützung für private Quellen und sichere Tokenablage bleibt erhalten.

Ed25519 autorisiert auf beiden Plattformen zwingend die exakten Manifestbytes.
Der öffentliche SPKI-Schlüssel und sein SHA-256-Fingerprint werden eingebettet.
Das Manifest bindet App-ID, Version, Tag, Quellcommit, Repository-ID/Sichtbarkeit,
Schlüssel-ID, Veröffentlichungs- und Ablaufzeit und beide Plattformpakete mit
Format, x64-Architektur, Dateiname, Asset-ID/URL, Größe und SHA-256. Ein fremder
Schlüssel aus dem Feed kann das eingebettete Vertrauen nicht ersetzen.
Ungültige Signaturen, abgelaufene Metadaten, falsche Quellen/Plattformen und
Downgrades werden abgelehnt. Assetredirects geben GitHub-Zugangsdaten nicht weiter.

## Zwei getrennte Windows-Vertrauensmodi

`windows.mode` wird aus der lokalen Release-Policy in den Installer/Client
übernommen. Die Manifestquittung darf diesen Modus nicht bestimmen:

| Modus | Paketierung, Veröffentlichung und nativer Helfer |
| --- | --- |
| `ed25519-only` | Ausdrücklich unsignierte EXE mit `NotSigned`, richtiger ProductVersion, ohne Publisher/Zertifikat und ohne Zeitstempel. Ed25519 bleibt zwingend. Kein Fallback von fehlerhaften Windows-Signaturen. |
| `authenticode-required` | Zusätzlich `Valid`, exakter Zertifikatsfingerprint/Publisher, Zeitstempel und ProductVersion für Installer und App-EXE. Dedizierte Signierinfrastruktur bleibt unterstützt. |

Ein fehlender Modus bedeutet aus Kompatibilitätsgründen immer
`authenticode-required`. Unbekannte Werte sind Fehler. Im Modus ohne Authenticode
sind widersprüchliche Zertifikatsangaben verboten. Der Helfer erhält den Modus
vom laufenden verifizierenden Client über stdin; nach Installation prüft er
Version/Commit, vollständige Programmdateien, registrierte Version und den
unveränderten Vertrauensmodus samt Repository und Schlüssel-ID des Zielclients.
Moduswechsel, Schlüsselwechsel und die frühere private Sichtbarkeit werden
nicht still durch einen Feed autorisiert: vollständige unabhängig geprüfte
manuelle Erstinstallation vorsehen. Bestehende strenge Clients akzeptieren
keine unsignierten Updates.

## Ablauf und Datenerhalt

Main verwaltet Erkennung, verifizierten Download und Installationsfähigkeit;
Renderer bekommt keine Schlüssel oder freie Installationspfade. Download und
Installationsbestätigung sind getrennte Nutzeraktionen. Vor Übergabe werden
Manifest, Kandidat, Version und Ablauf erneut geprüft und aktive Arbeiten
abgewartet. Der Backend-Shutdown für Updates darf keine Schreiboperationen
gewaltsam beenden. Bei Fehlern erfolgt keine Installationsübergabe.

Windows: statischer PowerShell-Helfer, Kontext nur über stdin; Pfad-/ACL-Prüfung,
Dateisperre, erneute Größe/Hash/Windows-Modusprüfung, READY/COMMIT/LAUNCH-Handschlag,
Elternprozessende und sichtbarer NSIS-Installer als derselbe Benutzer. Erst nach
vollständiger Installationsprüfung startet die neue App. Journale melden
unbestätigte/fehlgeschlagene Installationen. NSIS-Dateiersatz ist nicht atomar;
bei Abbruch kann ein vollständiger gleicher/höherer Installer nötig sein.

Linux: nur echtes Type-2-x64-AppImage über FUSE am benutzereigenen, schreibbaren,
lokalen Ziel ohne Symlinks/fremde Schreibrechte. Ein unabhängiger verifizierter
Python-Helfer überlebt den alten Mount, prüft Identität, Hash und Sperren und
ersetzt atomar mit Ausführungsrechten. Ungeeignete Orte führen zum manuellen
Updateweg ohne erhöhte Rechte. Extraktionsbetrieb ist keine FUSE-Abnahme.

DB, PDFs und Einstellungen liegen außerhalb der Programmdateien. Profilidentität
und eigene Dokumentenpfade bleiben bestehen. Kein automatisches Datenbank-Rollback
oder Rücktausch auf eine ältere Anwendung; Wiederherstellung nur in ein neues
Profil über den bestehenden Offlineweg. Tests verwenden ausschließlich temporäre
Profile und flüchtige, getrennte Testschlüssel.

## Release-Barrieren

Nur bewusster `desktop-v*`-Tag-Push startet den Releaseworkflow. Gate prüft
Policy, Repository, Tagziel/Abstammung von `Entwicklung-App`, Branch-/Tagschutz,
manuelles Release-Environment und erfolgreiche vollständige native CI für genau
den Commit. Beide Builds checken `github.sha` aus. Der geprüfte Windows-Modus
bestimmt den Runner: `windows-2025` oder dedizierter Signierrechner.
Nur nach beiden erfolgreichen Builds erhält der geschützte Publishjob den
Ed25519-Schlüssel. Vollständige Pakete/Metadaten, native Windows-Quittung und
Uploadbytes werden geprüft; das signierte Manifest folgt, Veröffentlichung ist
die letzte Mutation. Normale Merges veröffentlichen nichts.

`enabled: false` und fehlende Produktionsschlüssel bleiben bis zur dokumentierten
nativen Abnahme und ausdrücklichen Freigabe bestehen. Schlüsselerzeugung und
GitHub-Einrichtung: [Release-Einrichtung](Desktop_Release_Einrichtung.md).
Offene Lizenzpflichten: [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md).
