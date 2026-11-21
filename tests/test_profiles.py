"""Billing profile isolation; all databases/documents live in pytest temp dirs."""
import hashlib
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.database as db
from backend.main import app, get_database_path, get_invoice_directory
from backend.backup_service import create_backup
from backend.backup_restore import restore_backup
from backend.storage_import import import_database, validate_database


@pytest.fixture
def environment(tmp_path):
    database = tmp_path / 'app.db'
    documents = tmp_path / 'documents'
    db.initialize_database(database)
    app.state.test_database_path = database
    app.state.test_invoice_directory = documents
    app.dependency_overrides[get_database_path] = lambda: database
    app.dependency_overrides[get_invoice_directory] = lambda: documents
    with TestClient(app) as client:
        yield client, database, documents
    app.dependency_overrides.clear()


def request(client, method, url, profile=1, body=None, expected=200):
    result = client.request(method, url, headers={'X-Profile-ID': str(profile)}, **({'json': body} if body is not None else {}))
    assert result.status_code == expected, result.text
    return result.json() if result.content and 'json' in result.headers.get('content-type', '') else result.content


def activity(client, profile, rate=1000):
    return request(client, 'PUT', '/api/settings', profile, {'activities': [{'name': 'Training', 'hourly_rate_cents': rate}]})['activities'][0]['id']


def training(client, profile, identifier):
    return request(client, 'POST', '/api/trainings', profile, {'training_date': '2025-01-02', 'activity_type_id': identifier, 'hours': 2, 'status': 'completed'}, 201)['id']


def test_two_profiles_invoices_documents_and_full_restore(environment, tmp_path):
    client, database, documents = environment
    second = request(client, 'POST', '/api/profiles', body={'name': 'Firma XY'}, expected=201)['id']
    assert second != 1
    assert request(client, 'GET', '/api/settings', second)['activities'] == []
    ids = [activity(client, p, p * 1000) for p in (1, second)]
    trainings = [training(client, p, a) for p, a in zip((1, second), ids)]
    invoices = []
    digests = []
    for profile in (1, second):
        preview = request(client, 'POST', '/api/invoices/preview', profile, {'year': 2025, 'month': 1})
        assert preview
        invoice = request(client, 'POST', '/api/invoices', profile, {'year': 2025, 'month': 1}, 201)
        invoices.append(invoice)
        pdf = request(client, 'GET', f'/api/invoices/{invoice["id"]}/pdf', profile)
        assert pdf.startswith(b'%PDF')
        digests.append(hashlib.sha256(pdf).hexdigest())
        assert len(request(client, 'GET', '/api/invoices', profile)) == 1
    assert invoices[0]['invoice_number'] == invoices[1]['invoice_number']
    assert invoices[0]['pdf_path'] != invoices[1]['pdf_path']
    for index, profile in enumerate((1, second)):
        other = invoices[1-index]['id']
        request(client, 'GET', f'/api/invoices/{other}/pdf', profile, expected=404)
        request(client, 'DELETE', f'/api/invoices/{other}', profile, expected=404)
        request(client, 'PUT', f'/api/trainings/{trainings[1-index]}', profile, {'note': 'attack'}, 404)
        request(client, 'DELETE', f'/api/trainings/{trainings[1-index]}', profile, expected=404)
        request(client, 'POST', '/api/trainings', profile, {'training_date': '2025-01-03', 'activity_type_id': ids[1-index]}, 404)
        request(client, 'PUT', '/api/settings', profile, {'activities': [{'id': ids[1-index], 'name': 'attack', 'hourly_rate_cents': 1}]}, 404)
        request(client, 'PUT', '/api/weekly-plan', profile, [{'weekday': 0, 'activity_type_id': ids[1-index], 'hours': 1}], 409)
        plan = request(client, 'PUT', '/api/weekly-plan', profile, [{'weekday': 0, 'activity_type_id': ids[index], 'hours': profile}])
        assert len(plan) == 1
        calendar = request(client, 'GET', '/api/calendar/2025/1', profile)
        assert [t['id'] for day in calendar['days'] for t in day['trainings']] == [trainings[index]]
    before = [db.get_invoice(invoice['id'], database) for invoice in invoices]
    request(client, 'PUT', f'/api/profiles/{second}', body={'name': '../ Umbenannt'})
    settings = request(client, 'GET', '/api/organization/settings', second)
    from backend.models import OrganizationSettingsUpdate
    body = OrganizationSettingsUpdate().model_dump() | {'name': 'Neue Firma', 'invoice_number_prefix': 'XY'}
    request(client, 'PUT', '/api/organization/settings', second, body)
    assert request(client, 'GET', '/api/organization/settings')['name'] != 'Neue Firma'
    assert request(client, 'GET', '/api/organization/settings', second)['next_invoice_number'] == 2
    assert [db.get_invoice(invoice['id'], database) for invoice in invoices] == before
    archive = create_backup(database, documents, tmp_path / 'backups')
    restored = restore_backup(archive, tmp_path / 'restored', current_database=database, current_documents=documents, safety_directory=tmp_path / 'safety', confirmed=True)
    db.initialize_database(restored / 'ttc.db')
    assert len(db.list_profiles(restored / 'ttc.db')) == 2
    for index, invoice in enumerate(invoices):
        assert db.get_invoice(invoice['id'], restored / 'ttc.db') == before[index]
        assert hashlib.sha256((restored / 'documents' / invoice['pdf_path']).read_bytes()).hexdigest() == digests[index]

    request(client, 'DELETE', f'/api/invoices/{invoices[1]["id"]}', second, expected=204)
    assert hashlib.sha256(request(client, 'GET', f'/api/invoices/{invoices[0]["id"]}/pdf')).hexdigest() == digests[0]
    replacement = request(client, 'POST', '/api/invoices', second, {'year': 2025, 'month': 1}, 201)
    assert replacement['invoice_number'] == 'XY-2025-0002'
    assert request(client, 'GET', '/api/organization/settings')['next_invoice_number'] == 2


@pytest.mark.parametrize('identifier', ['', '0', '-1', '9999', 'abc', '1.0', '١', '9' * 100])
def test_invalid_profile_never_falls_back(environment, identifier):
    client, _, _ = environment
    # Non-ASCII cannot be encoded as an HTTP header; exercise the query contract.
    response = client.get('/api/settings', params={'profile_id': identifier})
    assert response.status_code in (404, 422)


def test_concurrent_requests_and_profile_limits(environment):
    client, database, _ = environment
    second = request(client, 'POST', '/api/profiles', body={'name': 'B'}, expected=201)['id']
    with ThreadPoolExecutor(2) as executor:
        results = list(executor.map(lambda profile: activity(client, profile, profile * 100), (1, second)))
    assert len(set(results)) == 2
    for profile in (1, second):
        rows = [{'name': f'Activity {n}', 'hourly_rate_cents': profile, 'is_active': False} for n in range(9)]
        assert len(request(client, 'PUT', '/api/settings', profile, {'activities': rows})['activities']) == 10
        request(client, 'PUT', '/api/settings', profile, {'activities': [{'name': 'Too many', 'hourly_rate_cents': 1}]}, 422)
    with sqlite3.connect(database) as connection:
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute('UPDATE activity_types SET organization_id=? WHERE id=?', (second, results[0]))
        # Even an offline archive that bypassed triggers must be rejected.
        connection.execute('DROP TRIGGER profile_trainings_insert')
        connection.execute('INSERT INTO trainings(organization_id, training_date, activity_type_id, unit_rate_cents) VALUES (1, ?, ?, 1)', ('2025-01-01', results[1]))
        with pytest.raises(ValueError, match='Profilübergreifende'):
            validate_database(connection, current=True)


def test_v6_migration_rollback_restart_snapshots_and_legacy_import(tmp_path, monkeypatch):
    database = tmp_path / 'legacy.db'
    original = db._migrate_profiles
    monkeypatch.setattr(db, '_migrate_profiles', lambda connection: None)
    db.initialize_database(database)
    monkeypatch.setattr(db, '_migrate_profiles', original)
    a = db.create_record('activity_types', {'name': 'Alt', 'hourly_rate_cents': 1500}, database)
    t = db.create_record('trainings', {'activity_type_id': a, 'training_date': '2025-01-01', 'hours': None, 'unit_rate_cents': 1500}, database)
    invoice = db.create_invoice_with_items({'year': 2025, 'month': 1, 'invoice_date': '2025-02-01', 'invoice_number': 'ALT-0007', 'pdf_path': 'Rechnung_TTC_2025-01.pdf', 'total_amount_cents': 1500, 'invoice_snapshot_json': json.dumps({'name': 'Historisch'})}, [{'training_id': t, 'description': 'Alt', 'training_date': '2025-01-01', 'hours': None, 'unit_rate_cents': 1500, 'amount_cents': 1500}], database)
    before = db.get_invoice(invoice, database)
    validate = db.validate_profile_relationships
    monkeypatch.setattr(db, 'validate_profile_relationships', lambda connection: (_ for _ in ()).throw(ValueError('injected')))
    with pytest.raises(ValueError, match='injected'):
        db.initialize_database(database)
    with sqlite3.connect(database) as connection:
        assert db.get_schema_version(connection) == 6
        assert 'profile_name' not in {r[1] for r in connection.execute('PRAGMA table_info(organizations)')}
        assert not connection.execute("SELECT name FROM sqlite_master WHERE name LIKE 'profile_%'").fetchall()
    monkeypatch.setattr(db, 'validate_profile_relationships', validate)
    imported = tmp_path / 'import.db'
    import_database(database, imported)
    db.initialize_database(database)
    db.initialize_database(database)
    assert db.list_profiles(database) == [{'id': 1, 'name': 'TTC'}]
    assert db.get_invoice(invoice, database) == before == db.get_invoice(invoice, imported)
    second = db.create_profile('B', database)['id']
    new_id = db.create_record('activity_types', {'name': 'Alt', 'hourly_rate_cents': 1}, db.ProfileDatabasePath(database, second))
    assert new_id != a
    assert len(db.list_records('activity_types', database_path=db.ProfileDatabasePath(database, second))) == 1


def test_profile_validation_logo_and_management(environment):
    import base64
    import struct
    import zlib
    client, database, _ = environment
    for name in (' ', '', 'x' * 101):
        request(client, 'POST', '/api/profiles', body={'name': name}, expected=422)
    second = request(client, 'POST', '/api/profiles', body={'name': '  B  '}, expected=201)['id']
    assert request(client, 'GET', '/api/profiles')[1]['name'] == 'B'
    request(client, 'DELETE', f'/api/profiles/{second}', expected=405)
    request(client, 'PUT', '/api/profiles/9999', body={'name': 'Missing'}, expected=404)
    assert client.get('/api/settings?profile_id=2', headers={'X-Profile-ID': '1'}).status_code == 422
    def chunk(kind, content):
        return struct.pack('>I', len(content)) + kind + content + struct.pack('>I', zlib.crc32(kind + content) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00\xff')) + chunk(b'IEND', b'')
    request(client, 'POST', '/api/organization/logo', second, {'media_type': 'image/png', 'data_base64': base64.b64encode(png).decode()})
    assert request(client, 'GET', '/api/organization/logo', second) == png
    request(client, 'GET', '/api/organization/logo', expected=404)
    request(client, 'DELETE', '/api/organization/logo')
    assert request(client, 'GET', '/api/organization/logo', second) == png
    identifier = activity(client, second)
    own_plan = request(client, 'PUT', '/api/weekly-plan', second, [{'weekday': 0, 'activity_type_id': identifier, 'hours': 1}])[0]['id']
    request(client, 'PUT', '/api/weekly-plan', 1, [{'id': own_plan, 'weekday': 0, 'activity_type_id': identifier, 'hours': 1}], 404)
    # Reject malicious document references even if archive SQL bypassed triggers.
    with sqlite3.connect(database) as connection:
        connection.execute("INSERT INTO invoices(organization_id,year,month,invoice_date,total_amount_cents,pdf_path) VALUES (?,2025,1,'2025-02-01',1,'../foreign.pdf')", (second,))
        with pytest.raises(ValueError, match='Dokumentreferenz'):
            validate_database(connection, current=True)


def test_legacy_single_profile_archive_restore(environment, tmp_path, monkeypatch):
    import zipfile
    from backend.backup_service import _digest
    _, current_database, current_documents = environment
    legacy = tmp_path / 'v6.db'
    original = db._migrate_profiles
    monkeypatch.setattr(db, '_migrate_profiles', lambda connection: None)
    db.initialize_database(legacy)
    monkeypatch.setattr(db, '_migrate_profiles', original)
    db.update_organization({'next_invoice_number': 42, 'recipient_name': 'Legacy recipient'}, legacy)
    pdf = tmp_path / 'Rechnung_TTC_2025-01.pdf'
    pdf.write_bytes(b'%PDF-legacy-exact-bytes')
    with sqlite3.connect(legacy) as connection:
        connection.execute("INSERT INTO invoices(year,month,invoice_date,invoice_number,total_amount_cents,pdf_path,invoice_snapshot_json) VALUES (2025,1,'2025-02-01','ALT-0041',50,?,?)", (pdf.name, '{"name":"Old snapshot"}'))
    archive = tmp_path / 'v6.zip'
    files = {'database/ttc.db': _digest(legacy), 'documents/' + pdf.name: _digest(pdf)}
    before = legacy.read_bytes()
    with zipfile.ZipFile(archive, 'x') as output:
        output.write(legacy, 'database/ttc.db')
        output.write(pdf, 'documents/' + pdf.name)
        output.writestr('manifest.json', json.dumps({'format': 1, 'files': files}))
    restored = restore_backup(archive, tmp_path / 'legacy-restored', current_database=current_database, current_documents=current_documents, safety_directory=tmp_path / 'safety', confirmed=True)
    assert db.list_profiles(restored / 'ttc.db') == [{'id': 1, 'name': 'TTC'}]
    assert db.get_organization(restored / 'ttc.db')['next_invoice_number'] == 42
    invoice = db.list_records('invoices', database_path=restored / 'ttc.db')[0]
    assert invoice['invoice_snapshot_json'] == '{"name":"Old snapshot"}'
    assert (restored / 'documents' / pdf.name).read_bytes() == pdf.read_bytes()
    assert legacy.read_bytes() == before
