from pathlib import Path

import pytest

from backend.document_storage import DocumentStore
from backend.paths import PROJECT_ROOT, get_document_directory


def test_document_directory_defaults_and_profile_override(monkeypatch, tmp_path):
    monkeypatch.delenv("TTC_DATA_DIRECTORY", raising=False)
    assert get_document_directory() == PROJECT_ROOT / "rechnungen"
    profile = tmp_path / "User Data"
    monkeypatch.setenv("TTC_DATA_DIRECTORY", str(profile))
    store = DocumentStore()
    assert store.directory == profile / "documents"
    assert not profile.exists()  # Resolution alone never creates data.
    path = store.save_new("Rechnung_TTC_2026-11.pdf", b"pdf content")
    assert DocumentStore().get_file(path.name).read_bytes() == b"pdf content"


@pytest.mark.parametrize("value", ["", " ", "relative/path"])
def test_invalid_profile_is_rejected(monkeypatch, value):
    monkeypatch.setenv("TTC_DATA_DIRECTORY", value)
    with pytest.raises(ValueError, match="absolutes"):
        DocumentStore()


def test_existing_document_is_not_overwritten(tmp_path):
    store = DocumentStore(tmp_path)
    path = store.save_new("invoice.pdf", b"original")
    with pytest.raises(FileExistsError):
        store.save_new("invoice.pdf", b"replacement")
    assert path.read_bytes() == b"original"


@pytest.mark.parametrize("name", ["", ".", "..", "../other.pdf", "/other.pdf", "sub/file.pdf", "sub\\file.pdf", "C:\\other.pdf", "file.pdf:stream", "bad\0.pdf"])
def test_path_references_are_rejected_without_creating_directories(tmp_path, name):
    root = tmp_path / "documents"
    store = DocumentStore(root)
    with pytest.raises(ValueError):
        store.save_new(name, b"content")
    with pytest.raises(ValueError):
        store.get_file(name)
    assert not root.exists()


def test_missing_files_directories_and_symlinks_are_not_documents(tmp_path):
    root = tmp_path / "documents"
    root.mkdir()
    outside = tmp_path / "private.pdf"
    outside.write_bytes(b"private")
    link = root / "invoice.pdf"
    link.symlink_to(outside)
    (root / "folder").mkdir()
    store = DocumentStore(root)
    for name in ("missing.pdf", "folder", "invoice.pdf"):
        with pytest.raises(FileNotFoundError):
            store.get_file(name)
    with pytest.raises(FileExistsError):
        store.save_new(link.name, b"replacement")
    assert outside.read_bytes() == b"private"
    assert link.is_symlink()


def test_write_failure_removes_only_new_partial_document(monkeypatch, tmp_path):
    store = DocumentStore(tmp_path)
    original_open = Path.open

    class FailingWrite:
        def __init__(self, file):
            self.file = file

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.file.close()

        def write(self, content):
            self.file.write(content[:2])
            raise OSError("Disk full")

    def open_file(path, mode="r", *args, **kwargs):
        file = original_open(path, mode, *args, **kwargs)
        return FailingWrite(file) if mode == "xb" else file

    monkeypatch.setattr(Path, "open", open_file)
    with pytest.raises(OSError, match="Disk full"):
        store.save_new("partial.pdf", b"content")
    assert not (tmp_path / "partial.pdf").exists()


def test_relative_explicit_root_stays_stable_after_working_directory_change(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    store = DocumentStore(Path("documents"))
    other = tmp_path / "other"
    other.mkdir()
    monkeypatch.chdir(other)
    path = store.save_new("invoice.pdf", b"content")
    assert path == tmp_path / "documents" / "invoice.pdf"
    assert store.get_file(path.name) == path
    assert not (other / "documents").exists()
