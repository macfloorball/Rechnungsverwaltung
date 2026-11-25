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
    payload = {'year': 2025, 'month': 1, 'invoice_date': '2025-01-31', 'signature': {'enabled': True, 'x_mm': 35, 'y_mm': 260, 'width_mm': 40}}
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
