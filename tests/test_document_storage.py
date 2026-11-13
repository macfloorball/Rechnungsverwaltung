from pathlib import Path

import pytest

from backend.document_storage import DocumentStore
from backend.paths import PROJECT_ROOT, get_document_directory


def test_document_directory_defaults_and_profile_override(monkeypatch, tmp_path):
    monkeypatch.delenv("TTC_DOCUMENT_DIRECTORY", raising=False)
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
    monkeypatch.delenv("TTC_DOCUMENT_DIRECTORY", raising=False)
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


def test_legacy_copy_preserves_source_and_existing_target(tmp_path):
    source = DocumentStore(tmp_path / "old")
    target = DocumentStore(tmp_path / "new")
    original = source.save_new("invoice.pdf", b"original")
    copied = target.copy_missing_from(source, original.name)
    assert copied.read_bytes() == b"original"
    assert original.read_bytes() == b"original"
    copied.write_bytes(b"authoritative target")
    assert target.copy_missing_from(source, original.name).read_bytes() == b"authoritative target"
    assert original.read_bytes() == b"original"
    assert list(target.directory.iterdir()) == [copied]


def test_failed_legacy_copy_does_not_publish_partial_data(monkeypatch, tmp_path):
    import backend.document_storage as storage

    source = DocumentStore(tmp_path / "old")
    target = DocumentStore(tmp_path / "new")
    original = source.save_new("invoice.pdf", b"original")

    def fail_copy(reader, writer):
        writer.write(b"partial")
        raise OSError("Disk full")

    monkeypatch.setattr(storage.shutil, "copyfileobj", fail_copy)
    with pytest.raises(OSError, match="Disk full"):
        target.copy_missing_from(source, original.name)
    assert not list(target.directory.iterdir())
    assert original.read_bytes() == b"original"


def test_concurrent_legacy_copy_never_replaces_target(monkeypatch, tmp_path):
    import backend.document_storage as storage

    source = DocumentStore(tmp_path / "old")
    target = DocumentStore(tmp_path / "new")
    original = source.save_new("invoice.pdf", b"original")
    original_link = storage.os.link

    def competing_link(staged, destination):
        destination.write_bytes(b"concurrent target")
        original_link(staged, destination)

    monkeypatch.setattr(storage.os, "link", competing_link)
    copied = target.copy_missing_from(source, original.name)
    assert copied.read_bytes() == b"concurrent target"
    assert original.read_bytes() == b"original"
    assert list(target.directory.iterdir()) == [copied]


def test_legacy_copy_rejects_target_symlink(tmp_path):
    source = DocumentStore(tmp_path / "old")
    target = DocumentStore(tmp_path / "new")
    original = source.save_new("invoice.pdf", b"original")
    target.directory.mkdir()
    link = target.directory / original.name
    link.symlink_to(original)
    with pytest.raises(FileNotFoundError):
        target.copy_missing_from(source, original.name)
    assert link.is_symlink()
    assert original.read_bytes() == b"original"
