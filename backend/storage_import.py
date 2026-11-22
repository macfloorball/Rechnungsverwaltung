"""Non-destructive adoption of a legacy SQLite database into a new profile."""
import argparse
import os
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

from backend.database import (
    TABLE_COLUMNS, get_schema_version, initialize_database, validate_profile_relationships,
)
from backend.paths import get_database_path

LEGACY_COLUMNS = {
    "activity_types": {"id", "name", "hourly_rate_cents", "is_active"},
    "weekly_plan": {"id", "weekday", "activity_type_id", "hours", "is_active"},
    "trainings": {"id", "training_date", "activity_type_id", "hours", "status", "note", "unit_rate_cents"},
    "invoices": {"id", "year", "month", "invoice_date", "invoice_number", "total_amount_cents", "pdf_path", "created_at"},
    "invoice_items": {"id", "invoice_id", "training_id", "description", "training_date", "hours", "unit_rate_cents", "amount_cents"},
}


def validate_database(connection: sqlite3.Connection, *, current: bool = False) -> None:
    if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
        raise sqlite3.DatabaseError("Integritätsprüfung der Importdaten fehlgeschlagen")
    get_schema_version(connection)
    required = {table: fields | {"id"} for table, fields in TABLE_COLUMNS.items()} if current else LEGACY_COLUMNS
    for table, fields in required.items():
        columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
        if not fields <= columns:
            raise ValueError("Die Datei enthält keine unterstützte Rechnungsdatenbank")
    if get_schema_version(connection) >= 12:
        if {row[1] for row in connection.execute("PRAGMA table_info(invoice_number_retired)")} != {"organization_id", "year", "serial"}:
            raise ValueError("Die Historie gelöschter Rechnungsnummern fehlt")
    if get_schema_version(connection) >= 11:
        if not connection.execute("SELECT name FROM sqlite_master WHERE name='profile_identifiers'").fetchone():
            raise ValueError("Die Profil-ID-Historie fehlt")
    if get_schema_version(connection) >= 9:
        for table, required_columns in {
            "invoice_counters": {"organization_id", "year", "next_number", "minimum_number"},
            "invoice_number_legacy_floors": {"organization_id", "minimum_number"},
        }.items():
            columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
            if not required_columns <= columns:
                raise ValueError("Die Rechnungsnummernkreise fehlen in der Datenbank")
    if get_schema_version(connection) >= 7:
        validate_profile_relationships(connection)
    if connection.execute("PRAGMA foreign_key_check").fetchall():
        raise sqlite3.DatabaseError("Fremdschlüsselprüfung der Importdaten fehlgeschlagen")


def import_database(source: Path, target: Path) -> Path:
    source, target = Path(source).absolute(), Path(target).absolute()
    if target.exists() or target.is_symlink():
        raise FileExistsError("Die Zieldatenbank existiert bereits; Import abgebrochen")
    if not source.is_file():
        raise FileNotFoundError("Die Quelldatenbank wurde nicht gefunden")
    target.parent.mkdir(parents=True, exist_ok=True)
    # Stage on the same filesystem. The source is only ever opened read-only.
    with tempfile.TemporaryDirectory(prefix=".ttc-import-", dir=target.parent) as temporary:
        staged = Path(temporary) / "ttc.db"
        with closing(sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)) as original:
            with closing(sqlite3.connect(staged)) as copy:
                original.backup(copy)
                validate_database(copy)
        initialize_database(staged)
        with closing(sqlite3.connect(staged.resolve().as_uri() + "?mode=ro", uri=True)) as copy:
            validate_database(copy, current=True)
        staged.chmod(0o600)
        with staged.open("r+b") as file:
            os.fsync(file.fileno())
        # Atomic no-clobber publication, even if another process created target.
        os.link(staged, target)
    return target


def prepare_database(target: Path, legacy: Path | None = None) -> None:
    if not target.exists() and not target.is_symlink() and legacy is not None and legacy.exists():
        if legacy.resolve() != target.resolve():
            import_database(legacy, target)
    initialize_database(target)


def main() -> None:
    parser = argparse.ArgumentParser(description="SQLite-Altdaten ohne Überschreiben übernehmen")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--target", type=Path, default=None)
    args = parser.parse_args()
    try:
        import_database(args.source, args.target or get_database_path())
    except (OSError, sqlite3.Error, ValueError) as error:
        parser.exit(1, f"Import abgebrochen: {error}\n")
    print("Datenbank geprüft und übernommen; Quelle unverändert.")


if __name__ == "__main__":
    main()
