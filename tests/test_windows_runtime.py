"""Windows runtime build rejects corrupted archives before publishing files."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import zipfile

import pytest

from scripts import prepare_windows_runtime as runtime


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
        executable = os.environ.get("TTC_WINDOWS_PYTHON")
        if not executable:
            pytest.skip("Set TTC_WINDOWS_PYTHON for the packaged Windows runtime check")
        command = [executable, str(script)]
        if os.environ.get("TTC_WINE"):
            assert os.environ.get("TTC_WINE_PREFIX"), "Use a dedicated Wine prefix"
            environment.update(WINEPREFIX=os.environ["TTC_WINE_PREFIX"], WINEDEBUG="-all")
            command = [os.environ["TTC_WINE"], executable, "Z:" + str(script).replace("/", "\\")]
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
