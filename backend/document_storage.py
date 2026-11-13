"""Local document access without invoice, database, or HTTP dependencies."""
import stat
from pathlib import Path

from backend.paths import get_document_directory


class DocumentStore:
    def __init__(self, directory: Path | None = None):
        # Resolve once so a later working-directory change cannot redirect access.
        self.directory = (directory if directory is not None else get_document_directory()).resolve()

    def _path(self, name: str) -> Path:
        # Database references are plain filenames, never paths or Windows streams.
        if (
            not name
            or name in {".", ".."}
            or any(character in name for character in ("/", "\\", ":", "\0"))
        ):
            raise ValueError("Dokumentreferenzen müssen einfache Dateinamen sein")
        return self.directory / name

    def save_new(self, name: str, content: bytes) -> Path:
        """Create a new document; never replace an existing file or symlink."""
        path = self._path(name)
        self.directory.mkdir(parents=True, exist_ok=True)
        # Opening is outside the cleanup block: a failed exclusive open must
        # never remove a pre-existing document.
        document = path.open("xb")
        try:
            with document:
                document.write(content)
                document.flush()
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return path

    def get_file(self, name: str) -> Path:
        """Return an existing regular file, rejecting symbolic links."""
        path = self._path(name)
        if not stat.S_ISREG(path.lstat().st_mode):
            raise FileNotFoundError("Dokument wurde nicht gefunden")
        return path
