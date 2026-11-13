"""Windows runtime build rejects corrupted archives before publishing files."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import socket
import time
import urllib.error
import urllib.request
import zipfile

import pytest

from scripts import prepare_windows_runtime as runtime


def _windows_path(value):
    return "Z:" + str(value).replace("/", "\\") if os.environ.get("TTC_WINE") else str(value)


def _packaged_command():
    executable = os.environ.get("TTC_WINDOWS_PYTHON")
    if not executable:
        pytest.skip("Set TTC_WINDOWS_PYTHON for the packaged Windows runtime check")
    environment = {key: value for key, value in os.environ.items() if not key.startswith("TTC_")}
    environment["PYTHONIOENCODING"] = "utf-8"
    command = [executable]
    if os.environ.get("TTC_WINE"):
        assert os.environ.get("TTC_WINE_PREFIX"), "Use a dedicated Wine prefix"
        environment.update(WINEPREFIX=os.environ["TTC_WINE_PREFIX"], WINEDEBUG="-all")
        command.insert(0, os.environ["TTC_WINE"])
    return command, environment


def test_corrupt_archive_never_creates_runtime(tmp_path):
    archive = tmp_path / "bad.zip"
    archive.write_bytes(b"not the approved Python distribution")
    target = tmp_path / "runtime"
    with pytest.raises(ValueError, match="SHA-256"):
        runtime.extract_runtime(archive, target)
    assert not target.exists()


def test_embedded_search_path_is_relocatable_and_explicit(tmp_path, monkeypatch):
    archive = tmp_path / "python.zip"
    with zipfile.ZipFile(archive, "w") as source:
        source.writestr("python.exe", b"MZfixture")
        source.writestr("python313._pth", "original")
    monkeypatch.setattr(runtime, "ARCHIVE_SHA256", hashlib.sha256(archive.read_bytes()).hexdigest())
    target = tmp_path / "runtime"
    runtime.extract_runtime(archive, target)
    assert (target / "python313._pth").read_text().splitlines() == [
        "python313.zip", ".", "Lib/site-packages", "..\\..",
    ]


def test_runtime_does_not_replace_existing_directory(tmp_path):
    target = tmp_path / "runtime"
    target.mkdir()
    marker = target / "existing"
    marker.write_bytes(b"keep")
    with pytest.raises(ValueError, match="existiert"):
        runtime.prepare(target)
    assert marker.read_bytes() == b"keep"


@pytest.mark.parametrize("packaged", [False, True])
def test_migration_in_separate_interpreter(tmp_path, packaged):
    root = Path(__file__).resolve().parent.parent
    script = root / "tests" / "packaged_migration_check.py"
    environment = {key: value for key, value in os.environ.items() if not key.startswith("TTC_")}
    if packaged:
        command, environment = _packaged_command()
        command.append(_windows_path(script))
    else:
        environment["PYTHONPATH"] = str(root)
        command = [sys.executable, str(script)]
    result = subprocess.run(command, cwd=tmp_path, env=environment, capture_output=True,
                            text=True, timeout=90)
    assert result.returncode == 0, result.stdout + result.stderr
    payload = json.loads(result.stdout)
    assert payload["migrationCheck"] == "ok"
    if packaged:
        assert "resources/app/backend/database.py" in payload["backend"].replace("\\", "/")


@pytest.mark.parametrize("invalid_directory", [False, True])
def test_packaged_backend_start_and_shutdown(tmp_path, invalid_directory):
    command, environment = _packaged_command()
    app = Path(os.environ["TTC_WINDOWS_PYTHON"]).resolve().parents[2]
    profile = tmp_path / "User Data"
    if invalid_directory:
        profile.write_bytes(b"preserve-existing-file")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    environment.update({
        "TTC_DATA_DIRECTORY": _windows_path(profile),
        "TTC_DOCUMENT_DIRECTORY": _windows_path(tmp_path / "Custom Documents"),
        "TTC_FRONTEND_DIRECTORY": _windows_path(app / "dist" / "frontend"),
        "TTC_LEGACY_DATABASE": _windows_path(tmp_path / "no-legacy.db"),
    })
    process = subprocess.Popen(command + ["-m", "scripts.managed_server", "backend.main:app",
        "--host", "127.0.0.1", "--port", str(port)], cwd=tmp_path, env=environment,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        if not invalid_directory:
            deadline = time.monotonic() + 45
            ready = False
            while time.monotonic() < deadline and process.poll() is None:
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as response:
                        ready = json.load(response) == {"status": "ok"}
                    if ready:
                        break
                except (urllib.error.URLError, TimeoutError):
                    pass
                time.sleep(0.1)
            assert ready, "Packaged backend did not become ready"
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/desktop-build.json", timeout=2) as response:
                assert json.load(response)["buildId"]
            assert (profile / "ttc.db").is_file()
    finally:
        try:
            stdout, stderr = process.communicate(input="shutdown\n", timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate(timeout=5)
            pytest.fail("Packaged backend shutdown timed out: " + stdout + stderr)
    if invalid_directory:
        assert process.returncode != 0
        assert "TTC_DATABASE_ERROR:access" in stderr
        assert profile.read_bytes() == b"preserve-existing-file"
    else:
        assert process.returncode == 0, stdout + stderr
