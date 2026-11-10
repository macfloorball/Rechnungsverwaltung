import base64
import json
import sqlite3
import struct
import zlib
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.database import get_invoice, initialize_database
from backend.main import app, get_database_path, get_invoice_directory


def _png_image() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        checksum = zlib.crc32(kind + data) & 0xFFFFFFFF
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", checksum)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00\xff"))
        + chunk(b"IEND", b"")
    )


@pytest.fixture
def client(tmp_path: Path):
    database_path = tmp_path / "api.db"
    invoice_directory = tmp_path / "rechnungen"
    initialize_database(database_path)
    app.state.test_database_path = database_path
    app.state.test_invoice_directory = invoice_directory
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


def test_hour_inputs_reject_fractional_and_comma_values(client: TestClient) -> None:
    settings = client.put(
        "/api/settings",
        json={"activities": [{"name": "Training", "hourly_rate_cents": 1500}]},
    )
    activity_id = settings.json()["activities"][0]["id"]
    training = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-05",
            "activity_type_id": activity_id,
            "hours": 1,
        },
    ).json()

    for hours in (1.5, 1.0, "1,5"):
        assert client.put(
            "/api/weekly-plan",
            json=[{
                "weekday": 3,
                "activity_type_id": activity_id,
                "hours": hours,
            }],
        ).status_code == 422
        assert client.post(
            "/api/trainings",
            json={
                "training_date": "2026-11-06",
                "activity_type_id": activity_id,
                "hours": hours,
            },
        ).status_code == 422
        assert client.put(
            f"/api/trainings/{training['id']}",
            json={"hours": hours},
        ).status_code == 422


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


def test_organization_settings_are_validated_and_persist_after_restart(
    client: TestClient,
) -> None:
    payload = {
        "name": "TTC Beispiel",
        "issuer_first_name": "Max",
        "issuer_last_name": "Muster",
        "street": "Musterstraße 1",
        "postal_code": "12345",
        "city": "Köln",
        "email": "max@example.org",
        "phone": None,
        "iban": "DE89 3704 0044 0532 0130 00",
        "bic": None,
        "bank_name": None,
        "account_holder": "TTC Beispiel",
        "tax_number": None,
        "vat_id": None,
        "additional_tax_info": None,
        "invoice_number_prefix": "TTC",
        "payment_due_days": 21,
        "invoice_text": "Vielen Dank.",
        "payment_notice": "Bitte überweisen.",
        "standard_service_description": "Übungsleitung",
        "invoice_footer": "Vereinsregister Beispiel",
    }
    response = client.put("/api/organization/settings", json=payload)
    assert response.status_code == 200
    assert response.json()["iban"] == "DE89370400440532013000"
    assert response.json()["phone"] is None

    initialize_database(client.app.state.test_database_path)
    loaded = client.get("/api/organization/settings")
    assert loaded.status_code == 200
    assert loaded.json()["name"] == "TTC Beispiel"
    assert loaded.json()["payment_due_days"] == 21
    assert loaded.json()["iban"] == "DE89370400440532013000"

    invalid = client.put(
        "/api/organization/settings",
        json={"email": "not-an-email"},
    )
    assert invalid.status_code == 422
    assert isinstance(invalid.json()["detail"], list)
    assert invalid.json()["detail"][0]["loc"][-1] == "email"
    invalid_iban = client.put(
        "/api/organization/settings",
        json={"iban": "DE00000000000000000000"},
    )
    assert invalid_iban.status_code == 422
    assert invalid_iban.json()["detail"][0]["loc"][-1] == "iban"
    invalid_bic = client.put(
        "/api/organization/settings",
        json={"bic": "invalid"},
    )
    assert invalid_bic.status_code == 422
    assert invalid_bic.json()["detail"][0]["loc"][-1] == "bic"
    invalid_prefix = client.put(
        "/api/organization/settings",
        json={"invoice_number_prefix": "TTC#"},
    )
    assert invalid_prefix.status_code == 422
    assert invalid_prefix.json()["detail"][0]["loc"][-1] == "invoice_number_prefix"

    logo_enabled_without_upload = client.put(
        "/api/organization/settings",
        json={"logo_enabled": True},
    )
    assert logo_enabled_without_upload.status_code == 422
    assert "Lade zuerst ein Logo hoch" in logo_enabled_without_upload.json()["detail"]

    logo = _png_image()
    uploaded = client.post(
        "/api/organization/logo",
        json={
            "media_type": "image/png",
            "data_base64": base64.b64encode(logo).decode("ascii"),
        },
    )
    assert uploaded.status_code == 200
    logo_enabled = client.put(
        "/api/organization/settings",
        json={"logo_enabled": True},
    )
    assert logo_enabled.status_code == 200
    assert logo_enabled.json()["logo_enabled"] == 1
    assert logo_enabled.json()["logo_available"] is True


def test_logo_upload_is_validated_and_available_through_api(
    client: TestClient,
) -> None:
    logo = _png_image()
    response = client.post(
        "/api/organization/logo",
        json={
            "media_type": "image/png",
            "data_base64": base64.b64encode(logo).decode("ascii"),
        },
    )
    assert response.status_code == 200
    assert response.json()["logo_available"] is True
    assert "logo_data" not in response.json()
    assert client.get("/api/organization/logo").content == logo

    invalid = client.post(
        "/api/organization/logo",
        json={"media_type": "image/png", "data_base64": "bm90IGFuIGltYWdl"},
    )
    assert invalid.status_code == 422

    removed = client.delete("/api/organization/logo")
    assert removed.status_code == 200
    assert removed.json()["logo_available"] is False
    assert client.get("/api/organization/logo").status_code == 404


def test_invoice_snapshot_and_saved_pdf_survive_organization_changes(
    client: TestClient,
) -> None:
    logo = _png_image()
    settings_response = client.put(
        "/api/organization/settings",
        json={
            "name": "Alter Absender",
            "city": "Köln",
            "iban": "DE89370400440532013000",
            "account_holder": "Alter Kontoinhaber",
            "invoice_number_prefix": "TTC",
            "payment_due_days": 14,
        },
    )
    assert settings_response.status_code == 200
    uploaded = client.post(
        "/api/organization/logo",
        json={
            "media_type": "image/png",
            "data_base64": base64.b64encode(logo).decode("ascii"),
        },
    )
    assert uploaded.status_code == 200

    activity = client.put(
        "/api/settings",
        json={
            "activities": [
                {"name": "Training", "hourly_rate_cents": 1500},
            ]
        },
    ).json()["activities"][0]
    for training_date in ("2026-11-05", "2026-12-03"):
        created = client.post(
            "/api/trainings",
            json={
                "training_date": training_date,
                "activity_type_id": activity["id"],
                "hours": 2,
                "status": "completed",
            },
        )
        assert created.status_code == 201

    first_response = client.post("/api/invoices", json={"year": 2026, "month": 11})
    assert first_response.status_code == 201
    first_invoice = first_response.json()
    assert first_invoice["invoice_number"] == "TTC-2026-0001"
    first_pdf = client.get(f"/api/invoices/{first_invoice['id']}/pdf").content
    assert b"/Subtype /Image" in first_pdf

    changed = client.put(
        "/api/organization/settings",
        json={
            "name": "Neuer Absender",
            "iban": "DE12500105170648489890",
            "account_holder": "Neuer Kontoinhaber",
            "payment_due_days": 30,
        },
    )
    assert changed.status_code == 200
    client.delete("/api/organization/logo")

    second_response = client.post("/api/invoices", json={"year": 2026, "month": 12})
    assert second_response.status_code == 201
    second_invoice = second_response.json()
    assert second_invoice["invoice_number"] == "TTC-2026-0002"
    second_pdf = client.get(f"/api/invoices/{second_invoice['id']}/pdf").content
    assert b"/Subtype /Image" not in second_pdf

    with sqlite3.connect(client.app.state.test_database_path) as connection:
        snapshots = {
            invoice_id: json.loads(snapshot)
            for invoice_id, snapshot in connection.execute(
                "SELECT id, invoice_snapshot_json FROM invoices"
            )
        }
        logo_snapshot = connection.execute(
            "SELECT logo_snapshot FROM invoices WHERE id = ?",
            (first_invoice["id"],),
        ).fetchone()[0]
    assert snapshots[first_invoice["id"]]["name"] == "Alter Absender"
    assert snapshots[first_invoice["id"]]["iban"] == "DE89370400440532013000"
    assert snapshots[first_invoice["id"]]["items"][0]["unit_rate_cents"] == 1500
    assert snapshots[second_invoice["id"]]["name"] == "Neuer Absender"
    assert snapshots[second_invoice["id"]]["iban"] == "DE12500105170648489890"
    assert logo_snapshot == logo
    assert client.get(f"/api/invoices/{first_invoice['id']}/pdf").content == first_pdf

    invoice_list = client.get("/api/invoices").json()
    assert all("invoice_snapshot_json" not in invoice for invoice in invoice_list)
    assert all("logo_snapshot" not in invoice for invoice in invoice_list)


def test_invoice_archive_is_chronological_and_pdfs_remain_unchanged(
    client: TestClient,
) -> None:
    activity = client.put(
        "/api/settings",
        json={"activities": [{"name": "Training alt", "hourly_rate_cents": 2000}]},
    ).json()["activities"][0]

    invoices_by_month = {}
    first_month_pdf = None
    for year, month, training_date in (
        (2026, 11, "2026-11-12"),
        (2026, 12, "2026-12-10"),
        (2027, 1, "2027-01-14"),
    ):
        if month == 12:
            changed_activity = client.put(
                "/api/settings",
                json={
                    "activities": [
                        {
                            "id": activity["id"],
                            "name": "Training neu",
                            "hourly_rate_cents": 3500,
                            "is_active": True,
                        }
                    ]
                },
            )
            assert changed_activity.status_code == 200

        training = client.post(
            "/api/trainings",
            json={
                "training_date": training_date,
                "activity_type_id": activity["id"],
                "hours": 2,
                "status": "completed",
            },
        )
        assert training.status_code == 201

        invoice = client.post(
            "/api/invoices",
            json={"year": year, "month": month},
        )
        assert invoice.status_code == 201
        invoices_by_month[(year, month)] = invoice.json()

        pdf_response = client.get(f"/api/invoices/{invoice.json()['id']}/pdf")
        assert pdf_response.status_code == 200
        assert pdf_response.headers["content-type"] == "application/pdf"
        assert "inline" in pdf_response.headers["content-disposition"]
        assert pdf_response.content.startswith(b"%PDF-")
        if month == 11:
            first_month_pdf = pdf_response.content
            assert invoice.json()["total_amount_cents"] == 4000
        elif month == 12:
            assert invoice.json()["total_amount_cents"] == 7000
        else:
            assert invoice.json()["total_amount_cents"] == 7000

    invoice_list = client.get("/api/invoices")
    assert invoice_list.status_code == 200
    archived = invoice_list.json()
    assert [
        (invoice["year"], invoice["month"])
        for invoice in archived
    ] == [(2027, 1), (2026, 12), (2026, 11)]
    assert [
        invoice["invoice_number"]
        for invoice in archived
    ] == ["RE-2027-0003", "RE-2026-0002", "RE-2026-0001"]

    november_invoice = invoices_by_month[(2026, 11)]
    archived_november = next(
        invoice
        for invoice in archived
        if invoice["id"] == november_invoice["id"]
    )
    assert archived_november["total_amount_cents"] == 4000
    assert archived_november["invoice_number"] == "RE-2026-0001"
    reopened = client.get(f"/api/invoices/{november_invoice['id']}/pdf")
    assert reopened.status_code == 200
    assert reopened.content == first_month_pdf
    assert "Rechnung_TTC_2026-11.pdf" in reopened.headers["content-disposition"]

    persisted = get_invoice(
        november_invoice["id"],
        client.app.state.test_database_path,
    )
    assert persisted is not None
    assert persisted["items"][0]["description"] == "Training alt"
    assert persisted["items"][0]["unit_rate_cents"] == 2000
    assert persisted["items"][0]["amount_cents"] == 4000


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
                "hours": 1,
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
            "hours": 2,
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


def test_weekly_plan_persists_current_and_following_month_without_overwrites(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FrozenDate(date):
        @classmethod
        def today(cls) -> date:
            return cls(2026, 11, 8)

    monkeypatch.setattr("backend.main.date", FrozenDate)
    settings = client.put(
        "/api/settings",
        json={"activities": [{"name": "Training", "hourly_rate_cents": 2000}]},
    )
    activity_id = settings.json()["activities"][0]["id"]

    manual = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-12",
            "activity_type_id": activity_id,
            "hours": 2,
            "note": "Manuell angepasst",
        },
    )
    assert manual.status_code == 201

    payload = [
        {
            "weekday": 3,
            "activity_type_id": activity_id,
            "hours": 2,
            "is_active": True,
        }
    ]
    first_save = client.put("/api/weekly-plan", json=payload)
    assert first_save.status_code == 200
    plan_entry = first_save.json()[0]

    with sqlite3.connect(client.app.state.test_database_path) as connection:
        occurrences = connection.execute(
            """
            SELECT training_date, hours, status, unit_rate_cents
            FROM trainings
            WHERE weekly_plan_id = ?
            ORDER BY training_date
            """,
            (plan_entry["id"],),
        ).fetchall()
    assert occurrences == [
        ("2026-11-05", 2.0, "planned", 2000),
        ("2026-11-12", 2.0, "planned", 2000),
        ("2026-11-19", 2.0, "planned", 2000),
        ("2026-11-26", 2.0, "planned", 2000),
        ("2026-12-03", 2.0, "planned", 2000),
        ("2026-12-10", 2.0, "planned", 2000),
        ("2026-12-17", 2.0, "planned", 2000),
        ("2026-12-24", 2.0, "planned", 2000),
        ("2026-12-31", 2.0, "planned", 2000),
    ]
    assert next(item for item in occurrences if item[0] == "2026-11-12")[1] == 2

    calendar = client.get("/api/calendar/2026/11").json()
    november_dates = [
        day["date"]
        for day in calendar["days"]
        if any(training["activity_type_id"] == activity_id for training in day["trainings"])
    ]
    assert november_dates == [
        "2026-11-05",
        "2026-11-12",
        "2026-11-19",
        "2026-11-26",
    ]
    assert all(
        training["id"] is not None
        for day in calendar["days"]
        for training in day["trainings"]
        if training["activity_type_id"] == activity_id
    )

    thursday = next(
        training
        for day in calendar["days"]
        for training in day["trainings"]
        if training["training_date"] == "2026-11-19"
    )
    edited = client.put(
        f"/api/trainings/{thursday['id']}",
        json={"hours": 3, "note": "Manuell geändert"},
    )
    assert edited.status_code == 200
    completed = client.put(
        f"/api/trainings/{next(training['id'] for day in calendar['days'] for training in day['trainings'] if training['training_date'] == '2026-11-26')}",
        json={"status": "completed"},
    )
    assert completed.status_code == 200
    december_calendar = client.get("/api/calendar/2026/12").json()
    cancelled_id = next(
        training["id"]
        for day in december_calendar["days"]
        for training in day["trainings"]
        if training["training_date"] == "2026-12-03"
    )
    cancelled = client.put(
        f"/api/trainings/{cancelled_id}",
        json={"status": "cancelled"},
    )
    assert cancelled.status_code == 200

    repeat_save = client.put(
        "/api/weekly-plan",
        json=[
            {
                **payload[0],
                "id": plan_entry["id"],
                "hours": 3,
            }
        ],
    )
    assert repeat_save.status_code == 200
    with sqlite3.connect(client.app.state.test_database_path) as connection:
        persisted = connection.execute(
            """
            SELECT training_date, hours, status, note
            FROM trainings
            WHERE weekly_plan_id = ? OR training_date = '2026-11-12'
            ORDER BY training_date
            """,
            (plan_entry["id"],),
        ).fetchall()
    assert len(persisted) == 9
    assert ("2026-11-19", 3.0, "planned", "Manuell geändert") in persisted
    assert ("2026-11-26", 2.0, "completed", None) in persisted
    assert ("2026-11-12", 2.0, "planned", "Manuell angepasst") in persisted
    assert ("2026-12-03", 2.0, "cancelled", None) in persisted

    january_calendar = client.get("/api/calendar/2027/1").json()
    january_training = next(
        training
        for day in january_calendar["days"]
        for training in day["trainings"]
        if training["activity_type_id"] == activity_id
    )
    assert january_training["hours"] == 3.0
    assert january_training["status"] == "planned"


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
    assert invoice["invoice_date"] == date.today().isoformat()
    assert invoice["invoice_number"] == "RE-2026-0001"
    assert invoice["items"][0]["unit_rate_cents"] == 1500
    assert invoice["pdf_path"] == "Rechnung_TTC_2026-11.pdf"
    saved_pdf_path = client.app.state.test_invoice_directory / invoice["pdf_path"]
    assert saved_pdf_path.is_file()
    assert saved_pdf_path.name == "Rechnung_TTC_2026-11.pdf"
    pdf_response = client.get(f"/api/invoices/{invoice['id']}/pdf")
    assert pdf_response.status_code == 200
    assert pdf_response.headers["content-type"] == "application/pdf"
    assert "inline" in pdf_response.headers["content-disposition"]
    assert (
        "Rechnung_TTC_2026-11.pdf"
        in pdf_response.headers["content-disposition"]
    )
    assert pdf_response.content.startswith(b"%PDF-")
    assert pdf_response.content == saved_pdf_path.read_bytes()
    original_pdf = pdf_response.content
    reopened_pdf_response = client.get(f"/api/invoices/{invoice['id']}/pdf")
    assert reopened_pdf_response.status_code == 200
    assert reopened_pdf_response.content == original_pdf

    response = client.delete(f"/api/trainings/{training['id']}")
    assert response.status_code == 204
    assert client.delete(f"/api/trainings/{training['id']}").status_code == 404
    reopened_after_source_deletion = client.get(
        f"/api/invoices/{invoice['id']}/pdf"
    )
    assert reopened_after_source_deletion.status_code == 200
    assert reopened_after_source_deletion.content == original_pdf


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
    with sqlite3.connect(client.app.state.test_database_path) as connection:
        connection.execute(
            """
            INSERT INTO trainings (
                organization_id, training_date, activity_type_id, hours,
                status, unit_rate_cents
            ) VALUES (1, '2026-11-05', ?, 0.333, 'completed', 1500)
            """,
            (activity_id,),
        )

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


def test_invoice_preview_matches_example_uses_training_rate_snapshots_and_is_read_only(
    client: TestClient,
) -> None:
    settings = client.put(
        "/api/settings",
        json={
            "activities": [
                {"name": "Tätigkeit A", "hourly_rate_cents": 2000},
                {"name": "Tätigkeit B", "hourly_rate_cents": 3000},
                {"name": "Tätigkeit C", "hourly_rate_cents": 1500},
            ]
        },
    )
    activities = settings.json()["activities"]
    training_payloads = [
        (activities[0]["id"], "2026-11-02", 2, "completed"),
        (activities[1]["id"], "2026-11-03", 1, "completed"),
        (activities[2]["id"], "2026-11-04", 2, "completed"),
        (activities[0]["id"], "2026-11-05", 4, "planned"),
        (activities[1]["id"], "2026-11-06", 4, "cancelled"),
    ]
    for activity_id, training_date, hours, training_status in training_payloads:
        response = client.post(
            "/api/trainings",
            json={
                "training_date": training_date,
                "activity_type_id": activity_id,
                "hours": hours,
                "status": training_status,
            },
        )
        assert response.status_code == 201

    preview = client.post(
        "/api/invoices/preview",
        json={"year": 2026, "month": 11},
    )
    assert preview.status_code == 200
    result = preview.json()
    assert [
        (item["description"], item["hours"], item["unit_rate_cents"], item["amount_cents"])
        for item in result["items"]
    ] == [
        ("Tätigkeit A", 2, 2000, 4000),
        ("Tätigkeit B", 1, 3000, 3000),
        ("Tätigkeit C", 2, 1500, 3000),
    ]
    assert result["total_amount_cents"] == 10000

    changed_settings = client.put(
        "/api/settings",
        json={
            "activities": [
                {
                    "id": activity["id"],
                    "name": activity["name"],
                    "hourly_rate_cents": 9999,
                    "is_active": True,
                }
                for activity in activities
            ]
        },
    )
    assert changed_settings.status_code == 200
    repeated_preview = client.post(
        "/api/invoices/preview",
        json={"year": 2026, "month": 11},
    )
    assert repeated_preview.status_code == 200
    assert repeated_preview.json() == result

    empty_preview = client.post(
        "/api/invoices/preview",
        json={"year": 2026, "month": 12},
    )
    assert empty_preview.status_code == 200
    assert empty_preview.json()["items"] == []
    assert empty_preview.json()["total_amount_cents"] == 0
    with sqlite3.connect(client.app.state.test_database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM invoices").fetchone() == (0,)


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
            "hours": 2,
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
            "hours": 2,
            "unit_rate_cents": 1800,
            "amount_cents": 3600,
        }
    ]
    assert preview.json()["total_amount_cents"] == 3600


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
                "hours": 1,
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
    for activity, hours in zip(activities, (1, 2), strict=True):
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
    assert [item["amount_cents"] for item in items] == [1500, 4000]
    assert preview.json()["total_amount_cents"] == 5500
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
    assert invoice.json()["total_amount_cents"] == 5500
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
