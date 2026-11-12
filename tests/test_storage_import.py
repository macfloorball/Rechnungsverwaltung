import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from backend.database import create_record, get_record, initialize_database
from backend.storage_import import import_database, prepare_database


def legacy_database(path):
    initialize_database(path)
    create_record("activity_types", {"name": "Preserved", "hourly_rate_cents": 1250}, path)
    return path


def test_import_preserves_source_and_existing_target(tmp_path):
    source = legacy_database(tmp_path / "old" / "ttc.db")
    before = source.read_bytes()
    target = tmp_path / "new profile" / "ttc.db"
    import_database(source, target)
    assert source.read_bytes() == before
    assert get_record("activity_types", 1, target)["name"] == "Preserved"
    persisted = target.read_bytes()
    with pytest.raises(FileExistsError):
        import_database(source, target)
    prepare_database(target, source)
    assert target.read_bytes() == persisted


def test_import_reads_committed_wal_contents(tmp_path):
    source = legacy_database(tmp_path / "wal.db")
    target = tmp_path / "new.db"
    with closing(sqlite3.connect(source)) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("INSERT INTO activity_types (name, hourly_rate_cents) VALUES ('WAL', 12)")
        connection.commit()
        import_database(source, target)
        assert get_record("activity_types", 2, target)["name"] == "WAL"


@pytest.mark.parametrize("kind", ["missing", "corrupt", "foreign", "future", "migration_failure"])
def test_failed_import_never_publishes_or_changes_source(tmp_path, kind):
    source, target = tmp_path / "source.db", tmp_path / "profile" / "ttc.db"
    if kind == "corrupt":
        source.write_bytes(b"not sqlite")
    elif kind == "foreign":
        with sqlite3.connect(source) as connection:
            connection.execute("CREATE TABLE unrelated (id INTEGER)")
    elif kind in {"future", "migration_failure"}:
        legacy_database(source)
        with sqlite3.connect(source) as connection:
            if kind == "future":
                connection.execute("INSERT INTO schema_migrations (version) VALUES (7)")
            else:
                connection.execute("DELETE FROM schema_migrations WHERE version = 6")
                connection.execute("DROP INDEX idx_invoices_unique_preview_period")
                connection.executemany(
                    "INSERT INTO invoices (year, month, is_preview, invoice_date, total_amount_cents) VALUES (2026, 1, 1, '2026-01-01', ?)",
                    [(1,), (2,)],
                )
    before = source.read_bytes() if source.exists() else None
    with pytest.raises((OSError, sqlite3.Error, ValueError)):
        import_database(source, target)
    assert not target.exists()
    assert not list(target.parent.glob(".ttc-import-*"))
    assert (source.read_bytes() if source.exists() else None) == before


def test_prepare_adopts_once_or_initializes_empty_profile(tmp_path):
    source = legacy_database(tmp_path / "legacy.db")
    target = tmp_path / "profile" / "ttc.db"
    prepare_database(target, source)
    assert get_record("activity_types", 1, target)["name"] == "Preserved"
    empty = tmp_path / "empty" / "ttc.db"
    prepare_database(empty, tmp_path / "missing.db")
    assert get_record("activity_types", 1, empty) is None


def test_target_created_during_import_is_never_overwritten(tmp_path, monkeypatch):
    import os
    source = legacy_database(tmp_path / "legacy.db")
    target = tmp_path / "profile" / "ttc.db"
    real_link = os.link

    def concurrent_target(staged, destination):
        target.write_bytes(b"concurrent target")
        real_link(staged, destination)

    monkeypatch.setattr(os, "link", concurrent_target)
    with pytest.raises(FileExistsError):
        import_database(source, target)
    assert target.read_bytes() == b"concurrent target"
    assert not list(target.parent.glob(".ttc-import-*"))
