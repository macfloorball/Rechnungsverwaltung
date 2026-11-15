"""Diagnostics for disposable server processes, including Windows spawn workers."""
from pathlib import Path


def configure(site_directory: Path, output_directory: Path) -> None:
    # Spawned Windows workers need their own stream; the supervisor's redirected
    # standard handles are not a reliable worker log destination.
    (site_directory / "sitecustomize.py").write_text(
        'import faulthandler, os, sys, threading, time\n'
        f"stream = open(os.path.join({str(output_directory)!r}, 'python-' + str(os.getpid()) + '.log'), 'a', buffering=1, encoding='utf-8')\n"
        'sys.stdout = stream\n'
        'sys.stderr = stream\n'
        "print('TEST_PYTHON_START', os.getpid(), sys.executable, sys.argv, sys.flags, flush=True)\n"
        'faulthandler.dump_traceback_later(5, repeat=True)\n'
        'import multiprocessing.process, multiprocessing.spawn\n'
        'original_start = multiprocessing.process.BaseProcess.start\n'
        'def observed_start(process):\n'
        '    result = original_start(process)\n'
        "    print('TEST_WORKER_START', process.pid, multiprocessing.spawn.get_executable(), flush=True)\n"
        '    def observe():\n'
        '        while process.exitcode is None:\n'
        '            time.sleep(0.2)\n'
        "        print('TEST_WORKER_EXIT', process.pid, process.exitcode, flush=True)\n"
        '    threading.Thread(target=observe, daemon=True).start()\n'
        '    return result\n'
        'multiprocessing.process.BaseProcess.start = observed_start\n'
    )


def read(log_path: Path) -> str:
    files = [log_path, *sorted(log_path.parent.glob("python-*.log"))]
    return "\n".join(f"{file.name}:\n{file.read_text(errors='replace')}" for file in files if file.exists())
