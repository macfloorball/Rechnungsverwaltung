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
