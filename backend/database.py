import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATABASE_PATH = PROJECT_ROOT / "data" / "ttc.db"


def get_connection(database_path: Path = DATABASE_PATH) -> sqlite3.Connection:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    if database_path.stat().st_size == 0:
        connection.execute("VACUUM")
    return connection