"""Portable offline backups. No archive content is ever extracted by name."""
import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
import uuid
import zipfile
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from backend.document_storage import DocumentIdentity, DocumentStore
from backend.storage_import import validate_database

MAX_TOTAL_BYTES = 8 * 1024**3
MAX_ENTRIES = 100_000


def _digest(path: Path) -> dict:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return {'size': path.stat().st_size, 'sha256': digest.hexdigest()}


def create_backup(database: Path, documents: Path, destination: Path) -> Path:
    destination = Path(destination)
    if not destination.is_absolute():
        raise ValueError('Bitte einen absoluten Sicherungsordner angeben.')
    destination = destination.resolve()
    if destination == documents.resolve() or documents.resolve() in destination.parents:
        raise ValueError('Der Sicherungsordner darf nicht im Dokumentenordner liegen.')
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    target = destination / f'ttc-backup-{timestamp}-{uuid.uuid4().hex[:8]}.zip'
    with tempfile.TemporaryDirectory(prefix='.ttc-backup-', dir=destination) as temporary:
        stage = Path(temporary)
        (stage / 'database').mkdir()
        (stage / 'documents').mkdir()
        # A separate writer reservation prevents app writes/deletions while a
        # read-only connection uses SQLite's online backup API (including WAL).
        with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=rw', uri=True, timeout=5)) as guard:
            guard.execute('BEGIN IMMEDIATE')
            try:
                with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)) as source:
                    with closing(sqlite3.connect(stage / 'database/ttc.db')) as copy:
                        source.backup(copy)
                        validate_database(copy, current=True)
                store = DocumentStore(documents)
                if documents.exists():
                    names = sorted(documents.iterdir())
                    portable_names = set()
                    for entry in names:
                        if entry.name.startswith('.ttc-document-write-') and entry.is_dir() and not entry.is_symlink():
                            continue  # Uncommitted staging data, never a document.
                        folded = entry.name.casefold()
                        if folded in portable_names:
                            raise ValueError('Dokumentnamen sind unter Windows nicht eindeutig.')
                        portable_names.add(folded)
                        with store.open_read(entry.name) as stream:
                            before = DocumentIdentity.from_stat(os.fstat(stream.fileno()))
                            with (stage / 'documents' / entry.name).open('xb') as output:
                                shutil.copyfileobj(stream, output)
                            if before != DocumentIdentity.from_stat(os.fstat(stream.fileno())) or before != store.get_identity(entry.name):
                                raise ValueError('Dokument wurde während der Sicherung geändert; erneut versuchen.')
                with closing(sqlite3.connect(stage / 'database/ttc.db')) as copy:
                    for (reference,) in copy.execute("SELECT pdf_path FROM invoices WHERE pdf_path IS NOT NULL AND pdf_path != ''"):
                        store._path(reference)
                        if not (stage / 'documents' / reference).is_file():
                            raise ValueError('Eine referenzierte Rechnungs-PDF fehlt. Dokumentenablage prüfen.')
            finally:
                guard.rollback()
        files = {p.relative_to(stage).as_posix(): _digest(p) for p in sorted(stage.rglob('*')) if p.is_file()}
        manifest = {'format': 1, 'created_utc': timestamp, 'files': files}
        archive = stage / 'backup.zip'
        with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED) as output:
            for name in files:
                output.write(stage / name, name)
            output.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
        with zipfile.ZipFile(archive) as check:
            entries = check.infolist()
            if len(entries) > MAX_ENTRIES or sum(entry.file_size for entry in entries) > MAX_TOTAL_BYTES:
                raise ValueError('Sicherung überschreitet das Wiederherstellungslimit (8 GiB / 100.000 Einträge).')
        archive.chmod(0o600)
        with archive.open('rb') as stream:
            os.fsync(stream.fileno())
        os.link(archive, target)
    return target
