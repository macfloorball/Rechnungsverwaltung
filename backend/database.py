import re
import sqlite3
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATABASE_PATH = PROJECT_ROOT / "data" / "ttc.db"

TABLE_COLUMNS = {
    "organizations": {
        "name",
        "address",
        "street",
        "postal_code",
        "city",
        "recipient_name",
        "recipient_street",
        "recipient_postal_code",
        "recipient_city",
        "recipient_email",
        "issuer_first_name",
        "issuer_last_name",
        "email",
        "phone",
        "iban",
        "bic",
        "account_holder",
        "bank_name",
        "tax_number",
        "vat_id",
        "additional_tax_info",
        "logo_path",
        "logo_data",
        "logo_media_type",
        "logo_enabled",
        "invoice_number_prefix",
        "next_invoice_number",
        "payment_due_days",
        "invoice_text",
        "payment_notice",
        "standard_service_description",
        "invoice_footer",
    },
    "activity_types": {
        "organization_id",
        "name",
        "hourly_rate_cents",
        "is_active",
    },
    "weekly_plan": {
        "organization_id",
        "weekday",
        "activity_type_id",
        "hours",
        "is_active",
    },
    "trainings": {
        "organization_id",
        "training_date",
        "weekly_plan_id",
        "weekly_plan_date",
        "weekly_plan_generated",
        "activity_type_id",
        "hours",
        "status",
        "note",
        "unit_rate_cents",
    },
    "invoices": {
        "organization_id",
        "year",
        "month",
        "invoice_date",
        "invoice_number",
        "total_amount_cents",
        "pdf_path",
        "invoice_snapshot_json",
        "logo_snapshot",
        "logo_media_type",
    },
    "invoice_items": {
        "organization_id",
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
            CREATE TABLE IF NOT EXISTS organizations (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                address TEXT NOT NULL DEFAULT '',
                street TEXT NOT NULL DEFAULT '',
                postal_code TEXT NOT NULL DEFAULT '',
                city TEXT NOT NULL DEFAULT '',
                recipient_name TEXT NOT NULL DEFAULT '',
                recipient_street TEXT NOT NULL DEFAULT '',
                recipient_postal_code TEXT NOT NULL DEFAULT '',
                recipient_city TEXT NOT NULL DEFAULT '',
                recipient_email TEXT NOT NULL DEFAULT '',
                issuer_first_name TEXT NOT NULL DEFAULT '',
                issuer_last_name TEXT NOT NULL DEFAULT '',
                email TEXT NOT NULL DEFAULT '',
                phone TEXT,
                iban TEXT NOT NULL DEFAULT '',
                bic TEXT,
                account_holder TEXT NOT NULL DEFAULT '',
                bank_name TEXT,
                tax_number TEXT,
                vat_id TEXT,
                additional_tax_info TEXT,
                logo_path TEXT,
                logo_data BLOB,
                logo_media_type TEXT,
                logo_enabled INTEGER NOT NULL DEFAULT 0
                    CHECK (logo_enabled IN (0, 1)),
                invoice_number_prefix TEXT NOT NULL DEFAULT 'RE',
                next_invoice_number INTEGER NOT NULL DEFAULT 1
                    CHECK (next_invoice_number > 0),
                payment_due_days INTEGER NOT NULL DEFAULT 14
                    CHECK (payment_due_days >= 0),
                invoice_text TEXT NOT NULL DEFAULT '',
                payment_notice TEXT NOT NULL DEFAULT '',
                standard_service_description TEXT NOT NULL DEFAULT '',
                invoice_footer TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS activity_types (
                id INTEGER PRIMARY KEY,
                organization_id INTEGER NOT NULL DEFAULT 1
                    REFERENCES organizations (id),
                name TEXT NOT NULL UNIQUE,
                hourly_rate_cents INTEGER NOT NULL CHECK (hourly_rate_cents >= 0),
                is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
            );

            CREATE TABLE IF NOT EXISTS weekly_plan (
                id INTEGER PRIMARY KEY,
                organization_id INTEGER NOT NULL DEFAULT 1
                    REFERENCES organizations (id),
                weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
                activity_type_id INTEGER NOT NULL
                    REFERENCES activity_types (id) ON DELETE RESTRICT,
                hours REAL NOT NULL CHECK (hours > 0),
                is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
            );

            CREATE TABLE IF NOT EXISTS trainings (
                id INTEGER PRIMARY KEY,
                organization_id INTEGER NOT NULL DEFAULT 1
                    REFERENCES organizations (id),
                training_date TEXT NOT NULL,
                activity_type_id INTEGER NOT NULL
                    REFERENCES activity_types (id) ON DELETE RESTRICT,
                hours REAL CHECK (hours IS NULL OR hours > 0),
                status TEXT NOT NULL DEFAULT 'planned'
                    CHECK (status IN ('planned', 'completed', 'cancelled')),
                note TEXT,
                unit_rate_cents INTEGER NOT NULL CHECK (unit_rate_cents >= 0),
                weekly_plan_generated INTEGER NOT NULL DEFAULT 0
                    CHECK (weekly_plan_generated IN (0, 1))
            );

            CREATE TABLE IF NOT EXISTS invoices (
                id INTEGER PRIMARY KEY,
                organization_id INTEGER NOT NULL DEFAULT 1
                    REFERENCES organizations (id),
                year INTEGER NOT NULL CHECK (year BETWEEN 1 AND 9999),
                month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
                invoice_date TEXT NOT NULL,
                invoice_number TEXT,
                total_amount_cents INTEGER NOT NULL
                    CHECK (total_amount_cents >= 0),
                pdf_path TEXT,
                invoice_snapshot_json TEXT,
                logo_snapshot BLOB,
                logo_media_type TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS invoice_items (
                id INTEGER PRIMARY KEY,
                organization_id INTEGER NOT NULL DEFAULT 1
                    REFERENCES organizations (id),
                invoice_id INTEGER NOT NULL
                    REFERENCES invoices (id) ON DELETE CASCADE,
                training_id INTEGER
                    REFERENCES trainings (id) ON DELETE SET NULL,
                description TEXT NOT NULL,
                training_date TEXT NOT NULL,
                hours REAL CHECK (hours IS NULL OR hours > 0),
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

            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        connection.execute(
            "INSERT OR IGNORE INTO organizations (id, name) VALUES (1, '')"
        )
        connection.commit()
        _migrate_organization_support(connection)
        _migrate_organization_invoice_fields(connection)
        _migrate_weekly_plan_occurrences(connection)
        _migrate_optional_training_hours(connection)
        _migrate_weekly_plan_generated(connection)


def _migrate_organization_support(connection: sqlite3.Connection) -> None:
    migration_version = 1
    current_version = connection.execute(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations"
    ).fetchone()[0]
    if current_version >= migration_version:
        return

    connection.execute("BEGIN IMMEDIATE")
    try:
        organization_columns = {
            "organization_id": "INTEGER REFERENCES organizations (id)",
        }
        snapshot_columns = {
            "invoice_snapshot_json": "TEXT",
            "logo_snapshot": "BLOB",
            "logo_media_type": "TEXT",
        }
        for table in (
            "activity_types",
            "weekly_plan",
            "trainings",
            "invoices",
            "invoice_items",
        ):
            existing_columns = {
                row[1]
                for row in connection.execute(f"PRAGMA table_info({table})")
            }
            if "organization_id" not in existing_columns:
                connection.execute(
                    f"ALTER TABLE {table} ADD COLUMN organization_id "
                    f"{organization_columns['organization_id']}"
                )
            if table == "invoices":
                for column, definition in snapshot_columns.items():
                    if column not in existing_columns:
                        connection.execute(
                            f"ALTER TABLE invoices ADD COLUMN {column} {definition}"
                        )

        connection.execute(
            "UPDATE activity_types SET organization_id = 1 "
            "WHERE organization_id IS NULL"
        )
        connection.execute(
            "UPDATE weekly_plan SET organization_id = 1 "
            "WHERE organization_id IS NULL"
        )
        connection.execute(
            "UPDATE trainings SET organization_id = 1 "
            "WHERE organization_id IS NULL"
        )
        connection.execute(
            "UPDATE invoices SET organization_id = 1 "
            "WHERE organization_id IS NULL"
        )
        connection.execute(
            """
            UPDATE invoice_items
            SET organization_id = COALESCE(
                (SELECT organization_id FROM invoices
                 WHERE invoices.id = invoice_items.invoice_id),
                1
            )
            WHERE organization_id IS NULL
            """
        )

        for table in (
            "activity_types",
            "weekly_plan",
            "trainings",
            "invoices",
            "invoice_items",
        ):
            connection.execute(
                f"CREATE INDEX IF NOT EXISTS idx_{table}_organization "
                f"ON {table} (organization_id)"
            )
            organization_expression = (
                "COALESCE((SELECT organization_id FROM invoices "
                "WHERE invoices.id = NEW.invoice_id), 1)"
                if table == "invoice_items"
                else "1"
            )
            connection.execute(
                f"""
                CREATE TRIGGER IF NOT EXISTS trg_{table}_assign_organization
                AFTER INSERT ON {table}
                WHEN NEW.organization_id IS NULL
                BEGIN
                    UPDATE {table}
                    SET organization_id = {organization_expression}
                    WHERE id = NEW.id;
                END
                """
            )

        connection.execute(
            "INSERT INTO schema_migrations (version) VALUES (?)",
            (migration_version,),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def _migrate_organization_invoice_fields(
    connection: sqlite3.Connection,
) -> None:
    migration_version = 2
    current_version = connection.execute(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations"
    ).fetchone()[0]
    if current_version >= migration_version:
        return

    connection.execute("BEGIN IMMEDIATE")
    try:
        existing_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(organizations)")
        }
        added_columns = {
            "recipient_name": "TEXT NOT NULL DEFAULT ''",
            "recipient_street": "TEXT NOT NULL DEFAULT ''",
            "recipient_postal_code": "TEXT NOT NULL DEFAULT ''",
            "recipient_city": "TEXT NOT NULL DEFAULT ''",
            "recipient_email": "TEXT NOT NULL DEFAULT ''",
        }
        for column, definition in added_columns.items():
            if column not in existing_columns:
                connection.execute(
                    f"ALTER TABLE organizations ADD COLUMN {column} {definition}"
                )
        connection.execute(
            """
            UPDATE organizations
            SET invoice_number_prefix = 'RE'
            WHERE TRIM(invoice_number_prefix) = ''
            """
        )
        connection.execute(
            "INSERT INTO schema_migrations (version) VALUES (?)",
            (migration_version,),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def _migrate_weekly_plan_occurrences(connection: sqlite3.Connection) -> None:
    migration_version = 3
    current_version = connection.execute(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations"
    ).fetchone()[0]
    if current_version >= migration_version:
        return

    connection.execute("BEGIN IMMEDIATE")
    try:
        existing_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(trainings)")
        }
        added_columns = {
            "weekly_plan_id": (
                "INTEGER REFERENCES weekly_plan (id) ON DELETE SET NULL"
            ),
            "weekly_plan_date": "TEXT",
        }
        for column, definition in added_columns.items():
            if column not in existing_columns:
                connection.execute(
                    f"ALTER TABLE trainings ADD COLUMN {column} {definition}"
                )
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_trainings_plan_occurrence
            ON trainings (weekly_plan_id, weekly_plan_date)
            WHERE weekly_plan_id IS NOT NULL AND weekly_plan_date IS NOT NULL
            """
        )
        connection.execute(
            "INSERT INTO schema_migrations (version) VALUES (?)",
            (migration_version,),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def _migrate_optional_training_hours(connection: sqlite3.Connection) -> None:
    migration_version = 4
    current_version = connection.execute(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations"
    ).fetchone()[0]
    if current_version >= migration_version:
        return

    connection.execute("PRAGMA foreign_keys = OFF")
    connection.execute("BEGIN IMMEDIATE")
    try:
        for table in ("trainings", "invoice_items"):
            columns = connection.execute(
                f"PRAGMA table_info({table})"
            ).fetchall()
            hours_column = next(row for row in columns if row[1] == "hours")
            if not hours_column[3]:
                continue

            create_sql = connection.execute(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
                (table,),
            ).fetchone()[0]
            create_sql = create_sql.replace(
                f"CREATE TABLE {table}",
                f"CREATE TABLE {table}_new",
                1,
            )
            create_sql, replacements = re.subn(
                r"\bhours\s+([A-Z]+)\s+NOT\s+NULL"
                r"(?:\s+CHECK\s*\(\s*hours\s*>\s*0\s*\))?",
                r"hours \1 CHECK (hours IS NULL OR hours > 0)",
                create_sql,
                count=1,
                flags=re.IGNORECASE,
            )
            if replacements != 1:
                raise RuntimeError(
                    f"Stundenspalte in {table} konnte nicht migriert werden"
                )

            schema_objects = connection.execute(
                """
                SELECT sql
                FROM sqlite_master
                WHERE tbl_name = ? AND type IN ('index', 'trigger')
                  AND sql IS NOT NULL
                """,
                (table,),
            ).fetchall()
            connection.execute(create_sql)
            column_names = ", ".join(f'"{row[1]}"' for row in columns)
            connection.execute(
                f"INSERT INTO {table}_new ({column_names}) "
                f"SELECT {column_names} FROM {table}"
            )
            connection.execute(f"DROP TABLE {table}")
            connection.execute(f"ALTER TABLE {table}_new RENAME TO {table}")
            for (schema_sql,) in schema_objects:
                connection.execute(schema_sql)

        connection.execute(
            "INSERT INTO schema_migrations (version) VALUES (?)",
            (migration_version,),
        )
        violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError(
                "Fremdschlüsselprüfung nach Stundenmigration fehlgeschlagen"
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.execute("PRAGMA foreign_keys = ON")


def _migrate_weekly_plan_generated(connection: sqlite3.Connection) -> None:
    migration_version = 5
    current_version = connection.execute(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations"
    ).fetchone()[0]
    if current_version >= migration_version:
        return

    connection.execute("BEGIN IMMEDIATE")
    try:
        existing_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(trainings)")
        }
        if "weekly_plan_generated" not in existing_columns:
            connection.execute(
                """
                ALTER TABLE trainings
                ADD COLUMN weekly_plan_generated INTEGER NOT NULL DEFAULT 0
                    CHECK (weekly_plan_generated IN (0, 1))
                """
            )
        connection.execute(
            """
            UPDATE trainings
            SET weekly_plan_generated = 1
            WHERE weekly_plan_id IS NOT NULL
              AND weekly_plan_date = training_date
            """
        )
        connection.execute(
            "INSERT INTO schema_migrations (version) VALUES (?)",
            (migration_version,),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def get_organization(
    database_path: Path = DATABASE_PATH,
    organization_id: int = 1,
) -> dict[str, Any] | None:
    with sqlite3.connect(database_path) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            "SELECT * FROM organizations WHERE id = ?",
            (organization_id,),
        ).fetchone()
        return dict(row) if row is not None else None


def update_organization(
    values: dict[str, Any],
    database_path: Path = DATABASE_PATH,
    organization_id: int = 1,
) -> bool:
    _validate_fields("organizations", values)
    if not values:
        return False

    assignments = ", ".join(f"{column} = ?" for column in values)
    with sqlite3.connect(database_path) as connection:
        cursor = connection.execute(
            f"""
            UPDATE organizations
            SET {assignments}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (*values.values(), organization_id),
        )
        return cursor.rowcount > 0


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
    expected_next_invoice_number: int | None = None,
    updated_next_invoice_number: int | None = None,
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
        if expected_next_invoice_number is not None:
            organization_id = invoice.get("organization_id", 1)
            cursor = connection.execute(
                """
                UPDATE organizations
                SET next_invoice_number = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND next_invoice_number = ?
                """,
                (
                    updated_next_invoice_number or expected_next_invoice_number + 1,
                    organization_id,
                    expected_next_invoice_number,
                ),
            )
            if cursor.rowcount != 1:
                raise ValueError("Der Rechnungsnummernkreis wurde parallel geändert")
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