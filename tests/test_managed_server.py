"""Exercise the real managed Uvicorn lifecycle without application/user data."""
import concurrent.futures
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.request

import pytest


@pytest.mark.parametrize("reload", [False, True])
@pytest.mark.parametrize("control", ["command", "eof"])
def test_shutdown_finishes_active_request(tmp_path: Path, reload: bool, control: str):
    (tmp_path / "sample_app.py").write_text(
        'import asyncio\nfrom pathlib import Path\nfrom fastapi import FastAPI\n'
        'app = FastAPI()\n'
        '@app.get("/health")\ndef health(): return {"ok": True}\n'
        '@app.post("/write")\nasync def write():\n'
        '    Path("started").touch()\n'
        '    await asyncio.sleep(0.5)\n'
        '    Path("completed").write_text("saved")\n'
        '    return {"saved": True}\n'
    )
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    root = Path(__file__).resolve().parent.parent
    env = os.environ | {"PYTHONPATH": os.pathsep.join([str(tmp_path), str(root)])}
    args = [sys.executable, "-m", "scripts.managed_server", "sample_app:app",
            "--host", "127.0.0.1", "--port", str(port)]
    if reload:
        args += ["--reload", "--reload-dir", str(tmp_path)]
    with (tmp_path / "server.log").open("w") as log:
        process = subprocess.Popen(args, cwd=tmp_path, env=env, stdin=subprocess.PIPE,
                                   stdout=log, stderr=log, start_new_session=os.name != "nt")
        try:
            url = f"http://127.0.0.1:{port}"
            deadline = time.monotonic() + 10
            while True:
                try:
                    with urllib.request.urlopen(url + "/health", timeout=0.2):
                        break
                except OSError:
                    assert process.poll() is None, (tmp_path / "server.log").read_text()
                    assert time.monotonic() < deadline, "Server startup timed out"
                    time.sleep(0.05)

            def write():
                request = urllib.request.Request(url + "/write", method="POST")
                with urllib.request.urlopen(request, timeout=5) as response:
                    return response.status

            with concurrent.futures.ThreadPoolExecutor() as executor:
                response = executor.submit(write)
                deadline = time.monotonic() + 5
                while not (tmp_path / "started").exists():
                    assert time.monotonic() < deadline
                    time.sleep(0.01)
                if control == "command":
                    process.stdin.write(b"shutdown\n")
                process.stdin.close()
                assert response.result() == 200
            assert process.wait(timeout=10) == 0
            assert (tmp_path / "completed").read_text() == "saved"
            with socket.socket() as probe:
                assert probe.connect_ex(("127.0.0.1", port)) != 0
        finally:
            if process.poll() is None:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                                   capture_output=True, timeout=5)
                else:
                    os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)


@pytest.mark.parametrize("control", ["command", "eof"])
def test_idle_reload_stops_without_waiting_for_a_filesystem_event(tmp_path, control):
    watched = tmp_path / "watched"
    watched.mkdir()
    (watched / "sample_app.py").write_text('from fastapi import FastAPI\napp=FastAPI()\n@app.get("/health")\ndef health(): return {"ok": True}\n')
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    root = Path(__file__).resolve().parent.parent
    wrapper = """
import uvicorn.supervisors.watchfilesreload as module
from scripts.managed_server import main
original = module.watch
def slow(*args, **kwargs):
    kwargs['rust_timeout'] = 60000
    return original(*args, **kwargs)
module.watch = slow
main()
"""
    env = os.environ | {"PYTHONPATH": os.pathsep.join([str(watched), str(root)]), "PYTHONDONTWRITEBYTECODE": "1"}
    # Logs stay outside watched: log writes must not accidentally wake the watcher.
    with (tmp_path / "server.log").open("w") as log:
        process = subprocess.Popen([sys.executable, "-c", wrapper, "sample_app:app", "--host", "127.0.0.1", "--port", str(port), "--reload", "--reload-dir", str(watched)],
                                   cwd=tmp_path, env=env, stdin=subprocess.PIPE, stdout=log, stderr=log, start_new_session=os.name != "nt")
        try:
            deadline = time.monotonic() + 10
            while True:
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=0.2):
                        break
                except OSError:
                    assert process.poll() is None, (tmp_path / "server.log").read_text()
                    assert time.monotonic() < deadline
                    time.sleep(0.05)
            if control == "command":
                process.stdin.write(b"shutdown\n")
            process.stdin.close()
            assert process.wait(timeout=5) == 0
        finally:
            if process.poll() is None:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=5)
                else:
                    os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
