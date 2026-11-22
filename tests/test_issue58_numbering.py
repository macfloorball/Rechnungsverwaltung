"""Issue 58: isolated complete numbering and correction lifecycle."""
import hashlib
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest

from test_profiles import environment, request, activity
from test_invoice_numbering import add_training
from backend import database as db
from backend.backup_service import create_backup
from backend.backup_restore import restore_backup


def create(client, month, number=None, profile=1, when='2026-01-02', expected=201):
    return request(client, 'POST', '/api/invoices', profile, {
        'year': 2025, 'month': month, 'invoice_date': when, 'invoice_number': number}, expected)


def correction(client, invoice, number, profile=1, expected=200):
    return request(client, 'PUT', f'/api/invoices/{invoice["id"]}/number', profile, {
        'invoice_number': number, 'expected_invoice_number': invoice['invoice_number'], 'confirmed': True}, expected)


def test_gap_correction_snapshot_pdf_and_restore(environment, tmp_path):
    client, database, documents = environment
    identifier = activity(client, 1)
    request(client, 'PUT', '/api/organization/settings', body={
        'name': 'Historischer Absender', 'recipient_name': 'Historischer Empfänger',
        'invoice_number_prefix': 'TTC', 'invoice_text': 'Historischer Rechnungstext'})
    for month in range(1, 5):
        add_training(client, 1, identifier, month)
    first = create(client, 1)
    second = create(client, 2, 'TTC-2026-02')
    fourth = create(client, 3, '2026-04')
    originals = {invoice['id']: db.get_invoice(invoice['id'], database) for invoice in (first, second, fourth)}
    other_pdfs = {invoice['pdf_path']: (documents / invoice['pdf_path']).read_bytes() for invoice in (first, second)}
    old_pdf = (documents / fourth['pdf_path']).read_bytes()
    archive = create_backup(database, documents, tmp_path / 'external')
    archive_bytes = archive.read_bytes()
    state = db.get_invoice_counter(2026, database)
    assert state['gaps'] == [3] and not state['automatic_allowed']
    create(client, 4, expected=409)
    request(client, 'PUT', '/api/organization/settings', body={'name': 'Heutiger Absender', 'invoice_text': 'Heutiger Text'})
    correction(client, fourth, '2026-02', expected=422)
    assert (documents / fourth['pdf_path']).read_bytes() == old_pdf
    result = correction(client, fourth, '2026-03')
    saved = db.get_invoice(fourth['id'], database)
    assert saved['invoice_number'] == '2026-03'
    assert saved['invoice_date'] == fourth['invoice_date']
    assert saved['items'] == originals[fourth['id']]['items']
    old_snapshot = json.loads(originals[fourth['id']]['invoice_snapshot_json'])
    assert json.loads(saved['invoice_snapshot_json']) == old_snapshot | {'invoice_number': '2026-03'}
    assert not (documents / fourth['pdf_path']).exists()
    pdf = request(client, 'GET', f'/api/invoices/{fourth["id"]}/pdf')
    import base64
    import re
    import zlib
    streams = re.findall(rb"stream\r?\n(.*?)endstream", pdf, re.S)
    text = "".join(zlib.decompress(base64.a85decode(stream.strip(), adobe=True)).decode('latin-1') for stream in streams)
    assert '2026-03' in text and '2026-04' not in text
    assert 'Historischer Absender' in text and 'Heutiger Absender' not in text
    assert archive.read_bytes() == archive_bytes
    assert all((documents / name).read_bytes() == content for name, content in other_pdfs.items())
    assert result['numbering']['invoice_number'] == '2026-04'
    assert create(client, 4)['invoice_number'] == '2026-04'
    # Corrected filenames remain owned and portable through backup/restore.
    revised_backup = create_backup(database, documents, tmp_path / 'revised-backups')
    restored = restore_backup(revised_backup, tmp_path / 'restored', current_database=database,
        current_documents=documents, safety_directory=tmp_path / 'safety', confirmed=True)
    assert db.get_invoice(fourth['id'], restored / 'ttc.db') == saved
    assert (restored / 'documents' / saved['pdf_path']).read_bytes() == pdf
    db.initialize_database(restored / 'ttc.db')


def test_manual_format_duplicates_profiles_years_and_limit(environment):
    client, database, _ = environment
    a = activity(client, 1)
    for month in range(1, 13):
        add_training(client, 1, a, month)
    for invalid in ('2026-00', '2026-13', '2025-01', '2026-1', '2026-001', '../2026-01', 'OTHER-2026-01', 'arbitrary'):
        create(client, 1, invalid, expected=409)
    assert create(client, 1, ' RE-2026-01 ')['invoice_number'] == 'RE-2026-01'
    create(client, 2, '2026-01', expected=409)
    for month in range(2, 13):
        assert create(client, month)['invoice_number'] == f'2026-{month:02d}'
    state = db.get_invoice_counter(2026, database)
    assert state['next_number'] == 13 and not state['automatic_allowed']
    preview = request(client, 'POST', '/api/invoices/preview', body={'year': 2024, 'month': 1, 'invoice_date': '2026-12-31'})
    assert preview['invoice_number'] is None and 'zwölf' in preview['numbering']['message']
    b = request(client, 'POST', '/api/profiles', body={'name': 'Other'}, expected=201)['id']
    add_training(client, b, activity(client, b), 1)
    assert create(client, 1, profile=b)['invoice_number'] == '2026-01'
    assert db.get_invoice_counter(2027, database)['invoice_number'] == '2027-01'


def test_deleted_tail_requires_explicit_release_even_for_manual(environment):
    client, database, _ = environment
    a = activity(client, 1)
    add_training(client, 1, a, 1)
    invoice = create(client, 1)
    request(client, 'DELETE', f'/api/invoices/{invoice["id"]}', expected=204)
    assert db.get_invoice_counter(2026, database)['release_required']
    create(client, 1, expected=409)
    create(client, 1, '2026-01', expected=409)
    request(client, 'PUT', '/api/organization/invoice-counter/2026', body={'next_number': 1}, expected=422)
    request(client, 'PUT', '/api/organization/invoice-counter/2026', body={'next_number': 1, 'confirm_reuse': True})
    assert create(client, 1)['invoice_number'] == '2026-01'


def test_deleted_middle_stays_gap_until_explicit_correction(environment):
    client, database, _ = environment
    a = activity(client, 1)
    for month in range(1, 5):
        add_training(client, 1, a, month)
    one, two, three = [create(client, month) for month in (1, 2, 3)]
    request(client, 'DELETE', f'/api/invoices/{two["id"]}', expected=204)
    assert db.get_invoice_counter(2026, database)['gaps'] == [2]
    create(client, 4, expected=409)
    correction(client, three, '2026-02')
    assert db.get_invoice_counter(2026, database)['invoice_number'] == '2026-03'
    assert create(client, 4)['invoice_number'] == '2026-03'


def test_parallel_finalization_and_correction(environment):
    client, database, documents = environment
    a = activity(client, 1)
    for month in (1, 2, 3):
        add_training(client, 1, a, month)
    with ThreadPoolExecutor(2) as pool:
        responses = list(pool.map(lambda month: client.post('/api/invoices', json={
            'year': 2025, 'month': month, 'invoice_date': '2026-01-01'}), (1, 2)))
    assert all(response.status_code in (201, 409) for response in responses)
    invoices = [response.json() for response in responses if response.status_code == 201]
    assert invoices and len({invoice['invoice_number'] for invoice in invoices}) == len(invoices)
    third = create(client, 3, '2026-04')
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: client.put(f'/api/invoices/{third["id"]}/number', json={
            'invoice_number': '2026-03', 'expected_invoice_number': '2026-04', 'confirmed': True}), range(2)))
    assert sorted(response.status_code for response in results) == [200, 409]
    saved = db.get_invoice(third['id'], database)
    assert (documents / saved['pdf_path']).is_file()
    assert len(list(documents.glob('*revision*.pdf'))) == 1


def test_legacy_invalid_duplicate_detection_and_no_silent_changes(environment):
    client, database, _ = environment
    with db.get_connection(database) as connection:
        for month, number in ((1, '2026-01'), (2, 'RE-2026-01'), (3, '2026-42')):
            connection.execute("INSERT INTO invoices(year,month,invoice_date,invoice_number,total_amount_cents) VALUES (2025,?,'2026-01-01',?,0)", (month, number))
    before = db.list_records('invoices', database_path=database)
    state = db.get_invoice_counter(2026, database)
    assert any('Doppelte' in issue for issue in state['issues'])
    assert any('Ungültige' in issue for issue in state['issues'])
    db.initialize_database(database)
    assert db.list_records('invoices', database_path=database) == before
    for row in before:
        correction(client, row, '2026-02', expected=409)


@pytest.mark.parametrize('failure', ['render', 'publish', 'database'])
def test_correction_failure_keeps_original_snapshot_and_pdf(environment, monkeypatch, failure):
    import backend.main as api
    from backend.document_storage import DocumentStore
    client, database, documents = environment
    add_training(client, 1, activity(client, 1), 1)
    invoice = create(client, 1, '2026-04')
    before = db.get_invoice(invoice['id'], database)
    pdf = (documents / invoice['pdf_path']).read_bytes()
    if failure == 'render':
        def fail(*args, **kwargs):
            raise RuntimeError('injected render error')
        monkeypatch.setattr(api, 'render_invoice_pdf', fail)
        with pytest.raises(RuntimeError, match='injected'):
            correction(client, invoice, '2026-01')
    elif failure == 'publish':
        def fail(*args, **kwargs):
            raise PermissionError('injected publication error')
        monkeypatch.setattr(DocumentStore, 'save_new_with_identity', fail)
        correction(client, invoice, '2026-01', expected=503)
    else:
        with sqlite3.connect(database) as connection:
            connection.execute("CREATE TRIGGER fail_number_update BEFORE UPDATE OF invoice_number ON invoices BEGIN SELECT RAISE(ABORT, 'injected'); END")
        correction(client, invoice, '2026-01', expected=409)
    assert db.get_invoice(invoice['id'], database) == before
    assert (documents / invoice['pdf_path']).read_bytes() == pdf
    assert not list(documents.glob('*revision*.pdf'))


def test_corrected_documents_isolate_profiles_and_support_profile_deletion(environment, tmp_path):
    client, database, documents = environment
    second = request(client, 'POST', '/api/profiles', body={'name': 'B'}, expected=201)['id']
    invoices = []
    for profile in (1, second):
        add_training(client, profile, activity(client, profile), 1)
        invoices.append(create(client, 1, '2026-04', profile))
    before = (documents / invoices[0]['pdf_path']).read_bytes()
    correction(client, invoices[0], '2026-01', second, expected=404)
    changed = correction(client, invoices[1], '2026-01', second)
    # Repeated correction uses the revised reference, never the original basename.
    changed_again = correction(client, invoices[1] | changed, '2026-02', second)
    assert not (documents / changed['pdf_path']).exists()
    assert (documents / invoices[0]['pdf_path']).read_bytes() == before
    archive = create_backup(database, documents, tmp_path / 'backups')
    restored = restore_backup(archive, tmp_path / 'restored', current_database=database,
        current_documents=documents, safety_directory=tmp_path / 'safety', confirmed=True)
    assert (restored / 'documents' / changed_again['pdf_path']).exists()
    summary = request(client, 'GET', f'/api/profiles/{second}/deletion')
    request(client, 'DELETE', f'/api/profiles/{second}', body=summary)
    assert not (documents / changed_again['pdf_path']).exists()
    assert (documents / invoices[0]['pdf_path']).read_bytes() == before


def test_correction_confirmation_stale_number_and_missing_original(environment):
    client, database, documents = environment
    add_training(client, 1, activity(client, 1), 1)
    invoice = create(client, 1, '2026-04')
    request(client, 'PUT', f'/api/invoices/{invoice["id"]}/number', body={
        'invoice_number': '2026-01', 'expected_invoice_number': '2026-04', 'confirmed': False}, expected=422)
    correction(client, invoice | {'invoice_number': 'stale'}, '2026-01', expected=409)
    (documents / invoice['pdf_path']).unlink()
    result = correction(client, invoice, '2026-01')
    assert (documents / result['pdf_path']).is_file()
    assert request(client, 'GET', f'/api/invoices/{invoice["id"]}/pdf').startswith(b'%PDF')


def test_deleted_number_release_state_survives_backup_and_restore(environment, tmp_path):
    client, database, documents = environment
    add_training(client, 1, activity(client, 1), 1)
    invoice = create(client, 1)
    request(client, 'DELETE', f'/api/invoices/{invoice["id"]}', expected=204)
    state = db.get_invoice_counter(2026, database)
    archive = create_backup(database, documents, tmp_path / 'backups')
    restored = restore_backup(archive, tmp_path / 'restored', current_database=database,
        current_documents=documents, safety_directory=tmp_path / 'safety', confirmed=True)
    assert db.get_invoice_counter(2026, restored / 'ttc.db') == state
    assert state['retired_numbers'] == [1] and state['release_required']
    from backend.data_export import create_export
    import zipfile
    with zipfile.ZipFile(create_export(database, documents, tmp_path / 'export')) as output:
        assert '1;2026;1' in output.read('csv/invoice_number_retired.csv').decode('utf-8-sig')
