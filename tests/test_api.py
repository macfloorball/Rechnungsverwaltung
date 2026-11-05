from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.database import initialize_database
from backend.main import app, get_database_path


@pytest.fixture
def client(tmp_path: Path):
    database_path = tmp_path / "api.db"
    initialize_database(database_path)
    app.dependency_overrides[get_database_path] = lambda: database_path
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
    assert client.get(f"/api/invoices/{invoice['id']}/pdf").status_code == 404

    response = client.delete(f"/api/trainings/{training['id']}")
    assert response.status_code == 204
    assert client.delete(f"/api/trainings/{training['id']}").status_code == 404
