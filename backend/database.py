import calendar
from datetime import date
import re
import sqlite3
import tempfile
import os
from contextlib import closing
from contextlib import contextmanager
from pathlib import Path
from collections.abc import Iterator
from typing import Any

from backend.paths import PROJECT_ROOT, get_database_path
from backend.storage_errors import DatabaseAccessError, error_code

# Compatibility constant; runtime defaults are resolved inside get_connection.
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
        "is_preview",
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


@contextmanager
def get_connection(
    database_path: Path | None = None, *, create: bool = False,
) -> Iterator[sqlite3.Connection]:
    """One transaction per operation; always close, including on rollback."""
    database_path = Path(database_path) if database_path is not None else get_database_path()
    connection = None
    try:
        if database_path.is_symlink() or (database_path.exists() and not database_path.is_file()):
            raise DatabaseAccessError("access")
        if not create and not database_path.exists():
            raise DatabaseAccessError("missing")
        if database_path.exists() and not os.access(database_path, os.R_OK | os.W_OK):
            raise DatabaseAccessError("access")
        if create:
            database_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        uri = database_path.resolve().as_uri() + ("?mode=rwc" if create else "?mode=rw")
        connection = sqlite3.connect(uri, uri=True, timeout=5)
        connection.execute("PRAGMA foreign_keys = ON")
        with connection:
            yield connection
    except sqlite3.IntegrityError:
        raise
    except DatabaseAccessError:
        raise
    except (sqlite3.DatabaseError, OSError) as error:
        raise DatabaseAccessError(error_code(error)) from None
    finally:
        if connection is not None:
            connection.close()


SCHEMA_VERSION = 6


def get_schema_version(connection: sqlite3.Connection) -> int:
    tables = {row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
    )}
    if "schema_migrations" not in tables:
        return 0
    versions = [row[0] for row in connection.execute(
        "SELECT version FROM schema_migrations ORDER BY version"
    )]
    if versions != list(range(1, len(versions) + 1)):
        raise ValueError("Ungültige Reihenfolge der Datenbankmigrationen")
    if versions and versions[-1] > SCHEMA_VERSION:
        raise ValueError("Diese Datenbank benötigt eine neuere App-Version")
    return len(versions)


def _backup_before_migration(connection: sqlite3.Connection, path: Path) -> None:
    # SQLite backup includes committed WAL contents; never overwrite a recovery copy.
    descriptor, name = tempfile.mkstemp(prefix=path.name + ".before-migration-", suffix=".sqlite3", dir=path.parent)
    os.close(descriptor)
    target = Path(name)
    try:
        with closing(sqlite3.connect(target)) as backup:
            connection.backup(backup)
            if backup.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise sqlite3.DatabaseError("Migrationssicherung ist beschädigt")
    except Exception:
        target.unlink(missing_ok=True)
        raise


def initialize_database(database_path: Path | None = None) -> None:
    database_path = Path(database_path) if database_path is not None else get_database_path()
    existed = database_path.exists()
    if existed and database_path.is_file() and database_path.stat().st_size == 0:
        raise DatabaseAccessError("corrupt")
    with get_connection(database_path, create=True) as connection:
        if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise sqlite3.DatabaseError("Integritätsprüfung der Datenbank fehlgeschlagen")
        version = get_schema_version(connection)
        if existed:
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            required_tables = set(TABLE_COLUMNS) - ({"organizations"} if version == 0 else set())
            if not required_tables <= tables:
                raise DatabaseAccessError("corrupt")
            if version == SCHEMA_VERSION:
                for table, fields in TABLE_COLUMNS.items():
                    columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
                    if not (fields | {"id"}) <= columns:
                        raise DatabaseAccessError("corrupt")
        if existed and version < SCHEMA_VERSION:
            _backup_before_migration(connection, database_path)
        schema = (
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
                is_preview INTEGER NOT NULL DEFAULT 0
                    CHECK (is_preview IN (0, 1)),
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
        # executescript would implicitly commit; keep bootstrap transactional.
        connection.execute("BEGIN IMMEDIATE")
        for statement in schema.split(";"):
            if statement.strip():
                connection.execute(statement)
        connection.execute(
            "INSERT OR IGNORE INTO organizations (id, name) VALUES (1, '')"
        )
        connection.commit()
        for migration in (
            _migrate_organization_support,
            _migrate_organization_invoice_fields,
            _migrate_weekly_plan_occurrences,
            _migrate_optional_training_hours,
            _migrate_weekly_plan_generated,
            _migrate_invoice_previews,
        ):
            migration(connection)
        if connection.execute("PRAGMA foreign_key_check").fetchall():
            raise sqlite3.DatabaseError("Fremdschlüsselprüfung fehlgeschlagen")


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
    database_path: Path | None = None,
    organization_id: int = 1,
) -> dict[str, Any] | None:
    with get_connection(database_path) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            "SELECT * FROM organizations WHERE id = ?",
            (organization_id,),
        ).fetchone()
        return dict(row) if row is not None else None


def update_organization(
    values: dict[str, Any],
    database_path: Path | None = None,
    organization_id: int = 1,
) -> bool:
    _validate_fields("organizations", values)
    if not values:
        return False

    assignments = ", ".join(f"{column} = ?" for column in values)
    with get_connection(database_path) as connection:
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
    database_path: Path | None = None,
) -> int:
    _validate_fields(table, values)
    if not values:
        raise ValueError("Zum Anlegen eines Datensatzes sind Werte erforderlich")

    columns = ", ".join(values)
    placeholders = ", ".join("?" for _ in values)
    with get_connection(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        cursor = connection.execute(
            f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
            tuple(values.values()),
        )
        return int(cursor.lastrowid)


def _migrate_invoice_previews(connection: sqlite3.Connection) -> None:
    migration_version = 6
    current_version = connection.execute(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations"
    ).fetchone()[0]
    if current_version >= migration_version:
        return

    connection.execute("BEGIN IMMEDIATE")
    try:
        existing_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(invoices)")
        }
        if "is_preview" not in existing_columns:
            connection.execute(
                """
                ALTER TABLE invoices
                ADD COLUMN is_preview INTEGER NOT NULL DEFAULT 0
                    CHECK (is_preview IN (0, 1))
                """
            )
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_unique_preview_period
            ON invoices (year, month)
            WHERE is_preview = 1
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


def get_record(
    table: str,
    record_id: int,
    database_path: Path | None = None,
) -> dict[str, Any] | None:
    _validate_table(table)
    with get_connection(database_path) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            f"SELECT * FROM {table} WHERE id = ?",
            (record_id,),
        ).fetchone()
        return dict(row) if row is not None else None


def list_records(
    table: str,
    filters: dict[str, Any] | None = None,
    database_path: Path | None = None,
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

    with get_connection(database_path) as connection:
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
    database_path: Path | None = None,
) -> bool:
    _validate_fields(table, values)
    if not values:
        raise ValueError("Zum Ändern eines Datensatzes sind Werte erforderlich")

    assignments = ", ".join(f"{column} = ?" for column in values)
    with get_connection(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        cursor = connection.execute(
            f"UPDATE {table} SET {assignments} WHERE id = ?",
            (*values.values(), record_id),
        )
        return cursor.rowcount > 0


def delete_record(
    table: str,
    record_id: int,
    database_path: Path | None = None,
) -> bool:
    _validate_table(table)
    with get_connection(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        cursor = connection.execute(
            f"DELETE FROM {table} WHERE id = ?",
            (record_id,),
        )
        return cursor.rowcount > 0


def create_invoice_with_items(
    invoice: dict[str, Any],
    items: list[dict[str, Any]],
    database_path: Path | None = None,
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

    with get_connection(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute(
            """
            SELECT id, is_preview
            FROM invoices
            WHERE year = ? AND month = ?
            ORDER BY id
            """,
            (invoice["year"], invoice["month"]),
        ).fetchall()
        finalized = [row for row in existing if not row[1]]
        if finalized:
            raise InvoiceAlreadyExistsError
        preview_ids = [row[0] for row in existing]

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

        if preview_ids:
            invoice_id = int(preview_ids[0])
            assignments = ", ".join(f"{column} = ?" for column in invoice)
            connection.execute(
                f"UPDATE invoices SET {assignments} WHERE id = ?",
                (*invoice.values(), invoice_id),
            )
            if len(preview_ids) > 1:
                placeholders = ", ".join("?" for _ in preview_ids[1:])
                connection.execute(
                    f"DELETE FROM invoices WHERE id IN ({placeholders})",
                    tuple(preview_ids[1:]),
                )
            connection.execute(
                "DELETE FROM invoice_items WHERE invoice_id = ?",
                (invoice_id,),
            )
        else:
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


class InvoiceAlreadyExistsError(ValueError):
    """Raised when a finalized invoice already exists for the period."""


class InvoicePreviewDeletionError(ValueError):
    """Raised when attempting to delete a preview as a finalized invoice."""


def delete_final_invoice(
    invoice_id: int,
    database_path: Path | None = None,
) -> dict[str, Any] | None:
    with get_connection(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            "SELECT * FROM invoices WHERE id = ?",
            (invoice_id,),
        ).fetchone()
        if row is None:
            return None
        invoice = dict(row)
        if invoice["is_preview"]:
            raise InvoicePreviewDeletionError

        cursor = connection.execute(
            "DELETE FROM invoices WHERE id = ? AND is_preview = 0",
            (invoice_id,),
        )
        if cursor.rowcount != 1:
            return None
        return invoice


def save_invoice_preview(
    year: int,
    month: int,
    invoice_date: str,
    total_amount_cents: int,
    items: list[dict[str, Any]],
    database_path: Path | None = None,
) -> int:
    for item in items:
        _validate_fields("invoice_items", item)

    item_fields = tuple(items[0]) if items else ()
    if any(set(item) != set(item_fields) for item in items):
        raise ValueError("Alle Rechnungspositionen müssen dieselben Felder haben")

    with get_connection(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute(
            """
            SELECT id
            FROM invoices
            WHERE year = ? AND month = ? AND is_preview = 1
            ORDER BY id
            """,
            (year, month),
        ).fetchall()
        preview_ids = [int(row[0]) for row in existing]
        if preview_ids:
            invoice_id = preview_ids[0]
            connection.execute(
                """
                UPDATE invoices
                SET invoice_date = ?, total_amount_cents = ?,
                    invoice_number = NULL, pdf_path = NULL,
                    invoice_snapshot_json = NULL, logo_snapshot = NULL,
                    logo_media_type = NULL
                WHERE id = ?
                """,
                (invoice_date, total_amount_cents, invoice_id),
            )
            if len(preview_ids) > 1:
                placeholders = ", ".join("?" for _ in preview_ids[1:])
                connection.execute(
                    f"DELETE FROM invoices WHERE id IN ({placeholders})",
                    tuple(preview_ids[1:]),
                )
            connection.execute(
                "DELETE FROM invoice_items WHERE invoice_id = ?",
                (invoice_id,),
            )
        else:
            cursor = connection.execute(
                """
                INSERT INTO invoices (
                    year, month, is_preview, invoice_date, total_amount_cents
                ) VALUES (?, ?, 1, ?, ?)
                """,
                (year, month, invoice_date, total_amount_cents),
            )
            invoice_id = int(cursor.lastrowid)

        if items:
            columns = ", ".join(("invoice_id", *item_fields))
            placeholders = ", ".join("?" for _ in range(len(item_fields) + 1))
            connection.executemany(
                f"INSERT INTO invoice_items ({columns}) VALUES ({placeholders})",
                [
                    (invoice_id, *(item[field] for field in item_fields))
                    for item in items
                ],
            )
        return invoice_id


def get_invoice(
    invoice_id: int,
    database_path: Path | None = None,
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

class RecordNotFoundError(ValueError):
    """A requested record no longer exists."""


class InvalidRecordError(ValueError):
    """An invalid batch must be rolled back as a whole."""


def save_activities(activities: list[dict[str, Any]], database_path: Path) -> None:
    with get_connection(database_path) as connection:
        for activity in activities:
            if activity["id"] is None:
                connection.execute(
                    """
                    INSERT INTO activity_types (name, hourly_rate_cents, is_active)
                    VALUES (?, ?, ?)
                    """,
                    (
                        activity["name"],
                        activity["hourly_rate_cents"],
                        activity["is_active"],
                    ),
                )
            else:
                exists = connection.execute(
                    "SELECT 1 FROM activity_types WHERE id = ?",
                    (activity["id"],),
                ).fetchone()
                if exists is None:
                    raise RecordNotFoundError("Tätigkeitsart wurde nicht gefunden")
                connection.execute(
                    """
                    UPDATE activity_types
                    SET name = ?, hourly_rate_cents = ?, is_active = ?
                    WHERE id = ?
                    """,
                    (
                        activity["name"],
                        activity["hourly_rate_cents"],
                        activity["is_active"],
                        activity["id"],
                    ),
                )


def _ensure_weekly_plan_occurrences(
    connection: sqlite3.Connection,
    month_start: date,
) -> None:
    plan_entries = connection.execute(
        """
        SELECT weekly_plan.id, weekly_plan.organization_id, weekly_plan.weekday,
               weekly_plan.activity_type_id, weekly_plan.hours,
               activity_types.hourly_rate_cents
        FROM weekly_plan
        JOIN activity_types
          ON activity_types.id = weekly_plan.activity_type_id
         AND activity_types.organization_id = weekly_plan.organization_id
        WHERE weekly_plan.organization_id = 1
          AND weekly_plan.is_active = 1
          AND activity_types.is_active = 1
        ORDER BY weekly_plan.id
        """
    ).fetchall()
    days_in_month = calendar.monthrange(month_start.year, month_start.month)[1]

    for day_number in range(1, days_in_month + 1):
        current_date = date(month_start.year, month_start.month, day_number)
        date_string = current_date.isoformat()
        matching_entries: dict[int, list[tuple[int, int, float, int]]] = {}
        for entry in plan_entries:
            if entry[2] == current_date.weekday():
                matching_entries.setdefault(entry[3], []).append(
                    (entry[0], entry[1], entry[4], entry[5])
                )

        for activity_type_id, entries in matching_entries.items():
            existing_trainings = list(connection.execute(
                """
                SELECT id, weekly_plan_id
                FROM trainings
                WHERE organization_id = 1
                  AND training_date = ?
                  AND activity_type_id = ?
                ORDER BY id
                """,
                (date_string, activity_type_id),
            ).fetchall())
            used_training_ids: set[int] = set()

            for plan_id, organization_id, hours, unit_rate_cents in entries:
                occurrence = connection.execute(
                    """
                    SELECT id
                    FROM trainings
                    WHERE weekly_plan_id = ? AND weekly_plan_date = ?
                    """,
                    (plan_id, date_string),
                ).fetchone()
                if occurrence is not None:
                    used_training_ids.add(occurrence[0])
                    continue

                existing = next(
                    (
                        training
                        for training in existing_trainings
                        if training[0] not in used_training_ids
                    ),
                    None,
                )
                if existing is not None:
                    used_training_ids.add(existing[0])
                    if existing[1] is None:
                        connection.execute(
                            """
                            UPDATE trainings
                            SET weekly_plan_id = ?, weekly_plan_date = ?
                            WHERE id = ? AND weekly_plan_id IS NULL
                            """,
                            (plan_id, date_string, existing[0]),
                        )
                    continue

                cursor = connection.execute(
                    """
                    INSERT INTO trainings (
                        organization_id, training_date, weekly_plan_id,
                        weekly_plan_date, activity_type_id, hours, status,
                        note, unit_rate_cents, weekly_plan_generated
                    ) VALUES (?, ?, ?, ?, ?, ?, 'planned', NULL, ?, 1)
                    """,
                    (
                        organization_id,
                        date_string,
                        plan_id,
                        date_string,
                        activity_type_id,
                        hours,
                        unit_rate_cents,
                    ),
                )
                used_training_ids.add(cursor.lastrowid)
                existing_trainings.append((cursor.lastrowid, plan_id))


def save_weekly_plan(entries: list[dict[str, Any]], database_path: Path) -> None:
    with get_connection(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        existing_entries = {
            row[0]: row
            for row in connection.execute(
                """
                SELECT id, weekday, activity_type_id, hours, is_active
                FROM weekly_plan
                WHERE organization_id = 1
                """
            ).fetchall()
        }
        retained_ids: set[int] = set()
        requested_ids: set[int] = set()
        for entry in entries:
            if entry["id"] is not None:
                if entry["id"] in requested_ids:
                    raise InvalidRecordError("Ein Planeintrag wurde mehrfach übermittelt")
                if entry["id"] not in existing_entries:
                    raise RecordNotFoundError("Planeintrag wurde nicht gefunden")
                requested_ids.add(entry["id"])
                connection.execute(
                    """
                    UPDATE weekly_plan
                    SET weekday = ?, activity_type_id = ?, hours = ?, is_active = ?
                    WHERE id = ? AND organization_id = 1
                    """,
                    (
                        entry["weekday"],
                        entry["activity_type_id"],
                        entry["hours"],
                        entry["is_active"],
                        entry["id"],
                    ),
                )
                retained_ids.add(entry["id"])
                continue

            cursor = connection.execute(
                """
                INSERT INTO weekly_plan (
                    organization_id, weekday, activity_type_id, hours, is_active
                ) VALUES (1, ?, ?, ?, ?)
                """,
                (
                    entry["weekday"],
                    entry["activity_type_id"],
                    entry["hours"],
                    entry["is_active"],
                ),
            )
            retained_ids.add(cursor.lastrowid)

        for plan_id in existing_entries.keys() - retained_ids:
            connection.execute("DELETE FROM weekly_plan WHERE id = ?", (plan_id,))

        current_month = date.today().replace(day=1)
        following_month_index = current_month.year * 12 + current_month.month
        following_month = date(
            following_month_index // 12,
            following_month_index % 12 + 1,
            1,
        )
        _ensure_weekly_plan_occurrences(connection, current_month)
        _ensure_weekly_plan_occurrences(connection, following_month)


def ensure_weekly_plan_month(month_start: date, database_path: Path) -> None:
    with get_connection(database_path) as connection:
        connection.execute("BEGIN IMMEDIATE")
        _ensure_weekly_plan_occurrences(connection, month_start)


def complete_planned_month(year: int, month: int, database_path: Path) -> int:
    month_start = date(year, month, 1).isoformat()
    month_end = date(year, month, calendar.monthrange(year, month)[1]).isoformat()
    with get_connection(database_path) as connection:
        connection.execute("BEGIN IMMEDIATE")
        result = connection.execute(
            """
            UPDATE trainings
            SET status = 'completed'
            WHERE organization_id = 1
              AND training_date BETWEEN ? AND ?
              AND status = 'planned'
              AND weekly_plan_id IS NOT NULL
              AND weekly_plan_generated = 1
              AND weekly_plan_date = training_date
            """,
            (month_start, month_end),
        )
        updated_count = result.rowcount

    return updated_count
