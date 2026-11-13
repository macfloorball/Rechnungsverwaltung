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
