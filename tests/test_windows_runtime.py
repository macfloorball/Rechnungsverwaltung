"""Windows runtime build rejects corrupted archives before publishing files."""
import hashlib
import zipfile

import pytest

from scripts import prepare_windows_runtime as runtime


def test_corrupt_archive_never_creates_runtime(tmp_path):
    archive = tmp_path / "bad.zip"
    archive.write_bytes(b"not the approved Python distribution")
    target = tmp_path / "runtime"
    with pytest.raises(ValueError, match="SHA-256"):
        runtime.extract_runtime(archive, target)
    assert not target.exists()


def test_embedded_search_path_is_relocatable_and_explicit(tmp_path, monkeypatch):
    archive = tmp_path / "python.zip"
    with zipfile.ZipFile(archive, "w") as source:
        source.writestr("python.exe", b"MZfixture")
        source.writestr("python313._pth", "original")
    monkeypatch.setattr(runtime, "ARCHIVE_SHA256", hashlib.sha256(archive.read_bytes()).hexdigest())
    target = tmp_path / "runtime"
    runtime.extract_runtime(archive, target)
    assert (target / "python313._pth").read_text().splitlines() == [
        "python313.zip", ".", "Lib/site-packages", "../..",
    ]


def test_runtime_does_not_replace_existing_directory(tmp_path):
    target = tmp_path / "runtime"
    target.mkdir()
    marker = target / "existing"
    marker.write_bytes(b"keep")
    with pytest.raises(ValueError, match="existiert"):
        runtime.prepare(target)
    assert marker.read_bytes() == b"keep"
