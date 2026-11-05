import argparse
import os
import re
import sqlite3
import tempfile
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATABASE = PROJECT_ROOT / "data" / "ttc.db"
DEFAULT_BACKUP_DIRECTORY = Path.home() / "ttc-rechnungsverwaltung-backups"
BACKUP_NAME_PATTERN = re.compile(r"ttc-(\d{8}T\d{12}Z)\.sqlite3\Z")
BACKUP_TIMESTAMP_FORMAT = "%Y%m%dT%H%M%S%fZ"


def _remove_expired_backups(
    backup_directory: Path,
    retention_days: int,
    now: datetime,
) -> None:
    cutoff = now - timedelta(days=retention_days)
    for backup_path in backup_directory.glob("ttc-*.sqlite3"):
        if BACKUP_NAME_PATTERN.fullmatch(backup_path.name) is None:
            continue
        if backup_path.is_symlink() or not backup_path.is_file():
            continue
        modified_at = datetime.fromtimestamp(
            backup_path.stat().st_mtime,
            timezone.utc,
        )
        if modified_at < cutoff:
            backup_path.unlink()


def create_database_backup(
    database_path: Path = DEFAULT_DATABASE,
    backup_directory: Path = DEFAULT_BACKUP_DIRECTORY,
    retention_days: int = 30,
    now: datetime | None = None,
) -> Path:
    if retention_days < 1:
        raise ValueError("Die Aufbewahrungsdauer muss mindestens 1 Tag betragen")
    if not database_path.is_file():
        raise FileNotFoundError(f"Datenbank wurde nicht gefunden: {database_path}")

    backup_directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    backup_directory.chmod(0o700)
    current_time = now or datetime.now(timezone.utc)
    if current_time.tzinfo is None:
        raise ValueError("Der Sicherungszeitpunkt muss eine Zeitzone enthalten")
    timestamp = current_time.astimezone(timezone.utc).strftime(
        BACKUP_TIMESTAMP_FORMAT
    )
    backup_path = backup_directory / f"ttc-{timestamp}.sqlite3"
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=".ttc-backup-",
        suffix=".tmp",
        dir=backup_directory,
    )
    os.close(file_descriptor)
    temporary_path = Path(temporary_name)

    try:
        source_uri = f"{database_path.resolve().as_uri()}?mode=ro"
        with closing(sqlite3.connect(source_uri, uri=True)) as source:
            target = sqlite3.connect(temporary_path)
            try:
                source.backup(target)
                result = target.execute("PRAGMA integrity_check").fetchone()
                if result != ("ok",):
                    raise sqlite3.DatabaseError(
                        f"Backup-Integritätsprüfung fehlgeschlagen: {result}"
                    )
            finally:
                target.close()

        temporary_path.chmod(0o600)
        os.replace(temporary_path, backup_path)
    finally:
        temporary_path.unlink(missing_ok=True)

    _remove_expired_backups(backup_directory, retention_days, current_time)
    return backup_path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Erstellt und rotiert zugriffsgeschützte SQLite-Sicherungen."
    )
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument(
        "--backup-directory",
        type=Path,
        default=DEFAULT_BACKUP_DIRECTORY,
    )
    parser.add_argument("--retention-days", type=int, default=30)
    arguments = parser.parse_args()

    backup_path = create_database_backup(
        arguments.database,
        arguments.backup_directory,
        arguments.retention_days,
    )
    print(f"Datenbanksicherung erstellt: {backup_path}")


if __name__ == "__main__":
    main()
