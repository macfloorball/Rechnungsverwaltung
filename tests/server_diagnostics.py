"""Diagnostics for disposable server processes, including Windows spawn workers."""
from pathlib import Path


def configure(site_directory: Path, output_directory: Path) -> None:
    # Spawned Windows workers need their own stream; the supervisor's redirected
    # standard handles are not a reliable worker log destination.
    (site_directory / "sitecustomize.py").write_text(
        'import faulthandler, os, sys\n'
        "if '--multiprocessing-fork' in sys.argv:\n"
        f"    stream = open(os.path.join({str(output_directory)!r}, 'worker-' + str(os.getpid()) + '.log'), 'a', buffering=1)\n"
        '    sys.stdout = stream\n'
        '    sys.stderr = stream\n'
        'faulthandler.dump_traceback_later(5, repeat=True)\n'
    )


def read(log_path: Path) -> str:
    files = [log_path, *sorted(log_path.parent.glob("worker-*.log"))]
    return "\n".join(f"{file.name}:\n{file.read_text(errors='replace')}" for file in files if file.exists())
