"""Public storage errors contain no paths, SQL, or user data."""
import sqlite3

MESSAGES = {
    "missing": "Die Datenbank fehlt. Datenverzeichnis prüfen oder eine Sicherung wiederherstellen; es wurde keine Ersatzdatenbank angelegt.",
    "locked": "Die Datenbank ist belegt. Andere App-Instanzen schließen und erneut versuchen.",
    "corrupt": "Die Datenbank ist beschädigt oder keine gültige Rechnungsdatenbank. Original erhalten und eine Sicherung wiederherstellen.",
    "access": "Die Datenbank ist nicht erreichbar oder nicht beschreibbar. Datenverzeichnis, freien Speicher und Zugriffsrechte prüfen.",
    "schema": "Der Datenbankstand wird nicht unterstützt. Passende App-Version verwenden; die Datenbank nicht löschen.",
}


class DatabaseAccessError(sqlite3.OperationalError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(MESSAGES[code])


def error_code(error: BaseException) -> str:
    if isinstance(error, DatabaseAccessError):
        return error.code
    code = getattr(error, "sqlite_errorcode", 0) or 0
    if code & 255 in (5, 6):
        return "locked"
    if code & 255 in (11, 26):
        return "corrupt"
    # Python 3.10 lacks sqlite_errorcode on SQLite exceptions.
    if not code and isinstance(error, sqlite3.Error):
        message = str(error).lower()
        if "database is locked" in message or "database table is locked" in message:
            return "locked"
        if "not a database" in message or "malformed" in message:
            return "corrupt"
    if isinstance(error, ValueError):
        return "schema"
    return "access"
