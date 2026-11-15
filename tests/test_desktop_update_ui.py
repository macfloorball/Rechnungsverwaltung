"""Opt-in real Electron UI, with signed fixtures and no production credentials."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys

import pytest


@pytest.mark.skipif(os.environ.get("TTC_RUN_ELECTRON_TESTS") != "1", reason="Opt-in Electron/GUI test")
@pytest.mark.parametrize("mode", ["development", "production"])
@pytest.mark.parametrize("flow", ["dialog", "download", "cancel"])
def test_desktop_update_dialog_and_session_decisions(tmp_path, mode, flow):
    root = Path(__file__).resolve().parent.parent
    executable = root / "node_modules/electron/dist" / ("electron.exe" if os.name == "nt" else "electron")
    installation = tmp_path / "Test Application"
    installation.mkdir()
    for folder in ("backend", "electron", "scripts", "frontend"):
        shutil.copytree(root / folder, installation / folder, ignore=shutil.ignore_patterns("__pycache__"))
    (installation / "tests").mkdir()
    for name in ("update_fixture.cjs", "release_fixture.cjs"):
        shutil.copyfile(root / "tests" / name, installation / "tests" / name)
    metadata = json.loads((root / "package.json").read_text())
    metadata["main"] = "desktop_update_ui_check.cjs"
    (installation / "package.json").write_text(json.dumps(metadata))
    shutil.copyfile(root / "tests/desktop_update_ui_check.cjs", installation / metadata["main"])
    profile, output = tmp_path / "User Data", tmp_path / "artifacts"
    profile.mkdir()
    output.mkdir()
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = {key: value for key, value in os.environ.items() if not key.startswith("TTC_")}
    env.pop("ELECTRON_RUN_AS_NODE", None)
    env.pop("PYTHONPATH", None)
    env.update(TTC_TEST_DOWNLOAD="1" if flow in ("download", "cancel") else "0", TTC_TEST_CANCEL="1" if flow == "cancel" else "0",
               TTC_PYTHON=sys.executable, TTC_DATA_DIRECTORY=str(profile),
               TTC_LEGACY_DATABASE=str(tmp_path / "no-legacy.db"), TTC_TEST_OUTPUT=str(output),
               TTC_DESKTOP_URL=f"http://127.0.0.1:{port}", TTC_DESKTOP_PRODUCTION_URL=f"http://127.0.0.1:{port}")
    if mode == "production":
        subprocess.run([str(executable), "scripts/build_frontend.cjs"], cwd=installation,
                       env=env | {"ELECTRON_RUN_AS_NODE": "1"}, check=True, capture_output=True, timeout=20)
    command = [str(executable), str(installation)] + (["--desktop-production"] if mode == "production" else [])
    process = subprocess.Popen(command, cwd=tmp_path, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        stdout, stderr = process.communicate(timeout=85)
        assert process.returncode == 0, stdout + stderr
        assert "DESKTOP_UPDATE_UI_CHECK passed" in stdout, stdout + stderr
        assert (output / "update-dialog.png").is_file()
        print(f"Update UI screenshot: {output / 'update-dialog.png'}")
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=25)
