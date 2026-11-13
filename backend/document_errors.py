"""Sanitized document failures shared by startup and HTTP boundaries."""
import errno
from contextlib import contextmanager
from typing import Iterator


MESSAGES = {
    "missing": "Die Dokumentdatei fehlt. Dokumentenordner prüfen oder die Datei aus einer Sicherung wiederherstellen.",
    "access": "Die Dokumentenablage ist nicht zugänglich oder beschreibbar. Zugriffsrechte prüfen und die Datei in anderen Programmen schließen.",
    "space": "Für die Dokumentdatei ist nicht genügend Speicherplatz verfügbar. Freien Speicher im Dokumentenordner prüfen.",
    "exists": "Die Dokumentdatei existiert bereits. Vorhandene Dateien prüfen; es wird nichts überschrieben.",
    "changed": "Die Dokumentdatei wurde zwischenzeitlich geändert. Den aktuellen Dateibestand prüfen und den Vorgang erneut versuchen.",
    "invalid": "Dokumentenpfad oder Dateiverweis ist ungültig. Einen absoluten Dokumentenordner und reguläre Dateien verwenden.",
    "unsupported": "Das Dateisystem unterstützt die benötigte Dateioperation nicht. Einen lokalen Dokumentenordner mit Hardlink-Unterstützung verwenden.",
    "io": "Die Dokumentdatei konnte nicht verarbeitet werden. Verfügbarkeit der Ablage prüfen und den Vorgang erneut versuchen.",
}
HTTP_STATUS = {"exists": 409, "changed": 409}
PREFIXES = {
    "prepare": "Die Dokumentenablage konnte nicht vorbereitet werden. ",
    "configure": "",
    "write": "Die Rechnung wurde nicht gespeichert. ",
    "read": "",
    "inspect": "Die Rechnung wurde nicht gelöscht. ",
    "delete": "Die Rechnung wurde gelöscht, die zugehörige PDF konnte jedoch nicht entfernt werden. ",
    "cleanup": "Die PDF konnte nach dem Speicherfehler nicht bereinigt werden. Dateibestand vor einem erneuten Speicherversuch prüfen. ",
}
SYSTEM_ERRORS = {
    code: {getattr(errno, name) for name in names if hasattr(errno, name)}
    for code, names in {
        "space": ("ENOSPC", "EDQUOT"),
        "access": ("EACCES", "EPERM", "EROFS", "EBUSY"),
        "unsupported": ("ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"),
        "invalid": ("ENOTDIR", "EISDIR", "EINVAL", "ENAMETOOLONG"),
    }.items()
}
WINDOWS_ERRORS = {
    "space": {39, 112, 1816}, "access": {5, 32, 33},
    "unsupported": {1, 17, 50}, "invalid": {123, 206, 267},
}


class DocumentChangedError(OSError):
    """A document changed after selection for an operation."""


class DocumentOperationError(Exception):
    def __init__(self, code: str, operation: str):
        self.code = code
        self.operation = operation
        self.status_code = 404 if code == "missing" and operation == "read" else HTTP_STATUS.get(code, 503)
        self.detail = PREFIXES[operation] + MESSAGES[code]
        super().__init__(self.detail)


def error_code(error: BaseException) -> str:
    if isinstance(error, DocumentChangedError):
        return "changed"
    if isinstance(error, FileNotFoundError):
        return "missing"
    if isinstance(error, FileExistsError):
        return "exists"
    number = getattr(error, "errno", None)
    windows = getattr(error, "winerror", None)
    for code in SYSTEM_ERRORS:
        if number in SYSTEM_ERRORS[code] or windows in WINDOWS_ERRORS[code]:
            return code
    if isinstance(error, PermissionError):
        return "access"
    if isinstance(error, NotImplementedError):
        return "unsupported"
    if isinstance(error, (ValueError, NotADirectoryError, IsADirectoryError)):
        return "invalid"
    return "io"


@contextmanager
def document_operation(operation: str) -> Iterator[None]:
    try:
        yield
    except (OSError, ValueError, NotImplementedError) as error:
        raise DocumentOperationError(error_code(error), operation) from None
