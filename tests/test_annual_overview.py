import csv
import io

from backend.database import get_connection
from tests.test_api import client


def test_totals_and_exports_use_saved_cents_and_billing_period(client):
    from backend.main import app
    database = app.state.test_database_path
    other = client.post('/api/profiles', json={'name': 'Anderes Profil'}).json()['id']
    with get_connection(database) as connection:
        for profile, year, month, preview, cents, invoice_date in [
            (1, 2025, 1, 0, 101, '2026-02-01'), (1, 2025, 1, 0, 202, '2025-03-01'),
            (1, 2025, 12, 0, 99999, '2026-01-01'), (1, 2025, 2, 1, 88888, '2025-02-01'),
            (1, 2024, 12, 0, 999, '2025-01-01'), (other, 2025, 1, 0, 77777, '2025-01-01')]:
            connection.execute('INSERT INTO invoices(organization_id,year,month,is_preview,total_amount_cents,invoice_date) VALUES(?,?,?,?,?,?)', (profile,year,month,preview,cents,invoice_date))
    data = client.get('/api/annual-overview/2025').json()
    assert len(data['months']) == 12
    assert [row['amount_cents'] for row in data['months']] == [303] + [0]*10 + [99999]
    assert data['total_amount_cents'] == 100302
    assert data['invoice_count'] == 3
    assert data['years'] == [2025, 2024]
    assert client.get(f'/api/annual-overview/2025?profile_id={other}').json()['total_amount_cents'] == 77777
    assert client.get('/api/annual-overview/2026').json()['total_amount_cents'] == 0
    response = client.get('/api/annual-overview/2025/csv')
    rows = list(csv.reader(io.StringIO(response.content.decode('utf-8-sig')), delimiter=';'))
    assert len(rows) == 14
    assert rows[1][-1] == '3,03'
    assert rows[-1][-1] == '1.003,02'
    response = client.get('/api/annual-overview/2025/pdf')
    assert response.content.startswith(b'%PDF')
    # Inspect the uncompressed PDF drawing commands without a new test dependency.
    import re
    import zlib
    from reportlab.pdfbase import pdfutils
    streams = re.findall(rb'stream\r?\n(.*?)endstream', response.content, re.S)
    drawing = b' '.join(zlib.decompress(pdfutils.asciiBase85Decode(stream.strip())) for stream in streams)
    for text in (b'2025', b'Januar', b'Dezember', b'1.003,02', b'3,03'):
        assert text in drawing
    assert client.get('/api/annual-overview/0').status_code == 422
    assert client.get('/api/annual-overview/10000/csv').status_code == 422
    assert client.get('/api/annual-overview/2025/xml').status_code == 404
    assert client.get('/api/annual-overview/2025?profile_id=9999').status_code == 404


def test_empty_year_and_spreadsheet_safe_profile_name(client):
    client.put('/api/profiles/1', json={'name': '=Test; <Profil> & Name'})
    data = client.get('/api/annual-overview/2023').json()
    assert data['invoice_count'] == 0
    assert data['total_amount_cents'] == 0
    assert all(month['amount_cents'] == 0 for month in data['months'])
    response = client.get('/api/annual-overview/2023/csv')
    rows = list(csv.reader(io.StringIO(response.content.decode('utf-8-sig')), delimiter=';'))
    assert len(rows) == 14
    assert all(row[-1] == '0,00' for row in rows[1:])
    assert rows[1][0] == "'=Test; <Profil> & Name"
    assert client.get('/api/annual-overview/2023/pdf').status_code == 200
