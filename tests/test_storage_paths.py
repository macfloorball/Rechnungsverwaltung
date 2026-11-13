from pathlib import Path

import pytest

from backend.database import create_record, initialize_database, list_records
from backend.paths import PROJECT_ROOT, get_database_path
from scripts.backup_database import create_database_backup


def test_runtime_path_override_and_backup(monkeypatch, tmp_path):
    for name in ("profile with spaces", "second profile"):
        directory = tmp_path / name
        monkeypatch.setenv("TTC_DATA_DIRECTORY", str(directory))
        assert get_database_path() == directory / "ttc.db"
        initialize_database()
        create_record("activity_types", {"name": name, "hourly_rate_cents": 100})
        initialize_database()
        assert [row["name"] for row in list_records("activity_types")] == [name]
        assert create_database_backup(backup_directory=tmp_path / (name + " backups")).is_file()


def test_web_path_and_invalid_overrides(monkeypatch):
    monkeypatch.delenv("TTC_DATA_DIRECTORY", raising=False)
    assert get_database_path() == PROJECT_ROOT / "data" / "ttc.db"
    for value in ("", "relative/path", " "):
        monkeypatch.setenv("TTC_DATA_DIRECTORY", value)
        with pytest.raises(ValueError, match="absolutes"):
            get_database_path()


def test_invoice_api_uses_central_document_directory(monkeypatch, tmp_path):
    from backend.main import get_invoice_directory

    monkeypatch.delenv("TTC_DATA_DIRECTORY", raising=False)
    assert get_invoice_directory() == PROJECT_ROOT / "rechnungen"
    monkeypatch.setenv("TTC_DATA_DIRECTORY", str(tmp_path / "profile"))
    assert get_invoice_directory() == tmp_path / "profile" / "documents"
