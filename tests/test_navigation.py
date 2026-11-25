"""Opt-in real renderer navigation regression with a disposable application/profile."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys

import pytest


@pytest.mark.skipif(os.environ.get("TTC_RUN_ELECTRON_TESTS") != "1", reason="Opt-in Electron/GUI test")
@pytest.mark.parametrize("scenario", ["navigation", "profiles", "recurrence", "invoice_layout", "numbering", "archive"])
@pytest.mark.parametrize("mode", ["development", "production"])
def test_navigation_drafts_month_and_restart(tmp_path, mode, scenario):
    root = Path(__file__).resolve().parent.parent
    executable = root / "node_modules/electron/dist" / ("electron.exe" if os.name == "nt" else "electron")
    installation = tmp_path / "Application"
    installation.mkdir()
    for folder in ("backend", "electron", "scripts", "frontend"):
        shutil.copytree(root / folder, installation / folder, ignore=shutil.ignore_patterns("__pycache__"))
    metadata = json.loads((root / "package.json").read_text())
    metadata["main"] = f"{scenario}_check.cjs"
    (installation / "package.json").write_text(json.dumps(metadata))
    shutil.copyfile(root / f"tests/{scenario}_check.cjs", installation / metadata["main"])
    profile, output = tmp_path / "Profile", tmp_path / "artifacts"
    profile.mkdir()
    output.mkdir()
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = {key: value for key, value in os.environ.items() if not key.startswith("TTC_")}
    env.pop("ELECTRON_RUN_AS_NODE", None)
    env.pop("PYTHONPATH", None)
    env.update(TTC_PYTHON=sys.executable, TTC_DATA_DIRECTORY=str(profile),
               TTC_LEGACY_DATABASE=str(tmp_path / "no-legacy.db"), TTC_TEST_OUTPUT=str(output),
               TTC_DESKTOP_URL=f"http://127.0.0.1:{port}", TTC_DESKTOP_PRODUCTION_URL=f"http://127.0.0.1:{port}")
    if mode == "production":
        subprocess.run([str(executable), "scripts/build_frontend.cjs"], cwd=installation,
                       env=env | {"ELECTRON_RUN_AS_NODE": "1"}, check=True, capture_output=True, timeout=20)
    command = [str(executable), str(installation)] + (["--desktop-production"] if mode == "production" else [])
    for resume in ("0", "1"):
        process = subprocess.Popen(command, cwd=tmp_path, env=env | {"TTC_TEST_RESUME": resume},
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            stdout, stderr = process.communicate(timeout=100)
            assert process.returncode == 0, stdout + stderr
            assert (f"{scenario.upper()}_RESTART_OK" if resume == "1" else f"{scenario.upper()}_OK") in stdout, stdout + stderr
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=10)
    assert (output / f"{scenario}.png").stat().st_size > 1000
