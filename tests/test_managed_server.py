"""Exercise the real managed Uvicorn lifecycle without application/user data."""
import concurrent.futures
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.request

import pytest
import server_diagnostics


@pytest.mark.skipif(os.name != "nt", reason="Windows native standard-handle inheritance")
def test_spawn_initializes_while_owner_control_pipe_is_being_read(tmp_path):
    """Reach worker code before sending anything to the owner's stdin pipe."""
    script = tmp_path / "spawn_app.py"
    script.write_text('''
import ctypes
import functools
import multiprocessing
import sys
import threading
import time
import uvicorn
from scripts.managed_server import ManagedReload

def worker(sockets=None):
    print("WORKER_INITIALIZED", flush=True)

if __name__ == "__main__":
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetStdHandle.argtypes = [ctypes.c_ulong]
    kernel.GetStdHandle.restype = ctypes.c_void_p
    original_handle = kernel.GetStdHandle(-10 & 0xffffffff)
    original_input = sys.stdin
    reading = threading.Event()
    def control():
        reading.set()
        original_input.read(1)
    threading.Thread(target=control, daemon=True).start()
    assert reading.wait(2)
    time.sleep(0.1)  # Let the synchronous ReadFile enter its pending state.
    stop = multiprocessing.get_context("spawn").Event()
    reloader = ManagedReload(uvicorn.Config("unused:app"), worker, [], stop)
    for start in (reloader.startup, reloader.restart):
        start()
        assert sys.stdin is original_input
        assert kernel.GetStdHandle(-10 & 0xffffffff) == original_handle
        reloader.process.join(5)
        assert reloader.process.exitcode == 0
    try:
        reloader._spawn_without_control_input(functools.partial(int, "invalid"))
    except ValueError:
        pass
    else:
        raise AssertionError("Expected operation failure")
    assert sys.stdin is original_input
    assert kernel.GetStdHandle(-10 & 0xffffffff) == original_handle
    reloader.shutdown()
''')
    root = Path(__file__).resolve().parent.parent
    env = os.environ | {"PYTHONPATH": str(root)}
    with (tmp_path / "spawn.log").open("w+") as log:
        process = subprocess.Popen([sys.executable, str(script)], env=env,
                                   stdin=subprocess.PIPE, stdout=log, stderr=log)
        try:
            # Keep the owner pipe open and empty throughout both worker starts.
            assert wait_for_exit(process, 12, tmp_path / "spawn.log") == 0
            log.seek(0)
            assert log.read().count("WORKER_INITIALIZED") == 2
        finally:
            if process.poll() is None:
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                               capture_output=True, timeout=5)
                process.wait(timeout=5)
            process.stdin.close()


def wait_for_exit(process, timeout, log_path):
    try:
        return process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        raise AssertionError(server_diagnostics.read(log_path)) from None


@pytest.mark.parametrize("reload", [False, True])
@pytest.mark.parametrize("control", ["command", "eof"])
def test_shutdown_finishes_active_request(tmp_path: Path, reload: bool, control: str):
    server_diagnostics.configure(tmp_path, tmp_path)
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
                    assert process.poll() is None, server_diagnostics.read(tmp_path / "server.log")
                    assert time.monotonic() < deadline, server_diagnostics.read(tmp_path / "server.log")
                    time.sleep(0.05)

            def write():
                request = urllib.request.Request(url + "/write", method="POST")
                with urllib.request.urlopen(request, timeout=5) as response:
                    return response.status

            with concurrent.futures.ThreadPoolExecutor() as executor:
                response = executor.submit(write)
                deadline = time.monotonic() + 5
                while not (tmp_path / "started").exists():
                    assert time.monotonic() < deadline, server_diagnostics.read(tmp_path / "server.log")
                    time.sleep(0.01)
                if control == "command":
                    process.stdin.write(b"shutdown\n")
                process.stdin.close()
                assert response.result() == 200
            assert wait_for_exit(process, 10, tmp_path / "server.log") == 0
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
    server_diagnostics.configure(watched, tmp_path)
    app_file = watched / "sample_app.py"
    app_source = 'from fastapi import FastAPI\napp=FastAPI()\n@app.get("/health")\ndef health(): return {"version": %d}\n'
    app_file.write_text(app_source % 1)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    root = Path(__file__).resolve().parent.parent
    wrapper = """
import uvicorn.supervisors.watchfilesreload as module
import sys
from scripts.managed_server import main
control_input = sys.stdin
class OwnerInput:
    def __iter__(self):
        return iter(control_input)
    def fileno(self):
        raise AssertionError('Reload workers must not access the owner control pipe')
sys.stdin = OwnerInput()
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
            def wait_for_version(version):
                deadline = time.monotonic() + 10
                while True:
                    try:
                        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=0.2) as response:
                            if json.load(response)["version"] == version:
                                return
                    except OSError:
                        pass
                    assert process.poll() is None, server_diagnostics.read(tmp_path / "server.log")
                    assert time.monotonic() < deadline, server_diagnostics.read(tmp_path / "server.log")
                    time.sleep(0.05)
            wait_for_version(1)
            app_file.write_text(app_source % 2)
            wait_for_version(2)
            if control == "command":
                process.stdin.write(b"shutdown\n")
            process.stdin.close()
            assert wait_for_exit(process, 5, tmp_path / "server.log") == 0
        finally:
            if process.poll() is None:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=5)
                else:
                    os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
