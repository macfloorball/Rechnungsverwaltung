"""Replace installation code while retaining a separate user profile."""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from backend.database import (
    create_record, create_invoice_with_items, get_invoice, initialize_database,
    update_organization,
)


def test_replaced_installation_keeps_all_business_data(tmp_path):
    profile = tmp_path / "User Data"
    path = profile / "ttc.db"
    initialize_database(path)
    update_organization({"recipient_name": "Test Recipient", "next_invoice_number": 42, "logo_data": b"logo"}, path)
    activity = create_record("activity_types", {"name": "Training", "hourly_rate_cents": 1200}, path)
    plan = create_record("weekly_plan", {"weekday": 1, "activity_type_id": activity, "hours": 2}, path)
    training = create_record("trainings", {"activity_type_id": activity, "weekly_plan_id": plan, "training_date": "2026-11-01", "status": "completed", "hours": 2, "unit_rate_cents": 1200}, path)
    invoice_id = create_invoice_with_items(
        {"year": 2026, "month": 11, "invoice_date": "2026-11-30", "invoice_number": "RE-41", "total_amount_cents": 2400, "pdf_path": "existing.pdf", "invoice_snapshot_json": '{"recipient_name":"Historical"}', "logo_snapshot": b"old logo"},
        [{"training_id": training, "training_date": "2026-11-01", "description": "Training", "hours": 2, "unit_rate_cents": 1200, "amount_cents": 2400}], path,
    )
    before = path.read_bytes()
    invoice = get_invoice(invoice_id, path)
    root = Path(__file__).resolve().parent.parent
    script = '''
import json
from backend.database import initialize_database, get_organization, list_records
initialize_database()
org = get_organization()
print(json.dumps({"recipient": org["recipient_name"], "number": org["next_invoice_number"], "logo": org["logo_data"].decode(), "counts": [len(list_records(table)) for table in ("activity_types", "weekly_plan", "trainings", "invoices", "invoice_items")]}))
'''
    for name in ("old installation", "replacement installation"):
        installation = tmp_path / name
        shutil.copytree(root / "backend", installation / "backend", ignore=shutil.ignore_patterns("__pycache__"))
        result = subprocess.run([sys.executable, "-c", script], cwd=tmp_path,
                                env=os.environ | {"PYTHONPATH": str(installation), "TTC_DATA_DIRECTORY": str(profile)},
                                capture_output=True, text=True, check=True, timeout=10)
        assert json.loads(result.stdout) == {"recipient": "Test Recipient", "number": 42, "logo": "logo", "counts": [1, 1, 1, 1, 1]}
        assert not (installation / "data").exists()
        assert path.read_bytes() == before
        assert get_invoice(invoice_id, path) == invoice
    assert not list(profile.glob("*.before-migration-*"))


@pytest.mark.parametrize("custom_documents", [False, True])
def test_replaced_installation_keeps_imported_pdf_in_user_profile(tmp_path, custom_documents):
    root = Path(__file__).resolve().parent.parent
    profile = tmp_path / "User Data"
    database = profile / "ttc.db"
    initialize_database(database)
    reference = "Rechnung_TTC_2026-11.pdf"
    invoice_id = create_invoice_with_items({
        "year": 2026, "month": 11, "invoice_date": "2026-11-30",
        "total_amount_cents": 0, "pdf_path": reference,
    }, [], database)
    before = database.read_bytes()
    installations = [tmp_path / "old installation", tmp_path / "replacement installation"]
    for installation in installations:
        shutil.copytree(root / "backend", installation / "backend", ignore=shutil.ignore_patterns("__pycache__"))
    legacy = installations[0] / "rechnungen" / reference
    legacy.parent.mkdir()
    legacy.write_bytes(b"%PDF-historical-content")
    orphan = legacy.parent / "unassigned.pdf"
    orphan.write_bytes(b"unassigned")
    directory = tmp_path / "Custom Invoices" if custom_documents else profile / "documents"
    expected_content = "%PDF-historical-content"
    if custom_documents:
        # The current profile copy takes precedence over older installation
        # files when moving to a separately configured document directory.
        default_pdf = profile / "documents" / reference
        default_pdf.parent.mkdir()
        expected_content = "%PDF-profile-content"
        default_pdf.write_bytes(expected_content.encode())
    script = '''
import json
from fastapi.testclient import TestClient
from backend.main import app, get_invoice_directory
with TestClient(app) as client:
    response = client.get("/api/invoices/INVOICE_ID/pdf")
    assert response.status_code == 200
    print(json.dumps({"content": response.content.decode(), "directory": str(get_invoice_directory())}))
'''.replace("INVOICE_ID", str(invoice_id))
    for index, installation in enumerate(installations):
        environment = os.environ | {
            "PYTHONPATH": str(installation), "TTC_DATA_DIRECTORY": str(profile),
            "TTC_FRONTEND_DIRECTORY": str(root / "frontend"),
        }
        environment.pop("TTC_DOCUMENT_DIRECTORY", None)
        if custom_documents:
            environment["TTC_DOCUMENT_DIRECTORY"] = str(directory)
        result = subprocess.run(
            [sys.executable, "-c", script], cwd=tmp_path,
            env=environment, capture_output=True, text=True, check=True, timeout=15,
        )
        assert json.loads(result.stdout) == {
            "content": expected_content, "directory": str(directory),
        }
        assert database.read_bytes() == before
        assert (directory / reference).read_bytes() == expected_content.encode()
        assert not (directory / orphan.name).exists()
        if custom_documents:
            assert default_pdf.read_bytes() == expected_content.encode()
        if index == 0:
            assert legacy.read_bytes() == b"%PDF-historical-content"
            assert orphan.read_bytes() == b"unassigned"
            # Only a temporary test installation is removed, after its source
            # files and the persistent copy have both been verified.
            shutil.rmtree(installation)
