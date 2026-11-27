"""Synthetic pre-signature schema (v12, shipped in 0.2.3) upgrade lifecycle."""
import sqlite3
from backend import database as db
from test_profiles import environment, request, activity, training
from test_signatures import png, page_streams
import base64


def test_v12_upgrade_release_and_import_preserve_history(environment):
    client, database, documents = environment
    identifier = activity(client, 1)
    training(client, 1, identifier)
    payload = {'year': 2025, 'month': 1, 'invoice_date': '2025-01-31', 'render_pdf': True}
    historical = request(client, 'POST', '/api/invoices', body=payload, expected=201)
    original = (documents / historical['pdf_path']).read_bytes()
    with sqlite3.connect(database) as connection:
        for (name,) in connection.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'archive_%'").fetchall():
            connection.execute(f'DROP TRIGGER "{name}"')
        connection.execute('ALTER TABLE organizations DROP COLUMN signature_json')
        connection.execute('ALTER TABLE organizations DROP COLUMN is_archived')
        connection.execute('DELETE FROM schema_migrations WHERE version >= 13')
    db.initialize_database(database)
    assert (documents / historical['pdf_path']).read_bytes() == original
    assert db.get_invoice(historical['id'], database)['invoice_number'] == '2025-01'
    request(client, 'POST', '/api/organization/signature', body={'data_base64': png()})
    layout = {'enabled': True, 'x_mm': 60, 'y_mm': 230, 'width_mm': 45}
    request(client, 'PUT', '/api/organization/signature', body=layout)
    assert (documents / historical['pdf_path']).read_bytes() == original
    request(client, 'DELETE', f'/api/invoices/{historical["id"]}', expected=204)
    request(client, 'PUT', '/api/organization/invoice-counter/2025', body={'next_number': 1, 'confirm_reuse': True})
    db.initialize_database(database)
    assert db.get_invoice_counter(2025, database)['automatic_allowed']
    assert db.get_invoice_counter(2026, database)['next_number'] == 1
    signature = request(client, 'GET', '/api/organization/signature')
    assert all(signature[k] == v for k, v in layout.items())
    preview = request(client, 'POST', '/api/invoices/preview', body=payload)
    invoice = request(client, 'POST', '/api/invoices', body=payload, expected=201)
    assert invoice['invoice_number'] == '2025-01'
    assert page_streams(base64.b64decode(preview['pdf_base64'])) == page_streams((documents / invoice['pdf_path']).read_bytes())
