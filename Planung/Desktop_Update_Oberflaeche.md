# Desktop-Update-Oberfläche

Stand: 14.11.2026, Umsetzungsschritt 6. Aufbauend auf der
[Update-Erkennung](Desktop_Update_Erkennung.md) gibt es einen Dialog im bestehenden
Design und einen Desktop-Abschnitt für manuelle Prüfungen und private Zugänge.
Der sichere [Paketdownload aus Schritt 7](Desktop_Update_Download.md) erweitert
inzwischen die unten dokumentierte ursprüngliche Oberfläche.
Der produktive Release-Workflow bleibt gesperrt, bis die dokumentierte
[Vertrauensinfrastruktur](Desktop_Release_Einrichtung.md) eingerichtet ist.

## Bedienung und Grenzen dieses Schritts

- Der Dialog nennt installierte und neue Version, zeigt signierte Release Notes
  auf Wunsch und bietet „Jetzt aktualisieren“ und „Später“.
- „Später“ und Escape schließen den Dialog. Main merkt angezeigte und verschobene
  Versionen für die gesamte App-Sitzung, einschließlich Renderer-Neuladen. Ein
  manuelles erneutes Öffnen bleibt möglich. Eine neue Version darf erneut erscheinen.
- Automatische Dialoge warten auf das Ende anderer Dialoge und mit `aria-busy`
  markierter Arbeit; bestehende Eingaben bleiben bestehen.
- Manuelle Prüfung, deaktivierte Entwicklungsbuilds, fehlende Einrichtung,
  Netzwerk-/Verifikationsfehler und notwendiger GitHub-Zugang sind sichtbar.
- Der Fortschrittsbereich verarbeitet empfangene/gesamte Bytes aus dem Main-Status.
  Ohne gültige Gesamtgröße ist er unbestimmt. Es gibt keinen simulierten Fortschritt.
  **Der echte Paketdownload folgt in Schritt 7.** Main liefert deshalb derzeit
  immer `canDownload: false`; „Jetzt aktualisieren“ ist deaktiviert. Auch direkte
  IPC-Aufrufe erhalten `DOWNLOAD_UNAVAILABLE`. Installation folgt in Schritt 8/9.
- Ohne Desktop-Bridge bleibt der Abschnitt verborgen; die Web-App nutzt keine
  Update-IPC und legt keine Zugänge an.

## Privates Repository

Ein persönlicher Fine-grained GitHub-Token benötigt für das konfigurierte Repository
`Contents: Read-only` (Metadatenzugriff ist automatisch enthalten). Das eigene
GitHub-Konto muss bereits Zugriff besitzen. Die Oberfläche nennt die konfigurierte
Quelle; sie erlaubt keine beliebigen Feed-URLs oder Repository-Wechsel.

Das Passwortfeld wird vor der IPC-Anfrage und beim Verlassen geleert. Es gibt
keinen Token-Lesezugriff für den Renderer, keine Speicherung im Browser/Backend
und keine Ausgabe in Fehlermeldungen. Main verwendet den geschützten Speicher aus
Schritt 5 und verweigert ungeschützte Ersatzverfahren. Speichern und Entfernen
sind serialisiert; danach verwirft der Dienst alte Prüfergebnisse und bricht eine
laufende Prüfung ab. Nach erfolgreichem Speichern beginnt eine neue Prüfung.
Entfernen bleibt auch in deaktivierten Builds möglich.

## Dateien und IPC

- `electron/update_controller.cjs`: Sitzung, versionsgebundene Entscheidungen,
  Zugangsänderungen und gesperrte Downloadfähigkeit.
- `electron/updates.cjs`, `main.cjs`, `installation.cjs`: Dienstanbindung,
  Statusinvalidierung, Abmeldung und Aufnahme in das Installationsmanifest.
- `electron/ipc.cjs`, `preload.cjs`: ausschließlich benannte Methoden;
  Versions-/Tokenargumente werden in Preload und Main geprüft. Main akzeptiert nur
  den erwarteten Hauptframe des eigenen Fensters am erlaubten lokalen Ursprung.
- `acknowledgeUpdate(version)`, `deferUpdate(version)`, `requestUpdate(version)`,
  `setUpdateAccessToken(token)`, `clearUpdateAccessToken()` ergänzen die bisherigen
  lesenden Methoden. `onUpdateStatus(callback)` liefert nur Statusdaten und eine
  Abmeldefunktion; das Electron-Ereignisobjekt wird nicht weitergereicht.
- `frontend/js/updates.js`, `app.js`, `index.html`, `css/style.css`: Oberfläche,
  Statusereignisse, Textausgabe ohne HTML-Auswertung, Fortschritt und Aufräumen.
- Controller-/IPC-/Preload-/Renderer-Tests, nativer Dialogtreiber unter `tests/`
  sowie die bestehende native Rechnungsprüfung sichern die Integration ab.

## Überprüfung

```sh
npm run desktop:check
python -m pytest -q
TTC_RUN_ELECTRON_TESTS=1 python -m pytest -q -s tests/test_desktop_update_ui.py tests/test_desktop_invoice.py
```

Lokal tatsächlich geprüft: 134 JavaScript-Tests bestanden, ein optionaler
NSIS-Artefakttest übersprungen; 393 Python-Tests bestanden, neun optionale Tests
übersprungen. Die sechs gesondert aktivierten Linux-Electron-Szenarien bestanden:
zwei Dialogprüfungen in Entwicklungs-/Produktionsmodus und vier bestehende
Rechnungs-/Sicherungs-/Neustartprüfungen mit Standard-/eigenem Dokumentenort.
Der Dialog wurde als Screenshot visuell kontrolliert.
Der Linux-AppImage-Build war erfolgreich; nach Entpacken wurden vollständiges
Installationsmanifest, Versionsmetadaten und der freigegebene Starter geprüft.

Die Dialogtests verwenden echte Fenster, Backend, Main-Dienst, Signaturprüfung,
Controller, IPC und Renderer. Sie prüfen wartende Dialoge, unveränderte Notizen,
Escape/Später, Sitzungsunterdrückung nach Neuladen, manuelles Öffnen sowie das
Leeren/Entfernen persönlicher Zugänge. Release-Metadaten sind signierte Testdaten,
Transport und Zugangsspeicher sind isolierte Testadapter. Das belegt weder echte
GitHub-Berechtigungen noch native Schlüsselbundintegration oder Paketdownload.
Native Windows-Installations-/Signaturtests stehen weiterhin aus.
