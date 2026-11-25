"""Only generated synthetic strokes; no personal signatures."""
import base64
from io import BytesIO
import json

from PIL import Image, ImageDraw
import pytest
from test_profiles import environment, request, activity, training
from backend.signatures import decode_png, geometry


def png():
    image = Image.new('RGBA', (400, 100))
    ImageDraw.Draw(image).line([(10, 70), (80, 20), (140, 80), (380, 30)], fill='black', width=4)
    output = BytesIO()
    image.save(output, format='PNG')
    return base64.b64encode(output.getvalue()).decode()


def test_local_import_isolation_and_validation(environment):
    client, database, _ = environment
    second = request(client, 'POST', '/api/profiles', body={'name': 'Synthetisches Profil'}, expected=201)['id']
    signature = request(client, 'POST', '/api/organization/signature', body={'data_base64': png()})
    data, width, height = decode_png(signature['data_base64'])
    assert (width, height) == (400, 100)
    assert Image.open(BytesIO(data)).mode == 'RGBA'
    assert request(client, 'GET', '/api/organization/signature', second) is None
    for bad in ['oops', base64.b64encode(b'not a png').decode()]:
        request(client, 'POST', '/api/organization/signature', body={'data_base64': bad}, expected=422)
    request(client, 'PUT', '/api/organization/signature', body={'x_mm': 200}, expected=422)
    request(client, 'PUT', '/api/organization/signature', body={'enabled': False})
    assert not request(client, 'GET', '/api/organization/signature')['enabled']
    request(client, 'DELETE', '/api/organization/signature')
    assert request(client, 'GET', '/api/organization/signature') is None


def test_invoice_snapshot_preview_and_last_page(environment):
    from backend.database import get_invoice, get_connection
    from backend.invoice_generator import render_invoice_pdf, InvoiceDetails, InvoiceLine
    from datetime import date
    from decimal import Decimal
    client, database, documents = environment
    request(client, 'POST', '/api/organization/signature', body={'data_base64': png()})
    identifier = activity(client, 1)
    training(client, 1, identifier)
    payload = {'render_pdf': True, 'year': 2025, 'month': 1, 'invoice_date': '2025-01-31', 'signature': {'enabled': True, 'x_mm': 35, 'y_mm': 260, 'width_mm': 40}}
    preview = request(client, 'POST', '/api/invoices/preview', body=payload)
    assert preview['signature']['x_mm'] == 35
    assert preview['layout'] == {'pages': 1, 'collision': False}
    invoice = request(client, 'POST', '/api/invoices', body=payload, expected=201)
    stored = get_invoice(invoice['id'], database)
    snapshot = json.loads(stored['invoice_snapshot_json'])
    assert json.loads(snapshot['signature_json']) == preview['signature']
    original = (documents / stored['pdf_path']).read_bytes()
    request(client, 'DELETE', '/api/organization/signature')
    assert (documents / stored['pdf_path']).read_bytes() == original
    corrected = request(client, 'PUT', f"/api/invoices/{invoice['id']}/number", body={
        'invoice_number': '2025-02', 'expected_invoice_number': invoice['invoice_number'], 'confirmed': True})
    assert json.loads(json.loads(get_invoice(invoice['id'], database)['invoice_snapshot_json'])['signature_json']) == preview['signature']
    assert b'/Subtype /Image' in (documents / corrected['pdf_path']).read_bytes()
    layout = {}
    content = render_invoice_pdf(2025, 1, date(2025, 1, 31),
        [InvoiceLine('Synthetischer Test', date(2025, 1, 2), Decimal(1), 100)] * 160,
        16000, InvoiceDetails(signature=preview['signature']), layout)
    assert layout['pages'] > 1
    assert content.startswith(b'%PDF')


def page_streams(pdf):
    """Read ReportLab page content only, excluding timestamps and document IDs."""
    import re, zlib
    objects = {int(n): body for n, body in re.findall(rb'(?:^|\n)(\d+) 0 obj\n(.*?)\nendobj', pdf, re.S)}
    streams = []
    for body in objects.values():
        if not re.search(rb'/Type /Page\b', body):
            continue
        reference = int(re.search(rb'/Contents (\d+) 0 R', body)[1])
        stream_object = objects[reference]
        stream = re.search(rb'stream\r?\n(.*?)endstream', stream_object, re.S)[1].strip()
        if b'/ASCII85Decode' in stream_object:
            stream = base64.a85decode(stream, adobe=True)
        if b'/FlateDecode' in stream_object:
            stream = zlib.decompress(stream)
        streams.append(stream)
    return streams


def test_pdf_parity_transparency_and_dynamic_last_page(environment):
    from backend.invoice_generator import render_invoice_pdf, InvoiceDetails, InvoiceLine
    from datetime import date
    from decimal import Decimal
    client, database, documents = environment
    from backend.database import update_organization
    update_organization({'issuer_first_name': 'Test', 'issuer_last_name': 'Beispiel'}, database)
    signature = request(client, 'POST', '/api/organization/signature', body={'data_base64': png()})
    signature['name'] = 'Test Beispiel'
    for count in (1, 45, 160, 2):
        layout = {}
        pdf = render_invoice_pdf(2025, 1, date(2025, 1, 31),
            [InvoiceLine('Synthetisch', date(2025, 1, 2), Decimal(1), 100)] * count,
            count * 100, InvoiceDetails(signature=signature), layout)
        pages = page_streams(pdf)
        assert len(pages) == layout['pages']
        assert sum(b'Test Beispiel' in page for page in pages) == 1
        assert b'Test Beispiel' in pages[-1]
        assert b'/SMask' in pdf
        assert b'Do' in pages[-1]
        assert all(b'Do' not in page for page in pages[:-1])
    identifier = activity(client, 1)
    training(client, 1, identifier)
    payload = {'year': 2025, 'month': 1, 'invoice_date': '2025-01-31', 'render_pdf': True}
    preview = request(client, 'POST', '/api/invoices/preview', body=payload)
    invoice = request(client, 'POST', '/api/invoices', body=payload, expected=201)
    pdf = request(client, 'GET', f"/api/invoices/{invoice['id']}/pdf")
    assert page_streams(base64.b64decode(preview['pdf_base64'])) == page_streams(pdf)
    before = request(client, 'GET', '/api/organization/signature')
    layout = {'enabled': False, 'x_mm': 40, 'y_mm': 250, 'width_mm': 60}
    revision = request(client, 'PUT', f"/api/invoices/{invoice['id']}/signature", body={**layout, 'expected_pdf_path': invoice['pdf_path']})
    saved = request(client, 'GET', f"/api/invoices/{invoice['id']}/signature")
    assert all(saved['signature'][key] == value for key, value in layout.items())
    assert request(client, 'GET', '/api/organization/signature') == before
    request(client, 'PUT', f"/api/invoices/{invoice['id']}/signature", body={**layout, 'expected_pdf_path': invoice['pdf_path']}, expected=409)
    disabled_pdf = request(client, 'GET', f"/api/invoices/{invoice['id']}/pdf")
    assert all(b'Do' not in page for page in page_streams(disabled_pdf))


def test_backup_restart_profile_defaults_and_collision(environment, tmp_path):
    from backend.database import initialize_database, get_invoice
    from backend.backup_service import create_backup
    from backend.backup_restore import restore_backup
    client, database, documents = environment
    signature = request(client, 'POST', '/api/organization/signature', body={'data_base64': png()})
    identifier = activity(client, 1)
    training(client, 1, identifier)
    payload = {'year': 2025, 'month': 1, 'invoice_date': '2025-01-31', 'render_pdf': True,
               'signature': {'x_mm': 25, 'y_mm': 85, 'width_mm': 50, 'enabled': True}}
    preview = request(client, 'POST', '/api/invoices/preview', body=payload)
    assert preview['layout']['collision']
    assert request(client, 'GET', '/api/organization/signature') == signature
    request(client, 'PUT', '/api/organization/signature', body=payload['signature'])
    invoice = request(client, 'POST', '/api/invoices', body=payload, expected=201)
    initialize_database(database)
    assert request(client, 'GET', '/api/organization/signature')['y_mm'] == 85
    backup = create_backup(database, documents, tmp_path / 'backups')
    restored = tmp_path / 'restored'
    restore_backup(backup, restored, current_database=database, current_documents=documents, safety_directory=tmp_path / 'safety', confirmed=True)
    # Complete backup preserves both the profile and independent invoice image.
    from backend.database import get_organization
    assert json.loads(get_organization(restored / 'ttc.db')['signature_json'])['y_mm'] == 85
    assert get_invoice(invoice['id'], restored / 'ttc.db')['invoice_snapshot_json'] == get_invoice(invoice['id'], database)['invoice_snapshot_json']


def test_long_footer_and_corrupt_png(environment):
    from backend.invoice_generator import render_invoice_pdf, InvoiceDetails, InvoiceFooterDetails
    from datetime import date
    client, _, _ = environment
    signature = request(client, 'POST', '/api/organization/signature', body={'data_base64': png()})
    signature['name'] = 'Test Beispiel'
    layout = {}
    pdf = render_invoice_pdf(2025, 1, date(2025, 1, 31), [], 0,
        InvoiceDetails(signature=signature, footer=InvoiceFooterDetails(invoice_footer='Synthetische Zeile\n' * 100)), layout)
    pages = page_streams(pdf)
    assert len(pages) > 2
    assert sum(b'Test Beispiel' in page for page in pages) == 1
    assert b'Test Beispiel' in pages[-1]
    damaged = bytearray(base64.b64decode(png()))
    damaged[45] ^= 127
    request(client, 'POST', '/api/organization/signature', body={'data_base64': base64.b64encode(damaged).decode()}, expected=422)
    assert request(client, 'GET', '/api/organization/signature')['data_base64'] == png()
