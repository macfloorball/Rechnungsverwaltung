"""Issue 37: deterministic dates, real SQLite transactions and saved documents."""
import hashlib
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest

from test_profiles import environment, request, activity
from backend import database as db
from backend.backup_service import create_backup
from backend.backup_restore import restore_backup
from backend.models import OrganizationSettingsUpdate


def add_training(client, profile, identifier, month):
    request(client, 'POST', '/api/trainings', profile, {
        'training_date': f'2025-{month:02d}-02', 'activity_type_id': identifier,
        'hours': 1, 'status': 'completed'}, 201)


def test_dates_preview_years_manual_profiles_and_deletion(environment):
    client, database, _ = environment
    identifier = activity(client, 1)
    for month in range(1, 6):
        add_training(client, 1, identifier, month)
    period = {'year': 2025, 'month': 1, 'invoice_date': '2026-01-02'}
    for _ in range(3):
        assert request(client, 'POST', '/api/invoices/preview', body=period)['invoice_number'] == '2026-01'
    first = request(client, 'POST', '/api/invoices', body=period, expected=201)
    assert first['invoice_date'] == '2026-01-02'
    assert first['invoice_number'] == '2026-01'
    request(client, 'DELETE', f'/api/invoices/{first["id"]}', expected=204)
    request(client, 'PUT', '/api/organization/invoice-counter/2026', body={'next_number': 1}, expected=422)
    request(client, 'PUT', '/api/organization/invoice-counter/2026', body={'next_number': 100}, expected=422)
    request(client, 'PUT', '/api/organization/invoice-counter/2026', body={'next_number': 1, 'confirm_reuse': True})
    replacement = request(client, 'POST', '/api/invoices', body=period, expected=201)
    assert replacement['invoice_number'] == '2026-01'
    for value in (0, -1, 1.5, True, '3'):
        request(client, 'PUT', '/api/organization/invoice-counter/2026', body={'next_number': value}, expected=422)
    for month, when, number in ((2, '2027-01-01', '2027-01'), (3, '2026-12-31', '2026-02'), (4, '2024-01-01', '2024-01')):
        invoice = request(client, 'POST', '/api/invoices', body={'year': 2025, 'month': month, 'invoice_date': when}, expected=201)
        assert invoice['invoice_number'] == number
    second = request(client, 'POST', '/api/profiles', body={'name': 'Second'}, expected=201)['id']
    assert request(client, 'GET', '/api/organization/invoice-counter/2026', second)['next_number'] == 1
    assert request(client, 'GET', '/api/organization/invoice-counter/2026')['next_number'] == 3
    db.initialize_database(database)
    assert db.get_invoice_counter(2026, database)['next_number'] == 3


def test_concurrent_different_months_and_rollback(environment):
    _, database, _ = environment
    def finalize(month):
        try:
            return db.create_invoice_with_items({'year': 2025, 'month': month,
                'invoice_date': '2026-01-02', 'invoice_number': '2026-01',
                'total_amount_cents': 0}, [], database, expected_next_invoice_number=1)
        except ValueError:
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(finalize, (1, 2)))
    assert sum(result is not None for result in results) == 1
    assert db.get_invoice_counter(2026, database)['next_number'] == 2
    with pytest.raises(sqlite3.IntegrityError):
        db.create_invoice_with_items({'year': 2025, 'month': 3, 'invoice_date': '2026-01-02',
            'invoice_number': '2026-02', 'total_amount_cents': 0},
            [{'training_id': 99999, 'description': 'Invalid', 'training_date': '2025-03-01',
              'hours': 1, 'unit_rate_cents': 1, 'amount_cents': 1}], database,
            expected_next_invoice_number=2)
    assert db.get_invoice_counter(2026, database)['next_number'] == 2


def test_tax_iban_snapshot_pdf_backup_and_export(environment, tmp_path, monkeypatch):
    client, database, documents = environment
    request(client, 'PUT', '/api/organization/settings', body={
        'tax_id': '  Separate <ID>  ', 'tax_number': 'Tax number', 'vat_id': 'VAT',
        'iban': 'GB82 WEST 1234 5698 7654 32', 'account_holder': 'Account',
        'bank_name': 'Bank', 'payment_notice': 'Freier Zahlungshinweis'})
    identifier = activity(client, 1)
    add_training(client, 1, identifier, 1)
    import backend.main as api
    rendered = []
    original_render = api.render_invoice_pdf
    def capture(*args):
        rendered.append(args[-1])
        return original_render(*args)
    monkeypatch.setattr(api, 'render_invoice_pdf', capture)
    invoice = request(client, 'POST', '/api/invoices', body={'year': 2025, 'month': 1, 'invoice_date': '2026-01-01'}, expected=201)
    pdf = request(client, 'GET', f'/api/invoices/{invoice["id"]}/pdf')
    assert pdf.startswith(b'%PDF')
    assert 'Steuer ID: Separate <ID>' in rendered[0].contact.tax_lines
    assert rendered[0].footer.iban == 'GB82WEST12345698765432'
    assert rendered[0].footer.due_date is None
    assert rendered[0].footer.payment_notice == 'Freier Zahlungshinweis'
    snapshot = db.get_invoice(invoice['id'], database)['invoice_snapshot_json']
    assert json.loads(snapshot)['tax_id'] == 'Separate <ID>'
    assert 'payment_due_days' not in json.loads(snapshot)
    request(client, 'PUT', '/api/organization/settings', body={'tax_id': 'Changed'})
    assert db.get_invoice(invoice['id'], database)['invoice_snapshot_json'] == snapshot
    assert request(client, 'GET', f'/api/invoices/{invoice["id"]}/pdf') == pdf
    second = request(client, 'POST', '/api/profiles', body={'name': 'Other'}, expected=201)['id']
    assert request(client, 'GET', '/api/organization/settings', second)['tax_id'] is None
    archive = create_backup(database, documents, tmp_path / 'backups')
    restored = restore_backup(archive, tmp_path / 'restored', current_database=database,
        current_documents=documents, safety_directory=tmp_path / 'safety', confirmed=True)
    assert db.get_invoice_counter(2026, restored / 'ttc.db')['next_number'] == 2
    assert hashlib.sha256((restored / 'documents' / invoice['pdf_path']).read_bytes()).digest() == hashlib.sha256(pdf).digest()
    from backend.data_export import create_export
    import zipfile
    with zipfile.ZipFile(create_export(database, documents, tmp_path / 'export')) as export:
        assert '2026;2;2' in export.read('csv/invoice_counters.csv').decode('utf-8-sig')


@pytest.mark.parametrize('iban', ['DE89 3704 0044 0532 0130 00', 'GB82 WEST 1234 5698 7654 32', 'NO93 8601 1117 947', 'MT84 MALT 0110 0001 2345 MTLC AST0 01S'])
def test_international_iban_normalizes_before_length_validation(iban):
    assert OrganizationSettingsUpdate(iban=iban).iban == iban.replace(' ', '')
    with pytest.raises(ValueError):
        OrganizationSettingsUpdate(tax_id='x' * 101)


def test_migration_is_idempotent_and_preserves_legacy(environment):
    _, database, _ = environment
    original = db.create_invoice_with_items({'year': 2025, 'month': 1,
        'invoice_date': '2026-01-02', 'invoice_number': 'RE-11-2025-0041',
        'invoice_snapshot_json': '{"tax_number":"Old"}', 'total_amount_cents': 0}, [], database)
    before = db.get_invoice(original, database)
    with sqlite3.connect(database) as connection:
        connection.execute('DROP TABLE invoice_number_retired')
        connection.execute('DROP TABLE profile_identifiers')
        connection.execute('DELETE FROM schema_migrations WHERE version >= 9')
        connection.execute('ALTER TABLE organizations DROP COLUMN recipient_salutation')
        connection.execute('ALTER TABLE organizations DROP COLUMN recipient_contact_name')
        connection.execute('DROP TABLE invoice_counters')
        connection.execute('DROP TABLE invoice_number_legacy_floors')
        connection.execute('ALTER TABLE organizations DROP COLUMN tax_id')
        connection.execute('UPDATE organizations SET next_invoice_number = 43')
    db.initialize_database(database)
    assert not db.get_invoice_counter(2026, database)['automatic_allowed']
    assert db.get_invoice_counter(2027, database)['next_number'] == 1
    db.initialize_database(database)
    assert db.get_invoice(original, database) == before
    assert not db.get_invoice_counter(2026, database)['automatic_allowed']


def test_manual_counter_rejects_imported_number_collision(environment):
    client, database, _ = environment
    db.create_invoice_with_items({'year': 2025, 'month': 1,
        'invoice_date': '2026-01-02', 'invoice_number': '2026-42',
        'total_amount_cents': 0}, [], database)
    request(client, 'PUT', '/api/organization/invoice-counter/2026', body={'next_number': 42}, expected=422)
    assert not request(client, 'GET', '/api/organization/invoice-counter/2026')['automatic_allowed']


@pytest.mark.parametrize('iban', [None, 123, [], {}])
def test_iban_invalid_types_return_validation_errors(environment, iban):
    client, _, _ = environment
    request(client, 'PUT', '/api/organization/settings', body={'iban': iban}, expected=422)


def test_skipped_months_do_not_consume_numbers(environment):
    client, database, _ = environment
    identifier = activity(client, 1)
    for month, expected in ((1, '2026-01'), (3, '2026-02')):
        add_training(client, 1, identifier, month)
        invoice = request(client, 'POST', '/api/invoices', body={
            'year': 2025, 'month': month, 'invoice_date': '2026-01-02'}, expected=201)
        assert invoice['invoice_number'] == expected
    assert db.get_invoice_counter(2026, database)['next_number'] == 3
