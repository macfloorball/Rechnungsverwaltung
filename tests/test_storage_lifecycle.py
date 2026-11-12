"""Real managed backend restarts use only a temporary database and PDFs."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest


@contextmanager
def backend_process(tmp_path, *, damaged=False, reload=False):
    root = Path(__file__).resolve().parent.parent
    (tmp_path / "isolated_app.py").write_text(
        "import os\nfrom pathlib import Path\n"
        "from backend.main import app, get_invoice_directory\n"
        "app.dependency_overrides[get_invoice_directory] = lambda: Path(os.environ['TEST_INVOICES'])\n"
    )
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = os.environ | {
        "PYTHONPATH": os.pathsep.join([str(tmp_path), str(root)]),
        "TTC_DATA_DIRECTORY": str(tmp_path / "User Data"),
        "TTC_LEGACY_DATABASE": str(tmp_path / "no-legacy.db"),
        "TEST_INVOICES": str(tmp_path / "invoices"),
    }
    args = [sys.executable, "-m", "scripts.managed_server", "isolated_app:app", "--host", "127.0.0.1", "--port", str(port)]
    if reload:
        args += ["--reload", "--reload-dir", str(tmp_path)]
    with (tmp_path / "process.log").open("w+") as log:
        process = subprocess.Popen(args, cwd=tmp_path, env=env, stdin=subprocess.PIPE, stdout=log, stderr=log)
        try:
            if damaged:
                assert process.wait(timeout=10) != 0
                log.seek(0)
                assert "TTC_DATABASE_ERROR:corrupt" in log.read()
                yield None
                return
            url = f"http://127.0.0.1:{port}"
            deadline = time.monotonic() + 10
            while True:
                try:
                    with urllib.request.urlopen(url + "/api/health", timeout=0.2):
                        break
                except OSError:
                    assert process.poll() is None, (tmp_path / "process.log").read_text()
                    assert time.monotonic() < deadline
                    time.sleep(0.05)

            def request(method, endpoint, payload=None, expected=200):
                data = json.dumps(payload).encode() if payload is not None else None
                req = urllib.request.Request(url + endpoint, data=data, method=method, headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=10) as response:
                    assert response.status == expected
                    content = response.read()
                    return json.loads(content) if response.headers.get_content_type() == "application/json" else content
            yield request
        finally:
            if process.poll() is None:
                process.stdin.write(b"shutdown\n")
                process.stdin.close()
                try:
                    assert process.wait(timeout=10) == 0
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.wait(timeout=5)


@pytest.mark.parametrize("reload", [False, True])
def test_restart_preserves_recipient_plan_status_invoice_and_pdf(tmp_path, reload):
    with backend_process(tmp_path, reload=reload) as request:
        request("PUT", "/api/organization/settings", {"recipient_name": "Test Recipient", "invoice_number_prefix": "TEST"})
        activity = request("PUT", "/api/settings", {"activities": [{"name": "Training", "hourly_rate_cents": 1500}]})["activities"][0]
        plan = request("PUT", "/api/weekly-plan", [{"weekday": 1, "activity_type_id": activity["id"], "hours": 1}])
        training = request("POST", "/api/trainings", {"training_date": "2020-01-15", "activity_type_id": activity["id"], "hours": 2, "status": "completed"}, 201)
        request("POST", "/api/trainings", {"training_date": "2020-01-16", "activity_type_id": activity["id"], "hours": 3, "status": "cancelled"}, 201)
        preview = request("POST", "/api/invoices/preview", {"year": 2020, "month": 1})
        assert preview["total_amount_cents"] == 3000
        invoice = request("POST", "/api/invoices", {"year": 2020, "month": 1}, 201)
        pdf = request("GET", f"/api/invoices/{invoice['id']}/pdf")
        assert pdf.startswith(b"%PDF-")
        request("PUT", "/api/settings", {"activities": [{"id": activity["id"], "name": "Changed", "hourly_rate_cents": 9999}]})
    with backend_process(tmp_path, reload=reload) as request:
        organization = request("GET", "/api/organization/settings")
        assert organization["recipient_name"] == "Test Recipient"
        assert organization["next_invoice_number"] == 2
        assert request("GET", "/api/weekly-plan") == plan
        calendar = request("GET", "/api/calendar/2020/1")
        persisted = [item for day in calendar["days"] for item in day["trainings"] if item["id"] == training["id"]][0]
        assert persisted["status"] == "completed"
        assert persisted["unit_rate_cents"] == 1500
        assert request("GET", "/api/invoices")[0]["total_amount_cents"] == 3000
        assert request("GET", f"/api/invoices/{invoice['id']}/pdf") == pdf


def test_corrupt_database_aborts_real_start_without_replacing_it(tmp_path):
    path = tmp_path / "User Data" / "ttc.db"
    path.parent.mkdir()
    path.write_bytes(b"damaged original")
    with backend_process(tmp_path, damaged=True):
        pass
    assert path.read_bytes() == b"damaged original"
