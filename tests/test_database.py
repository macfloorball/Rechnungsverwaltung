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
