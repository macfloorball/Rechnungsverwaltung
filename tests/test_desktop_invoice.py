"""Opt-in real Electron tests; every app file and all data live in tmp_path."""
import errno
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import time
import zipfile

import pytest


def _check_offline_network():
    """Require an isolated Linux network with only loopback, not a request mock."""
    assert sys.platform == "linux", "Offline namespace check requires Linux"
    links = json.loads(subprocess.check_output(["ip", "-j", "address", "show"], text=True))
    assert len(links) == 1 and links[0]["ifname"] == "lo", links
    addresses = {entry["local"] for entry in links[0]["addr_info"]}
    assert {"127.0.0.1", "::1"} <= addresses, addresses
    for family, destination in (
        (socket.AF_INET, ("192.0.2.1", 443)),
        (socket.AF_INET6, ("2001:db8::1", 443)),
    ):
        with socket.socket(family, socket.SOCK_STREAM) as probe:
            probe.settimeout(1)
            assert probe.connect_ex(destination) == errno.ENETUNREACH
    namespace = os.readlink("/proc/self/ns/net")
    print(f"Offline namespace verified: {namespace}, loopback only, IPv4/IPv6 unreachable")
    return namespace


def _run_electron(args, working_directory, environment, *, expected_returncode=0):
    process = subprocess.Popen(args, cwd=working_directory, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        stdout, stderr = process.communicate(timeout=85)
        assert process.returncode == expected_returncode, stdout + stderr
        return stdout, stderr
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=25)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


@pytest.mark.skipif(os.environ.get("TTC_RUN_ELECTRON_TESTS") != "1", reason="Opt-in Electron/GUI test")
@pytest.mark.parametrize("mode", ["development", "production"])
@pytest.mark.parametrize("custom_documents", [False, True])
def test_desktop_invoice_preview_creation_and_opening(tmp_path, mode, custom_documents):
    offline_namespace = _check_offline_network() if os.environ.get("TTC_EXPECT_OFFLINE") == "1" else None
    root = Path(__file__).resolve().parent.parent
    executable = root / "node_modules" / "electron" / "dist" / (
        "electron.exe" if os.name == "nt" else "electron"
    )
    assert executable.is_file(), "Install the project Electron dependency first"
    installation = tmp_path / "Test Application"
    installation.mkdir()
    for name in ("backend", "electron", "scripts", "frontend"):
        shutil.copytree(root / name, installation / name, ignore=shutil.ignore_patterns("__pycache__", "*.test.cjs"))
    metadata = json.loads((root / "package.json").read_text())
    metadata["main"] = "desktop_invoice_check.cjs"
    (installation / "package.json").write_text(json.dumps(metadata))
    shutil.copyfile(root / "tests" / "desktop_invoice_check.cjs", installation / metadata["main"])
    profile = tmp_path / "User Data"
    profile.mkdir()
    output = tmp_path / "artifacts"
    output.mkdir()
    # Discard inherited project options so this test can never use real data.
    environment = {key: value for key, value in os.environ.items() if not key.startswith("TTC_")}
    environment.pop("ELECTRON_RUN_AS_NODE", None)
    environment.pop("PYTHONPATH", None)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    environment.update({
        "TTC_PYTHON": sys.executable, "TTC_DATA_DIRECTORY": str(profile),
        "TTC_LEGACY_DATABASE": str(tmp_path / "no-legacy.db"),
        "TTC_TEST_OUTPUT": str(output),
        "TTC_DESKTOP_URL": f"http://127.0.0.1:{port}",
        "TTC_DESKTOP_PRODUCTION_URL": f"http://127.0.0.1:{port}",
    })
    if offline_namespace:
        environment["TTC_TEST_OFFLINE_NAMESPACE"] = offline_namespace
    if custom_documents:
        environment["TTC_DOCUMENT_DIRECTORY"] = str(tmp_path / "Custom Invoices")
    if mode == "production":
        subprocess.run(
            [str(executable), "scripts/build_frontend.cjs"], cwd=installation,
            env=environment | {"ELECTRON_RUN_AS_NODE": "1"},
            capture_output=True, text=True, check=True, timeout=15,
        )
    args = [str(executable), str(installation)]
    if mode == "production":
        args.append("--desktop-production")
    stdout, stderr = _run_electron(args, tmp_path, environment)
    assert "DESKTOP_RECIPIENT_CHECK saved" in stdout, stdout + stderr
    assert "DESKTOP_CALENDAR_CHECK saved" in stdout, stdout + stderr
    assert "DESKTOP_STATUS_CHECK saved" in stdout, stdout + stderr
    assert "DESKTOP_PREVIEW_CHECK saved" in stdout, stdout + stderr
    assert "DESKTOP_FINAL_CHECK saved" in stdout, stdout + stderr
    assert "DESKTOP_BACKUP_CHECK saved" in stdout, stdout + stderr
    assert "DESKTOP_BILLABLE_CHECK saved" in stdout, stdout + stderr
    assert "DESKTOP_EMPTY_CHECK saved" in stdout, stdout + stderr
    if offline_namespace:
        assert "DESKTOP_OFFLINE_CHECK " in stdout, stdout + stderr
    result = next((line for line in stdout.splitlines() if line.startswith("DESKTOP_PDF_CHECK ")), None)
    assert result is not None, stdout + stderr
    evidence = json.loads(result.removeprefix("DESKTOP_PDF_CHECK "))
    assert evidence["previewRows"] == 1
    assert evidence["totalCents"] == 4500
    assert evidence["handoffs"] == 2
    assert evidence["errorRecovery"] is True
    assert evidence["lifecycle"] is True
    assert evidence["refinalizedTotalCents"] == 6000
    assert evidence["pdfBytes"] > 1000
    assert (output / "preview.png").stat().st_size > 1000
    assert (output / "download.pdf").read_bytes() == (output / "Rechnung_TTC_2020-01.pdf").read_bytes()
    def stored_preview():
        with sqlite3.connect(profile / "ttc.db") as connection:
            draft = connection.execute(
                "SELECT id, is_preview, total_amount_cents, invoice_number, pdf_path "
                "FROM invoices WHERE year = 2020 AND month = 3"
            ).fetchone()
            assert draft is not None
            assert draft[1:] == (1, 0, None, None)
            items = connection.execute(
                "SELECT description, hours, unit_rate_cents, amount_cents FROM invoice_items WHERE invoice_id = ?",
                (draft[0],),
            ).fetchall()
            assert items == [("GUI Kostenfrei <Prüfung>", None, 0, 0)]
            return draft, items
    preview_before_restart = stored_preview()
    def billable_final_positions():
        with sqlite3.connect(profile / "ttc.db") as connection:
            positions = connection.execute(
                "SELECT items.description, items.hours, items.amount_cents, trainings.status "
                "FROM invoice_items AS items JOIN invoices ON invoices.id = items.invoice_id "
                "LEFT JOIN trainings ON trainings.id = items.training_id "
                "WHERE invoices.year = 2020 AND invoices.month = 1 AND invoices.is_preview = 0"
            ).fetchall()
            assert positions == [("Electron Testtraining", 4, 6000, "completed")]
            return positions
    final_positions_before_restart = billable_final_positions()
    # Restore the real GUI backup offline, then launch the restored profile.
    backup = next((output / "backups").glob("*.zip"))
    restored = tmp_path / "Restored Profile"
    documents = Path(environment.get("TTC_DOCUMENT_DIRECTORY", str(profile / "documents")))
    subprocess.run([
        sys.executable, "-m", "backend.backup_restore", "--archive", str(backup),
        "--target", str(restored), "--current-database", str(profile / "ttc.db"),
        "--current-documents", str(documents), "--safety-directory", str(output / "safety"), "--confirm",
    ], cwd=installation, env=environment, capture_output=True, text=True, check=True, timeout=20)
    with sqlite3.connect(profile / "ttc.db") as before, sqlite3.connect(restored / "ttc.db") as after:
        for table in ("organizations", "activity_types", "weekly_plan", "trainings", "invoices", "invoice_items"):
            assert before.execute(f"SELECT * FROM {table} ORDER BY id").fetchall() == after.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
    with zipfile.ZipFile(output / "export.zip") as exported:
        assert "csv/trainings.csv" in exported.namelist()
        assert exported.read("documents/Rechnung_TTC_2020-01.pdf") == (output / "recreated.pdf").read_bytes()
    stdout, stderr = _run_electron(args, tmp_path, environment | {
        "TTC_TEST_RESUME": "1", "TTC_DATA_DIRECTORY": str(restored),
        "TTC_DOCUMENT_DIRECTORY": str(restored / "documents"),
    })
    assert "DESKTOP_PDF_RESUME " in stdout, stdout + stderr
    assert list((output / "safety").glob("*.zip"))
    print(f"Backup, CSV download and restored profile restart verified: {mode}, custom documents={custom_documents}")
    # A second complete Electron launch reuses the profile after the first
    # application's normal shutdown, including its managed Python backend.
    stdout, stderr = _run_electron(args, tmp_path, environment | {"TTC_TEST_RESUME": "1"})
    assert "DESKTOP_RECIPIENT_CHECK restart" in stdout, stdout + stderr
    assert "DESKTOP_CALENDAR_CHECK restart" in stdout, stdout + stderr
    assert "DESKTOP_STATUS_CHECK restart" in stdout, stdout + stderr
    assert "DESKTOP_FINAL_CHECK restart" in stdout, stdout + stderr
    if offline_namespace:
        assert "DESKTOP_OFFLINE_CHECK " in stdout, stdout + stderr
    resumed = next((line for line in stdout.splitlines() if line.startswith("DESKTOP_PDF_RESUME ")), None)
    assert resumed is not None, stdout + stderr
    assert json.loads(resumed.removeprefix("DESKTOP_PDF_RESUME ")) == {
        "invoices": 2, "totalCents": 6000, "handoffs": 1,
    }
    assert stored_preview() == preview_before_restart
    assert billable_final_positions() == final_positions_before_restart
    if sys.platform == "linux":
        stdout, stderr = _run_electron(args, tmp_path, environment | {"TTC_TEST_RESUME": "1", "TTC_TEST_CRASH": "1"},
                                       expected_returncode=-signal.SIGKILL)
        assert "DESKTOP_CRASH_READY" in stdout, stdout + stderr
        deadline = time.monotonic() + 10
        while True:
            with socket.socket() as probe:
                probe.settimeout(0.2)
                if probe.connect_ex(("127.0.0.1", port)) != 0:
                    break
            assert time.monotonic() < deadline, "Backend blieb nach Electron-Absturz erreichbar"
            time.sleep(0.05)
        stdout, stderr = _run_electron(args, tmp_path, environment | {"TTC_TEST_RESUME": "1"})
        assert "DESKTOP_PDF_RESUME " in stdout, stdout + stderr
        assert stored_preview() == preview_before_restart
        assert billable_final_positions() == final_positions_before_restart
        print(f"Hard crash recovery verified: {mode}, custom documents={custom_documents}")
    print(f"Electron {mode}, custom documents={custom_documents}: {output}")
