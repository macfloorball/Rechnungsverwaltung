"""Offline restoration into a NEW profile; never replace a live database."""
import argparse
import json
import os
import shutil
import sqlite3
import stat
import tempfile
import zipfile
import zlib
from contextlib import closing
from pathlib import Path

from backend.backup_service import MAX_ENTRIES, MAX_TOTAL_BYTES, _digest, create_backup
from backend.paths import get_database_path, get_document_directory
from backend.document_storage import DocumentStore
from backend.storage_import import validate_database


def stage_backup(archive_path: Path, stage: Path) -> None:
    with zipfile.ZipFile(archive_path) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(names) > MAX_ENTRIES or len(names) != len(set(names)):
            raise ValueError('Ungültige oder doppelte Archiveinträge.')
        if sum(entry.file_size for entry in entries) > MAX_TOTAL_BYTES:
            raise ValueError('Sicherung überschreitet das Wiederherstellungslimit (8 GiB).')
        info = archive.getinfo('manifest.json')
        if info.file_size > 16 * 1024**2:
            raise ValueError('Manifest ist zu groß.')
        manifest = json.loads(archive.read(info))
        if not isinstance(manifest, dict) or manifest.get('format') != 1 or not isinstance(manifest.get('files'), dict):
            raise ValueError('Nicht unterstütztes Sicherungsformat.')
        files = manifest['files']
        if set(names) != set(files) | {'manifest.json'} or 'database/ttc.db' not in files:
            raise ValueError('Sicherung ist unvollständig.')
        folded = set()
        for name, metadata in files.items():
            if name != 'database/ttc.db':
                if not name.startswith('documents/'):
                    raise ValueError('Unzulässiger Archiveintrag.')
                DocumentStore(stage / 'documents')._path(name[len('documents/'):])
            if name.casefold() in folded:
                raise ValueError('Dateinamen sind auf Windows nicht eindeutig.')
            folded.add(name.casefold())
            entry = archive.getinfo(name)
            mode = entry.external_attr >> 16
            if entry.flag_bits & 1:
                raise ValueError('Verschlüsselte ZIP-Einträge werden nicht unterstützt.')
            if entry.is_dir() or stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
                raise ValueError('Nur reguläre Dateien sind zulässig.')
            if not isinstance(metadata, dict) or entry.file_size != metadata.get('size'):
                raise ValueError('Dateigröße stimmt nicht mit dem Manifest überein.')
            target = stage / name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with archive.open(entry) as source, target.open('xb') as output:
                shutil.copyfileobj(source, output)
                output.flush()
                os.fsync(output.fileno())
            target.chmod(0o600)
            if _digest(target) != metadata:
                raise ValueError('Prüfsumme der Sicherung stimmt nicht überein.')
    database = stage / 'database/ttc.db'
    with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)) as connection:
        validate_database(connection, current=True)
        for (reference,) in connection.execute("SELECT pdf_path FROM invoices WHERE pdf_path IS NOT NULL AND pdf_path != ''"):
            DocumentStore(stage / 'documents')._path(reference)
            if 'documents/' + reference not in files:
                raise ValueError('Referenzierte Rechnungs-PDF fehlt.')
    (stage / 'documents').mkdir(exist_ok=True)


def restore_backup(
    archive: Path, target: Path, *, current_database: Path,
    current_documents: Path, safety_directory: Path, confirmed: bool = False,
) -> Path:
    if not confirmed:
        raise ValueError('Wiederherstellung muss ausdrücklich bestätigt werden.')
    target = Path(target)
    if not target.is_absolute():
        raise ValueError('Der neue Datenordner muss absolut sein.')
    if target.exists() or target.is_symlink():
        raise FileExistsError('Ziel existiert bereits; vorhandene Daten bleiben unverändert.')
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.ttc-restore-', dir=target.parent) as temporary:
        stage = Path(temporary)
        try:
            stage_backup(archive, stage)
        except (KeyError, TypeError, zipfile.BadZipFile, json.JSONDecodeError, zlib.error, NotImplementedError) as error:
            raise ValueError('Ungültige oder beschädigte Sicherung.') from error
        if target.resolve() == safety_directory.resolve() or target.resolve() in safety_directory.resolve().parents:
            raise ValueError('Sicherheitskopie muss außerhalb des neuen Profils liegen.')
        create_backup(current_database, current_documents, safety_directory)
        # Reserve an unused profile. Publish the DB last. If publication fails,
        # only a new, incomplete target may remain; originals are never touched.
        target.mkdir(mode=0o700)
        (target / 'documents').mkdir(mode=0o700)
        for document in (stage / 'documents').iterdir():
            os.link(document, target / 'documents' / document.name)
        os.link(stage / 'database/ttc.db', target / 'ttc.db')
    return target


def main():
    parser = argparse.ArgumentParser(description='Geprüftes ZIP-Backup offline in einen neuen Datenordner übernehmen')
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--target', type=Path, required=True)
    parser.add_argument('--confirm', action='store_true')
    parser.add_argument('--current-database', type=Path, default=get_database_path())
    parser.add_argument('--current-documents', type=Path, default=get_document_directory())
    parser.add_argument('--safety-directory', type=Path, required=True)
    args = parser.parse_args()
    try:
        restore_backup(args.archive, args.target, confirmed=args.confirm,
                       current_database=args.current_database, current_documents=args.current_documents,
                       safety_directory=args.safety_directory)
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.exit(1, f'Wiederherstellung abgebrochen: {error}\nOriginalbestand beibehalten; einen eventuell unvollständigen neuen Zielordner nicht verwenden.\n')
    print('Wiederherstellung geprüft und abgeschlossen. TTC_DATA_DIRECTORY auf den neuen Datenordner setzen.')


if __name__ == '__main__':
    main()
