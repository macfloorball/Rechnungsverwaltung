"""Explicit external invoices establish a per-profile, per-year starting point."""
import sqlite3

import pytest

from backend import database as db
from backend.backup_service import create_backup
from backend.backup_restore import restore_backup
from test_profiles import environment, request, activity
from test_invoice_numbering import add_training


def start(client, number=11, year=2026, profile=1, expected=200):
    return request(client, 'PUT', f'/api/organization/invoice-counter/{year}/start', profile,
                   {'start_number': number, 'confirm_external': True}, expected)


def invoice(client, month, number=None, profile=1, expected=201):
    return request(client, 'POST', '/api/invoices', profile,
                   {'year': 2025, 'month': month, 'invoice_date': '2026-11-01',
                    'invoice_number': number}, expected)


def test_start_11_preview_finalize_12_restart_and_restore(environment, tmp_path):
    client, database, documents = environment
    identifier = activity(client, 1)
    for month in (1, 2):
        add_training(client, 1, identifier, month)
    state = start(client)
    assert state['start_number'] == state['next_number'] == 11
    assert state['gaps'] == [] and state['automatic_allowed']
    for _ in range(2):
        preview = request(client, 'POST', '/api/invoices/preview', body={
            'year': 2025, 'month': 1, 'invoice_date': '2026-11-01'})
        assert preview['invoice_number'] == '2026-11'
        assert db.get_invoice_counter(2026, database)['next_number'] == 11
    first = invoice(client, 1, 'RE-2026-11')
    assert first['invoice_number'] == 'RE-2026-11'
    state = db.get_invoice_counter(2026, database)
    assert state['gaps'] == [] and state['invoice_number'] == '2026-12'
    assert not state['start_number_editable']
    db.initialize_database(database)
    assert invoice(client, 2)['invoice_number'] == '2026-12'
    assert not db.get_invoice_counter(2026, database)['automatic_allowed']
    backup = create_backup(database, documents, tmp_path / 'backup')
    restored = restore_backup(backup, tmp_path / 'restored', current_database=database,
        current_documents=documents, safety_directory=tmp_path / 'safety', confirmed=True)
    assert db.get_invoice_counter(2026, restored / 'ttc.db')['start_number'] == 11
    assert db.get_invoice(first['id'], restored / 'ttc.db') == db.get_invoice(first['id'], database)


def test_start_is_explicit_scoped_and_cannot_hide_existing_gaps(environment):
    client, database, _ = environment
    identifier = activity(client, 1)
    for month in (1, 2):
        add_training(client, 1, identifier, month)
    request(client, 'PUT', '/api/organization/invoice-counter/2026/start',
            body={'start_number': 11}, expected=422)
    request(client, 'PUT', '/api/organization/invoice-counter/2026/start',
            body={'start_number': 11, 'confirm_external': False}, expected=422)
    assert db.get_invoice_counter(2026, database)['next_number'] == 1
    start(client)
    assert db.get_invoice_counter(2027, database)['next_number'] == 1
    other = request(client, 'POST', '/api/profiles', body={'name': 'Other'}, expected=201)['id']
    assert request(client, 'GET', '/api/organization/invoice-counter/2026', other)['next_number'] == 1
    invoice(client, 1, '2026-10', expected=409)
    invoice(client, 1, '2026-12')
    assert db.get_invoice_counter(2026, database)['gaps'] == [11]
    start(client, 12, expected=422)
    invoice(client, 2, expected=409)


def test_deleted_start_still_needs_explicit_reuse(environment):
    client, database, _ = environment
    add_training(client, 1, activity(client, 1), 1)
    start(client)
    saved = invoice(client, 1)
    request(client, 'DELETE', f'/api/invoices/{saved["id"]}', expected=204)
    state = db.get_invoice_counter(2026, database)
    assert state['next_number'] == 11 and state['release_required'] and not state['start_number_editable']
    start(client, 12, expected=422)
    invoice(client, 1, '2026-11', expected=409)
    request(client, 'PUT', '/api/organization/invoice-counter/2026',
            body={'next_number': 11, 'confirm_reuse': True})
    assert invoice(client, 1)['invoice_number'] == '2026-11'
    assert db.get_invoice_counter(2026, database)['invoice_number'] == '2026-12'


@pytest.mark.parametrize('number', [0, 13, -1, 1.5, True, '11'])
def test_start_rejects_invalid_numbers(environment, number):
    client, database, _ = environment
    start(client, number, expected=422)
    assert db.get_invoice_counter(2026, database)['next_number'] == 1


def test_schema14_migration_preserves_existing_numbering(tmp_path, monkeypatch):
    path = tmp_path / 'schema14.db'
    migration = db._migrate_invoice_start_number
    monkeypatch.setattr(db, '_migrate_invoice_start_number', lambda connection: None)
    db.initialize_database(path)
    with sqlite3.connect(path) as connection:
        connection.execute("INSERT INTO invoices (organization_id, year, month, invoice_date, invoice_number, total_amount_cents) VALUES (1,2025,1,'2026-11-01','2026-11',100)")
        connection.execute('INSERT INTO invoice_counters VALUES (1,2026,12,12)')
    from backend.storage_import import validate_database
    with sqlite3.connect(path) as connection:
        validate_database(connection)
    before = db.get_invoice(1, path)
    monkeypatch.setattr(db, '_migrate_invoice_start_number', migration)
    db.initialize_database(path)
    assert db.get_invoice(1, path) == before
    state = db.get_invoice_counter(2026, path)
    assert state['start_number'] == 1 and state['gaps'] == list(range(1, 11))
    assert not state['automatic_allowed']
    db.initialize_database(path)
    assert db.get_invoice_counter(2026, path) == state
    assert list(tmp_path.glob('*.before-migration-*.sqlite3'))
