"""Native Linux filesystem/process checks; synthetic ELF payload, no FUSE claim."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

import pytest

pytestmark = pytest.mark.skipif(sys.platform != "linux", reason="Linux helper requires Linux")
if sys.platform == "linux":
    from backend.linux_update_helper import identity, probe_lock

ROOT = Path(__file__).resolve().parent.parent
HELPER = ROOT / "backend/linux_update_helper.py"


def payload(tmp_path):
    compiler = shutil.which("cc")
    if not compiler:
        pytest.skip("ELF probe needs cc")
    source, executable = tmp_path / "probe.c", tmp_path / "probe"
    source.write_text('#include <stdio.h>\n#include <stdlib.h>\nint main(void){FILE*f=fopen(getenv("TTC_TEST_MARKER"),"w");if(!f)return 2;fputs("restarted",f);fclose(f);return 0;}')
    subprocess.run([compiler, str(source), "-o", str(executable)], check=True, capture_output=True)
    data = bytearray(executable.read_bytes())
    data[8:11] = b"AI\x02"
    return bytes(data).ljust(1000001, b"\0")


def fixture(tmp_path):
    folder = tmp_path / "AppImages"
    folder.mkdir(mode=0o700)
    target = folder / "Existing app.AppImage"
    data = payload(tmp_path)
    target.write_bytes(data + b"old")
    target.chmod(0o700)
    profile = tmp_path / "Profile"
    profile.mkdir(mode=0o700)
    slot = profile / "updates" / "downloads" / "download-AbC123"
    slot.mkdir(parents=True, mode=0o700)
    (profile / "updates").chmod(0o700)
    (profile / "updates/downloads").chmod(0o700)
    incoming = slot / "new.AppImage"
    incoming.write_bytes(data)
    incoming.chmod(0o600)
    helper = profile / "updates/linux-helper-AbC123"
    helper.mkdir(mode=0o700)
    marker = tmp_path / "restart-marker"
    context = {"target": str(target), "identity": identity(target.stat()), "profile": str(profile),
               "file": str(incoming), "size": len(data), "sha256": hashlib.sha256(data).hexdigest(),
               "version": "0.2.0", "currentVersion": "0.1.0", "helperDirectory": str(helper),
               "helperName": helper.name, "expiresAt": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)).isoformat()}
    return context, target, incoming, marker, data


OWNER = r'''
import json, os, subprocess, sys
context = json.loads(sys.argv[1])
context["parentPid"] = os.getpid()
p = subprocess.Popen([sys.executable, "-I", "-B", sys.argv[2]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
p.stdin.write(json.dumps(context)+"\n"); p.stdin.flush()
first = p.stdout.readline().strip()
if first != "TTC_UPDATE_READY":
    print(first, flush=True); p.wait(timeout=5); sys.exit(3)
if sys.argv[3] == "cancel":
    p.stdin.close(); p.wait(timeout=5); sys.exit(0)
if sys.argv[3] == "change":
    with open(context["target"], "ab") as f: f.write(b"changed")
p.stdin.write("commit\n"); p.stdin.flush()
assert p.stdout.readline().strip() == "TTC_UPDATE_COMMITTED"
p.stdin.write("launch\n"); p.stdin.flush()
os._exit(0)
'''


def run_owner(context, marker, action="replace"):
    env = dict(os.environ, TTC_TEST_MARKER=str(marker), PYTHONDONTWRITEBYTECODE="1")
    return subprocess.run([sys.executable, "-c", OWNER, json.dumps(context), str(HELPER), action], env=env, capture_output=True, text=True, timeout=15)


def until(predicate):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError("helper did not complete")


def test_native_atomic_replacement_and_restart_preserve_personal_data(tmp_path):
    context, target, incoming, marker, data = fixture(tmp_path)
    personal = Path(context["profile"]) / "invoice.db"
    personal.write_bytes(b"unchanged invoice data")
    old_inode = target.stat().st_ino
    result = run_owner(context, marker)
    assert result.returncode == 0, result.stdout + result.stderr
    until(marker.exists)
    assert target.read_bytes() == data
    assert target.stat().st_ino != old_inode
    assert personal.read_bytes() == b"unchanged invoice data"
    assert target.stat().st_mode & 0o777 == 0o700
    journal = json.loads((Path(context["profile"]) / "updates/linux-install-state.json").read_text())
    assert journal["phase"] == "replaced"
    assert not list(target.parent.glob(".ttc-update-*"))
    probe_lock(Path(context["profile"]) / "updates/linux-install.lock")


@pytest.mark.parametrize("action", ["cancel", "change", "hash", "expired", "symlink", "permissions"])
def test_rejected_handoff_never_executes_or_silently_replaces_original(tmp_path, action):
    context, target, incoming, marker, data = fixture(tmp_path)
    before = target.read_bytes()
    if action == "hash":
        incoming.write_bytes(b"X" + data[1:])
    elif action == "expired":
        context["expiresAt"] = "2000-01-01T00:00:00+00:00"
    elif action == "symlink":
        saved = target.with_suffix(".original")
        target.rename(saved)
        target.symlink_to(saved)
    elif action == "permissions":
        target.chmod(0o777)
    result = run_owner(context, marker, action)
    assert result.returncode in (0, 3), result.stdout + result.stderr
    # Parent can exit before the rejecting helper; wait for its lock release/cleanup.
    if action in ("change", "expired"):
        journal = Path(context["profile"]) / "updates/linux-install-state.json"
        until(lambda: journal.exists() and json.loads(journal.read_text())["phase"] == "failed")
    assert not marker.exists()
    assert target.read_bytes() == before + (b"changed" if action == "change" else b"")
    until(lambda: not list(target.parent.glob(".ttc-update-*")))


def test_native_copy_crosses_filesystems_before_atomic_replace(tmp_path):
    import tempfile
    context, target, incoming, marker, data = fixture(tmp_path)
    with tempfile.TemporaryDirectory(prefix="linux-update-test-", dir=ROOT / "dist") as destination:
        other = Path(destination) / target.name
        other.write_bytes(target.read_bytes())
        other.chmod(0o700)
        if other.stat().st_dev == incoming.stat().st_dev:
            pytest.skip("Two distinct writable filesystems required")
        context.update(target=str(other), identity=identity(other.stat()))
        result = run_owner(context, marker)
        assert result.returncode == 0, result.stdout + result.stderr
        until(marker.exists)
        assert other.read_bytes() == data
        assert target.read_bytes() == data + b"old"
        assert not list(other.parent.glob(".ttc-update-*"))


def test_parallel_app_start_is_blocked_by_live_update_lock(tmp_path):
    import fcntl
    lock = tmp_path / "linux-install.lock"
    fd = os.open(lock, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(BlockingIOError):
            probe_lock(lock)
    finally:
        os.close(fd)
    probe_lock(lock)
