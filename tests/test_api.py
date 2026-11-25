import base64
import json
import sqlite3
import struct
import subprocess
import sys
import time
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


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/docs/oauth2-redirect"])
def test_external_documentation_pages_are_unavailable(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 404
    assert "text/html" not in response.headers.get("content-type", "")


def test_local_frontend_and_openapi_remain_available(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert 'src="js/app.js"' in response.text
    assert client.get("/js/app.js").status_code == 200
    assert client.get("/css/style.css").status_code == 200

    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert schema["info"]["title"] == "TT Rechnungsverwaltung"
    for path in ("/api/health", "/api/calendar/{year}/{month}", "/api/invoices"):
        assert path in schema["paths"]
    assert not schema.get("servers")


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


@pytest.mark.parametrize("kind", ["shared", "shared-case", "preview", "wrong-period", "valid"])
def test_pdf_access_requires_unique_invoice_association(client: TestClient, kind):
    from backend.database import create_record

    path = client.app.state.test_database_path
    reference = "Rechnung_TTC_2026-11.pdf"
    invoice = {
        "year": 2026, "month": 11, "invoice_date": "2026-11-30",
        "total_amount_cents": 0, "pdf_path": reference,
        "is_preview": int(kind == "preview"),
    }
    if kind == "wrong-period":
        invoice["pdf_path"] = "Rechnung_TTC_2026-12.pdf"
    invoice_id = create_record("invoices", invoice, path)
    if kind.startswith("shared"):
        create_record("invoices", invoice | {
            "month": 12,
            "pdf_path": reference.lower() if kind == "shared-case" else reference,
        }, path)
    directory = client.app.state.test_invoice_directory
    directory.mkdir()
    pdf = directory / reference
    pdf.write_bytes(b"%PDF-original")
    before = path.read_bytes()
    response = client.get(f"/api/invoices/{invoice_id}/pdf")
    assert response.status_code == (200 if kind == "valid" else 404)
    if kind == "valid":
        assert response.content == pdf.read_bytes()
    else:
        assert client.delete(f"/api/invoices/{invoice_id}").status_code == (
            409 if kind == "preview" else 500
        )
    assert path.read_bytes() == before
    assert pdf.read_bytes() == b"%PDF-original"


def test_finalization_does_not_reuse_another_invoices_reference(client: TestClient):
    from backend.database import create_record, get_organization, list_records

    path = client.app.state.test_database_path
    activity = client.put("/api/settings", json={"activities": [
        {"name": "Training", "hourly_rate_cents": 1500},
    ]}).json()["activities"][0]
    client.post("/api/trainings", json={
        "training_date": "2026-11-12", "activity_type_id": activity["id"],
        "hours": 1, "status": "completed",
    })
    create_record("invoices", {
        "year": 2026, "month": 12, "invoice_date": "2026-12-31",
        "total_amount_cents": 0, "pdf_path": "Rechnung_TTC_2026-11.pdf",
    }, path)
    before = list_records("invoices", database_path=path)
    sequence = get_organization(path)["next_invoice_number"]
    response = client.post("/api/invoices", json={"year": 2026, "month": 11})
    assert response.status_code == 409
    assert list_records("invoices", database_path=path) == before
    assert get_organization(path)["next_invoice_number"] == sequence
    assert not (client.app.state.test_invoice_directory / "Rechnung_TTC_2026-11.pdf").exists()


@pytest.mark.parametrize("replaced", [False, True])
def test_finalization_rollback_only_removes_its_own_file(client, monkeypatch, replaced):
    import backend.main as main
    from backend.database import get_organization, list_records

    activity = client.put("/api/settings", json={"activities": [
        {"name": "Training", "hourly_rate_cents": 1500},
    ]}).json()["activities"][0]
    assert client.post("/api/trainings", json={
        "training_date": "2026-11-12", "activity_type_id": activity["id"],
        "hours": 1, "status": "completed",
    }).status_code == 201
    database = client.app.state.test_database_path
    pdf = client.app.state.test_invoice_directory / "Rechnung_TTC_2026-11.pdf"
    sequence = get_organization(database)["next_invoice_number"]

    def fail_database_write(*args, **kwargs):
        assert pdf.read_bytes().startswith(b"%PDF-")
        if replaced:
            replacement = pdf.with_name("replacement.pdf")
            replacement.write_bytes(b"another document")
            replacement.replace(pdf)
        raise ValueError("Der Rechnungsnummernkreis wurde parallel geändert")

    monkeypatch.setattr(main, "create_invoice_with_items", fail_database_write)
    if replaced:
        response = client.post("/api/invoices", json={"year": 2026, "month": 11})
        assert response.status_code == 409
        assert "bereinigt" in response.json()["detail"]
        assert "geändert" in response.json()["detail"]
        assert pdf.read_bytes() == b"another document"
    else:
        assert client.post("/api/invoices", json={"year": 2026, "month": 11}).status_code == 409
        assert not pdf.exists()
    assert list_records("invoices", database_path=database) == []
    assert get_organization(database)["next_invoice_number"] == sequence


@pytest.fixture
def billable_file_error_period(client):
    from backend.database import get_organization, list_records

    activity = client.put("/api/settings", json={"activities": [
        {"name": "Training", "hourly_rate_cents": 1500},
    ]}).json()["activities"][0]
    assert client.post("/api/trainings", json={
        "training_date": "2026-11-12", "activity_type_id": activity["id"],
        "hours": 1, "status": "completed",
    }).status_code == 201
    assert client.post("/api/invoices/preview", json={"year": 2026, "month": 11}).status_code == 200
    database = client.app.state.test_database_path
    preview = list_records("invoices", {"year": 2026, "month": 11, "is_preview": 1}, database)[0]
    return preview["id"], get_invoice(preview["id"], database), get_organization(database)["next_invoice_number"]


@pytest.mark.parametrize("failure,word", [
    (PermissionError("private-path"), "Zugriffsrechte"),
    (OSError(28, "private-path"), "Speicherplatz"),
    (NotADirectoryError("private-path"), "ungültig"),
    (NotImplementedError("private-path"), "Hardlink"),
])
def test_pdf_write_errors_preserve_preview_and_sequence(client, monkeypatch, billable_file_error_period, failure, word):
    from backend.database import get_organization
    from backend.document_storage import DocumentStore

    def fail_write(*args, **kwargs):
        raise failure

    monkeypatch.setattr(DocumentStore, "save_new_with_identity", fail_write)
    response = client.post("/api/invoices", json={"year": 2026, "month": 11})
    assert response.status_code == 503
    assert word in response.json()["detail"]
    assert "nicht gespeichert" in response.json()["detail"]
    assert "private-path" not in response.text
    invoice_id, preview, sequence = billable_file_error_period
    database = client.app.state.test_database_path
    assert get_invoice(invoice_id, database) == preview
    assert get_organization(database)["next_invoice_number"] == sequence
    assert not (client.app.state.test_invoice_directory / "Rechnung_TTC_2026-11.pdf").exists()


def test_failed_pdf_cleanup_is_reported_without_losing_the_file(client, monkeypatch, billable_file_error_period):
    import backend.main as main
    from backend.database import get_organization
    from backend.document_storage import DocumentStore

    def fail_database(*args, **kwargs):
        raise ValueError("Der Rechnungsnummernkreis wurde parallel geändert")

    def fail_cleanup(*args, **kwargs):
        raise PermissionError("private-path")

    monkeypatch.setattr(main, "create_invoice_with_items", fail_database)
    monkeypatch.setattr(DocumentStore, "delete", fail_cleanup)
    response = client.post("/api/invoices", json={"year": 2026, "month": 11})
    assert response.status_code == 503
    assert "nicht bereinigt" in response.json()["detail"]
    assert "private-path" not in response.text
    invoice_id, preview, sequence = billable_file_error_period
    database = client.app.state.test_database_path
    assert get_invoice(invoice_id, database) == preview
    assert get_organization(database)["next_invoice_number"] == sequence
    assert (client.app.state.test_invoice_directory / "Rechnung_TTC_2026-11.pdf").read_bytes().startswith(b"%PDF-")


@pytest.fixture
def stored_file_error_invoice(client):
    from backend.database import create_record
    from backend.document_storage import DocumentStore

    reference = "Rechnung_TTC_2026-11.pdf"
    invoice_id = create_record("invoices", {
        "year": 2026, "month": 11, "invoice_date": "2026-11-30",
        "total_amount_cents": 0, "pdf_path": reference,
    }, client.app.state.test_database_path)
    file = DocumentStore(client.app.state.test_invoice_directory).save_new(reference, b"%PDF-original")
    return invoice_id, file


@pytest.mark.parametrize("missing", [False, True])
def test_missing_or_unreadable_pdf_preserves_invoice(client, monkeypatch, stored_file_error_invoice, missing):
    from backend.document_storage import DocumentStore

    invoice_id, file = stored_file_error_invoice
    before = get_invoice(invoice_id, client.app.state.test_database_path)
    if missing:
        file.unlink()
    else:
        def deny_read(*args, **kwargs):
            raise PermissionError("private-path")
        monkeypatch.setattr(DocumentStore, "get_file", deny_read)
    response = client.get(f"/api/invoices/{invoice_id}/pdf")
    assert response.status_code == (404 if missing else 503)
    assert ("fehlt" if missing else "Zugriffsrechte") in response.json()["detail"]
    assert "private-path" not in response.text
    assert get_invoice(invoice_id, client.app.state.test_database_path) == before
    if missing:
        assert not file.exists()
    else:
        assert file.read_bytes() == b"%PDF-original"


@pytest.mark.parametrize("after_database", [False, True])
def test_delete_error_reports_whether_invoice_was_already_deleted(client, monkeypatch, stored_file_error_invoice, after_database):
    from backend.document_storage import DocumentStore

    invoice_id, file = stored_file_error_invoice
    before = get_invoice(invoice_id, client.app.state.test_database_path)

    def deny_operation(*args, **kwargs):
        raise PermissionError("private-path")

    monkeypatch.setattr(DocumentStore, "delete" if after_database else "get_identity", deny_operation)
    response = client.delete(f"/api/invoices/{invoice_id}")
    assert response.status_code == 503
    assert ("wurde gelöscht" if after_database else "nicht gelöscht") in response.json()["detail"]
    assert "private-path" not in response.text
    assert get_invoice(invoice_id, client.app.state.test_database_path) == (None if after_database else before)
    assert file.read_bytes() == b"%PDF-original"


@pytest.fixture
def deletion_documents(client, stored_file_error_invoice):
    from backend.database import create_record

    invoice_id, selected = stored_file_error_invoice
    other_id = create_record("invoices", {
        "year": 2026, "month": 12, "invoice_date": "2026-12-31",
        "total_amount_cents": 0, "pdf_path": "Rechnung_TTC_2026-12.pdf",
    }, client.app.state.test_database_path)
    legacy = selected.parent / "old-installation"
    legacy.mkdir()
    other_files = {
        selected.with_name("Rechnung_TTC_2026-12.pdf"): b"other invoice",
        selected.with_name("unassigned.pdf"): b"unassigned document",
        selected.parent.parent / "outside.pdf": b"outside document",
        legacy / selected.name: b"legacy original",
    }
    for file, content in other_files.items():
        file.write_bytes(content)
    return invoice_id, selected, other_id, other_files


def _assert_other_documents_unchanged(files):
    for file, content in files.items():
        assert file.read_bytes() == content


def test_deletion_removes_only_the_selected_active_pdf(client, deletion_documents):
    invoice_id, selected, other_id, files = deletion_documents
    other = get_invoice(other_id, client.app.state.test_database_path)
    assert client.delete(f"/api/invoices/{invoice_id}").status_code == 204
    assert not selected.exists()
    assert get_invoice(invoice_id, client.app.state.test_database_path) is None
    assert get_invoice(other_id, client.app.state.test_database_path) == other
    _assert_other_documents_unchanged(files)
    selected.write_bytes(b"later unrelated document")
    assert client.delete(f"/api/invoices/{invoice_id}").status_code == 404
    assert selected.read_bytes() == b"later unrelated document"


@pytest.mark.parametrize("reference", [None, ""])
def test_missing_database_reference_does_not_infer_a_file_to_delete(client, deletion_documents, reference):
    from backend.database import update_record

    invoice_id, selected, other_id, files = deletion_documents
    database = client.app.state.test_database_path
    update_record("invoices", invoice_id, {"pdf_path": reference}, database)
    assert client.delete(f"/api/invoices/{invoice_id}").status_code == 204
    assert get_invoice(invoice_id, database) is None
    assert selected.read_bytes() == b"%PDF-original"
    _assert_other_documents_unchanged(files)


@pytest.mark.parametrize("reference", ["../outside.pdf", "absolute", "..\\outside.pdf", "Rechnung_TTC_2026-12.pdf", "Rechnung_TTC_2026-11.pdf "])
def test_unsafe_invoice_reference_never_deletes_files(client, deletion_documents, reference):
    from backend.database import update_record

    invoice_id, selected, other_id, files = deletion_documents
    if reference == "absolute":
        reference = str(selected.parent.parent / "outside.pdf")
    database = client.app.state.test_database_path
    update_record("invoices", invoice_id, {"pdf_path": reference}, database)
    before = database.read_bytes()
    assert client.delete(f"/api/invoices/{invoice_id}").status_code == 500
    assert database.read_bytes() == before
    assert selected.read_bytes() == b"%PDF-original"
    _assert_other_documents_unchanged(files)


@pytest.mark.parametrize("kind", ["symlink", "directory"])
def test_non_regular_invoice_path_is_preserved_before_database_deletion(client, deletion_documents, kind):
    invoice_id, selected, other_id, files = deletion_documents
    selected.unlink()
    if kind == "symlink":
        selected.symlink_to(selected.parent.parent / "outside.pdf")
    else:
        selected.mkdir()
        (selected / "foreign.pdf").write_bytes(b"foreign")
    database = client.app.state.test_database_path
    before = database.read_bytes()
    assert client.delete(f"/api/invoices/{invoice_id}").status_code == 503
    assert database.read_bytes() == before
    if kind == "symlink":
        assert selected.is_symlink()
    else:
        assert (selected / "foreign.pdf").read_bytes() == b"foreign"
    _assert_other_documents_unchanged(files)


@pytest.mark.parametrize("change", ["invoice", "shared", "shared-case"])
def test_changed_database_selection_prevents_deletion(client, monkeypatch, deletion_documents, change):
    import backend.main as main
    from backend.database import update_record

    invoice_id, selected, other_id, files = deletion_documents
    database = client.app.state.test_database_path
    original_delete = main.delete_final_invoice
    expected = {}

    def concurrent_change(*args, **kwargs):
        if change == "invoice":
            update_record("invoices", invoice_id, {"invoice_number": "RE-CHANGED"}, database)
        else:
            update_record("invoices", other_id, {
                "pdf_path": selected.name.lower() if change == "shared-case" else selected.name,
            }, database)
        expected["selected"] = get_invoice(invoice_id, database)
        expected["other"] = get_invoice(other_id, database)
        return original_delete(*args, **kwargs)

    monkeypatch.setattr(main, "delete_final_invoice", concurrent_change)
    response = client.delete(f"/api/invoices/{invoice_id}")
    assert response.status_code == 409
    assert "nicht gelöscht" in response.json()["detail"]
    assert get_invoice(invoice_id, database) == expected["selected"]
    assert get_invoice(other_id, database) == expected["other"]
    assert selected.read_bytes() == b"%PDF-original"
    _assert_other_documents_unchanged(files)


@pytest.mark.parametrize("change", ["replacement", "reassigned", "reassigned-case", "appeared"])
def test_cleanup_preserves_replaced_new_or_reassigned_documents(client, monkeypatch, deletion_documents, change):
    import backend.main as main
    from backend.database import update_record

    invoice_id, selected, other_id, files = deletion_documents
    database = client.app.state.test_database_path
    original_delete = main.delete_final_invoice
    if change == "appeared":
        selected.unlink()

    def concurrent_change(*args, **kwargs):
        result = original_delete(*args, **kwargs)
        if change == "replacement":
            replacement = selected.with_name("replacement.pdf")
            replacement.write_bytes(b"foreign replacement")
            replacement.replace(selected)
        elif change == "appeared":
            selected.write_bytes(b"new foreign document")
        else:
            update_record("invoices", other_id, {
                "pdf_path": selected.name.lower() if change == "reassigned-case" else selected.name,
            }, database)
        return result

    monkeypatch.setattr(main, "delete_final_invoice", concurrent_change)
    response = client.delete(f"/api/invoices/{invoice_id}")
    assert response.status_code == (204 if change == "appeared" else 409)
    assert get_invoice(invoice_id, database) is None
    assert get_invoice(other_id, database) is not None
    expected = {"replacement": b"foreign replacement", "appeared": b"new foreign document"}.get(change, b"%PDF-original")
    assert selected.read_bytes() == expected
    _assert_other_documents_unchanged(files)


def test_failed_cleanup_ownership_check_keeps_pdf(client, monkeypatch, deletion_documents):
    from contextlib import contextmanager
    import backend.main as main
    from backend.storage_errors import DatabaseAccessError

    invoice_id, selected, other_id, files = deletion_documents

    @contextmanager
    def unavailable(*args, **kwargs):
        raise DatabaseAccessError("locked")
        yield

    monkeypatch.setattr(main, "invoice_document_deletion_guard", unavailable)
    response = client.delete(f"/api/invoices/{invoice_id}")
    assert response.status_code == 503
    assert "PDF blieb erhalten" in response.json()["detail"]
    assert get_invoice(invoice_id, client.app.state.test_database_path) is None
    assert selected.read_bytes() == b"%PDF-original"
    _assert_other_documents_unchanged(files)


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


def test_training_without_hours_is_billed_once_as_flat_rate(
    client: TestClient,
) -> None:
    settings = client.put(
        "/api/settings",
        json={"activities": [{"name": "Pauschale", "hourly_rate_cents": 1800}]},
    )
    activity_id = settings.json()["activities"][0]["id"]
    training = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-05",
            "activity_type_id": activity_id,
            "status": "completed",
        },
    )
    assert training.status_code == 201
    assert training.json()["hours"] is None

    preview = client.post(
        "/api/invoices/preview",
        json={"year": 2026, "month": 11},
    )
    assert preview.status_code == 200
    assert preview.json()["items"][0]["hours"] is None
    assert preview.json()["items"][0]["amount_cents"] == 1800
    assert preview.json()["total_amount_cents"] == 1800

    invoice = client.post(
        "/api/invoices",
        json={
            "year": 2026,
            "month": 11,
            "invoice_date": "2026-12-01",
        },
    )
    assert invoice.status_code == 201
    assert invoice.json()["items"][0]["hours"] is None
    assert invoice.json()["items"][0]["amount_cents"] == 1800

    updated = client.put(
        f"/api/trainings/{training.json()['id']}",
        json={"hours": 2},
    )
    assert updated.status_code == 200
    cleared = client.put(
        f"/api/trainings/{training.json()['id']}",
        json={"hours": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["hours"] is None


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


RECIPIENT_LIMITS = {
    "recipient_name": 200,
    "recipient_street": 200,
    "recipient_postal_code": 20,
    "recipient_city": 100,
    "recipient_email": 254,
}


def test_recipient_can_be_edited_partially_and_cleared(client: TestClient) -> None:
    original = client.get("/api/organization/settings").json()
    recipient = {
        "recipient_name": "TTC O'Brien & Söhne <Verein>",
        "recipient_street": "Äußere Straße 7",
        "recipient_postal_code": "01234",
        "recipient_city": "Köln",
        "recipient_email": "kontakt@example.org",
    }
    response = client.put("/api/organization/settings", json={
        key: f"  {value}  " for key, value in recipient.items()
    })
    assert response.status_code == 200
    assert {key: response.json()[key] for key in recipient} == recipient
    assert response.json()["name"] == original["name"]
    assert response.json()["next_invoice_number"] == original["next_invoice_number"]

    response = client.put("/api/organization/settings", json={"recipient_city": "Bonn"})
    assert response.status_code == 200
    recipient["recipient_city"] = "Bonn"
    assert {key: response.json()[key] for key in recipient} == recipient
    initialize_database(client.app.state.test_database_path)
    loaded = client.get("/api/organization/settings").json()
    assert {key: loaded[key] for key in recipient} == recipient

    response = client.put("/api/organization/settings", json={key: "  " for key in recipient})
    assert response.status_code == 200
    assert all(response.json()[key] == "" for key in recipient)
    assert all(client.get("/api/organization/settings").json()[key] == "" for key in recipient)
    assert response.json()["name"] == original["name"]


@pytest.mark.parametrize("field,limit", RECIPIENT_LIMITS.items())
def test_recipient_accepts_maximum_field_lengths(client: TestClient, field: str, limit: int) -> None:
    value = "a" * limit if field != "recipient_email" else "a" * (limit - 12) + "@example.org"
    response = client.put("/api/organization/settings", json={field: value})
    assert response.status_code == 200
    assert client.get("/api/organization/settings").json()[field] == value


@pytest.mark.parametrize("field,limit", RECIPIENT_LIMITS.items())
@pytest.mark.parametrize("kind", ["too-long", "null", "wrong-type"])
def test_invalid_recipient_update_preserves_all_settings(client: TestClient, field: str, limit: int, kind: str) -> None:
    original = client.get("/api/organization/settings").json()
    value = {"too-long": "a" * (limit + 1), "null": None, "wrong-type": []}[kind]
    response = client.put("/api/organization/settings", json={"name": "Nicht speichern", field: value})
    assert response.status_code == 422
    assert any(error["loc"][-1] == field for error in response.json()["detail"])
    assert client.get("/api/organization/settings").json() == original


@pytest.mark.parametrize("email", ["ungueltig", "a b@example.org", "a@@example.org"])
def test_invalid_recipient_email_preserves_existing_data(client: TestClient, email: str) -> None:
    original = client.get("/api/organization/settings").json()
    response = client.put("/api/organization/settings", json={"recipient_city": "Nicht speichern", "recipient_email": email})
    assert response.status_code == 422
    assert client.get("/api/organization/settings").json() == original


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
            "recipient_name": "Alter Empfänger",
            "recipient_street": "Alte Straße 1",
            "recipient_postal_code": "01234",
            "recipient_city": "Köln",
            "recipient_email": "alt@example.org",
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

    first_response = client.post("/api/invoices", json={"year": 2026, "month": 11, "invoice_date": "2026-11-30"})
    assert first_response.status_code == 201
    first_invoice = first_response.json()
    assert first_invoice["invoice_number"] == "2026-01"
    first_pdf = client.get(f"/api/invoices/{first_invoice['id']}/pdf").content
    assert b"/Subtype /Image" in first_pdf

    changed = client.put(
        "/api/organization/settings",
        json={
            "name": "Neuer Absender",
            "recipient_name": "Neuer Empfänger",
            "recipient_street": "Neue Straße 2",
            "recipient_postal_code": "56789",
            "recipient_city": "Bonn",
            "recipient_email": "neu@example.org",
            "iban": "DE12500105170648489890",
            "account_holder": "Neuer Kontoinhaber",
            "payment_due_days": 30,
        },
    )
    assert changed.status_code == 200
    client.delete("/api/organization/logo")

    second_response = client.post("/api/invoices", json={"year": 2026, "month": 12, "invoice_date": "2026-12-31"})
    assert second_response.status_code == 201
    second_invoice = second_response.json()
    assert second_invoice["invoice_number"] == "2026-02"
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
    for field, value in {"recipient_name": "Alter Empfänger", "recipient_street": "Alte Straße 1",
                         "recipient_postal_code": "01234", "recipient_city": "Köln", "recipient_email": "alt@example.org"}.items():
        assert snapshots[first_invoice["id"]][field] == value
        assert snapshots[second_invoice["id"]][field] == changed.json()[field]
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
            json={"year": year, "month": month, "invoice_date": f"{year}-11-21"},
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
    ] == ["2027-01", "2026-02", "2026-01"]

    november_invoice = invoices_by_month[(2026, 11)]
    archived_november = next(
        invoice
        for invoice in archived
        if invoice["id"] == november_invoice["id"]
    )
    assert archived_november["total_amount_cents"] == 4000
    assert archived_november["invoice_number"] == "2026-01"
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


def test_final_invoice_can_be_deleted_before_finalizing_current_preview(
    client: TestClient,
) -> None:
    activity = client.put(
        "/api/settings",
        json={"activities": [{"name": "Training", "hourly_rate_cents": 1500}]},
    ).json()["activities"][0]

    def create_completed_training(training_date: str, hours: int) -> dict:
        response = client.post(
            "/api/trainings",
            json={
                "training_date": training_date,
                "activity_type_id": activity["id"],
                "hours": hours,
                "status": "completed",
            },
        )
        assert response.status_code == 201
        return response.json()

    first_training = create_completed_training("2026-11-05", 1)
    original_response = client.post(
        "/api/invoices",
        json={"year": 2026, "month": 11},
    )
    assert original_response.status_code == 201
    old_invoice = original_response.json()
    old_pdf = client.app.state.test_invoice_directory / old_invoice["pdf_path"]
    assert old_pdf.is_file()

    second_training = create_completed_training("2026-11-12", 2)
    preview = client.post(
        "/api/invoices/preview",
        json={"year": 2026, "month": 11},
    )
    assert preview.status_code == 200
    assert preview.json()["total_amount_cents"] == 4500
    database_path = client.app.state.test_database_path
    with sqlite3.connect(database_path) as connection:
        preview_id = connection.execute(
            """
            SELECT id FROM invoices
            WHERE year = 2026 AND month = 11 AND is_preview = 1
            """
        ).fetchone()[0]

    other_training = create_completed_training("2026-12-03", 1)
    other_response = client.post(
        "/api/invoices",
        json={"year": 2026, "month": 12},
    )
    assert other_response.status_code == 201
    other_invoice = other_response.json()
    other_pdf = (
        client.app.state.test_invoice_directory / other_invoice["pdf_path"]
    )
    other_pdf_content = other_pdf.read_bytes()

    assert client.delete(f"/api/invoices/{preview_id}").status_code == 409
    assert client.delete(f"/api/invoices/{old_invoice['id']}").status_code == 204
    assert not old_pdf.exists()
    assert client.get(f"/api/invoices/{old_invoice['id']}/pdf").status_code == 404
    assert client.delete(f"/api/invoices/{old_invoice['id']}").status_code == 404

    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT id, is_preview FROM invoices WHERE id = ?",
            (preview_id,),
        ).fetchone() == (preview_id, 1)
        assert connection.execute(
            "SELECT id FROM invoices WHERE id = ?",
            (other_invoice["id"],),
        ).fetchone() == (other_invoice["id"],)
        training_ids = {
            row[0] for row in connection.execute("SELECT id FROM trainings")
        }
    assert training_ids == {
        first_training["id"],
        second_training["id"],
        other_training["id"],
    }

    assert client.post("/api/invoices", json={"year": 2026, "month": 11}).status_code == 409
    corrected = client.put(f"/api/invoices/{other_invoice['id']}/number", json={
        "invoice_number": old_invoice["invoice_number"],
        "expected_invoice_number": other_invoice["invoice_number"], "confirmed": True})
    assert corrected.status_code == 200, corrected.text
    other_pdf = client.app.state.test_invoice_directory / corrected.json()["pdf_path"]
    other_pdf_content = other_pdf.read_bytes()
    finalized = client.post(
        "/api/invoices",
        json={"year": 2026, "month": 11},
    )
    assert finalized.status_code == 201
    new_invoice = finalized.json()
    assert new_invoice["id"] == preview_id
    assert new_invoice["id"] != old_invoice["id"]
    assert new_invoice["total_amount_cents"] == 4500
    assert [item["training_id"] for item in new_invoice["items"]] == [
        first_training["id"],
        second_training["id"],
    ]
    assert other_pdf.read_bytes() == other_pdf_content
    assert client.get(f"/api/invoices/{other_invoice['id']}/pdf").status_code == 200
    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT id, status FROM trainings ORDER BY id"
        ).fetchall() == [
            (first_training["id"], "completed"),
            (second_training["id"], "completed"),
            (other_training["id"], "completed"),
        ]


@pytest.fixture
def calendar_activities(client, monkeypatch):
    class FrozenDate(date):
        @classmethod
        def today(cls):
            return cls(2031, 12, 15)

    monkeypatch.setattr("backend.main.date", FrozenDate)
    monkeypatch.setattr("backend.database.date", FrozenDate)
    return client.put("/api/settings", json={"activities": [
        {"name": "Training", "hourly_rate_cents": 1500},
        {"name": "Assistenz", "hourly_rate_cents": 2200},
        {"name": "Inaktiv", "hourly_rate_cents": 1000, "is_active": False},
    ]}).json()["activities"]


def test_weekly_plan_covers_all_weekdays_and_leap_year_without_duplicates(client, calendar_activities):
    activity = calendar_activities[0]
    response = client.put("/api/weekly-plan", json=[
        {"weekday": weekday, "activity_type_id": activity["id"], "hours": weekday + 1}
        for weekday in range(7)
    ])
    assert response.status_code == 200
    assert len(response.json()) == 7
    assert all(not day["trainings"] for day in client.get("/api/calendar/2031/11").json()["days"])
    for year, month, days in ((2031, 12, 31), (2032, 1, 31), (2032, 2, 29)):
        calendar = client.get(f"/api/calendar/{year}/{month}").json()
        assert len(calendar["days"]) == days
        ids = []
        for day in calendar["days"]:
            assert len(day["trainings"]) == 1
            training = day["trainings"][0]
            assert training["hours"] == date.fromisoformat(day["date"]).weekday() + 1
            assert training["activity_type_id"] == activity["id"]
            ids.append(training["id"])
        assert len(set(ids)) == days
        assert client.get(f"/api/calendar/{year}/{month}").json() == calendar


def test_plan_changes_deactivation_and_removal_preserve_legacy_trainings(client, calendar_activities):
    from backend.database import list_records

    plan = client.put("/api/weekly-plan", json=[
        {"weekday": 0, "activity_type_id": calendar_activities[0]["id"], "hours": 1},
    ]).json()[0]
    # Legacy records have no reliable proof that they have never been edited.
    with sqlite3.connect(client.app.state.test_database_path) as connection:
        connection.execute("DROP TRIGGER training_manual_change")
        connection.execute("UPDATE trainings SET manually_modified=NULL")
    before = list_records("trainings", database_path=client.app.state.test_database_path)
    changed = {"id": plan["id"], "weekday": 6, "activity_type_id": calendar_activities[1]["id"], "hours": 3}
    assert client.put("/api/weekly-plan", json=[changed]).status_code == 200
    for training in before:
        assert client.put(f"/api/trainings/{training['id']}", json={}).json() == training
    february = client.get("/api/calendar/2032/2").json()
    generated = [training for day in february["days"] for training in day["trainings"]]
    assert len(generated) == 5  # February 2032 has five Sundays.
    assert all(training["hours"] == 3 and training["activity_type_id"] == calendar_activities[1]["id"] for training in generated)
    with sqlite3.connect(client.app.state.test_database_path) as connection:
        connection.execute("UPDATE trainings SET manually_modified=NULL")
    assert client.put("/api/weekly-plan", json=[{**changed, "is_active": False}]).status_code == 200
    assert all(not day["trainings"] for day in client.get("/api/calendar/2032/3").json()["days"])
    assert client.put("/api/weekly-plan", json=[]).json() == []
    remaining = list_records("trainings", database_path=client.app.state.test_database_path)
    assert {training["id"] for training in before + generated} <= {training["id"] for training in remaining}
    assert all(training["weekly_plan_id"] is None for training in remaining)


@pytest.mark.parametrize("change,status", [
    ({"weekday": -1}, 422), ({"weekday": 7}, 422),
    ({"hours": 0}, 422), ({"hours": 1.5}, 422), ({"hours": "2"}, 422), ({"hours": None}, 422),
    ({"activity_type_id": 99999}, 409), ({"id": 99999}, 404),
    ({"extra": True}, 422), ({"duplicate": True}, 422),
])
def test_invalid_plan_batches_do_not_change_plan_or_occurrences(client, calendar_activities, change, status):
    from backend.database import list_records

    plan = client.put("/api/weekly-plan", json=[
        {"weekday": 0, "activity_type_id": calendar_activities[0]["id"], "hours": 1},
    ]).json()
    before = list_records("trainings", database_path=client.app.state.test_database_path)
    first = {key: plan[0][key] for key in ("id", "weekday", "activity_type_id", "is_active")}
    first["hours"] = 2
    second = {"weekday": 1, "activity_type_id": calendar_activities[1]["id"], "hours": 3, **change}
    if change.get("duplicate"):
        second = first
    response = client.put("/api/weekly-plan", json=[first, second])
    assert response.status_code == status
    assert client.get("/api/weekly-plan").json() == plan
    assert list_records("trainings", database_path=client.app.state.test_database_path) == before


def test_manual_training_edit_move_and_delete_leave_other_appointments_unchanged(client, calendar_activities):
    payload = {"training_date": "2032-02-28", "activity_type_id": calendar_activities[0]["id"], "hours": 2, "note": "Änderung <Termin>"}
    first = client.post("/api/trainings", json=payload).json()
    other = client.post("/api/trainings", json=payload).json()
    assert first["id"] != other["id"]
    response = client.put(f"/api/trainings/{first['id']}", json={
        "training_date": "2032-02-29", "activity_type_id": calendar_activities[1]["id"],
        "hours": None, "note": None,
    })
    assert response.status_code == 200
    changed = response.json()
    assert changed["hours"] is None and changed["note"] is None
    assert changed["unit_rate_cents"] == 2200
    assert changed["status"] == first["status"]
    calendar = client.get("/api/calendar/2032/2").json()["days"]
    assert [training["id"] for training in calendar[27]["trainings"]] == [other["id"]]
    assert [training["id"] for training in calendar[28]["trainings"]] == [first["id"]]
    assert client.delete(f"/api/trainings/{first['id']}").status_code == 204
    assert client.delete(f"/api/trainings/{first['id']}").status_code == 404
    assert client.put(f"/api/trainings/{first['id']}", json={"hours": 1}).status_code == 404
    assert client.put(f"/api/trainings/{other['id']}", json={}).json() == other


@pytest.mark.parametrize("change,status", [
    ({"training_date": "2031-02-29"}, 422), ({"training_date": None}, 422),
    ({"activity_type_id": None}, 422), ({"activity_type_id": 99999}, 404),
    ({"hours": 0}, 422), ({"hours": 1.5}, 422), ({"hours": "2"}, 422),
    ({"note": "a" * 1001}, 422), ({"extra": True}, 422),
])
def test_invalid_training_edits_preserve_appointment(client, calendar_activities, change, status):
    original = client.post("/api/trainings", json={
        "training_date": "2032-02-29", "activity_type_id": calendar_activities[0]["id"], "hours": 1,
    }).json()
    response = client.put(f"/api/trainings/{original['id']}", json={"note": "Nicht speichern", **change})
    assert response.status_code == status
    assert client.put(f"/api/trainings/{original['id']}", json={}).json() == original


def test_existing_training_can_keep_its_now_inactive_activity_when_edited(client, calendar_activities):
    activity = calendar_activities[0]
    training = client.post("/api/trainings", json={
        "training_date": "2032-02-29", "activity_type_id": activity["id"], "hours": 1,
    }).json()
    assert client.put("/api/settings", json={"activities": [{
        "id": activity["id"], "name": activity["name"], "hourly_rate_cents": 1500, "is_active": False,
    }]}).status_code == 200
    response = client.put(f"/api/trainings/{training['id']}", json={
        "activity_type_id": activity["id"], "hours": 2, "note": "Bestand bearbeiten",
    })
    assert response.status_code == 200
    assert response.json()["activity_type_id"] == activity["id"]
    assert response.json()["hours"] == 2
    assert response.json()["note"] == "Bestand bearbeiten"
    assert client.put(f"/api/trainings/{training['id']}", json={"activity_type_id": calendar_activities[2]["id"]}).status_code == 404
    assert client.put(f"/api/trainings/{training['id']}", json={}).json() == response.json()


def test_inactive_activities_do_not_generate_or_accept_new_appointments(client, calendar_activities):
    inactive = calendar_activities[2]["id"]
    assert client.post("/api/trainings", json={"training_date": "2032-02-29", "activity_type_id": inactive}).status_code == 404
    assert client.put("/api/weekly-plan", json=[{"weekday": 0, "activity_type_id": inactive, "hours": 1}]).status_code == 422
    assert all(not day["trainings"] for day in client.get("/api/calendar/2032/2").json()["days"])


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
            WHERE weekly_plan_id = ? OR id = ?
            ORDER BY training_date
            """,
            (plan_entry["id"], manual.json()["id"]),
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


@pytest.mark.parametrize("generated", [False, True])
@pytest.mark.parametrize("before,after", [
    (before, after) for before in ("planned", "completed", "cancelled")
    for after in ("planned", "completed", "cancelled")
])
def test_all_status_transitions_preserve_appointment_data(client, calendar_activities, generated, before, after):
    activity_id = calendar_activities[0]["id"]
    if generated:
        client.put("/api/weekly-plan", json=[{"weekday": 0, "activity_type_id": activity_id, "hours": 2}])
        training_id = client.get("/api/calendar/2031/12").json()["days"][0]["trainings"][0]["id"]
    else:
        training_id = client.post("/api/trainings", json={
            "training_date": "2031-12-01", "activity_type_id": activity_id, "hours": 2,
        }).json()["id"]
    original = client.put(f"/api/trainings/{training_id}", json={"status": before, "note": "Statusprüfung"}).json()
    other = client.post("/api/trainings", json={
        "training_date": "2031-12-02", "activity_type_id": calendar_activities[1]["id"], "hours": 1,
    }).json()
    response = client.put(f"/api/trainings/{training_id}", json={"status": after})
    assert response.status_code == 200
    expected = {**original, "status": after}
    assert response.json() == expected
    assert client.put(f"/api/trainings/{training_id}", json={"status": after}).json() == expected
    initialize_database(client.app.state.test_database_path)
    calendar = client.get("/api/calendar/2031/12").json()
    stored = next(training for day in calendar["days"] for training in day["trainings"] if training["id"] == training_id)
    assert {key: stored[key] for key in expected} == expected
    assert client.put(f"/api/trainings/{other['id']}", json={}).json() == other


@pytest.mark.parametrize("status", [None, "", "done", "Completed", 0, True, [], {}])
def test_invalid_status_values_do_not_create_or_change_appointments(client, calendar_activities, status):
    from backend.database import list_records

    payload = {"training_date": "2031-12-01", "activity_type_id": calendar_activities[0]["id"], "hours": 1}
    original = client.post("/api/trainings", json=payload).json()
    assert client.post("/api/trainings", json={**payload, "status": status}).status_code == 422
    assert client.put(f"/api/trainings/{original['id']}", json={"status": status, "hours": 2}).status_code == 422
    assert list_records("trainings", database_path=client.app.state.test_database_path) == [original]


def test_month_completion_is_repeatable_and_excludes_moved_and_manual_appointments(client, calendar_activities):
    from backend.database import list_records

    activity_id = calendar_activities[0]["id"]
    client.put("/api/weekly-plan", json=[{"weekday": day, "activity_type_id": activity_id, "hours": 1} for day in range(7)])
    december = client.get("/api/calendar/2031/12").json()["days"]
    completed_id = december[0]["trainings"][0]["id"]
    cancelled_id = december[1]["trainings"][0]["id"]
    moved_id = december[2]["trainings"][0]["id"]
    client.put(f"/api/trainings/{completed_id}", json={"status": "completed"})
    client.put(f"/api/trainings/{cancelled_id}", json={"status": "cancelled"})
    client.put(f"/api/trainings/{moved_id}", json={"training_date": "2032-01-02"})
    manual = client.post("/api/trainings", json={"training_date": "2031-12-01", "activity_type_id": activity_id}).json()
    before = list_records("trainings", database_path=client.app.state.test_database_path)
    assert client.post("/api/calendar/2031/12/complete").json() == {"updated_count": 28}
    assert client.post("/api/calendar/2031/12/complete").json() == {"updated_count": 0}
    assert client.put(f"/api/trainings/{cancelled_id}", json={}).json()["status"] == "cancelled"
    assert client.put(f"/api/trainings/{manual['id']}", json={}).json() == manual
    assert client.put(f"/api/trainings/{moved_id}", json={}).json()["status"] == "planned"
    assert client.post("/api/calendar/2032/1/complete").json() == {"updated_count": 31}
    assert client.put(f"/api/trainings/{moved_id}", json={}).json()["status"] == "planned"
    after = {training["id"]: training for training in list_records("trainings", database_path=client.app.state.test_database_path)}
    assert set(after) == {training["id"] for training in before}
    for training in before:
        assert {key: value for key, value in after[training["id"]].items() if key not in {"status", "manually_modified"}} == {
            key: value for key, value in training.items() if key not in {"status", "manually_modified"}
        }
    assert client.post("/api/calendar/2032/2/complete").json() == {"updated_count": 0}


@pytest.mark.parametrize("year,month", [(0, 1), (10000, 1), (2031, 0), (2031, 13)])
def test_invalid_completion_periods_leave_appointments_unchanged(client, calendar_activities, year, month):
    from backend.database import list_records

    original = client.post("/api/trainings", json={"training_date": "2031-12-01", "activity_type_id": calendar_activities[0]["id"]}).json()
    assert client.post(f"/api/calendar/{year}/{month}/complete").status_code == 422
    assert list_records("trainings", database_path=client.app.state.test_database_path) == [original]


def test_complete_month_only_updates_planned_weekly_plan_occurrences(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FrozenDate(date):
        @classmethod
        def today(cls) -> date:
            return cls(2026, 11, 8)

    monkeypatch.setattr("backend.main.date", FrozenDate)
    activities = client.put(
        "/api/settings",
        json={
            "activities": [
                {"name": "Wochenplan", "hourly_rate_cents": 1500},
                {"name": "Manuell", "hourly_rate_cents": 2000},
            ]
        },
    ).json()["activities"]
    plan_activity_id = activities[0]["id"]
    manual_activity_id = activities[1]["id"]
    matching_manual = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-05",
            "activity_type_id": plan_activity_id,
            "hours": 1,
        },
    )
    assert matching_manual.status_code == 201

    plan = client.put(
        "/api/weekly-plan",
        json=[{
            "weekday": 3,
            "activity_type_id": plan_activity_id,
            "hours": 1,
        }],
    )
    assert plan.status_code == 200

    manual = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-13",
            "activity_type_id": manual_activity_id,
            "hours": 2,
        },
    )
    assert manual.status_code == 201
    assert matching_manual.json()["weekly_plan_generated"] == 0

    november = client.get("/api/calendar/2026/11").json()
    plan_trainings = {
        training["training_date"]: training
        for day in november["days"]
        for training in day["trainings"]
        if training["activity_type_id"] == plan_activity_id
    }
    assert set(plan_trainings) == {
        "2026-11-05",
        "2026-11-12",
        "2026-11-19",
        "2026-11-26",
    }
    assert plan_trainings["2026-11-05"]["weekly_plan_generated"] == 0
    assert all(
        plan_trainings[training_date]["weekly_plan_generated"] == 1
        for training_date in ("2026-11-12", "2026-11-19", "2026-11-26")
    )
    for training_date, status_value in (
        ("2026-11-19", "completed"),
        ("2026-11-26", "cancelled"),
    ):
        response = client.put(
            f"/api/trainings/{plan_trainings[training_date]['id']}",
            json={"status": status_value},
        )
        assert response.status_code == 200

    response = client.post("/api/calendar/2026/11/complete")
    assert response.status_code == 200
    assert response.json() == {"updated_count": 1}

    refreshed_november = client.get("/api/calendar/2026/11").json()
    persisted_statuses = {
        training["training_date"]: training["status"]
        for day in refreshed_november["days"]
        for training in day["trainings"]
        if training["activity_type_id"] == plan_activity_id
    }
    assert persisted_statuses == {
        "2026-11-05": "planned",
        "2026-11-12": "completed",
        "2026-11-19": "completed",
        "2026-11-26": "cancelled",
    }
    manual_after_reload = next(
        training
        for day in refreshed_november["days"]
        for training in day["trainings"]
        if training["id"] == manual.json()["id"]
    )
    assert manual_after_reload["status"] == "planned"

    december = client.get("/api/calendar/2026/12").json()
    december_training = next(
        training
        for day in december["days"]
        for training in day["trainings"]
        if training["activity_type_id"] == plan_activity_id
    )
    assert december_training["status"] == "planned"
    assert client.post("/api/calendar/2026/13/complete").status_code == 422


def test_cancelled_training_status_persists_after_calendar_reload(
    client: TestClient,
) -> None:
    activity = client.put(
        "/api/settings",
        json={"activities": [{"name": "Training", "hourly_rate_cents": 1500}]},
    ).json()["activities"][0]
    training = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-05",
            "activity_type_id": activity["id"],
            "hours": 1,
        },
    ).json()

    response = client.put(
        f"/api/trainings/{training['id']}",
        json={"status": "cancelled"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"

    calendar = client.get("/api/calendar/2026/11").json()
    persisted_training = next(
        item
        for day in calendar["days"]
        for item in day["trainings"]
        if item["id"] == training["id"]
    )
    assert persisted_training["status"] == "cancelled"


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
    assert invoice["invoice_date"] == "2026-12-01"
    assert invoice["invoice_number"] == "2026-01"
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


@pytest.fixture
def invoice_draft(client):
    activity = client.put("/api/settings", json={"activities": [{"name": "Entwurf <Training>", "hourly_rate_cents": 1500}]}).json()["activities"][0]
    trainings = [client.post("/api/trainings", json={
        "training_date": f"2030-01-{day}", "activity_type_id": activity["id"], "hours": hours, "status": "completed",
    }).json() for day, hours in ((15, 2), (16, None))]
    period = {"year": 2030, "month": 1}
    assert client.post("/api/invoices/preview", json=period).status_code == 200
    from backend.database import list_records
    draft = list_records("invoices", {"is_preview": 1}, client.app.state.test_database_path)[0]
    return period, draft["id"], trainings


def test_preview_refresh_replaces_draft_without_pdf_archive_or_number(client, invoice_draft, monkeypatch):
    from backend.database import get_organization, list_records
    from backend import main

    period, draft_id, trainings = invoice_draft
    database = client.app.state.test_database_path
    sequence = get_organization(database)["next_invoice_number"]
    def no_pdf(*args, **kwargs):
        raise AssertionError("Eine Vorschau darf keine PDF rendern")
    monkeypatch.setattr(main, "render_invoice_pdf", no_pdf)
    assert client.put(f"/api/trainings/{trainings[0]['id']}", json={"hours": 4}).status_code == 200
    assert client.delete(f"/api/trainings/{trainings[1]['id']}").status_code == 204
    response = client.post("/api/invoices/preview", json=period)
    assert response.status_code == 200
    assert response.json()["total_amount_cents"] == 6000
    assert [item["training_id"] for item in response.json()["items"]] == [trainings[0]["id"]]
    for _ in range(2):
        assert client.post("/api/invoices/preview", json=period).json() == response.json()
    initialize_database(database)
    stored = get_invoice(draft_id, database)
    assert stored["is_preview"] == 1 and stored["total_amount_cents"] == 6000
    assert len(stored["items"]) == 1 and stored["items"][0]["hours"] == 4
    assert stored["invoice_number"] is None and stored["pdf_path"] is None
    assert stored["invoice_snapshot_json"] is None
    assert [row["id"] for row in list_records("invoices", database_path=database)] == [draft_id]
    assert get_organization(database)["next_invoice_number"] == sequence
    assert client.get("/api/invoices").json() == []
    assert client.get(f"/api/invoices/{draft_id}/pdf").status_code == 404
    assert not list(client.app.state.test_invoice_directory.glob("*"))


def test_refreshing_empty_draft_clears_stale_items_and_preserves_other_period(client, invoice_draft):
    from backend.database import list_records

    period, draft_id, trainings = invoice_draft
    database = client.app.state.test_database_path
    assert client.post("/api/invoices/preview", json={"year": 2030, "month": 2}).status_code == 200
    other = next(row for row in list_records("invoices", database_path=database) if row["month"] == 2)
    other_before = get_invoice(other["id"], database)
    for training in trainings:
        assert client.delete(f"/api/trainings/{training['id']}").status_code == 204
    response = client.post("/api/invoices/preview", json=period)
    assert {key: response.json()[key] for key in (*period, "items", "total_amount_cents")} == {**period, "items": [], "total_amount_cents": 0}
    initialize_database(database)
    assert get_invoice(draft_id, database)["items"] == []
    assert get_invoice(draft_id, database)["total_amount_cents"] == 0
    assert get_invoice(other["id"], database) == other_before


def test_zero_price_preview_keeps_its_position(client):
    activity = client.put("/api/settings", json={"activities": [{"name": "Kostenfrei", "hourly_rate_cents": 0}]}).json()["activities"][0]
    training = client.post("/api/trainings", json={"training_date": "2030-01-01", "activity_type_id": activity["id"], "status": "completed"}).json()
    response = client.post("/api/invoices/preview", json={"year": 2030, "month": 1})
    assert response.status_code == 200
    assert response.json()["total_amount_cents"] == 0
    assert len(response.json()["items"]) == 1
    assert response.json()["items"][0]["training_id"] == training["id"]
    assert response.json()["items"][0]["hours"] is None


def test_failed_draft_refresh_rolls_back_items_and_can_be_retried(client, invoice_draft):
    from backend.database import get_organization

    period, draft_id, trainings = invoice_draft
    database = client.app.state.test_database_path
    before = get_invoice(draft_id, database)
    sequence = get_organization(database)["next_invoice_number"]
    client.put(f"/api/trainings/{trainings[0]['id']}", json={"hours": 10})
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TRIGGER reject_draft_item BEFORE INSERT ON invoice_items BEGIN SELECT RAISE(ABORT, 'Testfehler'); END")
    try:
        assert client.post("/api/invoices/preview", json=period).status_code == 409
        assert get_invoice(draft_id, database) == before
        assert get_organization(database)["next_invoice_number"] == sequence
    finally:
        with sqlite3.connect(database) as connection:
            connection.execute("DROP TRIGGER reject_draft_item")
    assert client.post("/api/invoices/preview", json=period).json()["total_amount_cents"] == 16500


@pytest.mark.parametrize("period", [
    {"year": 0, "month": 1}, {"year": 10000, "month": 1},
    {"year": 2030, "month": 0}, {"year": 2030, "month": 13},
    {"year": None, "month": 1}, {"year": 2030},
    {"year": 2030, "month": 1.5}, {"year": 2030.5, "month": 1},
    {"year": 2030, "month": 1, "extra": True},
])
def test_invalid_preview_period_preserves_existing_draft(client, invoice_draft, period):
    from backend.database import list_records

    _, draft_id, _ = invoice_draft
    database = client.app.state.test_database_path
    before = get_invoice(draft_id, database)
    assert client.post("/api/invoices/preview", json=period).status_code == 422
    assert get_invoice(draft_id, database) == before
    assert [row["id"] for row in list_records("invoices", database_path=database)] == [draft_id]


def test_finalization_recalculates_stale_draft_and_freezes_snapshot(client, invoice_draft):
    from backend.database import get_organization

    period, draft_id, trainings = invoice_draft
    database = client.app.state.test_database_path
    client.put(f"/api/trainings/{trainings[0]['id']}", json={"hours": 4})
    assert get_invoice(draft_id, database)["total_amount_cents"] == 4500
    sequence = get_organization(database)["next_invoice_number"]
    response = client.post("/api/invoices", json=period)
    assert response.status_code == 201
    final = response.json()
    assert final["id"] == draft_id and final["total_amount_cents"] == 7500
    stored = get_invoice(draft_id, database)
    snapshot = json.loads(stored["invoice_snapshot_json"])
    assert [item["hours"] for item in snapshot["items"]] == [4, None]
    assert stored["is_preview"] == 0 and stored["invoice_number"]
    assert get_organization(database)["next_invoice_number"] == sequence + 1
    pdf = client.get(f"/api/invoices/{draft_id}/pdf").content
    assert pdf.startswith(b"%PDF-")
    assert client.post("/api/invoices", json=period).status_code == 409
    assert get_invoice(draft_id, database) == stored
    assert client.get(f"/api/invoices/{draft_id}/pdf").content == pdf
    assert get_organization(database)["next_invoice_number"] == sequence + 1


def test_failed_finalization_restores_draft_number_and_document_state(client, invoice_draft):
    from backend.database import get_organization

    period, draft_id, _ = invoice_draft
    database = client.app.state.test_database_path
    before = get_invoice(draft_id, database)
    sequence = get_organization(database)["next_invoice_number"]
    directory = client.app.state.test_invoice_directory
    directory.mkdir(exist_ok=True)
    unrelated = directory / "Andere-Datei.txt"
    unrelated.write_bytes(b"erhalten")
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TRIGGER reject_final_item BEFORE INSERT ON invoice_items BEGIN SELECT RAISE(ABORT, 'Testfehler'); END")
    try:
        assert client.post("/api/invoices", json=period).status_code == 409
        assert get_invoice(draft_id, database) == before
        assert get_organization(database)["next_invoice_number"] == sequence
        assert list(directory.iterdir()) == [unrelated]
    finally:
        with sqlite3.connect(database) as connection:
            connection.execute("DROP TRIGGER reject_final_item")
    response = client.post("/api/invoices", json=period)
    assert response.status_code == 201 and response.json()["id"] == draft_id
    assert get_organization(database)["next_invoice_number"] == sequence + 1
    assert unrelated.read_bytes() == b"erhalten"


def test_final_snapshot_and_pdf_survive_deleted_source_trainings(client, invoice_draft):
    from backend.database import get_organization

    period, _, trainings = invoice_draft
    final = client.post("/api/invoices", json=period).json()
    database = client.app.state.test_database_path
    stored = get_invoice(final["id"], database)
    pdf = client.get(f"/api/invoices/{final['id']}/pdf").content
    sequence = get_organization(database)["next_invoice_number"]
    for training in trainings:
        assert client.delete(f"/api/trainings/{training['id']}").status_code == 204
    response = client.post("/api/invoices/preview", json=period)
    assert {key: response.json()[key] for key in (*period, "items", "total_amount_cents")} == {**period, "items": [], "total_amount_cents": 0}
    after = get_invoice(final["id"], database)
    assert after["invoice_snapshot_json"] == stored["invoice_snapshot_json"]
    assert after["total_amount_cents"] == 4500
    assert [item["training_id"] for item in after["items"]] == [None, None]
    assert [item["amount_cents"] for item in after["items"]] == [3000, 1500]
    assert client.get(f"/api/invoices/{final['id']}/pdf").content == pdf
    assert client.post("/api/invoices", json=period).status_code == 400
    assert get_organization(database)["next_invoice_number"] == sequence
    assert [row["id"] for row in client.get("/api/invoices").json()] == [final["id"]]


def test_deletion_and_refinalization_preserve_copies_draft_other_month_and_number(client, invoice_draft):
    from backend.database import get_organization, list_records

    period, _, trainings = invoice_draft
    database = client.app.state.test_database_path
    original = client.post("/api/invoices", json=period).json()
    directory = client.app.state.test_invoice_directory
    pdf_path = directory / original["pdf_path"]
    copy = directory / "Exportierte-Kopie.pdf"
    copy.write_bytes(pdf_path.read_bytes())
    client.post("/api/trainings", json={"training_date": "2030-02-01", "activity_type_id": trainings[0]["activity_type_id"], "hours": 1, "status": "completed"})
    other = client.post("/api/invoices", json={"year": 2030, "month": 2}).json()
    other_before = get_invoice(other["id"], database)
    other_pdf = (directory / other["pdf_path"]).read_bytes()
    client.put(f"/api/trainings/{trainings[0]['id']}", json={"hours": 4})
    assert client.post("/api/invoices/preview", json=period).json()["total_amount_cents"] == 7500
    preview = next(row for row in list_records("invoices", database_path=database) if row["is_preview"])
    draft_before = get_invoice(preview["id"], database)
    sequence = get_organization(database)["next_invoice_number"]
    assert client.delete(f"/api/invoices/{original['id']}").status_code == 204
    assert not pdf_path.exists()
    assert copy.read_bytes().startswith(b"%PDF-")
    assert get_invoice(preview["id"], database) == draft_before
    assert get_invoice(other["id"], database) == other_before
    assert (directory / other["pdf_path"]).read_bytes() == other_pdf
    assert get_organization(database)["next_invoice_number"] == sequence
    assert client.delete(f"/api/invoices/{original['id']}").status_code == 404
    assert client.delete(f"/api/invoices/{preview['id']}").status_code == 409
    assert client.post("/api/invoices", json=period).status_code == 409
    corrected = client.put(f"/api/invoices/{other['id']}/number", json={
        "invoice_number": original["invoice_number"],
        "expected_invoice_number": other["invoice_number"], "confirmed": True})
    assert corrected.status_code == 200, corrected.text
    other["pdf_path"] = corrected.json()["pdf_path"]
    other_pdf = (directory / other["pdf_path"]).read_bytes()
    sequence = get_organization(database)["next_invoice_number"]
    response = client.post("/api/invoices", json=period)
    assert response.status_code == 201
    recreated = response.json()
    assert recreated["id"] == preview["id"] and recreated["total_amount_cents"] == 7500
    assert recreated["invoice_number"].endswith(f"-{sequence:02d}")
    assert recreated["invoice_number"] != original["invoice_number"]
    assert get_organization(database)["next_invoice_number"] == sequence + 1
    assert pdf_path.read_bytes() != copy.read_bytes()
    assert (directory / other["pdf_path"]).read_bytes() == other_pdf


def test_failed_final_invoice_deletion_preserves_database_and_pdf(client, invoice_draft):
    from backend.database import get_organization

    period, _, _ = invoice_draft
    final = client.post("/api/invoices", json=period).json()
    database = client.app.state.test_database_path
    stored = get_invoice(final["id"], database)
    path = client.app.state.test_invoice_directory / final["pdf_path"]
    pdf = path.read_bytes()
    sequence = get_organization(database)["next_invoice_number"]
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TRIGGER reject_final_delete BEFORE DELETE ON invoices BEGIN SELECT RAISE(ABORT, 'Testfehler'); END")
    try:
        assert client.delete(f"/api/invoices/{final['id']}").status_code == 409
        assert get_invoice(final["id"], database) == stored
        assert path.read_bytes() == pdf
        assert get_organization(database)["next_invoice_number"] == sequence
    finally:
        with sqlite3.connect(database) as connection:
            connection.execute("DROP TRIGGER reject_final_delete")
    assert client.delete(f"/api/invoices/{final['id']}").status_code == 204
    assert not path.exists()


@pytest.mark.parametrize("action", ["preview", "finalize", "delete"])
def test_concurrent_invoice_actions_do_not_duplicate_or_lose_data(client, invoice_draft, action):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from backend.database import get_organization, list_records

    period, draft_id, _ = invoice_draft
    database = client.app.state.test_database_path
    sequence = get_organization(database)["next_invoice_number"]
    if action == "delete":
        assert client.post("/api/invoices", json=period).status_code == 201
    barrier = Barrier(2)
    def request():
        barrier.wait(timeout=5)
        if action == "delete":
            return client.delete(f"/api/invoices/{draft_id}")
        return client.post("/api/invoices/preview" if action == "preview" else "/api/invoices", json=period)
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: request(), range(2)))
    statuses = sorted(response.status_code for response in responses)
    invoices = list_records("invoices", database_path=database)
    if action == "preview":
        assert statuses == [200, 200]
        assert len(invoices) == 1 and invoices[0]["id"] == draft_id
        assert len(get_invoice(draft_id, database)["items"]) == 2
        assert get_organization(database)["next_invoice_number"] == sequence
    elif action == "finalize":
        assert statuses == [201, 409]
        assert len(invoices) == 1 and invoices[0]["is_preview"] == 0
        assert len(get_invoice(draft_id, database)["items"]) == 2
        assert get_organization(database)["next_invoice_number"] == sequence + 1
        assert [path.name for path in client.app.state.test_invoice_directory.iterdir()] == ["Rechnung_TTC_2030-01.pdf"]
        assert client.get(f"/api/invoices/{draft_id}/pdf").content.startswith(b"%PDF-")
    else:
        assert statuses[0] == 204 and statuses[1] in (404, 409)
        assert invoices == []
        assert get_organization(database)["next_invoice_number"] == sequence + 1
        assert not list(client.app.state.test_invoice_directory.iterdir())


def test_crash_after_pdf_publication_preserves_draft_and_requires_explicit_file_check(client, invoice_draft, tmp_path):
    from backend.database import get_organization

    period, draft_id, _ = invoice_draft
    database = client.app.state.test_database_path
    directory = client.app.state.test_invoice_directory
    before = get_invoice(draft_id, database)
    sequence = get_organization(database)["next_invoice_number"]
    marker = tmp_path / "pdf-published"
    script = '''
from pathlib import Path
import sys
from backend import main
from backend.models import InvoiceCreate
def pause_before_commit(*args, **kwargs):
    Path(sys.argv[3]).write_text('ready')
    sys.stdin.read()
main.create_invoice_with_items = pause_before_commit
main.post_invoice(InvoiceCreate(year=2030, month=1), Path(sys.argv[1]), Path(sys.argv[2]))
'''
    process = subprocess.Popen([sys.executable, "-c", script, str(database), str(directory), str(marker)],
                               cwd=Path(__file__).resolve().parent.parent,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 10
        while not marker.exists():
            assert process.poll() is None, process.communicate()[1].decode()
            assert time.monotonic() < deadline, "PDF-Veröffentlichung wurde nicht erreicht"
            time.sleep(0.02)
        process.kill()
        process.communicate(timeout=5)
        assert process.returncode != 0
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)
    pdf = directory / "Rechnung_TTC_2030-01.pdf"
    original_pdf = pdf.read_bytes()
    assert original_pdf.startswith(b"%PDF-")
    initialize_database(database)
    assert get_invoice(draft_id, database) == before
    assert get_organization(database)["next_invoice_number"] == sequence
    assert client.post("/api/invoices", json=period).status_code == 409
    assert pdf.read_bytes() == original_pdf
    assert get_invoice(draft_id, database) == before
    # Explicit recovery after inspecting the isolated test files: keep the
    # candidate PDF under another name; never remove it automatically on start.
    retained = directory / "Absturz-Kopie.pdf"
    pdf.rename(retained)
    response = client.post("/api/invoices", json=period)
    assert response.status_code == 201 and response.json()["id"] == draft_id
    assert get_organization(database)["next_invoice_number"] == sequence + 1
    assert retained.read_bytes() == original_pdf


def test_invoice_preview_matches_example_and_refreshes_saved_preview(
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
        assert connection.execute(
            "SELECT COUNT(*) FROM invoices WHERE is_preview = 1"
        ).fetchone() == (2,)
        assert connection.execute(
            "SELECT COUNT(*) FROM invoices WHERE is_preview = 0"
        ).fetchone() == (0,)


def test_invoice_preview_stays_separate_from_existing_final_invoice(
    client: TestClient,
) -> None:
    activity = client.put(
        "/api/settings",
        json={"activities": [{"name": "Training", "hourly_rate_cents": 1500}]},
    ).json()["activities"][0]
    training = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-12",
            "activity_type_id": activity["id"],
            "hours": 1,
            "status": "completed",
        },
    ).json()
    payload = {"year": 2026, "month": 11}
    database_path = client.app.state.test_database_path

    first_preview = client.post("/api/invoices/preview", json=payload)
    assert first_preview.status_code == 200
    with sqlite3.connect(database_path) as connection:
        first_invoice_id = connection.execute(
            """
            SELECT id FROM invoices
            WHERE year = 2026 AND month = 11 AND is_preview = 1
            """
        ).fetchone()[0]
        assert connection.execute(
            "SELECT COUNT(*) FROM invoice_items WHERE invoice_id = ?",
            (first_invoice_id,),
        ).fetchone() == (1,)

    updated_training = client.put(
        f"/api/trainings/{training['id']}",
        json={"hours": 2},
    )
    assert updated_training.status_code == 200
    second_training = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-19",
            "activity_type_id": activity["id"],
            "hours": 1,
            "status": "completed",
        },
    )
    assert second_training.status_code == 201

    refreshed_preview = client.post("/api/invoices/preview", json=payload)
    assert refreshed_preview.status_code == 200
    assert refreshed_preview.json()["total_amount_cents"] == 4500
    with sqlite3.connect(database_path) as connection:
        previews = connection.execute(
            """
            SELECT id FROM invoices
            WHERE year = 2026 AND month = 11 AND is_preview = 1
            """
        ).fetchall()
        assert previews == [(first_invoice_id,)]
        replaced_items = connection.execute(
            """
            SELECT training_id, amount_cents FROM invoice_items
            WHERE invoice_id = ? ORDER BY training_id
            """,
            (first_invoice_id,),
        ).fetchall()
        assert replaced_items == [
            (training["id"], 3000),
            (second_training.json()["id"], 1500),
        ]

    finalized = client.post(
        "/api/invoices",
        json={**payload, "invoice_date": "2026-12-01"},
    )
    assert finalized.status_code == 201
    assert finalized.json()["id"] == first_invoice_id
    original_pdf = client.get(
        f"/api/invoices/{first_invoice_id}/pdf"
    ).content
    original_items = get_invoice(first_invoice_id, database_path)["items"]

    assert client.put(
        f"/api/trainings/{training['id']}",
        json={"hours": 3},
    ).status_code == 200
    refreshed_after_finalization = client.post(
        "/api/invoices/preview",
        json=payload,
    )
    assert refreshed_after_finalization.status_code == 200
    assert refreshed_after_finalization.json()["total_amount_cents"] == 6000
    with sqlite3.connect(database_path) as connection:
        preview_rows = connection.execute(
            """
            SELECT id FROM invoices
            WHERE year = 2026 AND month = 11 AND is_preview = 1
            """
        ).fetchall()
        assert len(preview_rows) == 1
        assert preview_rows[0][0] != first_invoice_id
        preview_items = connection.execute(
            """
            SELECT training_id, amount_cents FROM invoice_items
            WHERE invoice_id = ? ORDER BY training_id
            """,
            (preview_rows[0][0],),
        ).fetchall()
        assert preview_items == [
            (training["id"], 4500),
            (second_training.json()["id"], 1500),
        ]
    assert client.get(
        f"/api/invoices/{first_invoice_id}/pdf"
    ).content == original_pdf
    persisted_invoice = get_invoice(first_invoice_id, database_path)
    assert persisted_invoice["is_preview"] == 0
    assert persisted_invoice["items"] == original_items
    assert len(client.get("/api/invoices").json()) == 1


def test_training_status_updates_persist_without_affecting_other_trainings(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FrozenDate(date):
        @classmethod
        def today(cls) -> date:
            return cls(2026, 11, 1)

    monkeypatch.setattr("backend.main.date", FrozenDate)
    activity_id = client.put(
        "/api/settings",
        json={"activities": [{"name": "Training", "hourly_rate_cents": 1500}]},
    ).json()["activities"][0]["id"]
    plan = client.put(
        "/api/weekly-plan",
        json=[{"weekday": 3, "activity_type_id": activity_id, "hours": 1}],
    )
    assert plan.status_code == 200

    manual = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-06",
            "activity_type_id": activity_id,
            "hours": 1,
        },
    )
    cancelled = client.post(
        "/api/trainings",
        json={
            "training_date": "2026-11-07",
            "activity_type_id": activity_id,
            "hours": 1,
            "status": "cancelled",
        },
    )
    assert manual.status_code == cancelled.status_code == 201

    calendar = client.get("/api/calendar/2026/11").json()
    generated = next(
        training
        for day in calendar["days"]
        for training in day["trainings"]
        if training["training_date"] == "2026-11-05"
    )
    manual_training = manual.json()
    cancelled_training = cancelled.json()

    for training in (generated, manual_training):
        completed = client.put(
            f"/api/trainings/{training['id']}",
            json={"status": "completed"},
        )
        assert completed.status_code == 200
        assert completed.json()["status"] == "completed"
        reloaded = client.get("/api/calendar/2026/11").json()
        current = next(
            item
            for day in reloaded["days"]
            for item in day["trainings"]
            if item["id"] == training["id"]
        )
        assert current["status"] == "completed"

        planned = client.put(
            f"/api/trainings/{training['id']}",
            json={"status": "planned"},
        )
        assert planned.status_code == 200
        assert planned.json()["status"] == "planned"
        reloaded = client.get("/api/calendar/2026/11").json()
        current = next(
            item
            for day in reloaded["days"]
            for item in day["trainings"]
            if item["id"] == training["id"]
        )
        assert current["status"] == "planned"

    with sqlite3.connect(client.app.state.test_database_path) as connection:
        persisted = dict(
            connection.execute(
                "SELECT id, status FROM trainings"
            ).fetchall()
        )
    assert persisted[generated["id"]] == "planned"
    assert persisted[manual_training["id"]] == "planned"
    assert persisted[cancelled_training["id"]] == "cancelled"


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


@pytest.mark.parametrize("status", ["planned", "completed", "cancelled"])
@pytest.mark.parametrize("generated", [False, True])
@pytest.mark.parametrize("hours", [2, None])
@pytest.mark.parametrize("training_date", ["2031-11-30", "2031-12-01", "2032-01-01"])
def test_billing_filter_matrix_applies_to_preview_final_snapshot_and_pdf(
    client, calendar_activities, monkeypatch, status, generated, hours, training_date,
):
    from backend import main
    from backend.database import get_organization, list_records

    activity_id = calendar_activities[0]["id"]
    if generated:
        client.put("/api/weekly-plan", json=[{"weekday": 0, "activity_type_id": activity_id, "hours": 1}])
        training_id = client.get("/api/calendar/2031/12").json()["days"][0]["trainings"][0]["id"]
        response = client.put(f"/api/trainings/{training_id}", json={"status": status, "hours": hours, "training_date": training_date})
    else:
        response = client.post("/api/trainings", json={"training_date": training_date, "activity_type_id": activity_id, "status": status, "hours": hours})
        training_id = response.json()["id"]
    assert response.status_code in (200, 201)
    database = client.app.state.test_database_path
    before = list_records("trainings", database_path=database)
    sequence = get_organization(database)["next_invoice_number"]
    lines = []
    render_pdf = main.render_invoice_pdf
    def capture_pdf(year, month, invoice_date, items, total, details):
        lines.extend(items)
        return render_pdf(year, month, invoice_date, items, total, details)
    monkeypatch.setattr(main, "render_invoice_pdf", capture_pdf)
    period = {"year": 2031, "month": 12}
    billable = status == "completed" and training_date == "2031-12-01"
    preview = client.post("/api/invoices/preview", json=period)
    assert preview.status_code == 200
    expected_ids = [training_id] if billable else []
    expected_amount = (3000 if hours == 2 else 1500) if billable else 0
    assert [item["training_id"] for item in preview.json()["items"]] == expected_ids
    assert preview.json()["total_amount_cents"] == expected_amount
    final = client.post("/api/invoices", json=period)
    assert final.status_code == (201 if billable else 400)
    if billable:
        assert [item["training_id"] for item in final.json()["items"]] == expected_ids
        snapshot = json.loads(get_invoice(final.json()["id"], database)["invoice_snapshot_json"])
        assert [item["training_id"] for item in snapshot["items"]] == expected_ids
        assert [(line.training_date.isoformat(), line.hours, line.amount_cents) for line in lines] == [(training_date, hours, expected_amount)]
        assert client.get(f"/api/invoices/{final.json()['id']}/pdf").content.startswith(b"%PDF-")
    else:
        assert lines == []
        assert client.get("/api/invoices").json() == []
        assert not list(client.app.state.test_invoice_directory.glob("*"))
    assert get_organization(database)["next_invoice_number"] == sequence + int(billable)
    assert list_records("trainings", database_path=database) == before


@pytest.mark.parametrize("status", ["planned", "cancelled"])
def test_finalization_rechecks_completion_after_preview(client, invoice_draft, status):
    from backend.database import get_organization

    period, draft_id, trainings = invoice_draft
    database = client.app.state.test_database_path
    sequence = get_organization(database)["next_invoice_number"]
    for training in trainings:
        client.put(f"/api/trainings/{training['id']}", json={"status": status})
    assert client.post("/api/invoices", json=period).status_code == 400
    assert get_invoice(draft_id, database)["is_preview"] == 1
    assert get_organization(database)["next_invoice_number"] == sequence
    assert not list(client.app.state.test_invoice_directory.glob("*"))
    client.put(f"/api/trainings/{trainings[0]['id']}", json={"status": "completed"})
    final = client.post("/api/invoices", json=period)
    assert final.status_code == 201
    assert [item["training_id"] for item in final.json()["items"]] == [trainings[0]["id"]]
    assert final.json()["total_amount_cents"] == 3000


def test_mixed_billable_sources_keep_historical_prices_after_deactivation(client, calendar_activities, monkeypatch):
    from backend import main

    regular, flat = calendar_activities[:2]
    client.put("/api/weekly-plan", json=[{"weekday": 0, "activity_type_id": regular["id"], "hours": 1}])
    generated = client.get("/api/calendar/2031/12").json()["days"][0]["trainings"][0]
    client.put(f"/api/trainings/{generated['id']}", json={"status": "completed"})
    expected = {generated["id"]: 1500}
    for day, activity, hours in (("2031-12-31", regular, 2), ("2031-12-15", flat, None)):
        response = client.post("/api/trainings", json={"training_date": day, "activity_type_id": activity["id"], "hours": hours, "status": "completed"})
        expected[response.json()["id"]] = 3000 if hours else 2200
    for day, status in (("2031-12-31", "planned"), ("2031-12-15", "cancelled"), ("2031-11-30", "completed"), ("2032-01-01", "completed")):
        assert client.post("/api/trainings", json={"training_date": day, "activity_type_id": regular["id"], "hours": 99, "status": status}).status_code == 201
    assert client.put("/api/settings", json={"activities": [
        {"id": activity["id"], "name": activity["name"], "hourly_rate_cents": 9999, "is_active": False}
        for activity in (regular, flat)
    ]}).status_code == 200
    lines = []
    render_pdf = main.render_invoice_pdf
    def capture_pdf(year, month, invoice_date, items, total, details):
        lines.extend(items)
        return render_pdf(year, month, invoice_date, items, total, details)
    monkeypatch.setattr(main, "render_invoice_pdf", capture_pdf)
    period = {"year": 2031, "month": 12}
    preview = client.post("/api/invoices/preview", json=period).json()
    assert {item["training_id"]: item["amount_cents"] for item in preview["items"]} == expected
    assert preview["total_amount_cents"] == 6700
    final = client.post("/api/invoices", json=period)
    assert final.status_code == 201
    assert {item["training_id"]: item["amount_cents"] for item in final.json()["items"]} == expected
    assert sum(line.amount_cents for line in lines) == 6700
    assert sorted(line.unit_rate_cents for line in lines) == [1500, 1500, 2200]


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


def test_invoice_creation_only_persists_completed_manual_and_generated_trainings(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FrozenDate(date):
        @classmethod
        def today(cls) -> date:
            return cls(2026, 11, 1)

    monkeypatch.setattr("backend.main.date", FrozenDate)
    activity = client.put(
        "/api/settings",
        json={"activities": [{"name": "Training", "hourly_rate_cents": 1500}]},
    ).json()["activities"][0]
    plan = client.put(
        "/api/weekly-plan",
        json=[{
            "weekday": 2,
            "activity_type_id": activity["id"],
            "hours": 1,
        }],
    )
    assert plan.status_code == 200

    calendar = client.get("/api/calendar/2026/11").json()
    generated_trainings = {
        training["training_date"]: training
        for day in calendar["days"]
        for training in day["trainings"]
        if training["weekly_plan_generated"] == 1
    }
    assert "2026-11-04" in generated_trainings
    assert "2026-11-11" in generated_trainings
    assert "2026-11-18" in generated_trainings

    completed_auto_id = generated_trainings["2026-11-04"]["id"]
    cancelled_auto_id = generated_trainings["2026-11-11"]["id"]
    response = client.put(
        f"/api/trainings/{completed_auto_id}",
        json={"status": "completed"},
    )
    assert response.status_code == 200
    response = client.put(
        f"/api/trainings/{cancelled_auto_id}",
        json={"status": "cancelled"},
    )
    assert response.status_code == 200

    manual_ids = {}
    for training_date, training_status in (
        ("2026-11-12", "completed"),
        ("2026-11-13", "planned"),
        ("2026-11-14", "cancelled"),
    ):
        response = client.post(
            "/api/trainings",
            json={
                "training_date": training_date,
                "activity_type_id": activity["id"],
                "hours": 2,
                "status": training_status,
            },
        )
        assert response.status_code == 201
        manual_ids[training_date] = response.json()["id"]

    payload = {"year": 2026, "month": 11}
    preview = client.post("/api/invoices/preview", json=payload)
    assert preview.status_code == 200
    expected_training_ids = [completed_auto_id, manual_ids["2026-11-12"]]
    assert [item["training_id"] for item in preview.json()["items"]] == (
        expected_training_ids
    )
    assert preview.json()["total_amount_cents"] == 4500

    invoice_response = client.post("/api/invoices", json=payload)
    assert invoice_response.status_code == 201
    invoice = invoice_response.json()
    assert [item["training_id"] for item in invoice["items"]] == expected_training_ids
    assert invoice["total_amount_cents"] == 4500
    persisted_invoice = get_invoice(
        invoice["id"],
        client.app.state.test_database_path,
    )
    assert persisted_invoice is not None
    assert [item["training_id"] for item in persisted_invoice["items"]] == (
        expected_training_ids
    )


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


@pytest.mark.parametrize("corrupt", [False, True])
def test_database_failure_returns_actionable_503_without_recreating(client, corrupt):
    path = client.app.state.test_database_path
    path.unlink()
    if corrupt:
        path.write_bytes(b"damaged")
    response = client.get("/api/settings")
    assert response.status_code == 503
    assert str(path) not in response.text
    if corrupt:
        assert "beschädigt" in response.json()["detail"]
        assert path.read_bytes() == b"damaged"
    else:
        assert "fehlt" in response.json()["detail"]
        assert not path.exists()


def test_delete_after_another_request_completed_returns_not_found_and_preserves_invariants(client, invoice_draft, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, Lock
    from backend.database import get_organization, list_records
    import backend.main as main

    period, invoice_id, _ = invoice_draft
    database = client.app.state.test_database_path
    assert client.post("/api/invoices", json=period).status_code == 201
    sequence = get_organization(database)["next_invoice_number"]
    entered, release, guard = Event(), Event(), Lock()
    original, calls = main.get_owned_invoice_document, 0

    def ownership_after_concurrent_delete(invoice, path):
        nonlocal calls
        with guard:
            calls += 1
            first = calls == 1
        if first:
            entered.set()
            assert release.wait(5)
        return original(invoice, path)

    monkeypatch.setattr(main, "get_owned_invoice_document", ownership_after_concurrent_delete)
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(client.delete, f"/api/invoices/{invoice_id}")
        try:
            assert entered.wait(5)
            second = executor.submit(client.delete, f"/api/invoices/{invoice_id}")
            assert second.result(timeout=5).status_code == 204
        finally:
            release.set()
        assert first.result(timeout=5).status_code == 404
    assert list_records("invoices", database_path=database) == []
    assert get_organization(database)["next_invoice_number"] == sequence
    assert not list(client.app.state.test_invoice_directory.iterdir())


@pytest.mark.parametrize("count", [0, 1, 4, 5, 10, 11])
def test_dynamic_activity_capacity(client, count):
    activities = [{"name": f"Tätigkeit {i}", "hourly_rate_cents": 1234,
                   "is_active": i % 2 == 0} for i in range(count)]
    response = client.put("/api/settings", json={"activities": activities})
    assert response.status_code == (422 if count > 10 else 200)
    saved = client.get("/api/settings").json()["activities"]
    assert len(saved) == (0 if count > 10 else count)
    # A fresh client/connection reads the persisted records, with stable IDs.
    with TestClient(app) as restarted:
        assert restarted.get("/api/settings").json()["activities"] == saved


def test_activity_limit_counts_omitted_and_inactive_records(client):
    saved = client.put("/api/settings", json={"activities": [
        {"name": f"Alt {i}", "hourly_rate_cents": 100, "is_active": False}
        for i in range(10)
    ]}).json()["activities"]
    response = client.put("/api/settings", json={"activities": [
        {"id": saved[0]["id"], "name": "Geändert", "hourly_rate_cents": 200},
        {"name": "Elfte", "hourly_rate_cents": 100},
    ]})
    assert response.status_code == 422
    assert client.get("/api/settings").json()["activities"] == saved
    assert client.put("/api/settings", json={"activities": []}).json()["activities"] == saved
    edited = {key: saved[0][key] for key in ("id", "name", "hourly_rate_cents", "is_active")}
    edited["is_active"] = True
    response = client.put("/api/settings", json={"activities": [edited]})
    assert response.status_code == 200
    assert {item["id"] for item in response.json()["activities"]} == {item["id"] for item in saved}
    assert client.put("/api/settings", json={"activities": [edited, edited]}).status_code == 422


@pytest.mark.parametrize("invalid", [
    {"name": "   ", "hourly_rate_cents": 100},
    {"name": "X", "hourly_rate_cents": -1},
    {"name": "X", "hourly_rate_cents": 1.5},
    {"name": "X", "hourly_rate_cents": True},
    {"name": "X", "hourly_rate_cents": 10000000000},
])
def test_invalid_activity_batch_is_atomic(client, invalid):
    assert client.put("/api/settings", json={"activities": [
        {"name": "Valid", "hourly_rate_cents": 1}, invalid,
    ]}).status_code == 422
    assert client.get("/api/settings").json()["activities"] == []


def test_activity_final_slot_is_atomic(client):
    from concurrent.futures import ThreadPoolExecutor
    from backend.database import InvalidRecordError, save_activities

    client.put("/api/settings", json={"activities": [
        {"name": f"Alt {i}", "hourly_rate_cents": 100} for i in range(9)
    ]})
    path = client.app.state.test_database_path
    def save(index):
        try:
            save_activities([{"id": None, "name": f"Parallel {index}",
                              "hourly_rate_cents": 100, "is_active": True}], path)
            return "ok"
        except InvalidRecordError:
            return "full"
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, range(2))) == ["full", "ok"]
    assert len(client.get("/api/settings").json()["activities"]) == 10


def test_ten_activities_preserve_plan_training_and_final_invoice(client):
    activities = client.put("/api/settings", json={"activities": [
        {"name": f"Leistung {i}", "hourly_rate_cents": 1234 + i} for i in range(10)
    ]}).json()["activities"]
    plans = [{"weekday": 0, "activity_type_id": a["id"], "hours": 1} for a in activities]
    response = client.put("/api/weekly-plan", json=plans)
    assert response.status_code == 200
    saved_plans = response.json()
    training_ids = []
    for activity in activities:
        response = client.post("/api/trainings", json={
            "training_date": "2020-01-15", "activity_type_id": activity["id"],
            "hours": 1, "status": "completed",
        })
        assert response.status_code == 201
        training_ids.append(response.json()["id"])
    period = {"year": 2020, "month": 1}
    preview = client.post("/api/invoices/preview", json=period).json()
    assert len(preview["items"]) == 10
    assert preview["total_amount_cents"] == sum(1234 + i for i in range(10))
    created = client.post("/api/invoices", json=period)
    assert created.status_code == 201
    invoice_id = created.json()["id"]
    before = get_invoice(invoice_id, client.app.state.test_database_path)
    pdf = client.get(f"/api/invoices/{invoice_id}/pdf").content
    assert pdf.startswith(b"%PDF-")
    changed = [{"id": a["id"], "name": f"Neu {i}", "hourly_rate_cents": 9999,
                "is_active": False} for i, a in enumerate(activities)]
    assert client.put("/api/settings", json={"activities": changed}).status_code == 200
    assert client.get("/api/weekly-plan").json() == saved_plans
    retained_plans = [
        {**{key: plan[key] for key in ("id", "weekday", "activity_type_id", "is_active")},
         "hours": int(plan["hours"])}
        for plan in saved_plans
    ]
    assert client.put("/api/weekly-plan", json=retained_plans).status_code == 200
    assert client.put("/api/weekly-plan", json=plans).status_code == 422
    assert client.post("/api/trainings", json={"training_date": "2020-02-15",
        "activity_type_id": activities[-1]["id"], "hours": 1}).status_code == 404
    calendar = client.get("/api/calendar/2020/1").json()
    loaded = [t for day in calendar["days"] for t in day["trainings"]]
    assert {t["id"] for t in loaded} == set(training_ids)
    assert get_invoice(invoice_id, client.app.state.test_database_path) == before
    assert client.get(f"/api/invoices/{invoice_id}/pdf").content == pdf


def test_weekly_recurrence_api_validation_and_result_header(client, calendar_activities):
    activity = calendar_activities[0]['id']
    entry = {'weekday': 3, 'activity_type_id': activity, 'hours': 1, 'repeat_weeks': 2}
    for change in ({}, {'start_date': '2032-12-03'}, {'start_date': 'invalid'}, {'repeat_weeks': 3}, {'repeat_weeks': True}, {'repeat_weeks': 2.0}):
        response = client.put('/api/weekly-plan', json=[{**entry, **change}])
        assert response.status_code == 422
        assert client.get('/api/weekly-plan').json() == []
    response = client.put('/api/weekly-plan', json=[{**entry, 'start_date': '2032-12-02'}])
    assert response.status_code == 200
    assert set(json.loads(response.headers['X-Weekly-Plan-Sync'])) == {'added', 'removed', 'updated', 'preserved'}
    assert response.json()[0]['start_date'] == '2032-12-02'
    assert response.json()[0]['repeat_weeks'] == 2


def test_archive_uses_billing_period_and_saved_recipient(client):
    from backend.database import create_record

    database = client.app.state.test_database_path
    base = {"year": 2025, "month": 12, "invoice_date": "2026-01-04",
            "invoice_number": "2026-01", "total_amount_cents": 1500, "is_preview": 0}
    historical = create_record("invoices", base | {"invoice_snapshot_json": json.dumps({
        "recipient_name": "Alter Verein", "recipient_contact_name": "Erika Beispiel"})}, database)
    create_record("invoices", base | {"month": 11, "invoice_number": "2026-02",
                                       "invoice_snapshot_json": "broken"}, database)
    create_record("invoices", base | {"year": 2026, "is_preview": 1}, database)
    other = client.post('/api/profiles', json={"name": "Anderes Profil"}).json()['id']
    from backend.database import ProfileDatabasePath
    create_record("invoices", base, ProfileDatabasePath(database, other))
    response = client.get('/api/invoices')
    assert response.status_code == 200
    invoices = response.json()
    assert len(invoices) == 2
    assert invoices[0]['id'] == historical
    assert invoices[0]['year'] == 2025
    assert invoices[0]['invoice_date'].startswith('2026')
    assert invoices[0]['recipient'] == 'Alter Verein · Erika Beispiel'
    assert invoices[1]['recipient'] == ''
    assert 'invoice_snapshot_json' not in invoices[0]
    assert 'logo_snapshot' not in invoices[0]
