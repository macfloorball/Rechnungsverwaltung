"""Optional recipient contacts: migrations, snapshots, profiles and backups."""
import json
import sqlite3

import pytest
from test_profiles import environment, request, activity
from test_invoice_numbering import add_training
from backend import database as db
from backend.backup_service import create_backup
from backend.backup_restore import restore_backup


@pytest.mark.parametrize('salutation,name,line', [
    ('Herr', 'Max Mustermann', 'Herr Max Mustermann'),
    ('Frau', 'Erika Musterfrau', 'Frau Erika Musterfrau'),
    ('', 'Max Mustermann', 'Max Mustermann'), ('', '', None),
])
def test_contact_snapshot_pdf_and_restore(environment, tmp_path, monkeypatch, salutation, name, line):
    client, database, documents = environment
    import backend.main as api
    original = api.render_invoice_pdf
    rendered = []
    def capture(*args):
        rendered.append(args[-1].contact.recipient_lines)
        return original(*args)
    monkeypatch.setattr(api, 'render_invoice_pdf', capture)
    request(client, 'PUT', '/api/organization/settings', body={
        'recipient_name': 'Firma', 'recipient_street': 'Straße 1',
        'recipient_salutation': salutation, 'recipient_contact_name': name})
    identifier = activity(client, 1)
    add_training(client, 1, identifier, 1)
    invoice = request(client, 'POST', '/api/invoices', body={
        'year': 2025, 'month': 1, 'invoice_date': '2027-01-01'}, expected=201)
    assert rendered == [('Firma', *([line] if line else []), 'Straße 1')]
    before = db.get_invoice(invoice['id'], database)
    snapshot = json.loads(before['invoice_snapshot_json'])
    assert snapshot['recipient_contact_name'] == name
    assert snapshot['recipient_salutation'] == salutation
    assert snapshot['invoice_date'] == '2027-01-01'
    pdf = request(client, 'GET', f'/api/invoices/{invoice["id"]}/pdf')
    request(client, 'PUT', '/api/organization/settings', body={'recipient_contact_name': 'Changed'})
    assert db.get_invoice(invoice['id'], database) == before
    assert request(client, 'GET', f'/api/invoices/{invoice["id"]}/pdf') == pdf
    second = request(client, 'POST', '/api/profiles', body={'name': 'Other'}, expected=201)['id']
    assert request(client, 'GET', '/api/organization/settings', second)['recipient_contact_name'] == ''
    archive = create_backup(database, documents, tmp_path / 'backups')
    restored = restore_backup(archive, tmp_path / 'restored', current_database=database,
        current_documents=documents, safety_directory=tmp_path / 'safety', confirmed=True)
    assert db.get_invoice(invoice['id'], restored / 'ttc.db') == before
    assert (restored / 'documents' / invoice['pdf_path']).read_bytes() == pdf
    assert db.get_organization(restored / 'ttc.db')['recipient_contact_name'] == 'Changed'


def test_contact_migration_preserves_existing_data(environment):
    _, database, _ = environment
    invoice_id = db.create_invoice_with_items({'year': 2025, 'month': 1,
        'invoice_date': '2026-01-02', 'invoice_number': 'RE-2026-0041',
        'invoice_snapshot_json': '{"recipient_name":"Legacy"}', 'total_amount_cents': 0}, [], database)
    before = db.get_invoice(invoice_id, database)
    with sqlite3.connect(database) as connection:
        connection.execute('DELETE FROM schema_migrations WHERE version = 10')
        connection.execute('ALTER TABLE organizations DROP COLUMN recipient_salutation')
        connection.execute('ALTER TABLE organizations DROP COLUMN recipient_contact_name')
    db.initialize_database(database)
    db.initialize_database(database)
    assert db.get_invoice(invoice_id, database) == before
    assert db.get_organization(database)['recipient_contact_name'] == ''
    assert db.get_organization(database)['recipient_salutation'] == ''
