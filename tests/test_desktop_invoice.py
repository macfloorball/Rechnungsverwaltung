"""Opt-in real Electron tests; every app file and all data live in tmp_path."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys

import pytest


@pytest.mark.skipif(os.environ.get("TTC_RUN_ELECTRON_TESTS") != "1", reason="Opt-in Electron/GUI test")
@pytest.mark.parametrize("mode,custom_documents", [("development", False), ("production", True)])
def test_desktop_invoice_preview_creation_and_opening(tmp_path, mode, custom_documents):
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
    process = subprocess.Popen(args, cwd=tmp_path, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        stdout, stderr = process.communicate(timeout=85)
        assert process.returncode == 0, stdout + stderr
        result = next((line for line in stdout.splitlines() if line.startswith("DESKTOP_PDF_CHECK ")), None)
        assert result is not None, stdout + stderr
        evidence = json.loads(result.removeprefix("DESKTOP_PDF_CHECK "))
        assert evidence["previewRows"] == 1
        assert evidence["totalCents"] == 3000
        assert evidence["handoffs"] == 2
        assert evidence["errorRecovery"] is True
        assert evidence["pdfBytes"] > 1000
        assert (output / "preview.png").stat().st_size > 1000
        assert (output / "download.pdf").read_bytes() == (output / "Rechnung_TTC_2020-01.pdf").read_bytes()
        print(f"Electron {mode}: {output}")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=25)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
