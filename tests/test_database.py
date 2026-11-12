import sqlite3
from pathlib import Path

import pytest

from backend.database import (
    create_invoice_with_items,
    create_record,
    delete_record,
    get_invoice,
    get_record,
    initialize_database,
    list_records,
    update_record,
)


@pytest.fixture
def database_path(tmp_path: Path) -> Path:
    path = tmp_path / "ttc.db"
    initialize_database(path)
    return path


def test_activity_and_weekly_plan_crud(database_path: Path) -> None:
    activity_id = create_record(
        "activity_types",
        {"name": "Training", "hourly_rate_cents": 1500},
        database_path,
    )
    assert get_record("activity_types", activity_id, database_path)["name"] == "Training"

    plan_id = create_record(
        "weekly_plan",
        {"weekday": 2, "activity_type_id": activity_id, "hours": 1.5},
        database_path,
    )
    assert list_records("weekly_plan", {"weekday": 2}, database_path)[0]["id"] == plan_id
    assert update_record(
        "weekly_plan",
        plan_id,
        {"hours": 2},
        database_path,
    )
    assert get_record("weekly_plan", plan_id, database_path)["hours"] == 2
    assert delete_record("weekly_plan", plan_id, database_path)
    assert get_record("weekly_plan", plan_id, database_path) is None


def test_training_crud_and_activity_delete_restriction(database_path: Path) -> None:
    activity_id = create_record(
        "activity_types",
        {"name": "Spielbetreuung", "hourly_rate_cents": 1200},
        database_path,
    )
    training_id = create_record(
        "trainings",
        {
            "training_date": "2026-11-05",
            "activity_type_id": activity_id,
            "hours": 1,
            "unit_rate_cents": 1200,
        },
        database_path,
    )
    assert update_record(
        "trainings",
        training_id,
        {"status": "completed"},
        database_path,
    )
    assert get_record("trainings", training_id, database_path)["status"] == "completed"
    with pytest.raises(sqlite3.IntegrityError):
        delete_record("activity_types", activity_id, database_path)
    assert delete_record("trainings", training_id, database_path)
    assert delete_record("activity_types", activity_id, database_path)


def test_invoice_and_item_crud_keeps_price_snapshot(
    database_path: Path,
) -> None:
    activity_id = create_record(
        "activity_types",
        {"name": "Training", "hourly_rate_cents": 1500},
        database_path,
    )
    training_id = create_record(
        "trainings",
        {
            "training_date": "2026-11-05",
            "activity_type_id": activity_id,
            "hours": 2,
            "unit_rate_cents": 1500,
        },
        database_path,
    )
    invoice_id = create_invoice_with_items(
        {
            "year": 2026,
            "month": 11,
            "invoice_date": "2026-12-01",
            "total_amount_cents": 3000,
        },
        [
            {
                "training_id": training_id,
                "description": "Training",
                "training_date": "2026-11-05",
                "hours": 2,
                "unit_rate_cents": 1500,
                "amount_cents": 3000,
            }
        ],
        database_path,
    )
    assert update_record(
        "activity_types",
        activity_id,
        {"hourly_rate_cents": 1750},
        database_path,
    )
    invoice = get_invoice(invoice_id, database_path)
    assert invoice["items"][0]["unit_rate_cents"] == 1500
    assert invoice["items"][0]["amount_cents"] == 3000
    assert update_record(
        "invoice_items",
        invoice["items"][0]["id"],
        {"amount_cents": 3500},
        database_path,
    )
    assert list_records(
        "invoice_items",
        {"invoice_id": invoice_id},
        database_path,
    )[0]["amount_cents"] == 3500
    assert delete_record("invoices", invoice_id, database_path)
    assert list_records(
        "invoice_items",
        {"invoice_id": invoice_id},
        database_path,
    ) == []


def test_legacy_database_migration_preserves_existing_invoice_data(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "legacy.db"
    with sqlite3.connect(database_path) as connection:
        connection.executescript(
            """
            CREATE TABLE activity_types (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                hourly_rate_cents INTEGER NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE weekly_plan (
                id INTEGER PRIMARY KEY,
                weekday INTEGER NOT NULL,
                activity_type_id INTEGER NOT NULL REFERENCES activity_types (id),
                hours REAL NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE trainings (
                id INTEGER PRIMARY KEY,
                training_date TEXT NOT NULL,
                activity_type_id INTEGER NOT NULL REFERENCES activity_types (id),
                hours REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'planned',
                note TEXT,
                unit_rate_cents INTEGER NOT NULL
            );
            CREATE TABLE invoices (
                id INTEGER PRIMARY KEY,
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                invoice_date TEXT NOT NULL,
                invoice_number TEXT,
                total_amount_cents INTEGER NOT NULL,
                pdf_path TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE invoice_items (
                id INTEGER PRIMARY KEY,
                invoice_id INTEGER NOT NULL REFERENCES invoices (id),
                training_id INTEGER,
                description TEXT NOT NULL,
                training_date TEXT NOT NULL,
                hours REAL NOT NULL,
                unit_rate_cents INTEGER NOT NULL,
                amount_cents INTEGER NOT NULL
            );
            INSERT INTO activity_types VALUES (7, 'Alte Tätigkeit', 1500, 1);
            INSERT INTO weekly_plan VALUES (8, 2, 7, 1.5, 1);
            INSERT INTO trainings VALUES (
                9, '2026-11-05', 7, 2, 'completed', 'Legacy-Termin', 1500
            );
            INSERT INTO invoices VALUES (
                10, 2026, 11, '2026-12-01', 'ALT-01', 3000,
                'Rechnung_TTC_2026-11.pdf', '2026-12-01 10:00:00'
            );
            INSERT INTO invoice_items VALUES (
                11, 10, 9, 'Alte Tätigkeit', '2026-11-05', 2, 1500, 3000
            );
            """
        )

    initialize_database(database_path)
    initialize_database(database_path)

    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT id, organization_id FROM activity_types"
        ).fetchall() == [(7, 1)]
        assert connection.execute(
            "SELECT id, organization_id FROM weekly_plan"
        ).fetchall() == [(8, 1)]
        assert connection.execute(
            "SELECT id, organization_id FROM trainings"
        ).fetchall() == [(9, 1)]
        assert connection.execute(
            "SELECT id, training_id, hours, amount_cents FROM invoice_items"
        ).fetchall() == [(11, 9, 2.0, 3000)]
        assert connection.execute(
            "SELECT id, hours FROM trainings WHERE id = 9"
        ).fetchall() == [(9, 2.0)]
        assert next(
            column
            for column in connection.execute("PRAGMA table_info(trainings)")
            if column[1] == "hours"
        )[3] == 0
        assert next(
            column
            for column in connection.execute("PRAGMA table_info(invoice_items)")
            if column[1] == "hours"
        )[3] == 0
        connection.execute(
            """
            INSERT INTO trainings (
                organization_id, training_date, activity_type_id, hours,
                status, unit_rate_cents
            ) VALUES (1, '2026-11-06', 7, NULL, 'completed', 1500)
            """
        )
        assert connection.execute(
            "SELECT hours FROM trainings WHERE training_date = '2026-11-06'"
        ).fetchone() == (None,)
        assert connection.execute(
            "SELECT weekly_plan_id, weekly_plan_date FROM trainings WHERE id = 9"
        ).fetchone() == (None, None)
        assert connection.execute(
            """
            SELECT id, organization_id, invoice_number, pdf_path
            FROM invoices
            """
        ).fetchall() == [
            (10, 1, "ALT-01", "Rechnung_TTC_2026-11.pdf")
        ]
        assert connection.execute(
            """
            SELECT id, organization_id, description, unit_rate_cents, amount_cents
            FROM invoice_items
            """
        ).fetchall() == [(11, 1, "Alte Tätigkeit", 1500, 3000)]
        connection.execute(
            """
            INSERT INTO invoice_items (
                organization_id, invoice_id, training_id, description,
                training_date, hours, unit_rate_cents, amount_cents
            ) VALUES (1, 10, 9, 'Pauschale', '2026-11-05', NULL, 1500, 1500)
            """
        )
        assert connection.execute(
            "SELECT hours, amount_cents FROM invoice_items WHERE description = 'Pauschale'"
        ).fetchone() == (None, 1500)
        assert connection.execute(
            "SELECT COUNT(*) FROM organizations"
        ).fetchone() == (1,)
        assert connection.execute(
            "SELECT COUNT(*) FROM schema_migrations"
        ).fetchone() == (6,)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_connection_rolls_back_closes_and_does_not_recreate_missing_database(tmp_path):
    from backend.database import get_connection

    path = tmp_path / "central.db"
    initialize_database(path)
    with pytest.raises(RuntimeError):
        with get_connection(path) as connection:
            assert connection.execute("PRAGMA foreign_keys").fetchone() == (1,)
            connection.execute("INSERT INTO activity_types (name, hourly_rate_cents) VALUES ('Rollback', 1)")
            raise RuntimeError("abort")
    with pytest.raises(sqlite3.ProgrammingError):
        connection.execute("SELECT 1")
    assert list_records("activity_types", database_path=path) == []
    with pytest.raises(sqlite3.OperationalError):
        list_records("activity_types", database_path=tmp_path / "missing.db")
    assert not (tmp_path / "missing.db").exists()


def test_schema_rejects_future_and_gapped_versions_without_modification(database_path):
    from backend.database import SCHEMA_VERSION
    for versions in ([1, 2, 4], list(range(1, SCHEMA_VERSION + 2))):
        with sqlite3.connect(database_path) as connection:
            connection.execute("DELETE FROM schema_migrations")
            connection.executemany("INSERT INTO schema_migrations (version) VALUES (?)", [(v,) for v in versions])
        before = database_path.read_bytes()
        with pytest.raises(ValueError):
            initialize_database(database_path)
        assert database_path.read_bytes() == before


def test_upgrade_creates_recovery_copy_and_is_idempotent(database_path):
    with sqlite3.connect(database_path) as connection:
        connection.execute("DELETE FROM schema_migrations WHERE version = 6")
        connection.execute("INSERT INTO activity_types (name, hourly_rate_cents) VALUES ('Keep', 50)")
    initialize_database(database_path)
    copies = list(database_path.parent.glob("*.before-migration-*.sqlite3"))
    assert len(copies) == 1
    with sqlite3.connect(copies[0]) as connection:
        assert connection.execute("SELECT MAX(version) FROM schema_migrations").fetchone() == (5,)
        assert connection.execute("SELECT name FROM activity_types").fetchone() == ('Keep',)
    initialize_database(database_path)
    assert list(database_path.parent.glob("*.before-migration-*.sqlite3")) == copies


def test_repository_batch_errors_roll_back_all_changes(database_path):
    from backend.database import RecordNotFoundError, InvalidRecordError, save_activities, save_weekly_plan

    with pytest.raises(RecordNotFoundError):
        save_activities([
            {"id": None, "name": "Rollback", "hourly_rate_cents": 100, "is_active": True},
            {"id": 9999, "name": "Missing", "hourly_rate_cents": 100, "is_active": True},
        ], database_path)
    assert list_records("activity_types", database_path=database_path) == []
    activity_id = create_record("activity_types", {"name": "Training", "hourly_rate_cents": 100}, database_path)
    plan_id = create_record("weekly_plan", {"weekday": 1, "activity_type_id": activity_id, "hours": 1}, database_path)
    entry = {"id": plan_id, "weekday": 2, "activity_type_id": activity_id, "hours": 2, "is_active": True}
    with pytest.raises(InvalidRecordError):
        save_weekly_plan([entry, entry], database_path)
    assert get_record("weekly_plan", plan_id, database_path)["hours"] == 1
