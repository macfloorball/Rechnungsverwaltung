# Phase 4, Schritt 1 – Netzwerkabhängigkeiten erfassen

Stand: 13.11.2026. Untersucht wurde der aus Phase 3 übernommene Stand
`6a6f60a` auf Branch
`Phase-4_Vollständiger-lokaler-Betrieb-und-Funktionsprüfung` mit sauberem
Arbeitsbaum. Dieser Schritt dokumentiert den Bestand. Die Bewertung der
Notwendigkeit, Änderungen und der praktische Test ohne Internet folgen in
den jeweils eigenen Arbeitsschritten von Phase 4.

## Umfang und Vorgehen

Geprüft wurden die versionierten Laufzeitquellen in `frontend/`, `backend/`
und `electron/`, die Start-, Build- und Sicherungsskripte, `package.json`,
`package-lock.json`, `requirements.txt` sowie die vorhandenen Tests und
Dokumentation. Die Architektur aus Phase 1–3 bleibt maßgeblich: Electron
startet einen lokalen Python-/Uvicorn-Dienst; dieser liefert Oberfläche und
REST-API aus. SQLite und Dokumente liegen in den bestehenden lokalen Ablagen.
Produktive Datenbanken und Rechnungsdateien wurden nicht geöffnet.

Neben absoluten URLs wurden relative API-Aufrufe, Modulimporte, HTML-/CSS-
Ressourcen, Browserübergaben und implizit erzeugte Framework-Seiten geprüft.
Die installierte FastAPI-Implementierung unter
`.venv/lib/python*/site-packages/fastapi/openapi/docs.py` ergänzt dabei den
Anwendungsquellcode um die Standardressourcen der API-Dokumentation.

## Netzwerk zur Laufzeit

| Bereich / Auslöser | Ziel und Übertragung | Beleg im Repository / Befund |
| --- | --- | --- |
| Desktop-Start und Bereitschaftsprüfung | HTTP zur konfigurierten Loopback-Origin; Standard `http://127.0.0.1:8000/`. Prüfung von `/api/health`, `/`, `/js/app.js`, `/css/style.css` und in Produktion `/desktop-build.json` | `electron/config.cjs`, `electron/startup.cjs`, `electron/backend.cjs`, `scripts/run.cjs`. Konfiguration erlaubt ausschließlich `127.0.0.1` oder `[::1]`, HTTP und eine Origin ohne Zugangsdaten. |
| Oberfläche und Module | HTML, CSS und ES-Module derselben lokalen Origin | `frontend/index.html`, `frontend/js/app.js`, `frontend/js/calendar.js`. Relative Ressourcen und Modulimporte; keine CDN- oder Webfont-URL im Produktfrontend. |
| Kalender, Monatsabschluss und Termine | Relative `/api/calendar/{year}/{month}`, `/api/calendar/{year}/{month}/complete`, `/api/trainings` und `/api/trainings/{id}` | `frontend/js/calendar.js`, `frontend/js/trainings.js`. Kalenderdaten und Terminänderungen gehen an den lokalen Dienst. |
| Organisation, Empfänger, Preise und Wochenplan | Relative `/api/organization/settings`, `/api/settings` und `/api/weekly-plan` | `frontend/js/settings.js`, `frontend/js/trainings.js`. Kein externer Kunden- oder Kontendienst. |
| Logo | Relative `/api/organization/logo`; Upload als lokal eingelesene Bilddaten, Anzeige über denselben Dienst | `frontend/js/settings.js`, `backend/main.py`. Kein Abruf eines vom Nutzer angegebenen Bildservers. Logo und Rechnungssnapshots werden in SQLite gespeichert. |
| Vorschau, Finalisierung und Archiv | Relative `/api/invoices/preview`, `/api/invoices` und `/api/invoices/{id}` | `frontend/js/invoice.js`, `frontend/js/settings.js`, `backend/main.py`. Verarbeitung und Speicherung erfolgen im lokalen Backend. |
| PDF-Anzeige und Download | Relative `/api/invoices/{id}/pdf`; beim Öffnen Übergabe der absoluten lokalen HTTP-URL an den Standardbrowser | `frontend/js/invoice.js`, `frontend/js/settings.js`, `electron/browser-links.cjs`. Electron akzeptiert nur diesen GET-Pfad an seiner eigenen Origin ohne Query, Fragment oder Zugangsdaten. Der Browser benötigt den laufenden lokalen Dienst. Sein eigenes Netzwerkverhalten liegt außerhalb der Anwendung. |
| Swagger UI `/docs` | `https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js`, `https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css`, `https://fastapi.tiangolo.com/img/favicon.png` | `backend/main.py` verwendet `FastAPI(...)` ohne eigene Docs-Konfiguration. Die installierten FastAPI-Defaults erzeugen diese externen Ressourcen im HTML; Laden erfolgt beim Aufruf dieser Dokumentationsseite im Browser. |
| ReDoc `/redoc` | `https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js`, dasselbe FastAPI-Favicon sowie `https://fonts.googleapis.com/css?family=Montserrat:300,400,700\|Roboto:300,400,700` | Ebenfalls FastAPI-Defaults. Die Google-Stylesheet-Anfrage kann weitere Schriftabrufe auslösen. Die externen JavaScript-Bündel und ihre möglichen Folgeanfragen sind nicht lokal versioniert. |
| OpenAPI und OAuth-Redirect | `/openapi.json` und `/docs/oauth2-redirect` am lokalen Backend | Von FastAPI registrierte Hilfsrouten. Das lokale OpenAPI-Schema enthält keine konfigurierte externe Server-URL. Die Redirect-Hilfsseite ist kein implementierter Login; es gibt keinen eingerichteten OAuth-Anbieter. |

Die API-Dokumentation ist über die lokale API erreichbar, aber nicht in der
Produktoberfläche verlinkt. Die Electron-Regeln erlauben im Hauptfenster nur
die Startseite und deren lokale Ressourcen; `/docs` und `/redoc` sind dort
keine freigegebenen Navigationsziele. Bei direktem Aufruf im normalen Browser
greifen diese Electron-Regeln nicht.

## Weitere Laufzeitbefunde und Grenzen

- `electron/window.cjs` beschränkt Renderer-Anfragen auf die konfigurierte
  HTTP-Origin und setzt unter anderem `connect-src 'self'`,
  `script-src 'self'`, `style-src 'self'` und `font-src 'self'`.
  Fremde Navigation, Unterframes und beliebige neue Fenster werden blockiert.
  Das ist eine Renderer-Regel, kein systemweiter Netzwerkfilter für Electron,
  Python oder den Standardbrowser.
- Der Backend-Quellcode enthält keinen ausgehenden HTTP-Client für fachliche
  Abläufe, keine externe Datenbankverbindung, Anmeldung, Synchronisierung,
  E-Mail-Anbindung, Telemetrie oder automatische Updateprüfung. Die vorhandenen
  Netzwerkoperationen der Starter dienen dem lokalen Dienst. IPC ist lokale
  Prozesskommunikation und bietet ausschließlich den Versionsabruf an.
- CSS nennt `Inter` und Systemschriften als lokale Schriftfamilien, ohne
  `@font-face`, `@import` oder entfernte Schriftdateien.
  `backend/invoice_generator.py` verwendet ReportLabs `Helvetica` und
  `Helvetica-Bold`; Logos werden als `BytesIO` an `ImageReader` übergeben.
  Es gibt dort keinen URL-basierten Bild- oder Schriftabruf.
- `backend/paths.py`, SQLite, Dokumentendienst und Sicherungsskripte arbeiten
  über Dateisystempfade. Benutzerdefinierte absolute Speicherorte werden nicht
  auf physisch lokale Datenträger beschränkt. Ein gewähltes Netzlaufwerk,
  UNC-Pfad oder synchronisierter Ordner kann damit eine externe Abhängigkeit
  der konkreten Installation schaffen; Standardpfade benötigen keinen solchen
  Dienst. Der SQLite-Import verwendet eine lokale `file:`-URI, keinen Webdienst.
- Eine statische Quellcodeprüfung weist keine vollständige Netzwerklosigkeit
  der eingebetteten Chromium-/Electron-Laufzeit, transitiver Pakete oder des
  Betriebssystems nach. Hintergrundverkehr, externe Bibliotheks-Folgeanfragen
  und Verhalten ohne Internet wurden in diesem Schritt nicht praktisch
  gemessen. Native Windows-Abnahme und tatsächliche PDF-Anzeige im
  Standardbrowser bleiben gemäß den bisherigen Phasen offen.

## Einrichtung, Build und Entwicklung

| Auslöser | Externe Quelle / Art der Abhängigkeit | Beleg und Abgrenzung |
| --- | --- | --- |
| Repository beziehen | GitHub, im dokumentierten Ablauf `https://github.com/macfloorball/Rechnungsverwaltung.git` | `README.md`. Versionsverwaltung, kein fachlicher Laufzeitaufruf. |
| JavaScript-Pakete installieren | `https://registry.npmjs.org/` für die im Lockfile aufgelösten Pakete | `package-lock.json`, `package.json`. Enthält Electron und Packager samt transitiven Paketen. Sponsor-/Repository-URLs im Lockfile sind Metadaten und allein kein Beleg für Laufzeitanfragen. |
| Electron installieren | Electron-Release-Artefakte, standardmäßig GitHub Releases; Cache oder konfigurierte Mirrors können die Quelle ändern | `node_modules/electron/install.js` ruft `@electron/get` auf; dessen mitgelieferte README beschreibt Release-URLs und Mirrors. Der Download erfolgt bei fehlendem Artefakt, nicht durch den normalen App-Start. |
| Windows-Testbuild erzeugen | Packager kann das passende Electron-Artefakt für Windows x64 herunterladen, sofern nicht gecacht | `scripts/package_windows.cjs`. Der Frontend-Build selbst kopiert nur lokale Dateien und erzeugt eine Build-Kennung (`scripts/build_frontend.cjs`). |
| Python einrichten | Python-Laufzeit und Pakete aus der konfigurierten Installationsquelle; pip üblicherweise PyPI mit Paketdateien von `files.pythonhosted.org`, sofern kein anderer Index/Cache genutzt wird | `README.md`, `requirements.txt`: `fastapi`, `uvicorn[standard]`, `reportlab`, `pytest`, `httpx2`. Kein Index im Repository festgelegt, Versionen nicht gebunden. Python und Pakete sind weiterhin nicht in den Windows-Testbuild eingebettet. |
| Tests ausführen | HTTP-Integration über Loopback beziehungsweise In-Process-`TestClient`; Electron-GUI-Tests ausdrücklich per Opt-in | `tests/test_storage_lifecycle.py`, `tests/test_managed_server.py`, `tests/test_desktop_invoice.py` und `electron/*.test.cjs`. Kein konfigurierter externer Testdienst. HTTP-Client-Abhängigkeiten der Tests sind kein Beleg für einen externen Produktdienst. |

## Weiterführung

Die nachgewiesenen externen Ressourcen der API-Dokumentation, die
Einrichtungs-/Build-Downloads, mögliche benutzerdefinierte Netzablagen und die
noch nicht gemessene Laufzeit sind die Eingaben für die folgenden Schritte.
Mit dieser Erfassung wird weder eine Abhängigkeit deaktiviert noch eine
Offline-Abnahme oder die vollständige lokale Verfügbarkeit aller Ressourcen
als erledigt erklärt.
