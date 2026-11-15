import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest

from scripts.backup_database import (
    BACKUP_TIMESTAMP_FORMAT,
    create_database_backup,
)
from backend.database import initialize_database


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
    # Windows uses ACLs; stat/chmod do not represent POSIX permission bits.
    if os.name != "nt":
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


def test_backup_and_restore_preserve_organization_and_invoice_snapshots(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "source.db"
    backup_directory = tmp_path / "backups"
    initialize_database(database_path)
    logo_data = b"\x89PNG-test-logo"
    snapshot = '{"name":"TTC Beispiel","iban":"DE89370400440532013000"}'
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            """
            UPDATE organizations
            SET name = ?, iban = ?, logo_data = ?, logo_media_type = ?
            WHERE id = 1
            """,
            ("TTC Beispiel", "DE89370400440532013000", logo_data, "image/png"),
        )
        connection.execute(
            """
            INSERT INTO invoices (
                organization_id, year, month, invoice_date, invoice_number,
                total_amount_cents, invoice_snapshot_json, logo_snapshot,
                logo_media_type
            ) VALUES (1, 2026, 11, '2026-11-06', 'TTC-2026-0001', 3000, ?, ?, ?)
            """,
            (snapshot, logo_data, "image/png"),
        )

    backup_path = create_database_backup(
        database_path,
        backup_directory,
        now=datetime(2026, 11, 6, 12, 0, tzinfo=timezone.utc),
    )

    with sqlite3.connect(backup_path) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute(
            "SELECT name, iban, logo_data FROM organizations WHERE id = 1"
        ).fetchone() == (
            "TTC Beispiel",
            "DE89370400440532013000",
            logo_data,
        )
        assert connection.execute(
            """
            SELECT invoice_snapshot_json, logo_snapshot, logo_media_type
            FROM invoices WHERE invoice_number = 'TTC-2026-0001'
            """
        ).fetchone() == (snapshot, logo_data, "image/png")
