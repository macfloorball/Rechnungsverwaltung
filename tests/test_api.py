from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.database import get_invoice, initialize_database
from backend.main import app, get_database_path, get_invoice_directory


@pytest.fixture
def client(tmp_path: Path):
    database_path = tmp_path / "api.db"
    invoice_directory = tmp_path / "rechnungen"
    initialize_database(database_path)
    app.state.test_database_path = database_path
    app.dependency_overrides[get_database_path] = lambda: database_path
    app.dependency_overrides[get_invoice_directory] = lambda: invoice_directory
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_health_and_request_validation(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

    response = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-05",
            "activity_type_id": 1,
            "hours": -1,
        },
    )
    assert response.status_code == 422


def test_settings_conflict_rolls_back_all_changes(client: TestClient) -> None:
    response = client.put(
        "/api/settings",
        json={
            "activities": [
                {"name": "Training", "hourly_rate_cents": 1500},
                {"name": "Training", "hourly_rate_cents": 2000},
            ]
        },
    )
    assert response.status_code == 409
    assert client.get("/api/settings").json()["activities"] == []


def test_activity_prices_are_centralized_in_settings(client: TestClient) -> None:
    response = client.put(
        "/api/settings",
        json={
            "activities": [
                {"name": "Training", "hourly_rate_cents": 1500},
            ]
        },
    )
    assert response.status_code == 200
    activity = response.json()["activities"][0]

    response = client.get("/api/settings")
    assert response.status_code == 200
    assert response.json()["activities"][0]["hourly_rate_cents"] == 1500

    response = client.put(
        "/api/settings",
        json={
            "activities": [
                {
                    "id": activity["id"],
                    "name": "Training",
                    "hourly_rate_cents": 1750,
                    "is_active": True,
                }
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["activities"][0]["hourly_rate_cents"] == 1750


def test_settings_weekly_plan_and_calendar(client: TestClient) -> None:
    response = client.put(
        "/api/settings",
        json={
            "activities": [
                {"name": "Training", "hourly_rate_cents": 1500},
                {"name": "Assistenz", "hourly_rate_cents": 2000},
            ]
        },
    )
    assert response.status_code == 200
    activities = response.json()["activities"]
    activity = activities[0]

    response = client.put(
        "/api/weekly-plan",
        json=[
            {
                "weekday": 3,
                "activity_type_id": activity["id"],
                "hours": 1.5,
            }
        ],
    )
    assert response.status_code == 200

    response = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-05",
            "activity_type_id": activities[1]["id"],
            "hours": 1,
        },
    )
    assert response.status_code == 201

    response = client.get("/api/calendar/2026/11")
    assert response.status_code == 200
    thursday = next(day for day in response.json()["days"] if day["date"] == "2026-11-05")
    assert {training["activity_name"] for training in thursday["trainings"]} == {
        "Training",
        "Assistenz",
    }
    planned = next(
        training for training in thursday["trainings"]
        if training["activity_name"] == "Training"
    )
    assert planned["status"] == "planned"
    assert client.get("/api/calendar/2026/13").status_code == 422

    response = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-08",
            "activity_type_id": activities[1]["id"],
            "hours": 2,
            "status": "completed",
        },
    )
    assert response.status_code == 201
    response = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-08",
            "activity_type_id": activities[0]["id"],
            "hours": 1.5,
            "status": "completed",
        },
    )
    assert response.status_code == 201
    calendar = client.get("/api/calendar/2026/11").json()
    sunday = next(day for day in calendar["days"] if day["date"] == "2026-11-08")
    assert len(sunday["trainings"]) == 2
    assert {
        training["activity_name"] for training in sunday["trainings"]
    } == {"Training", "Assistenz"}
    assert all(training["status"] == "completed" for training in sunday["trainings"])


def test_training_and_invoice_endpoints(client: TestClient) -> None:
    client.put(
        "/api/settings",
        json={
            "activities": [
                {"name": "Training", "hourly_rate_cents": 1500},
            ]
        },
    )
    activity_id = client.get("/api/settings").json()["activities"][0]["id"]

    response = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-05",
            "activity_type_id": activity_id,
            "hours": 2,
        },
    )
    assert response.status_code == 201
    training = response.json()
    assert training["unit_rate_cents"] == 1500

    response = client.put(
        f"/api/trainings/{training['id']}",
        json={"status": "completed"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "completed"

    response = client.put(
        f"/api/trainings/{training['id']}",
        json={"status": "cancelled"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    preview = client.post(
        "/api/invoices/preview",
        json={"year": 2026, "month": 11},
    )
    assert preview.status_code == 200
    assert preview.json()["total_amount_cents"] == 0

    response = client.put(
        f"/api/trainings/{training['id']}",
        json={"status": "completed"},
    )
    assert response.status_code == 200

    preview = client.post(
        "/api/invoices/preview",
        json={"year": 2026, "month": 11},
    )
    assert preview.status_code == 200
    assert preview.json()["total_amount_cents"] == 3000

    response = client.post(
        "/api/invoices",
        json={
            "year": 2026,
            "month": 11,
            "invoice_date": "2026-12-01",
        },
    )
    assert response.status_code == 201
    invoice = response.json()
    assert invoice["total_amount_cents"] == 3000
    assert invoice["items"][0]["unit_rate_cents"] == 1500
    assert invoice["pdf_path"] == "Rechnung_TTC_2026-11.pdf"
    pdf_response = client.get(f"/api/invoices/{invoice['id']}/pdf")
    assert pdf_response.status_code == 200
    assert pdf_response.headers["content-type"] == "application/pdf"
    assert "inline" in pdf_response.headers["content-disposition"]
    assert (
        "Rechnung_TTC_2026-11.pdf"
        in pdf_response.headers["content-disposition"]
    )
    assert pdf_response.content.startswith(b"%PDF-")

    response = client.delete(f"/api/trainings/{training['id']}")
    assert response.status_code == 204
    assert client.delete(f"/api/trainings/{training['id']}").status_code == 404


def test_invoice_rejects_empty_period_and_prevents_overwriting_monthly_pdf(
    client: TestClient,
) -> None:
    empty_response = client.post(
        "/api/invoices",
        json={
            "year": 2026,
            "month": 11,
            "invoice_date": "2026-12-01",
        },
    )
    assert empty_response.status_code == 400

    activity = client.put(
        "/api/settings",
        json={
            "activities": [
                {"name": "Training", "hourly_rate_cents": 1500},
            ]
        },
    ).json()["activities"][0]
    client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-12",
            "activity_type_id": activity["id"],
            "hours": 2,
            "status": "completed",
        },
    )
    invoice_payload = {
        "year": 2026,
        "month": 11,
        "invoice_date": "2026-12-01",
    }
    invoice_response = client.post("/api/invoices", json=invoice_payload)
    assert invoice_response.status_code == 201
    invoice_id = invoice_response.json()["id"]
    original_pdf = client.get(f"/api/invoices/{invoice_id}/pdf").content

    duplicate_response = client.post("/api/invoices", json=invoice_payload)
    assert duplicate_response.status_code == 409
    saved_pdf = client.get(f"/api/invoices/{invoice_id}/pdf").content
    assert saved_pdf == original_pdf


def test_invoice_item_amount_multiplies_hours_by_rate_and_rounds_cents(
    client: TestClient,
) -> None:
    client.put(
        "/api/settings",
        json={
            "activities": [
                {"name": "Training", "hourly_rate_cents": 1500},
            ]
        },
    )
    activity_id = client.get("/api/settings").json()["activities"][0]["id"]
    response = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-05",
            "activity_type_id": activity_id,
            "hours": 0.333,
            "status": "completed",
        },
    )
    assert response.status_code == 201

    preview = client.post(
        "/api/invoices/preview",
        json={"year": 2026, "month": 11},
    )
    assert preview.status_code == 200
    item = preview.json()["items"][0]
    assert item["unit_rate_cents"] == 1500
    assert item["hours"] == pytest.approx(0.333)
    assert item["amount_cents"] == 500
    assert preview.json()["total_amount_cents"] == 500


def test_additional_training_is_saved_to_calendar_and_invoice_preview(
    client: TestClient,
) -> None:
    settings = client.put(
        "/api/settings",
        json={
            "activities": [
                {"name": "Zusatztraining", "hourly_rate_cents": 1800},
            ]
        },
    )
    activity_id = settings.json()["activities"][0]["id"]
    weekly_plan = client.put(
        "/api/weekly-plan",
        json=[
            {
                "weekday": 2,
                "activity_type_id": activity_id,
                "hours": 1,
            }
        ],
    )
    assert weekly_plan.status_code == 200

    response = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-06",
            "activity_type_id": activity_id,
            "hours": 2.5,
            "status": "completed",
            "note": "Zusätzlicher Freitagseinsatz",
        },
    )
    assert response.status_code == 201
    additional_training = response.json()
    assert additional_training["training_date"] == "2026-11-06"
    assert additional_training["unit_rate_cents"] == 1800

    calendar = client.get("/api/calendar/2026/11")
    assert calendar.status_code == 200
    friday = next(
        day for day in calendar.json()["days"] if day["date"] == "2026-11-06"
    )
    assert [training["id"] for training in friday["trainings"]] == [
        additional_training["id"]
    ]

    preview = client.post(
        "/api/invoices/preview",
        json={"year": 2026, "month": 11},
    )
    assert preview.status_code == 200
    assert preview.json()["items"] == [
        {
            "training_id": additional_training["id"],
            "description": "Zusatztraining",
            "training_date": "2026-11-06",
            "hours": 2.5,
            "unit_rate_cents": 1800,
            "amount_cents": 4500,
        }
    ]
    assert preview.json()["total_amount_cents"] == 4500


def test_calendar_and_invoice_preview_handle_month_and_year_boundaries(
    client: TestClient,
) -> None:
    settings = client.put(
        "/api/settings",
        json={
            "activities": [
                {"name": "Training", "hourly_rate_cents": 1500},
            ]
        },
    )
    activity_id = settings.json()["activities"][0]["id"]

    for training_date, hours in (
        ("2026-12-31", 2),
        ("2027-01-01", 3),
        ("2028-02-29", 1),
    ):
        response = client.post(
            "/api/trainings",
            json={
                "training_date": training_date,
                "activity_type_id": activity_id,
                "hours": hours,
                "status": "completed",
            },
        )
        assert response.status_code == 201

    december = client.post(
        "/api/invoices/preview",
        json={"year": 2026, "month": 12},
    )
    january = client.post(
        "/api/invoices/preview",
        json={"year": 2027, "month": 1},
    )
    leap_february = client.post(
        "/api/invoices/preview",
        json={"year": 2028, "month": 2},
    )

    assert (
        december.status_code
        == january.status_code
        == leap_february.status_code
        == 200
    )
    assert [item["training_date"] for item in december.json()["items"]] == [
        "2026-12-31"
    ]
    assert december.json()["total_amount_cents"] == 3000
    assert [item["training_date"] for item in january.json()["items"]] == [
        "2027-01-01"
    ]
    assert january.json()["total_amount_cents"] == 4500
    assert [item["training_date"] for item in leap_february.json()["items"]] == [
        "2028-02-29"
    ]
    assert leap_february.json()["total_amount_cents"] == 1500

    december_calendar = client.get("/api/calendar/2026/12").json()
    january_calendar = client.get("/api/calendar/2027/1").json()
    leap_calendar = client.get("/api/calendar/2028/2").json()
    assert len(december_calendar["days"]) == 31
    assert december_calendar["days"][-1]["date"] == "2026-12-31"
    assert len(january_calendar["days"]) == 31
    assert january_calendar["days"][0]["date"] == "2027-01-01"
    assert len(leap_calendar["days"]) == 29
    assert leap_calendar["days"][-1]["date"] == "2028-02-29"


def test_invoice_preview_only_includes_completed_trainings(
    client: TestClient,
) -> None:
    client.put(
        "/api/settings",
        json={
            "activities": [
                {"name": "Training", "hourly_rate_cents": 1500},
            ]
        },
    )
    activity_id = client.get("/api/settings").json()["activities"][0]["id"]
    response = client.put(
        "/api/weekly-plan",
        json=[
            {
                "weekday": 3,
                "activity_type_id": activity_id,
                "hours": 1.5,
            }
        ],
    )
    assert response.status_code == 200
    training_ids = {}
    for training_date, training_status in (
        ("2026-11-03", "planned"),
        ("2026-11-04", "cancelled"),
        ("2026-11-05", "completed"),
        ("2026-10-31", "completed"),
    ):
        response = client.post(
            "/api/trainings",
            json={
                "training_date": training_date,
                "activity_type_id": activity_id,
                "hours": 2,
                "status": training_status,
            },
        )
        assert response.status_code == 201
        training_ids[training_date] = response.json()["id"]

    response = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-08",
            "activity_type_id": activity_id,
            "hours": 2,
            "status": "completed",
        },
    )
    assert response.status_code == 201
    training_ids["2026-11-08"] = response.json()["id"]

    preview = client.post(
        "/api/invoices/preview",
        json={"year": 2026, "month": 11},
    )
    assert preview.status_code == 200
    items = preview.json()["items"]
    assert [item["training_id"] for item in items] == [
        training_ids["2026-11-05"],
        training_ids["2026-11-08"],
    ]
    assert preview.json()["total_amount_cents"] == 6000


def test_invoice_preview_keeps_multiple_activities_on_same_day(
    client: TestClient,
) -> None:
    response = client.put(
        "/api/settings",
        json={
            "activities": [
                {"name": "Training", "hourly_rate_cents": 1500},
                {"name": "Assistenz", "hourly_rate_cents": 2000},
            ]
        },
    )
    activities = response.json()["activities"]
    training_ids = []
    for activity, hours in zip(activities, (1.5, 2), strict=True):
        response = client.post(
            "/api/trainings",
            json={
                "training_date": "2026-11-12",
                "activity_type_id": activity["id"],
                "hours": hours,
                "status": "completed",
            },
        )
        assert response.status_code == 201
        training_ids.append(response.json()["id"])

    preview = client.post(
        "/api/invoices/preview",
        json={"year": 2026, "month": 11},
    )
    assert preview.status_code == 200
    items = preview.json()["items"]
    assert [item["training_id"] for item in items] == training_ids
    assert {item["description"] for item in items} == {"Training", "Assistenz"}
    assert [item["amount_cents"] for item in items] == [2250, 4000]
    assert preview.json()["total_amount_cents"] == 6250
    assert preview.json()["total_amount_cents"] == sum(
        item["amount_cents"] for item in items
    )

    invoice = client.post(
        "/api/invoices",
        json={
            "year": 2026,
            "month": 11,
            "invoice_date": "2026-12-01",
        },
    )
    assert invoice.status_code == 201
    assert invoice.json()["total_amount_cents"] == 6250
    assert invoice.json()["total_amount_cents"] == sum(
        item["amount_cents"] for item in invoice.json()["items"]
    )


def test_saved_invoice_keeps_original_prices_after_price_change(
    client: TestClient,
) -> None:
    response = client.put(
        "/api/settings",
        json={
            "activities": [
                {"name": "Training", "hourly_rate_cents": 1500},
            ]
        },
    )
    activity_id = response.json()["activities"][0]["id"]
    response = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-12",
            "activity_type_id": activity_id,
            "hours": 2,
            "status": "completed",
        },
    )
    assert response.status_code == 201
    original_training = response.json()

    response = client.post(
        "/api/invoices",
        json={
            "year": 2026,
            "month": 11,
            "invoice_date": "2026-12-01",
        },
    )
    assert response.status_code == 201
    invoice = response.json()
    assert invoice["total_amount_cents"] == 3000
    assert invoice["items"][0]["unit_rate_cents"] == 1500

    response = client.put(
        "/api/settings",
        json={
            "activities": [
                {
                    "id": activity_id,
                    "name": "Training",
                    "hourly_rate_cents": 2200,
                    "is_active": True,
                }
            ]
        },
    )
    assert response.status_code == 200

    november_calendar = client.get("/api/calendar/2026/11").json()
    original_training_after_change = next(
        training
        for day in november_calendar["days"]
        for training in day["trainings"]
        if training["id"] == original_training["id"]
    )
    assert original_training_after_change["unit_rate_cents"] == 1500

    persisted_invoice = get_invoice(
        invoice["id"],
        client.app.state.test_database_path,
    )
    assert persisted_invoice is not None
    assert persisted_invoice["total_amount_cents"] == 3000
    assert persisted_invoice["items"][0]["unit_rate_cents"] == 1500
    assert persisted_invoice["items"][0]["amount_cents"] == 3000

    new_training_response = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-12-03",
            "activity_type_id": activity_id,
            "hours": 2,
            "status": "completed",
        },
    )
    assert new_training_response.status_code == 201
    assert new_training_response.json()["unit_rate_cents"] == 2200

    december_preview = client.post(
        "/api/invoices/preview",
        json={"year": 2026, "month": 12},
    )
    assert december_preview.status_code == 200
    assert december_preview.json()["items"][0]["unit_rate_cents"] == 2200
    assert december_preview.json()["items"][0]["amount_cents"] == 4400
    assert december_preview.json()["total_amount_cents"] == 4400
