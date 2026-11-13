"""Build a relocatable Windows runtime without running Windows binaries.

Only binary Windows wheels are accepted; pip is used on the build host, never
on the installed machine. The destination must not exist (no stale packages).
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

VERSION = "3.13.17"
ARCHIVE_SHA256 = "9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38"
URL = f"https://www.python.org/ftp/python/{VERSION}/python-{VERSION}-embed-amd64.zip"
ROOT = Path(__file__).resolve().parent.parent


def extract_runtime(archive: Path, target: Path) -> None:
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA256:
        raise ValueError("Python-Archiv: SHA-256 stimmt nicht überein")
    target.mkdir(parents=True, exist_ok=False)
    with zipfile.ZipFile(archive) as source:
        for entry in source.infolist():
            relative = Path(entry.filename.replace("\\", "/"))
            if relative.is_absolute() or ".." in relative.parts or ":" in entry.filename:
                raise ValueError("Ungültiger Pfad im Python-Archiv")
        source.extractall(target)
    # _pth is relative to python.exe, ignores PYTHONPATH and current directory.
    # Explicit application path supports -m scripts.managed_server from anywhere.
    (target / "python313._pth").write_text(
        "python313.zip\n.\nLib/site-packages\n..\\..\n", encoding="utf-8"
    )


def prepare(target: Path, archive: Path | None = None) -> None:
    destination = target
    if destination.exists():
        raise ValueError("Ziel existiert bereits; frisches Laufzeitverzeichnis wählen")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ttc-python-") as temporary:
        target = Path(temporary) / "runtime"
        downloaded = Path(temporary) / "python.zip"
        if archive is None:
            with urllib.request.urlopen(URL, timeout=60) as response:
                downloaded.write_bytes(response.read())
            archive = downloaded
        extract_runtime(archive, target)
        subprocess.run([
            sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
            "--only-binary=:all:", "--platform", "win_amd64", "--python-version", "3.13",
            "--implementation", "cp", "--abi", "cp313", "--no-compile",
            "--target", str(target / "Lib" / "site-packages"),
            "-r", str(ROOT / "requirements-windows.txt"),
        ], check=True, timeout=300)
        files = {str(p.relative_to(target)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in sorted(target.rglob("*")) if p.is_file()}
        (target / "runtime-manifest.json").write_text(json.dumps({
            "python": VERSION, "platform": "win32-x64", "archiveSha256": ARCHIVE_SHA256,
            "requirementsSha256": hashlib.sha256((ROOT / "requirements-windows.txt").read_bytes()).hexdigest(),
            "files": files,
        }, indent=2), encoding="utf-8")
        import shutil
        shutil.copytree(target, destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path)
    parser.add_argument("--archive", type=Path)
    arguments = parser.parse_args()
    try:
        prepare(arguments.target.resolve(), arguments.archive)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        parser.exit(1, f"Windows-Python-Build fehlgeschlagen: {error}\n")
