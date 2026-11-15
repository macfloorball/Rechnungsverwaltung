import json
import sqlite3
import zipfile
from pathlib import Path

import pytest

from backend.backup_service import create_backup
from backend.database import initialize_database


@pytest.fixture
def inventory(tmp_path):
    database = tmp_path / 'ttc.db'
    initialize_database(database)
    documents = tmp_path / 'documents'
    documents.mkdir()
    (documents / 'Beleg.pdf').write_bytes(b'%PDF-test')
    return database, documents, tmp_path / 'backups'


def test_complete_backup(inventory):
    database, documents, destination = inventory
    archive = create_backup(*inventory)
    with zipfile.ZipFile(archive) as backup:
        assert backup.read('documents/Beleg.pdf') == b'%PDF-test'
        manifest = json.loads(backup.read('manifest.json'))
        assert manifest['format'] == 1
        assert set(manifest['files']) == {'database/ttc.db', 'documents/Beleg.pdf'}
    assert (documents / 'Beleg.pdf').exists()


def test_missing_pdf_publishes_nothing(inventory):
    database, documents, destination = inventory
    with sqlite3.connect(database) as db:
        db.execute("INSERT INTO invoices (organization_id, year, month, invoice_date, pdf_path, total_amount_cents) VALUES (1, 2026, 1, '2026-01-01', 'missing.pdf', 0)")
    with pytest.raises(ValueError, match='fehlt'):
        create_backup(*inventory)
    assert not list(destination.glob('*.zip'))


@pytest.mark.parametrize('target', ['relative', 'inside-documents'])
def test_invalid_destination(inventory, target):
    database, documents, _ = inventory
    destination = Path('relative') if target == 'relative' else documents / 'backups'
    with pytest.raises(ValueError):
        create_backup(database, documents, destination)


def test_backup_api_custom_destination(inventory):
    from fastapi.testclient import TestClient
    from backend.main import app, get_database_path, get_invoice_directory
    database, documents, destination = inventory
    app.dependency_overrides[get_database_path] = lambda: database
    app.dependency_overrides[get_invoice_directory] = lambda: documents
    try:
        client = TestClient(app)
        response = client.post('/api/backups', json={'directory': str(destination)})
        assert response.status_code == 200
        assert Path(response.json()['path']).parent == destination
        response = client.post('/api/backups', json={'directory': 'relative'})
        assert response.status_code == 503
        assert str(database) not in response.text
        assert client.post('/api/backups', json={'directory': 42}).status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_timestamp_structure_hashes_and_unique_publication(inventory):
    import hashlib
    import re
    first = create_backup(*inventory)
    original = first.read_bytes()
    second = create_backup(*inventory)
    assert first != second
    assert first.read_bytes() == original
    assert re.fullmatch(r'ttc-backup-\d{8}T\d{12}Z-[a-f0-9]{8}\.zip', first.name)
    with zipfile.ZipFile(first) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        for name, metadata in manifest['files'].items():
            content = archive.read(name)
            assert metadata == {'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
        assert set(archive.namelist()) == set(manifest['files']) | {'manifest.json'}
        assert str(inventory[0].parent) not in archive.read('manifest.json').decode()


def test_publication_failure_leaves_no_partial_backup(inventory, monkeypatch):
    import backend.backup_service as service
    def fail(*args):
        raise OSError('publication failed')
    monkeypatch.setattr(service.os, 'link', fail)
    with pytest.raises(OSError):
        create_backup(*inventory)
    assert list(inventory[2].iterdir()) == []


@pytest.mark.parametrize("operation", ["backup", "export"])
def test_sync_failure_never_publishes_archive_or_changes_inputs(inventory, monkeypatch, operation):
    import os
    from backend.data_export import create_export
    database, documents, destination = inventory
    original_database = database.read_bytes()
    original_document = (documents / 'Beleg.pdf').read_bytes()

    def fail(_fd):
        raise OSError('synchronization failed')

    monkeypatch.setattr(os, 'fsync', fail)
    with pytest.raises(OSError, match='synchronization failed'):
        (create_backup if operation == 'backup' else create_export)(*inventory)
    assert list(destination.iterdir()) == []
    assert database.read_bytes() == original_database
    assert (documents / 'Beleg.pdf').read_bytes() == original_document


def test_online_backup_preserves_wal_and_blocks_concurrent_writes(inventory, monkeypatch):
    import backend.backup_service as service
    database, documents, destination = inventory
    original_copy = service.shutil.copyfileobj
    attempts = []
    def copy_under_lock(source, target, *args):
        if args:
            return original_copy(source, target, *args)
        with sqlite3.connect(database, timeout=0.01) as writer:
            with pytest.raises(sqlite3.OperationalError, match='locked'):
                writer.execute('BEGIN IMMEDIATE')
            attempts.append(True)
        return original_copy(source, target)
    monkeypatch.setattr(service.shutil, 'copyfileobj', copy_under_lock)
    with sqlite3.connect(database) as live:
        live.execute('PRAGMA journal_mode=WAL')
        live.execute("UPDATE organizations SET name='WAL bestätigt' WHERE id=1")
        live.commit()
        assert Path(str(database) + '-wal').stat().st_size > 0
        archive_path = create_backup(*inventory)
    assert attempts
    with zipfile.ZipFile(archive_path) as archive:
        restored = destination / 'checked.db'
        restored.write_bytes(archive.read('database/ttc.db'))
    with sqlite3.connect(restored) as copy:
        assert copy.execute('SELECT name FROM organizations WHERE id=1').fetchone() == ('WAL bestätigt',)
        assert copy.execute('PRAGMA integrity_check').fetchone() == ('ok',)


def test_document_changed_during_copy_aborts(inventory, monkeypatch):
    import backend.backup_service as service
    original = service.shutil.copyfileobj
    def change(source, target):
        original(source, target)
        (inventory[1] / 'Beleg.pdf').write_bytes(b'changed')
    monkeypatch.setattr(service.shutil, 'copyfileobj', change)
    with pytest.raises(ValueError, match='geändert'):
        create_backup(*inventory)
    assert not list(inventory[2].glob('*.zip'))


def test_restore_to_new_profile_and_no_overwrite(inventory, tmp_path):
    from backend.backup_restore import restore_backup
    archive = create_backup(*inventory)
    target = tmp_path / 'anderer PC' / 'Profil'
    with pytest.raises(ValueError, match='bestätigt'):
        restore_backup(archive, target, current_database=inventory[0], current_documents=inventory[1], safety_directory=tmp_path / 'safety')
    assert not target.exists()
    restore_backup(archive, target, confirmed=True, current_database=inventory[0], current_documents=inventory[1], safety_directory=tmp_path / 'safety')
    assert (target / 'documents/Beleg.pdf').read_bytes() == b'%PDF-test'
    with sqlite3.connect(target / 'ttc.db') as connection:
        assert connection.execute('PRAGMA integrity_check').fetchone() == ('ok',)
    with pytest.raises(FileExistsError):
        restore_backup(archive, target, confirmed=True, current_database=inventory[0], current_documents=inventory[1], safety_directory=tmp_path / 'safety')


@pytest.mark.parametrize('damage', ['hash', 'traversal', 'duplicate', 'version', 'database', 'case-collision'])
def test_invalid_restore_never_publishes_target(inventory, tmp_path, damage):
    from backend.backup_restore import restore_backup
    archive = create_backup(*inventory)
    with zipfile.ZipFile(archive) as source:
        files = {name: source.read(name) for name in source.namelist()}
    manifest = json.loads(files['manifest.json'])
    if damage == 'hash':
        files['documents/Beleg.pdf'] = b'bad'
    elif damage == 'traversal':
        files['documents/../../escape'] = b'bad'
        manifest['files']['documents/../../escape'] = {'size': 3, 'sha256': 'bad'}
    elif damage == 'version':
        manifest['format'] = 99
    elif damage == 'database':
        import hashlib
        files['database/ttc.db'] = b'not sqlite'
        manifest['files']['database/ttc.db'] = {'size': 10, 'sha256': hashlib.sha256(b'not sqlite').hexdigest()}
    elif damage == 'case-collision':
        files['documents/beleg.pdf'] = files['documents/Beleg.pdf']
        manifest['files']['documents/beleg.pdf'] = dict(manifest['files']['documents/Beleg.pdf'])
    files['manifest.json'] = json.dumps(manifest).encode()
    broken = tmp_path / 'broken.zip'
    with zipfile.ZipFile(broken, 'w') as output:
        for name, content in files.items():
            output.writestr(name, content)
        if damage == 'duplicate':
            with pytest.warns(UserWarning):
                output.writestr('manifest.json', files['manifest.json'])
    target = tmp_path / 'restored'
    with pytest.raises((ValueError, sqlite3.Error)):
        restore_backup(broken, target, confirmed=True, current_database=inventory[0], current_documents=inventory[1], safety_directory=tmp_path / 'safety')
    assert not target.exists()
    assert (inventory[1] / 'Beleg.pdf').read_bytes() == b'%PDF-test'


def test_restore_saves_current_state_first(inventory, tmp_path):
    from backend.backup_restore import restore_backup
    archive = create_backup(*inventory)
    with sqlite3.connect(inventory[0]) as connection:
        connection.execute("UPDATE organizations SET name='Aktueller Bestand' WHERE id=1")
    (inventory[1] / 'Beleg.pdf').write_bytes(b'current PDF')
    safety = tmp_path / 'safety'
    target = tmp_path / 'restored'
    restore_backup(archive, target, confirmed=True, current_database=inventory[0], current_documents=inventory[1], safety_directory=safety)
    assert (target / 'documents/Beleg.pdf').read_bytes() == b'%PDF-test'
    with zipfile.ZipFile(next(safety.glob('*.zip'))) as copy:
        assert copy.read('documents/Beleg.pdf') == b'current PDF'
        db = tmp_path / 'safety.db'
        db.write_bytes(copy.read('database/ttc.db'))
    with sqlite3.connect(db) as connection:
        assert connection.execute('SELECT name FROM organizations WHERE id=1').fetchone() == ('Aktueller Bestand',)


def test_failed_safety_backup_prevents_restore(inventory, tmp_path, monkeypatch):
    import backend.backup_restore as restore
    archive = create_backup(*inventory)
    def fail(*args):
        raise OSError('disk full')
    monkeypatch.setattr(restore, 'create_backup', fail)
    target = tmp_path / 'restored'
    with pytest.raises(OSError):
        restore.restore_backup(archive, target, confirmed=True, current_database=inventory[0], current_documents=inventory[1], safety_directory=tmp_path / 'safety')
    assert not target.exists()


def test_csv_export_preserves_values_and_defuses_formulas(inventory, tmp_path):
    import csv
    import io
    from backend.data_export import create_export
    with sqlite3.connect(inventory[0]) as connection:
        connection.execute("UPDATE organizations SET name=?, logo_data=? WHERE id=1", ('=HYPERLINK("bad")\n;Ümlaut', b'logo'))
    exported = create_export(inventory[0], inventory[1], tmp_path / 'exports')
    with zipfile.ZipFile(exported) as archive:
        assert archive.read('documents/Beleg.pdf') == b'%PDF-test'
        text = archive.read('csv/organizations.csv').decode('utf-8-sig')
        row = next(csv.DictReader(io.StringIO(text), delimiter=';'))
        assert row['name'] == '\'=HYPERLINK("bad")\n;Ümlaut'
        assert row['logo_data'] == 'base64:bG9nbw=='
        assert row['id'] == '1'
        assert 'csv/invoice_items.csv' in archive.namelist()


@pytest.mark.parametrize('kind', ['directory', 'symlink', 'windows-name', 'case-collision'])
def test_nonportable_documents_abort_without_publication(inventory, kind):
    documents = inventory[1]
    if kind == 'directory':
        (documents / 'subfolder').mkdir()
    elif kind == 'symlink':
        (documents / 'link.pdf').symlink_to(documents / 'Beleg.pdf')
    elif kind == 'windows-name':
        (documents / 'CON.pdf').write_bytes(b'bad name')
    else:
        try:
            with (documents / 'beleg.pdf').open('xb') as stream:
                stream.write(b'ambiguous')
        except FileExistsError:
            pytest.skip('Filesystem cannot represent two names differing only in case; archive rejection is tested separately')
    with pytest.raises((OSError, ValueError)):
        create_backup(*inventory)
    assert not list(inventory[2].glob('*.zip'))


@pytest.mark.parametrize('error_number', [13, 28])
def test_copy_failure_preserves_originals(inventory, monkeypatch, error_number):
    import backend.backup_service as service
    def fail(*args):
        raise OSError(error_number, 'simulated filesystem failure')
    monkeypatch.setattr(service.shutil, 'copyfileobj', fail)
    with pytest.raises(OSError):
        create_backup(*inventory)
    assert not list(inventory[2].iterdir())
    assert (inventory[1] / 'Beleg.pdf').read_bytes() == b'%PDF-test'


def test_restore_rejects_symlink_and_excessive_size(inventory, tmp_path, monkeypatch):
    import stat
    import backend.backup_restore as restore
    archive = create_backup(*inventory)
    kwargs = dict(confirmed=True, current_database=inventory[0], current_documents=inventory[1], safety_directory=tmp_path / 'safety')
    monkeypatch.setattr(restore, 'MAX_TOTAL_BYTES', 1)
    with pytest.raises(ValueError, match='Limit|limit'):
        restore.restore_backup(archive, tmp_path / 'new', **kwargs)
    monkeypatch.setattr(restore, 'MAX_TOTAL_BYTES', 8 * 1024**3)
    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(tmp_path / 'symlink.zip', 'w') as output:
        for name in source.namelist():
            info = zipfile.ZipInfo(name)
            info.external_attr = (stat.S_IFLNK | 0o777) << 16 if name.startswith('documents/') else (stat.S_IFREG | 0o600) << 16
            output.writestr(info, source.read(name))
    with pytest.raises(ValueError, match='reguläre'):
        restore.restore_backup(tmp_path / 'symlink.zip', tmp_path / 'new', **kwargs)
    assert not (tmp_path / 'new').exists()


def test_export_api_download_and_error_response(inventory, tmp_path, monkeypatch):
    import io
    import backend.main as main
    from fastapi.testclient import TestClient
    database, documents, _ = inventory
    main.app.dependency_overrides[main.get_database_path] = lambda: database
    main.app.dependency_overrides[main.get_invoice_directory] = lambda: documents
    try:
        client = TestClient(main.app)
        response = client.get('/api/exports/download')
        assert response.status_code == 200
        assert 'attachment' in response.headers['content-disposition']
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            assert archive.read('documents/Beleg.pdf') == b'%PDF-test'
        (documents / 'Beleg.pdf').unlink()
        with sqlite3.connect(database) as connection:
            connection.execute("INSERT INTO invoices (organization_id, year, month, invoice_date, pdf_path, total_amount_cents) VALUES (1, 2026, 1, '2026-01-01', 'Beleg.pdf', 0)")
        response = client.get('/api/exports/download')
        assert response.status_code == 503
        assert str(tmp_path) not in response.text
    finally:
        main.app.dependency_overrides.clear()


def test_backup_never_publishes_archive_beyond_restore_limits(inventory, monkeypatch):
    import backend.backup_service as service
    monkeypatch.setattr(service, 'MAX_TOTAL_BYTES', 1)
    with pytest.raises(ValueError, match='Wiederherstellungslimit'):
        create_backup(*inventory)
    assert list(inventory[2].iterdir()) == []
