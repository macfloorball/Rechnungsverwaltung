import sqlite3
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATABASE_PATH = PROJECT_ROOT / "data" / "ttc.db"

TABLE_COLUMNS = {
    "activity_types": {
        "name",
        "hourly_rate_cents",
        "is_active",
    },
    "weekly_plan": {
        "weekday",
        "activity_type_id",
        "hours",
        "is_active",
    },
    "trainings": {
        "training_date",
        "activity_type_id",
        "hours",
        "status",
        "note",
        "unit_rate_cents",
    },
    "invoices": {
        "year",
        "month",
        "invoice_date",
        "invoice_number",
        "total_amount_cents",
        "pdf_path",
    },
    "invoice_items": {
        "invoice_id",
        "training_id",
        "description",
        "training_date",
        "hours",
        "unit_rate_cents",
        "amount_cents",
    },
}


def get_connection(database_path: Path = DATABASE_PATH) -> sqlite3.Connection:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    connection.execute("PRAGMA foreign_keys = ON")
    if database_path.stat().st_size == 0:
        connection.execute("VACUUM")
    return connection


def initialize_database(database_path: Path = DATABASE_PATH) -> None:
    with get_connection(database_path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS activity_types (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                hourly_rate_cents INTEGER NOT NULL CHECK (hourly_rate_cents >= 0),
                is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
            );

            CREATE TABLE IF NOT EXISTS weekly_plan (
                id INTEGER PRIMARY KEY,
                weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
                activity_type_id INTEGER NOT NULL
                    REFERENCES activity_types (id) ON DELETE RESTRICT,
                hours REAL NOT NULL CHECK (hours > 0),
                is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
            );

            CREATE TABLE IF NOT EXISTS trainings (
                id INTEGER PRIMARY KEY,
                training_date TEXT NOT NULL,
                activity_type_id INTEGER NOT NULL
                    REFERENCES activity_types (id) ON DELETE RESTRICT,
                hours REAL NOT NULL CHECK (hours > 0),
                status TEXT NOT NULL DEFAULT 'planned'
                    CHECK (status IN ('planned', 'completed', 'cancelled')),
                note TEXT,
                unit_rate_cents INTEGER NOT NULL CHECK (unit_rate_cents >= 0)
            );

            CREATE TABLE IF NOT EXISTS invoices (
                id INTEGER PRIMARY KEY,
                year INTEGER NOT NULL CHECK (year BETWEEN 1 AND 9999),
                month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
                invoice_date TEXT NOT NULL,
                invoice_number TEXT,
                total_amount_cents INTEGER NOT NULL
                    CHECK (total_amount_cents >= 0),
                pdf_path TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS invoice_items (
                id INTEGER PRIMARY KEY,
                invoice_id INTEGER NOT NULL
                    REFERENCES invoices (id) ON DELETE CASCADE,
                training_id INTEGER
                    REFERENCES trainings (id) ON DELETE SET NULL,
                description TEXT NOT NULL,
                training_date TEXT NOT NULL,
                hours REAL NOT NULL CHECK (hours > 0),
                unit_rate_cents INTEGER NOT NULL CHECK (unit_rate_cents >= 0),
                amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0)
            );

            CREATE INDEX IF NOT EXISTS idx_weekly_plan_weekday
                ON weekly_plan (weekday);
            CREATE INDEX IF NOT EXISTS idx_trainings_date
                ON trainings (training_date);
            CREATE INDEX IF NOT EXISTS idx_invoices_year_month
                ON invoices (year, month);
            CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice
                ON invoice_items (invoice_id);
            """
        )


def _validate_table(table: str) -> set[str]:
    try:
        return TABLE_COLUMNS[table]
    except KeyError as error:
        raise ValueError(f"Unbekannte Tabelle: {table}") from error


def _validate_fields(table: str, fields: dict[str, Any]) -> None:
    allowed_columns = _validate_table(table)
    unknown_columns = fields.keys() - allowed_columns
    if unknown_columns:
        names = ", ".join(sorted(unknown_columns))
        raise ValueError(f"Ungültige Spalten für {table}: {names}")


def create_record(
    table: str,
    values: dict[str, Any],
    database_path: Path = DATABASE_PATH,
) -> int:
    _validate_fields(table, values)
    if not values:
        raise ValueError("Zum Anlegen eines Datensatzes sind Werte erforderlich")

    columns = ", ".join(values)
    placeholders = ", ".join("?" for _ in values)
    with sqlite3.connect(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        cursor = connection.execute(
            f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
            tuple(values.values()),
        )
        return int(cursor.lastrowid)


def get_record(
    table: str,
    record_id: int,
    database_path: Path = DATABASE_PATH,
) -> dict[str, Any] | None:
    _validate_table(table)
    with sqlite3.connect(database_path) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            f"SELECT * FROM {table} WHERE id = ?",
            (record_id,),
        ).fetchone()
        return dict(row) if row is not None else None


def list_records(
    table: str,
    filters: dict[str, Any] | None = None,
    database_path: Path = DATABASE_PATH,
) -> list[dict[str, Any]]:
    filters = filters or {}
    _validate_fields(table, filters)
    where_clause = ""
    parameters: tuple[Any, ...] = ()
    if filters:
        where_clause = " WHERE " + " AND ".join(
            f"{column} = ?" for column in filters
        )
        parameters = tuple(filters.values())

    with sqlite3.connect(database_path) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            f"SELECT * FROM {table}{where_clause} ORDER BY id",
            parameters,
        ).fetchall()
        return [dict(row) for row in rows]


def update_record(
    table: str,
    record_id: int,
    values: dict[str, Any],
    database_path: Path = DATABASE_PATH,
) -> bool:
    _validate_fields(table, values)
    if not values:
        raise ValueError("Zum Ändern eines Datensatzes sind Werte erforderlich")

    assignments = ", ".join(f"{column} = ?" for column in values)
    with sqlite3.connect(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        cursor = connection.execute(
            f"UPDATE {table} SET {assignments} WHERE id = ?",
            (*values.values(), record_id),
        )
        return cursor.rowcount > 0


def delete_record(
    table: str,
    record_id: int,
    database_path: Path = DATABASE_PATH,
) -> bool:
    _validate_table(table)
    with sqlite3.connect(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        cursor = connection.execute(
            f"DELETE FROM {table} WHERE id = ?",
            (record_id,),
        )
        return cursor.rowcount > 0


def create_invoice_with_items(
    invoice: dict[str, Any],
    items: list[dict[str, Any]],
    database_path: Path = DATABASE_PATH,
) -> int:
    _validate_fields("invoices", invoice)
    if not invoice:
        raise ValueError("Rechnungsdaten sind erforderlich")
    for item in items:
        _validate_fields("invoice_items", item)

    invoice_columns = ", ".join(invoice)
    invoice_placeholders = ", ".join("?" for _ in invoice)
    item_fields = tuple(items[0]) if items else ()
    if any(set(item) != set(item_fields) for item in items):
        raise ValueError("Alle Rechnungspositionen müssen dieselben Felder haben")
    item_columns = ", ".join(("invoice_id", *item_fields))
    item_placeholders = ", ".join("?" for _ in range(len(item_fields) + 1))

    with sqlite3.connect(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        invoice_cursor = connection.execute(
            f"INSERT INTO invoices ({invoice_columns}) "
            f"VALUES ({invoice_placeholders})",
            tuple(invoice.values()),
        )
        invoice_id = int(invoice_cursor.lastrowid)
        if items:
            statement = (
                f"INSERT INTO invoice_items ({item_columns}) "
                f"VALUES ({item_placeholders})"
            )
            connection.executemany(
                statement,
                [
                    (invoice_id, *(item[field] for field in item_fields))
                    for item in items
                ],
            )
        return invoice_id


def get_invoice(
    invoice_id: int,
    database_path: Path = DATABASE_PATH,
) -> dict[str, Any] | None:
    invoice = get_record("invoices", invoice_id, database_path)
    if invoice is None:
        return None
    invoice["items"] = list_records(
        "invoice_items",
        {"invoice_id": invoice_id},
        database_path,
    )
    return invoice