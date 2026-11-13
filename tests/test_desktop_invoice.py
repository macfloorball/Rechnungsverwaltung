"""Opt-in real Electron tests; every app file and all data live in tmp_path."""
import errno
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys

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


def _run_electron(args, working_directory, environment):
    process = subprocess.Popen(args, cwd=working_directory, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        stdout, stderr = process.communicate(timeout=85)
        assert process.returncode == 0, stdout + stderr
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
    # A second complete Electron launch reuses the profile after the first
    # application's normal shutdown, including its managed Python backend.
    stdout, stderr = _run_electron(args, tmp_path, environment | {"TTC_TEST_RESUME": "1"})
    assert "DESKTOP_RECIPIENT_CHECK restart" in stdout, stdout + stderr
    if offline_namespace:
        assert "DESKTOP_OFFLINE_CHECK " in stdout, stdout + stderr
    resumed = next((line for line in stdout.splitlines() if line.startswith("DESKTOP_PDF_RESUME ")), None)
    assert resumed is not None, stdout + stderr
    assert json.loads(resumed.removeprefix("DESKTOP_PDF_RESUME ")) == {
        "invoices": 2, "totalCents": 6000, "handoffs": 1,
    }
    print(f"Electron {mode}, custom documents={custom_documents}: {output}")
