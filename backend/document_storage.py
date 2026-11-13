"""Local document access without invoice, database, or HTTP dependencies."""
import os
import shutil
import stat
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Iterator

from backend.paths import get_document_directory

WINDOWS_RESERVED_NAMES = {"CON", "PRN", "AUX", "NUL"} | {
    prefix + suffix for prefix in ("COM", "LPT") for suffix in "123456789¹²³"
}


@dataclass(frozen=True)
class DocumentIdentity:
    device: int
    inode: int
    size: int
    modified_ns: int

    @classmethod
    def from_stat(cls, info: os.stat_result) -> "DocumentIdentity":
        return cls(info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)


class DocumentChangedError(OSError):
    """A document changed after the caller selected it for an operation."""


@dataclass
class _DocumentWrite:
    stream: BinaryIO
    identity: DocumentIdentity | None = None


class DocumentStore:
    def __init__(self, directory: Path | None = None):
        # Resolve once so a later working-directory change cannot redirect access.
        self.directory = (directory if directory is not None else get_document_directory()).resolve()

    def _path(self, name: str) -> Path:
        # Database references are plain filenames, never paths or Windows streams.
        if (
            not name
            or name in {".", ".."}
            or name.endswith((" ", "."))
            or any(ord(character) < 32 or character in '<>:"/\\|?*' for character in name)
            or name.split(".", 1)[0].rstrip().upper() in WINDOWS_RESERVED_NAMES
        ):
            raise ValueError("Dokumentreferenzen müssen einfache Dateinamen sein")
        return self.directory / name

    @contextmanager
    def _new_file(self, name: str) -> Iterator[_DocumentWrite]:
        target = self._path(name)
        if target.exists() or target.is_symlink():
            raise FileExistsError("Die Dokumentdatei existiert bereits")
        self.directory.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".ttc-document-write-", dir=self.directory) as temporary:
            staged = Path(temporary) / "document"
            with staged.open("xb") as writer:
                pending = _DocumentWrite(writer)
                yield pending
                writer.flush()
                os.fsync(writer.fileno())
            staged.chmod(0o600)
            # On Windows the last-write timestamp may settle only when the
            # writing handle closes. Capture the version afterwards, before
            # publication, rather than looking up a replaceable target path.
            pending.identity = DocumentIdentity.from_stat(staged.stat())
            # Atomic no-clobber publication on the same filesystem. Failures
            # before publication clean up only this operation's temporary copy.
            os.link(staged, target)

    def save_new(self, name: str, content: bytes) -> Path:
        """Publish a complete new document without replacing existing data."""
        return self.save_new_with_identity(name, content)[0]

    def save_new_with_identity(
        self, name: str, content: bytes,
    ) -> tuple[Path, DocumentIdentity]:
        """Return the published file's identity for conditional rollback."""
        with self._new_file(name) as pending:
            pending.stream.write(content)
        assert pending.identity is not None
        return self._path(name), pending.identity

    def get_identity(self, name: str) -> DocumentIdentity:
        info = self._path(name).lstat()
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("Die Dokumentdatei ist keine reguläre Datei")
        return DocumentIdentity.from_stat(info)

    def get_file(self, name: str) -> Path:
        """Return an existing regular file, rejecting symbolic links."""
        path = self._path(name)
        try:
            self.get_identity(name)
        except ValueError as error:
            raise FileNotFoundError("Dokument wurde nicht gefunden") from error
        return path

    @contextmanager
    def open_read(self, name: str) -> Iterator[BinaryIO]:
        """Open read-only and verify the opened descriptor still identifies the file."""
        identity = self.get_identity(name)
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(self._path(name), flags)
        with os.fdopen(descriptor, "rb") as reader:
            if DocumentIdentity.from_stat(os.fstat(reader.fileno())) != identity:
                raise DocumentChangedError("Die Dokumentdatei wurde zwischenzeitlich geändert")
            yield reader

    def delete(
        self, name: str, *, expected: DocumentIdentity | None = None,
        missing_ok: bool = False,
    ) -> bool:
        """Delete only a regular file, optionally matching a prior selection."""
        path = self._path(name)
        try:
            identity = self.get_identity(name)
        except FileNotFoundError:
            if missing_ok:
                return False
            raise
        if expected is not None and identity != expected:
            raise DocumentChangedError("Die Dokumentdatei wurde zwischenzeitlich geändert")
        path.unlink()
        return True

    def rename(self, name: str, new_name: str) -> Path:
        """Rename within the store without ever replacing an existing target."""
        original, target = self._path(name), self._path(new_name)
        identity = self.get_identity(name)
        if original == target:
            return original
        if os.link in os.supports_follow_symlinks:
            os.link(original, target, follow_symlinks=False)
        else:
            os.link(original, target)
        if self.get_identity(new_name) != identity:
            raise DocumentChangedError("Die Dokumentdatei wurde zwischenzeitlich geändert")
        # If removal fails, retain both names rather than risk losing the only
        # remaining copy. The caller receives the error and can inspect them.
        self.delete(name, expected=identity)
        return target

    def copy_missing_from(self, source: "DocumentStore", name: str) -> Path:
        """Adopt an old document without modifying source or replacing target."""
        target = self._path(name)
        if target.exists() or target.is_symlink():
            return self.get_file(name)
        try:
            with source.open_read(name) as reader, self._new_file(name) as pending:
                shutil.copyfileobj(reader, pending.stream)
        except FileExistsError:
            return self.get_file(name)
        return self.get_file(name)
