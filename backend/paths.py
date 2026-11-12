"""Resolve storage at call time; packaged code and user data stay separate."""
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def get_data_directory() -> Path:
    configured = os.environ.get("TTC_DATA_DIRECTORY")
    if configured is None:
        # Preserve direct web use; Electron always supplies its userData path.
        return PROJECT_ROOT / "data"
    directory = Path(configured)
    if not configured.strip() or not directory.is_absolute():
        raise ValueError("TTC_DATA_DIRECTORY muss ein absolutes Verzeichnis sein")
    return directory


def get_database_path() -> Path:
    return get_data_directory() / "ttc.db"
