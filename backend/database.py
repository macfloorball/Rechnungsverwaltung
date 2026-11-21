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
        "profile_name",
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
        "tax_id",
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
        "repeat_weeks",
        "start_date",
        "organization_id",
        "weekday",
        "activity_type_id",
        "hours",
        "is_active",
    },
    "trainings": {
        "manually_modified",
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


class ProfileDatabasePath(type(Path())):
    """Request-local database address; never a process-wide active profile."""
    def __new__(cls, path, profile_id=1):
        instance = super().__new__(cls, path)
        instance._profile_id = int(profile_id)
        return instance

    def __init__(self, path, profile_id=1):
        super().__init__(path)

    @property
    def profile_id(self):
        return self._profile_id


def profile_id(database_path):
    return getattr(database_path, "profile_id", 1)


@contextmanager
def get_connection(
    database_path: Path | None = None, *, create: bool = False,
) -> Iterator[sqlite3.Connection]:
    """One transaction per operation; always close, including on rollback."""
    requested_profile = profile_id(database_path)
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
        connection.create_function("current_profile", 0, lambda: requested_profile)
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


SCHEMA_VERSION = 9


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
            raise DatabaseAccessError("corrupt")
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
        if existed and version == SCHEMA_VERSION:
            if connection.execute("PRAGMA foreign_key_check").fetchall():
                raise DatabaseAccessError("corrupt")
            validate_profile_relationships(connection)
            # A normal restart/update validates only; never recreate or reseed data.
            return
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
            _migrate_profiles,
            _migrate_recurrence,
            _migrate_invoice_numbering,
        ):
            migration(connection)
        if connection.execute("PRAGMA foreign_key_check").fetchall():
            raise DatabaseAccessError("corrupt")


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
    organization_id: int | None = None,
) -> dict[str, Any] | None:
    organization_id = organization_id or profile_id(database_path)
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
    organization_id: int | None = None,
) -> bool:
    organization_id = organization_id or profile_id(database_path)
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

    if table != "organizations":
        values = {**values, "organization_id": profile_id(database_path)}
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


def _migrate_recurrence(connection):
    if get_schema_version(connection) != 7:
        return
    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute("ALTER TABLE weekly_plan ADD COLUMN repeat_weeks INTEGER NOT NULL DEFAULT 1 CHECK(repeat_weeks IN (1, 2))")
        connection.execute("ALTER TABLE weekly_plan ADD COLUMN start_date TEXT")
        # NULL means unknown legacy history, never proof of an untouched record.
        connection.execute("ALTER TABLE trainings ADD COLUMN manually_modified INTEGER CHECK(manually_modified IN (0, 1))")
        connection.execute("""CREATE TABLE weekly_plan_months (
            organization_id INTEGER NOT NULL REFERENCES organizations(id),
            month_start TEXT NOT NULL, PRIMARY KEY(organization_id, month_start))""")
        connection.execute("""INSERT OR IGNORE INTO weekly_plan_months
            SELECT organization_id, substr(weekly_plan_date, 1, 7) || '-01'
            FROM trainings WHERE weekly_plan_id IS NOT NULL AND weekly_plan_date IS NOT NULL""")
        fields = ("training_date", "activity_type_id", "hours", "status", "note",
                  "unit_rate_cents", "weekly_plan_id", "weekly_plan_date",
                  "weekly_plan_generated", "organization_id")
        changed = " OR ".join(f"NEW.{field} IS NOT OLD.{field}" for field in fields)
        connection.execute(f"""CREATE TRIGGER training_manual_change AFTER UPDATE ON trainings
            WHEN {changed} OR NEW.manually_modified IS NOT OLD.manually_modified
            BEGIN UPDATE trainings SET manually_modified = 1 WHERE id = NEW.id; END""")
        connection.execute("INSERT INTO schema_migrations(version) VALUES (8)")
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def _migrate_invoice_numbering(connection):
    if get_schema_version(connection) != 8:
        return
    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute("ALTER TABLE organizations ADD COLUMN tax_id TEXT")
        connection.execute("""CREATE TABLE invoice_counters (
            organization_id INTEGER NOT NULL REFERENCES organizations(id),
            year INTEGER NOT NULL CHECK(year BETWEEN 1 AND 9999),
            next_number INTEGER NOT NULL CHECK(next_number > 0),
            minimum_number INTEGER NOT NULL CHECK(minimum_number > 0),
            PRIMARY KEY(organization_id, year))""")
        connection.execute("""CREATE TABLE invoice_number_legacy_floors (
            organization_id INTEGER PRIMARY KEY REFERENCES organizations(id),
            minimum_number INTEGER NOT NULL CHECK(minimum_number > 0))""")
        # Legacy prefixes and months are not interpreted. Preserve a conservative
        # profile-wide floor for uncertain numbering, including deleted invoices.
        for identifier, legacy_next in connection.execute(
            "SELECT id, next_invoice_number FROM organizations"
        ).fetchall():
            floor = legacy_next
            years = {}
            unknown_year = False
            for number, invoice_date in connection.execute(
                "SELECT invoice_number, invoice_date FROM invoices "
                "WHERE organization_id = ? AND is_preview = 0", (identifier,)
            ):
                match = re.fullmatch(r"([0-9]{4})-([0-9]+)", number or "")
                if match and 1 <= int(match[1]) <= 9999:
                    year, serial = map(int, match.groups())
                    years[year] = max(years.get(year, 1), serial + 1)
                else:
                    try:
                        legacy_year = date.fromisoformat(invoice_date).year
                        years.setdefault(legacy_year, 1)
                    except (TypeError, ValueError):
                        unknown_year = True
                    # A trailing integer is only an upper bound, never a guessed
                    # assignment to a year or a new label for an old invoice.
                    tail = re.search(r"([0-9]+)$", number or "")
                    if tail:
                        floor = max(floor, int(tail[1]) + 1)
            connection.execute("INSERT INTO invoice_number_legacy_floors VALUES (?, ?)", (identifier, floor if unknown_year or not years else 1))
            for year, minimum in years.items():
                minimum = max(minimum, floor)
                connection.execute("INSERT INTO invoice_counters VALUES (?, ?, ?, ?)",
                                   (identifier, year, minimum, minimum))
        connection.execute("INSERT INTO schema_migrations(version) VALUES (9)")
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def _invoice_counter(connection, identifier, year):
    row = connection.execute(
        "SELECT next_number, minimum_number FROM invoice_counters WHERE organization_id = ? AND year = ?",
        (identifier, year),
    ).fetchone()
    legacy = connection.execute(
        "SELECT minimum_number FROM invoice_number_legacy_floors WHERE organization_id = ?", (identifier,)
    ).fetchone()
    floor = row[1] if row else (legacy[0] if legacy else 1)
    # Also reject collisions in imported records created without the allocator.
    for (number,) in connection.execute(
        "SELECT invoice_number FROM invoices WHERE organization_id = ? AND is_preview = 0",
        (identifier,),
    ):
        match = re.fullmatch(r"([0-9]{4})-([0-9]+)", number or "")
        if match and int(match[1]) == year:
            floor = max(floor, int(match[2]) + 1)
    return max(row[0], floor) if row else floor, floor


def get_invoice_counter(year, database_path=None):
    with get_connection(database_path) as connection:
        next_number, minimum = _invoice_counter(connection, profile_id(database_path), year)
        return {"year": year, "next_number": next_number, "minimum_number": minimum}


def set_invoice_counter(year, next_number, database_path=None):
    if type(year) is not int or not 1 <= year <= 9999 or type(next_number) is not int or not 1 <= next_number <= 999999999:
        raise ValueError("Jahr und nächste Nummer müssen gültige positive Ganzzahlen sein")
    with get_connection(database_path) as connection:
        connection.execute("BEGIN IMMEDIATE")
        identifier = profile_id(database_path)
        _, minimum = _invoice_counter(connection, identifier, year)
        if next_number < minimum:
            raise ValueError(f"Der Rechnungsnummernkreis beginnt frühestens bei {minimum}; vergebene Nummern bleiben gesperrt")
        connection.execute("""INSERT INTO invoice_counters VALUES (?, ?, ?, ?)
            ON CONFLICT(organization_id, year) DO UPDATE SET next_number = excluded.next_number""",
            (identifier, year, next_number, minimum))
    return get_invoice_counter(year, database_path)


def _plan_matches(weekday, repeat_weeks, start_date, day):
    if day.weekday() != weekday:
        return False
    # Weekly mode deliberately ignores the optional stored start date.
    if repeat_weeks == 1:
        return True
    start = date.fromisoformat(start_date)
    return day >= start and (day - start).days % 14 == 0


def get_record(
    table: str,
    record_id: int,
    database_path: Path | None = None,
) -> dict[str, Any] | None:
    _validate_table(table)
    with get_connection(database_path) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            f"SELECT * FROM {table} WHERE id = ? AND {'id' if table == 'organizations' else 'organization_id'} = ?",
            (record_id, profile_id(database_path)),
        ).fetchone()
        return dict(row) if row is not None else None


def list_records(
    table: str,
    filters: dict[str, Any] | None = None,
    database_path: Path | None = None,
) -> list[dict[str, Any]]:
    filters = dict(filters or {})
    if isinstance(database_path, ProfileDatabasePath):
        filters["id" if table == "organizations" else "organization_id"] = profile_id(database_path)
    _validate_fields(table, {k: v for k, v in filters.items() if k != "id"})
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
            f"UPDATE {table} SET {assignments} WHERE id = ? AND organization_id = ?",
            (*values.values(), record_id, profile_id(database_path)),
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
            f"DELETE FROM {table} WHERE id = ? AND organization_id = ?",
            (record_id, profile_id(database_path)),
        )
        return cursor.rowcount > 0


def create_invoice_with_items(
    invoice: dict[str, Any],
    items: list[dict[str, Any]],
    database_path: Path | None = None,
    expected_next_invoice_number: int | None = None,
    updated_next_invoice_number: int | None = None,
) -> int:
    invoice = {**invoice, "organization_id": profile_id(database_path)}
    _validate_fields("invoices", invoice)
    if not invoice:
        raise ValueError("Rechnungsdaten sind erforderlich")
    items = [{**item, "organization_id": profile_id(database_path)} for item in items]
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
            WHERE organization_id = current_profile() AND year = ? AND month = ?
            ORDER BY id
            """,
            (invoice["year"], invoice["month"]),
        ).fetchall()
        finalized = [row for row in existing if not row[1]]
        if finalized:
            raise InvoiceAlreadyExistsError
        preview_ids = [row[0] for row in existing]

        if invoice.get("pdf_path") and connection.execute(
            "SELECT 1 FROM invoices WHERE pdf_path = ? COLLATE NOCASE LIMIT 1",
            (invoice["pdf_path"],),
        ).fetchone():
            raise InvoiceDocumentConflictError

        if expected_next_invoice_number is not None:
            organization_id = invoice.get("organization_id", profile_id(database_path))
            numbering_year = date.fromisoformat(invoice["invoice_date"]).year
            actual, minimum = _invoice_counter(connection, organization_id, numbering_year)
            if actual != expected_next_invoice_number:
                raise ValueError("Der Rechnungsnummernkreis wurde parallel geändert")
            number = invoice.get("invoice_number")
            if number != f"{numbering_year:04d}-{actual:02d}":
                raise ValueError("Ungültiger Rechnungsnummernkreis")
            if connection.execute("SELECT 1 FROM invoices WHERE organization_id = ? AND invoice_number = ? AND is_preview = 0",
                                  (organization_id, number)).fetchone():
                raise ValueError("Der Rechnungsnummernkreis enthält eine bereits vergebene Nummer")
            # Retain the deprecated single counter as a compatibility mirror only.
            connection.execute("UPDATE organizations SET next_invoice_number = ? WHERE id = ?",
                               (actual + 1, organization_id))
            connection.execute("""INSERT INTO invoice_counters VALUES (?, ?, ?, ?)
                ON CONFLICT(organization_id, year) DO UPDATE SET
                next_number = excluded.next_number, minimum_number = excluded.minimum_number""",
                (organization_id, numbering_year, actual + 1, max(minimum, actual + 1)))

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


class InvoiceDocumentConflictError(ValueError):
    """Raised when a document reference is already assigned to an invoice."""


def get_invoice_document_owners(
    reference: str, database_path: Path | None = None,
) -> list[int]:
    with get_connection(database_path) as connection:
        # Windows filenames are case-insensitive. Treat case variants as the
        # same reference on every platform, including inconsistent legacy rows.
        return [row[0] for row in connection.execute(
            "SELECT id FROM invoices WHERE pdf_path = ? COLLATE NOCASE ORDER BY id",
            (reference,),
        )]


class InvoicePreviewDeletionError(ValueError):
    """Raised when attempting to delete a preview as a finalized invoice."""


class InvoiceDeletionConflictError(ValueError):
    """The selected invoice or its document ownership changed before deletion."""


@contextmanager
def invoice_document_deletion_guard(
    reference: str, database_path: Path | None = None,
) -> Iterator[None]:
    """Keep database writers out while an unreferenced PDF is removed."""
    with get_connection(database_path) as connection:
        connection.execute("BEGIN IMMEDIATE")
        if connection.execute(
            "SELECT 1 FROM invoices WHERE pdf_path = ? COLLATE NOCASE LIMIT 1",
            (reference,),
        ).fetchone():
            raise InvoiceDeletionConflictError
        yield


def delete_final_invoice(
    invoice_id: int,
    database_path: Path | None = None,
    *, expected_invoice: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    with get_connection(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            "SELECT * FROM invoices WHERE id = ? AND organization_id = current_profile()",
            (invoice_id,),
        ).fetchone()
        if row is None:
            return None
        invoice = dict(row)
        if invoice["is_preview"]:
            raise InvoicePreviewDeletionError
        if expected_invoice is not None and any(
            expected_invoice.get(field) != value for field, value in invoice.items()
        ):
            raise InvoiceDeletionConflictError
        if invoice["pdf_path"] and connection.execute(
            "SELECT 1 FROM invoices WHERE pdf_path = ? COLLATE NOCASE AND id != ? LIMIT 1",
            (invoice["pdf_path"], invoice_id),
        ).fetchone():
            raise InvoiceDeletionConflictError

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
    items = [{**item, "organization_id": profile_id(database_path)} for item in items]
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
            WHERE organization_id = current_profile() AND year = ? AND month = ? AND is_preview = 1
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
                    organization_id, year, month, is_preview, invoice_date, total_amount_cents
                ) VALUES (current_profile(), ?, ?, 1, ?, ?)
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
        # Serialize the count and writes: concurrent requests cannot claim the
        # same final slot. Omitted records are retained, including inactive ones.
        connection.execute("BEGIN IMMEDIATE")
        existing_ids = {row[0] for row in connection.execute(
            "SELECT id FROM activity_types WHERE organization_id = current_profile()"
        )}
        requested_ids = [activity["id"] for activity in activities if activity["id"] is not None]
        if len(requested_ids) != len(set(requested_ids)):
            raise InvalidRecordError("Eine Tätigkeit wurde mehrfach übermittelt")
        if not set(requested_ids) <= existing_ids:
            raise RecordNotFoundError("Tätigkeitsart wurde nicht gefunden")
        if len(existing_ids) + sum(activity["id"] is None for activity in activities) > 10:
            raise InvalidRecordError(
                "Es können höchstens zehn Tätigkeiten insgesamt angelegt werden, einschließlich deaktivierter Tätigkeiten"
            )
        for activity in activities:
            if activity["id"] is None:
                connection.execute(
                    """
                    INSERT INTO activity_types (organization_id, name, hourly_rate_cents, is_active)
                    VALUES (current_profile(), ?, ?, ?)
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
                    WHERE id = ? AND organization_id = current_profile()
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
    *, after: date | None = None, only_ids: set[int] | None = None,
) -> int:
    connection.execute("INSERT OR IGNORE INTO weekly_plan_months VALUES (current_profile(), ?)", (month_start.isoformat(),))
    added = 0
    plan_entries = connection.execute(
        """
        SELECT weekly_plan.id, weekly_plan.organization_id, weekly_plan.weekday,
               weekly_plan.activity_type_id, weekly_plan.hours,
               activity_types.hourly_rate_cents, weekly_plan.repeat_weeks, weekly_plan.start_date
        FROM weekly_plan
        JOIN activity_types
          ON activity_types.id = weekly_plan.activity_type_id
         AND activity_types.organization_id = weekly_plan.organization_id
        WHERE weekly_plan.organization_id = current_profile()
          AND weekly_plan.is_active = 1
          AND activity_types.is_active = 1
        ORDER BY weekly_plan.id
        """
    ).fetchall()
    days_in_month = calendar.monthrange(month_start.year, month_start.month)[1]

    for day_number in range(1, days_in_month + 1):
        current_date = date(month_start.year, month_start.month, day_number)
        if after is not None and current_date <= after:
            continue
        date_string = current_date.isoformat()
        matching_entries: dict[int, list[tuple[int, int, float, int]]] = {}
        for entry in plan_entries:
            if (only_ids is None or entry[0] in only_ids) and _plan_matches(entry[2], entry[6], entry[7], current_date):
                matching_entries.setdefault(entry[3], []).append(
                    (entry[0], entry[1], entry[4], entry[5])
                )

        for activity_type_id, entries in matching_entries.items():
            existing_trainings = list(connection.execute(
                """
                SELECT id, weekly_plan_id
                FROM trainings
                WHERE organization_id = current_profile()
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
                    WHERE organization_id = current_profile() AND weekly_plan_id = ?
                      AND (weekly_plan_date = ? OR training_date = ?)
                    """,
                    (plan_id, date_string, date_string),
                ).fetchone()
                if occurrence is not None:
                    used_training_ids.add(occurrence[0])
                    continue

                existing = next(
                    (
                        training
                        for training in existing_trainings
                        if training[0] not in used_training_ids and training[1] is None
                    ),
                    None,
                )
                if existing is not None:
                    used_training_ids.add(existing[0])
                    # A collision is not evidence of origin. Leave manual rows
                    # completely untouched, including provenance and edit proof.
                    continue

                cursor = connection.execute(
                    """
                    INSERT INTO trainings (
                        organization_id, training_date, weekly_plan_id,
                        weekly_plan_date, activity_type_id, hours, status,
                        note, unit_rate_cents, weekly_plan_generated, manually_modified
                    ) VALUES (?, ?, ?, ?, ?, ?, 'planned', NULL, ?, 1, 0)
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
                added += 1
                used_training_ids.add(cursor.lastrowid)
                existing_trainings.append((cursor.lastrowid, plan_id))

    return added

def save_weekly_plan(entries: list[dict[str, Any]], database_path: Path) -> dict[str, int]:
    from backend.models import WeeklyPlanEntry
    # Validate direct database callers too, before making any writes.
    entries = [WeeklyPlanEntry.model_validate(entry).model_dump(mode="json") for entry in entries]
    result = {"added": 0, "removed": 0, "updated": 0, "preserved": 0}
    today = date.today()
    with get_connection(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        existing_entries = {
            row[0]: row
            for row in connection.execute(
                """
                SELECT id, weekday, activity_type_id, hours, is_active, repeat_weeks, start_date
                FROM weekly_plan
                WHERE organization_id = current_profile()
                """
            ).fetchall()
        }
        retained_ids: set[int] = set()
        requested_ids: set[int] = set()
        for entry in entries:
            activity = connection.execute(
                "SELECT is_active FROM activity_types WHERE id = ? AND organization_id = current_profile()",
                (entry["activity_type_id"],),
            ).fetchone()
            previous = existing_entries.get(entry["id"])
            if activity is not None and not activity[0] and (
                previous is None or previous[2] != entry["activity_type_id"]
            ):
                raise InvalidRecordError("Bitte wähle eine aktive Tätigkeit für neue Zuordnungen")
            if entry["id"] is not None:
                if entry["id"] in requested_ids:
                    raise InvalidRecordError("Ein Planeintrag wurde mehrfach übermittelt")
                if entry["id"] not in existing_entries:
                    raise RecordNotFoundError("Planeintrag wurde nicht gefunden")
                requested_ids.add(entry["id"])
                connection.execute(
                    """
                    UPDATE weekly_plan
                    SET weekday = ?, activity_type_id = ?, hours = ?, is_active = ?, repeat_weeks = ?, start_date = ?
                    WHERE id = ? AND organization_id = current_profile()
                    """,
                    (
                        entry["weekday"],
                        entry["activity_type_id"],
                        entry["hours"],
                        entry["is_active"],
                        entry["repeat_weeks"],
                        entry["start_date"],
                        entry["id"],
                    ),
                )
                retained_ids.add(entry["id"])
                continue

            cursor = connection.execute(
                """
                INSERT INTO weekly_plan (
                    organization_id, weekday, activity_type_id, hours, is_active, repeat_weeks, start_date
                ) VALUES (current_profile(), ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry["weekday"],
                    entry["activity_type_id"],
                    entry["hours"],
                    entry["is_active"],
                    entry["repeat_weeks"],
                    entry["start_date"],
                ),
            )
            retained_ids.add(cursor.lastrowid)

        changed_ids = set()
        for entry in entries:
            if entry["id"] in existing_entries:
                old = existing_entries[entry["id"]]
                if (old[1], old[4], old[5], old[6]) != (entry["weekday"], entry["is_active"], entry["repeat_weeks"], entry["start_date"]):
                    changed_ids.add(entry["id"])
        omitted = existing_entries.keys() - retained_ids
        changed_ids.update(omitted)
        new_rules = {entry["id"]: entry for entry in entries}
        for plan_id in changed_ids:
            rule = new_rules.get(plan_id)
            candidates = connection.execute("""SELECT t.id, t.training_date, t.weekly_plan_date,
                t.weekly_plan_generated, t.manually_modified, t.status,
                EXISTS(SELECT 1 FROM invoice_items i WHERE i.training_id=t.id)
                FROM trainings t WHERE t.organization_id=current_profile()
                  AND t.weekly_plan_id=? AND t.training_date>?""", (plan_id, today.isoformat())).fetchall()
            for identifier, actual, original, generated, modified, status, bound in candidates:
                matches = rule and rule["is_active"] and original and _plan_matches(
                    rule["weekday"], rule["repeat_weeks"], rule["start_date"], date.fromisoformat(original))
                if matches:
                    continue
                if generated == 1 and modified == 0 and actual == original and status == "planned" and not bound:
                    connection.execute("DELETE FROM trainings WHERE id=?", (identifier,))
                    result["removed"] += 1
                else:
                    result["preserved"] += 1
        for plan_id in omitted:
            connection.execute("DELETE FROM weekly_plan WHERE id = ? AND organization_id=current_profile()", (plan_id,))

        current_month = today.replace(day=1)
        following_month_index = current_month.year * 12 + current_month.month
        following_month = date(following_month_index // 12, following_month_index % 12 + 1, 1)
        # Preserve the existing current/next-month initialization for new plans.
        new_ids = retained_ids - existing_entries.keys()
        for month in (current_month, following_month):
            result["added"] += _ensure_weekly_plan_occurrences(connection, month, only_ids=new_ids)
        months = connection.execute("SELECT month_start FROM weekly_plan_months WHERE organization_id=current_profile() AND month_start>=?", (current_month.isoformat(),)).fetchall()
        for (month,) in months:
            result["added"] += _ensure_weekly_plan_occurrences(connection, date.fromisoformat(month), after=today, only_ids=changed_ids - omitted)
    return result


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
            WHERE organization_id = current_profile()
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


def validate_profile_relationships(connection):
    """Check existing rows too: triggers alone cannot validate imported archives."""
    for table in TABLE_COLUMNS.keys() - {"organizations"}:
        if connection.execute(f"SELECT 1 FROM {table} t LEFT JOIN organizations o ON o.id=t.organization_id WHERE o.id IS NULL LIMIT 1").fetchone():
            raise ValueError("Ungültige Profilzuordnung")
    if connection.execute("SELECT 1 FROM invoices WHERE pdf_path IS NOT NULL AND pdf_path != '' GROUP BY pdf_path COLLATE NOCASE HAVING COUNT(DISTINCT organization_id) > 1 LIMIT 1").fetchone():
        raise ValueError("Profilübergreifende Dokumentreferenz")
    from backend.invoice_generator import build_invoice_filename
    for identifier, year, month, reference in connection.execute("SELECT organization_id, year, month, pdf_path FROM invoices WHERE organization_id != 1 AND pdf_path IS NOT NULL AND pdf_path != ''"):
        if reference != f"profile-{identifier}-{build_invoice_filename(year, month)}":
            raise ValueError("Ungültige profilbezogene Dokumentreferenz")
    for table, column, parent in PROFILE_RELATIONSHIPS:
        if connection.execute(f"SELECT 1 FROM {table} t LEFT JOIN {parent} p ON p.id=t.{column} WHERE t.{column} IS NOT NULL AND (p.id IS NULL OR t.organization_id != p.organization_id) LIMIT 1").fetchone():
            raise ValueError("Profilübergreifende Beziehung")


PROFILE_RELATIONSHIPS = (
    ("weekly_plan", "activity_type_id", "activity_types"),
    ("trainings", "activity_type_id", "activity_types"),
    ("trainings", "weekly_plan_id", "weekly_plan"),
    ("invoice_items", "invoice_id", "invoices"),
    ("invoice_items", "training_id", "trainings"),
)


def _migrate_profiles(connection):
    if get_schema_version(connection) >= 7:
        validate_profile_relationships(connection)
        return
    # Rebuild only the activity catalog to replace its old global UNIQUE name.
    # Foreign keys are restored and checked before commit, without file moves.
    connection.execute("PRAGMA foreign_keys = OFF")
    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute("ALTER TABLE organizations ADD COLUMN profile_name TEXT NOT NULL DEFAULT 'TTC' CHECK(length(trim(profile_name)) BETWEEN 1 AND 100)")
        ddl = connection.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='activity_types'").fetchone()[0]
        ddl = re.sub(r'CREATE TABLE\s+"?activity_types"?', 'CREATE TABLE activity_types_profiles', ddl, count=1, flags=re.I)
        ddl = re.sub(r'\bUNIQUE\b', '', ddl, flags=re.I)
        connection.execute(ddl)
        columns = ', '.join(row[1] for row in connection.execute('PRAGMA table_info(activity_types)'))
        connection.execute(f'INSERT INTO activity_types_profiles ({columns}) SELECT {columns} FROM activity_types')
        connection.execute('DROP TABLE activity_types')
        connection.execute('ALTER TABLE activity_types_profiles RENAME TO activity_types')
        connection.execute('CREATE UNIQUE INDEX idx_activity_profile_name ON activity_types(organization_id, name)')
        connection.execute('DROP INDEX idx_invoices_unique_preview_period')
        connection.execute('CREATE UNIQUE INDEX idx_invoices_unique_preview_period ON invoices(organization_id, year, month) WHERE is_preview=1')
        for table in TABLE_COLUMNS.keys() - {'organizations'}:
            connection.execute(f'CREATE INDEX IF NOT EXISTS idx_{table}_profile ON {table}(organization_id)')
            for operation in ('INSERT', 'UPDATE'):
                checks = ["NEW.organization_id IS NULL", "NOT EXISTS (SELECT 1 FROM organizations WHERE id=NEW.organization_id)"]
                checks.extend(f'(NEW.{column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM {parent} WHERE id=NEW.{column} AND organization_id=NEW.organization_id))' for child, column, parent in PROFILE_RELATIONSHIPS if child == table)
                connection.execute(f"CREATE TRIGGER profile_{table}_{operation.lower()} BEFORE {operation} ON {table} WHEN {' OR '.join(checks)} BEGIN SELECT RAISE(ABORT, 'Ungültige Profilbeziehung'); END")
            connection.execute(f"CREATE TRIGGER profile_{table}_immutable BEFORE UPDATE OF organization_id ON {table} WHEN NEW.organization_id != OLD.organization_id BEGIN SELECT RAISE(ABORT, 'Profilzuordnung ist unveränderlich'); END")
        validate_profile_relationships(connection)
        if connection.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Fremdschlüsselprüfung der Profilmigration fehlgeschlagen')
        connection.execute('INSERT INTO schema_migrations(version) VALUES (7)')
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.execute('PRAGMA foreign_keys = ON')


def list_profiles(database_path):
    with get_connection(database_path) as connection:
        return [{'id': row[0], 'name': row[1]} for row in connection.execute('SELECT id, profile_name FROM organizations ORDER BY id')]


def create_profile(name, database_path):
    with get_connection(database_path) as connection:
        connection.execute('BEGIN IMMEDIATE')
        # AUTOINCREMENT semantics without rebuilding historical organization IDs.
        maximum = connection.execute('SELECT COALESCE(MAX(id), 0) FROM organizations').fetchone()[0]
        identifier = maximum + 1
        connection.execute('INSERT INTO organizations(id, profile_name) VALUES (?, ?)', (identifier, name))
        return {'id': identifier, 'name': name}


def rename_profile(identifier, name, database_path):
    with get_connection(database_path) as connection:
        return connection.execute('UPDATE organizations SET profile_name=? WHERE id=?', (name, identifier)).rowcount == 1
