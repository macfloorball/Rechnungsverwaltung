import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest

from scripts.backup_database import (
    BACKUP_TIMESTAMP_FORMAT,
    create_database_backup,
)


def test_database_backup_is_valid_and_uses_private_permissions(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "source.db"
    backup_directory = tmp_path / "private-backups"
    with sqlite3.connect(database_path) as connection:
        connection.execute("CREATE TABLE example (value TEXT NOT NULL)")
        connection.execute("INSERT INTO example VALUES ('preserved')")

    backup_path = create_database_backup(
        database_path,
        backup_directory,
        now=datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc),
    )

    assert backup_path.name == "ttc-20261105T120000000000Z.sqlite3"
    assert backup_directory.stat().st_mode & 0o777 == 0o700
    assert backup_path.stat().st_mode & 0o777 == 0o600
    with sqlite3.connect(backup_path) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("SELECT value FROM example").fetchone() == (
            "preserved",
        )


def test_database_backup_prunes_only_expired_managed_backups(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "source.db"
    backup_directory = tmp_path / "backups"
    backup_directory.mkdir()
    with sqlite3.connect(database_path) as connection:
        connection.execute("CREATE TABLE example (value TEXT)")

    old_backup = backup_directory / "ttc-20260901T000000000000Z.sqlite3"
    recent_backup = backup_directory / "ttc-20261104T000000000000Z.sqlite3"
    unrelated_file = backup_directory / "keep-me.sqlite3"
    old_backup.touch()
    recent_backup.touch()
    unrelated_file.touch()
    old_timestamp = datetime(2026, 9, 1, tzinfo=timezone.utc).timestamp()
    os.utime(old_backup, (old_timestamp, old_timestamp))

    create_database_backup(
        database_path,
        backup_directory,
        retention_days=30,
        now=datetime(2026, 11, 5, tzinfo=timezone.utc),
    )

    assert not old_backup.exists()
    assert recent_backup.exists()
    assert unrelated_file.exists()


def test_database_backup_rejects_missing_database_and_invalid_retention(
    tmp_path: Path,
) -> None:
    with pytest.raises(FileNotFoundError):
        create_database_backup(
            tmp_path / "missing.db",
            tmp_path / "backups",
        )

    database_path = tmp_path / "source.db"
    database_path.touch()
    with pytest.raises(ValueError, match="mindestens 1 Tag"):
        create_database_backup(
            database_path,
            tmp_path / "backups",
            retention_days=0,
        )


def test_backup_timestamp_format_is_six_digit_precision() -> None:
    timestamp = datetime(
        2026,
        11,
        5,
        12,
        34,
        56,
        123456,
        tzinfo=timezone.utc,
    ).strftime(BACKUP_TIMESTAMP_FORMAT)

    assert timestamp == "20261105T123456123456Z"
