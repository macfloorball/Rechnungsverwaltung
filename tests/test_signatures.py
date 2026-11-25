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
