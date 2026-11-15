"""Private AppImage handoff. Stdlib only; no dependency on the old FUSE mount."""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import select
import signal
import stat
import sys


def directory(path, private=False, writable=False):
    path = Path(path)
    for entry in (path, *path.parents):
        info = entry.lstat()
        if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid not in (0, os.getuid()):
            raise ValueError("unsafe directory")
        if info.st_mode & 0o022 and not (info.st_uid == 0 and info.st_mode & stat.S_ISVTX and entry != path):
            raise ValueError("shared directory")
    info = path.lstat()
    if (private or writable) and info.st_uid != os.getuid():
        raise ValueError("foreign directory")
    if private and info.st_mode & 0o077:
        raise ValueError("public directory")
    if writable and not os.access(path, os.W_OK | os.X_OK):
        raise ValueError("read only directory")
    return os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)


def identity(info):
    return {key: str(getattr(info, field)) for key, field in
            (("dev", "st_dev"), ("ino", "st_ino"), ("size", "st_size"), ("mtime", "st_mtime_ns"), ("ctime", "st_ctime_ns"))}


def regular(fd, size=None, executable=False):
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_mode & 0o7022:
        raise ValueError("unsafe file")
    if size is not None and info.st_size != size:
        raise ValueError("size")
    if executable and info.st_mode & 0o700 != 0o700:
        raise ValueError("permissions")
    return info


def image(fd):
    header = os.pread(fd, 24, 0)
    if len(header) != 24 or header[:6] != b"\x7fELF\x02\x01" or header[8:11] != b"AI\x02" or header[18:20] != b"\x3e\x00":
        raise ValueError("not x64 type2 AppImage")


def digest(fd):
    value = hashlib.sha256()
    position = 0
    while data := os.pread(fd, 256 * 1024, position):
        value.update(data)
        position += len(data)
    return value.hexdigest()


def journal(context, phase):
    updates = Path(context["profile"]) / "updates"
    fd = directory(updates, private=True)
    try:
        temporary = ".linux-state-" + os.urandom(12).hex()
        output = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
        with os.fdopen(output, "w", encoding="utf-8") as stream:
            json.dump({"formatVersion": 1, "phase": phase, "version": context["version"],
                       "previousVersion": context["currentVersion"], "helper": context["helperName"],
                       "download": Path(context["file"]).parent.name,
                       "time": datetime.datetime.now(datetime.timezone.utc).isoformat()}, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, "linux-install-state.json", src_dir_fd=fd, dst_dir_fd=fd)
        os.fsync(fd)
    finally:
        os.close(fd)


def clean_environment():
    env = dict(os.environ)
    for key in list(env):
        if key.startswith("APPIMAGE") or key.startswith("PYTHON") or key in {
            "APPDIR", "ARGV0", "OWD", "LD_LIBRARY_PATH", "LD_PRELOAD", "ELECTRON_RUN_AS_NODE", "FUSERMOUNT_PROG"}:
            env.pop(key, None)
    return env


def probe_lock(path):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return
    try:
        regular(fd)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    finally:
        os.close(fd)


def run(context):
    if os.getuid() == 0 or not hasattr(os, "pidfd_open") or os.getppid() != context["parentPid"]:
        raise ValueError("unsupported owner")
    target = Path(context["target"])
    if not target.is_absolute() or target.name in ("", ".", ".."):
        raise ValueError("target")
    parent = directory(target.parent, writable=True)
    profile = directory(context["profile"], writable=True)
    updates = directory(Path(context["profile"]) / "updates", private=True)
    helpers = directory(context["helperDirectory"], private=True)
    pid = os.pidfd_open(context["parentPid"])
    lock = os.open("linux-install.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=updates)
    original = incoming = staged = stage_dir = None
    stage_name = None
    committed = replaced = False
    try:
        regular(lock)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        original = os.open(target.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
        old = regular(original, executable=True)
        fcntl.flock(original, fcntl.LOCK_EX | fcntl.LOCK_NB)
        image(original)
        if identity(old) != context["identity"]:
            raise ValueError("changed target")
        source = Path(context["file"])
        source_dir = directory(source.parent, private=True)
        try:
            incoming = os.open(source.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=source_dir)
        finally:
            os.close(source_dir)
        regular(incoming, context["size"])
        image(incoming)
        if digest(incoming) != context["sha256"]:
            raise ValueError("hash")
        space = os.fstatvfs(parent)
        if space.f_bavail * space.f_frsize < context["size"] + 16 * 1024 * 1024:
            raise OSError("space")
        candidate_name = ".ttc-update-" + os.urandom(12).hex()
        os.mkdir(candidate_name, 0o700, dir_fd=parent)
        stage_name = candidate_name
        stage_dir = os.open(stage_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        staged = os.open("image.part", os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=stage_dir)
        position = 0
        while data := os.pread(incoming, 256 * 1024, position):
            if position + len(data) > context["size"]:
                raise ValueError("size")
            view = memoryview(data)
            while view:
                written = os.write(staged, view)
                if written <= 0:
                    raise OSError("write")
                view = view[written:]
            position += len(data)
        regular(staged, context["size"])
        os.fsync(staged)
        if digest(staged) != context["sha256"]:
            raise ValueError("disk hash")
        print("TTC_UPDATE_READY", flush=True)
        if sys.stdin.readline().strip() != "commit":
            raise ValueError("cancelled")
        journal(context, "handoff")
        committed = True
        print("TTC_UPDATE_COMMITTED", flush=True)
        if sys.stdin.readline().strip() != "launch":
            raise ValueError("cancelled")
        if not select.select([pid], [], [], 60)[0]:
            raise ValueError("parent still running")
        if datetime.datetime.fromisoformat(context["expiresAt"].replace("Z", "+00:00")) <= datetime.datetime.now(datetime.timezone.utc):
            raise ValueError("expired")
        null = os.open(os.devnull, os.O_RDWR)
        for descriptor in (0, 1, 2):
            os.dup2(null, descriptor)
        os.close(null)
        current = os.stat(target.name, dir_fd=parent, follow_symlinks=False)
        if identity(current) != context["identity"] or identity(os.fstat(original)) != context["identity"]:
            raise ValueError("changed target")
        if os.stat(target.parent, follow_symlinks=False).st_ino != os.fstat(parent).st_ino:
            raise ValueError("moved directory")
        regular(staged, context["size"])
        if digest(staged) != context["sha256"]:
            raise ValueError("changed staged image")
        os.fchmod(staged, stat.S_IMODE(old.st_mode) & 0o755)
        os.fsync(staged)
        os.replace("image.part", target.name, src_dir_fd=stage_dir, dst_dir_fd=parent)
        replaced = True
        os.fsync(parent)
        final = os.stat(target.name, dir_fd=parent, follow_symlinks=False)
        if final.st_ino != os.fstat(staged).st_ino or final.st_dev != os.fstat(staged).st_dev:
            raise ValueError("changed replacement")
        journal(context, "replaced")
        os.close(staged)
        staged = None
        os.close(stage_dir)
        stage_dir = None
        os.rmdir(stage_name, dir_fd=parent)
        stage_name = None
        # No rollback after a new version might have migrated the database.
        # CLOEXEC descriptors release locks atomically as the new image starts.
        os.chdir(target.parent)
        os.execve(str(target), [str(target)], clean_environment())
    except BaseException:
        if committed:
            try:
                journal(context, "failed_after_replace" if replaced else "failed")
            except OSError:
                pass
        raise
    finally:
        if stage_dir is not None:
            try:
                os.unlink("image.part", dir_fd=stage_dir)
            except FileNotFoundError:
                pass
        if stage_name:
            os.rmdir(stage_name, dir_fd=parent)
        for fd in (staged, stage_dir, incoming, original, lock, pid, helpers, updates, profile, parent):
            if fd is not None:
                os.close(fd)


def interrupted(_signal, _frame):
    raise InterruptedError("cancelled")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupted)
    try:
        if len(sys.argv) == 3 and sys.argv[1] == "--probe-lock":
            probe_lock(sys.argv[2])
        elif len(sys.argv) == 1:
            line = sys.stdin.readline(65537)
            if len(line) > 65536:
                raise ValueError("context")
            run(json.loads(line))
        else:
            raise ValueError("arguments")
    except BaseException:
        # Static marker only; paths, environment, tokens and raw exceptions stay private.
        print("TTC_UPDATE_REJECTED", flush=True)
        sys.exit(1)
