"""Prepare a pinned, relocatable Linux x86_64 CPython, never system Python."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

VERSION = "3.13.18"
BUILD = "20261110"
ARCHIVE_SHA256 = "f2d2199eb25880e07863b391cf7124e7ffa1338b0d65600dfcec117c4223a7fb"
URL = (f"https://github.com/astral-sh/python-build-standalone/releases/download/{BUILD}/"
       f"cpython-{VERSION}%2B{BUILD}-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz")
ROOT = Path(__file__).resolve().parent.parent


def extract_runtime(archive: Path, target: Path) -> None:
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA256:
        raise ValueError("Linux-Python-Archiv: SHA-256 stimmt nicht überein")
    if target.exists():
        raise ValueError("Ziel existiert bereits; frisches Laufzeitverzeichnis wählen")
    with tempfile.TemporaryDirectory(prefix="ttc-linux-extract-") as temporary:
        base = Path(temporary)
        with tarfile.open(archive, "r:gz") as source:
            for entry in source.getmembers():
                relative = Path(entry.name)
                if relative.is_absolute() or ".." in relative.parts or relative.parts[:1] != ("python",):
                    raise ValueError("Ungültiger Pfad im Linux-Python-Archiv")
            source.extractall(base, filter="data")
        python = base / "python"
        for entry in python.rglob("*"):
            if entry.is_symlink() and (not entry.resolve().is_relative_to(python) or not entry.resolve().is_file()):
                raise ValueError("Ungültige Verknüpfung im Linux-Python-Archiv")
        # Materialize internal file aliases; shipped manifests accept regular files only.
        shutil.copytree(python, target, symlinks=False)


def prepare(destination: Path, archive: Path | None = None) -> None:
    if destination.exists():
        raise ValueError("Ziel existiert bereits; frisches Laufzeitverzeichnis wählen")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ttc-linux-python-") as temporary:
        root = Path(temporary)
        if archive is None:
            archive = root / "python.tar.gz"
            with urllib.request.urlopen(URL, timeout=60) as response, archive.open("wb") as output:
                shutil.copyfileobj(response, output)
        target = root / "runtime"
        extract_runtime(archive, target)
        subprocess.run([
            sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
            "--only-binary=:all:", "--platform", "manylinux_2_28_x86_64",
            "--platform", "manylinux2014_x86_64", "--platform", "manylinux_2_17_x86_64",
            "--python-version", "3.13", "--implementation", "cp", "--abi", "cp313",
            "--no-compile", "--target", str(target / "lib" / "python3.13" / "site-packages"),
            "-r", str(ROOT / "requirements-linux.txt"),
        ], check=True, timeout=300)
        files = {p.relative_to(target).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in sorted(target.rglob("*")) if p.is_file()}
        (target / "runtime-manifest.json").write_text(json.dumps({
            "python": VERSION, "platform": "linux-x64", "archiveSha256": ARCHIVE_SHA256,
            "requirementsSha256": hashlib.sha256((ROOT / "requirements-linux.txt").read_bytes()).hexdigest(),
            "files": files,
        }, indent=2), encoding="utf-8")
        shutil.copytree(target, destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path)
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()
    try:
        prepare(args.target.resolve(), args.archive)
    except (OSError, ValueError, tarfile.TarError, subprocess.SubprocessError) as error:
        parser.exit(1, f"Linux-Python-Build fehlgeschlagen: {error}\n")
