"""Recurrence and conservative synchronization using isolated DBs and local dates."""
from datetime import date
import sqlite3

import pytest
from pydantic import ValidationError

from backend import database as db
from backend.models import WeeklyPlanEntry


@pytest.fixture
def store(tmp_path, monkeypatch):
    class Today(date):
        @classmethod
        def today(cls):
            return cls(2026, 11, 30)
    monkeypatch.setattr(db, 'date', Today)
    path = tmp_path / 'recurrence.sqlite3'
    db.initialize_database(path)
    activity = db.create_record('activity_types', {'name': 'Training', 'hourly_rate_cents': 1500}, path)
    return path, {'id': None, 'weekday': 3, 'activity_type_id': activity, 'hours': 2, 'is_active': True}


def rows(path):
    return db.list_records('trainings', database_path=db.ProfileDatabasePath(path, db.profile_id(path)))


def payload(entry):
    return {key: int(value) if key == 'hours' else value for key, value in entry.items() if key != 'organization_id'}


def save(path, entry):
    result = db.save_weekly_plan([payload(entry)], path)
    return db.list_records('weekly_plan', database_path=path)[0], result


def december(path):
    return {r['training_date']: r for r in rows(path) if r['training_date'].startswith('2026-12')}


def test_exact_sequence_mixed_defaults_and_restart(store):
    path, entry = store
    plan, _ = save(path, entry)
    assert plan['repeat_weeks'] == 1
    second = {**entry, 'repeat_weeks': 2, 'start_date': '2026-12-03'}
    db.save_weekly_plan([payload(plan), second], path)
    db.ensure_weekly_plan_month(date(2027, 1, 1), path)
    plans = db.list_records('weekly_plan', database_path=path)
    fortnight = [r for r in rows(path) if r['weekly_plan_id'] == plans[1]['id']]
    assert [r['training_date'] for r in fortnight] == ['2026-12-03', '2026-12-17', '2026-12-31', '2027-01-14', '2027-01-28']
    before = rows(path)
    db.initialize_database(path)
    db.ensure_weekly_plan_month(date(2027, 1, 1), path)
    db.save_weekly_plan([payload(p) for p in plans], path)
    assert rows(path) == before


@pytest.mark.parametrize('changes', [
    {'repeat_weeks': 0}, {'repeat_weeks': 3}, {'repeat_weeks': 2},
    {'repeat_weeks': 2, 'start_date': '2026-12-04'},
    {'repeat_weeks': 2, 'start_date': 'nonsense'},
])
def test_invalid_rules_do_not_write(store, changes):
    path, entry = store
    with pytest.raises(ValidationError):
        save(path, {**entry, **changes})
    assert not db.list_records('weekly_plan', database_path=path)
    assert not rows(path)


@pytest.mark.parametrize('start,yes,no', [
    ('2032-02-19', '2032-03-04', '2032-02-26'),
    ('2028-02-24', '2028-03-09', '2028-03-02'),
    ('2027-03-18', '2027-04-01', '2027-03-25'),
    ('2026-10-22', '2026-11-05', '2026-10-29'),
])
def test_calendar_day_arithmetic(start, yes, no):
    origin = date.fromisoformat(start)
    assert db._plan_matches(origin.weekday(), 2, start, date.fromisoformat(yes))
    assert not db._plan_matches(origin.weekday(), 2, start, date.fromisoformat(no))
    assert not db._plan_matches(origin.weekday(), 2, start, date(origin.year-1, origin.month, origin.day))
    assert db._plan_matches(origin.weekday(), 1, start, date.fromisoformat(no))


def test_switch_start_deactivate_reactivate_and_ids(store):
    path, entry = store
    plan, _ = save(path, entry)
    original = december(path)
    plan, result = save(path, {**plan, 'repeat_weeks': 2, 'start_date': '2026-12-03'})
    assert result['removed'] == 2
    assert set(december(path)) == {'2026-12-03', '2026-12-17', '2026-12-31'}
    assert all(r['id'] == original[d]['id'] for d, r in december(path).items())
    assert save(path, plan)[1] == dict(added=0, removed=0, updated=0, preserved=0)
    plan, result = save(path, {**plan, 'start_date': '2026-12-10'})
    assert result['removed'] == 3 and result['added'] == 2
    plan, result = save(path, {**plan, 'repeat_weeks': 1})
    assert result['added'] == 3
    plan, result = save(path, {**plan, 'is_active': False})
    assert result['removed'] == 5 and result['added'] == 0
    assert not december(path)
    plan, result = save(path, {**plan, 'is_active': True})
    assert result['added'] == 5
    assert not any(r['training_date'] >= '2027-01' for r in rows(path))


def test_manual_revert_move_legacy_completed_and_invoice_protection(store):
    path, entry = store
    plan, _ = save(path, entry)
    db.ensure_weekly_plan_month(date(2027, 1, 1), path)
    dec = december(path)
    # Change then revert: the persistent mark must survive both updates.
    db.update_record('trainings', dec['2026-12-10']['id'], {'hours': 3}, path)
    db.update_record('trainings', dec['2026-12-10']['id'], {'hours': 2}, path)
    # A moved occurrence reserves its original source date against regeneration.
    db.update_record('trainings', dec['2026-12-24']['id'], {'training_date': '2026-12-25'}, path)
    january = {r['training_date']: r for r in rows(path) if r['training_date'].startswith('2027-01')}
    db.update_record('trainings', january['2027-01-07']['id'], {'status': 'completed'}, path)
    # Simulate genuine legacy data by inserting without the new proof flag.
    with db.get_connection(path) as c:
        c.execute("DELETE FROM trainings WHERE id=?", (january['2027-01-21']['id'],))
        c.execute("""INSERT INTO trainings(organization_id, training_date, weekly_plan_id, weekly_plan_date,
            weekly_plan_generated, activity_type_id, hours, status, unit_rate_cents)
            VALUES(1, '2027-01-21', ?, '2027-01-21', 1, ?, 2, 'planned', 1500)""", (plan['id'], entry['activity_type_id']))
    # An unrelated manual row must not be deleted or counted as an exception.
    manual = db.create_record('trainings', {'training_date': '2026-12-10', 'activity_type_id': entry['activity_type_id'], 'hours': 1, 'status': 'planned', 'unit_rate_cents': 1500}, path)
    plan, result = save(path, {**plan, 'repeat_weeks': 2, 'start_date': '2026-12-03'})
    assert result['preserved'] == 4
    assert db.get_record('trainings', manual, path)
    assert db.get_record('trainings', dec['2026-12-10']['id'], path)['manually_modified'] == 1
    assert db.get_record('trainings', dec['2026-12-24']['id'], path)['training_date'] == '2026-12-25'
    plan, _ = save(path, {**plan, 'repeat_weeks': 1})
    assert len([r for r in rows(path) if r['weekly_plan_id'] == plan['id'] and r['weekly_plan_date'] == '2026-12-24']) == 1


def test_rollback_mid_synchronization(store, monkeypatch):
    path, entry = store
    plan, _ = save(path, entry)
    before = rows(path)
    def fail(*args, **kwargs):
        raise RuntimeError('controlled failure after removals')
    monkeypatch.setattr(db, '_ensure_weekly_plan_occurrences', fail)
    with pytest.raises(RuntimeError):
        save(path, {**plan, 'repeat_weeks': 2, 'start_date': '2026-12-03'})
    assert rows(path) == before
    assert db.list_records('weekly_plan', database_path=path) == [plan]


def test_today_past_and_profile_isolation(store, monkeypatch):
    path, entry = store
    plan, _ = save(path, entry)
    other = db.create_profile('Other', path)
    address = db.ProfileDatabasePath(path, other['id'])
    activity = db.create_record('activity_types', {'name': 'Other', 'hourly_rate_cents': 100}, address)
    save(address, {**entry, 'activity_type_id': activity})
    other_before = rows(address)
    class Later(date):
        @classmethod
        def today(cls):
            return cls(2026, 12, 10)
    monkeypatch.setattr(db, 'date', Later)
    before = december(path)
    _, result = save(path, {**plan, 'is_active': False})
    assert result['removed'] == 3
    assert result['preserved'] == 0
    assert december(path) == {d: r for d, r in before.items() if d <= '2026-12-10'}
    assert rows(address) == other_before


@pytest.mark.parametrize('preview', [0, 1])
def test_invoice_bindings_snapshots_and_pdf_unchanged(store, preview, tmp_path):
    import hashlib
    path, entry = store
    plan, _ = save(path, entry)
    target = december(path)['2026-12-10']
    pdf = tmp_path / 'historic.pdf'
    pdf.write_bytes(b'%PDF-1.4\nunchanged historical document')
    digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
    invoice_id = db.create_invoice_with_items({
        'year': 2026, 'month': 12, 'is_preview': preview,
        'invoice_date': '2026-12-01', 'invoice_number': 'ALT-42',
        'total_amount_cents': 3000, 'pdf_path': pdf.name,
        'invoice_snapshot_json': '{"historical":"exact snapshot"}',
    }, [{'training_id': target['id'], 'description': 'Historical activity',
         'training_date': target['training_date'], 'hours': 2,
         'unit_rate_cents': 1500, 'amount_cents': 3000}], path)
    invoice = db.get_invoice(invoice_id, path)
    items = db.list_records('invoice_items', database_path=path)
    plan, result = save(path, {**plan, 'repeat_weeks': 2, 'start_date': '2026-12-03'})
    assert result['preserved'] == 1 and result['removed'] == 1
    assert db.get_record('trainings', target['id'], path) == target
    assert db.get_invoice(invoice_id, path) == invoice
    assert db.list_records('invoice_items', database_path=path) == items
    assert hashlib.sha256(pdf.read_bytes()).hexdigest() == digest
    save(path, {**plan, 'repeat_weeks': 1})
    assert len([r for r in rows(path) if r['weekly_plan_date'] == '2026-12-10']) == 1


def test_v7_migration_unknown_history_and_idempotence(tmp_path, monkeypatch):
    path = tmp_path / 'v7.db'
    migration = db._migrate_recurrence
    monkeypatch.setattr(db, '_migrate_recurrence', lambda c: None)
    db.initialize_database(path)
    a = db.create_record('activity_types', {'name': 'Legacy', 'hourly_rate_cents': 100}, path)
    p = db.create_record('weekly_plan', {'weekday': 3, 'activity_type_id': a, 'hours': 1}, path)
    t = db.create_record('trainings', {'training_date': '2026-12-10', 'activity_type_id': a,
        'weekly_plan_id': p, 'weekly_plan_date': '2026-12-10', 'weekly_plan_generated': 1,
        'hours': 1, 'unit_rate_cents': 100}, path)
    monkeypatch.setattr(db, '_migrate_recurrence', migration)
    db.initialize_database(path)
    assert db.get_record('trainings', t, path)['manually_modified'] is None
    plan = db.get_record('weekly_plan', p, path)
    assert plan['repeat_weeks'] == 1 and plan['start_date'] is None
    before = rows(path)
    db.initialize_database(path)
    assert rows(path) == before
    assert len(list(tmp_path.glob('*.before-migration-*.sqlite3'))) == 1
    assert save(path, {**plan, 'repeat_weeks': 2, 'start_date': '2026-12-03'})[1]['preserved'] == 1


@pytest.mark.parametrize('field,value', [('note', 'edited'), ('activity_type_id', None), ('hours', 4), ('unit_rate_cents', 999), ('training_date', '2026-12-11'), ('status', 'cancelled')])
def test_all_business_update_paths_leave_sticky_mark(store, field, value):
    path, entry = store
    save(path, entry)
    target = december(path)['2026-12-10']
    if field == 'activity_type_id':
        value = db.create_record('activity_types', {'name': 'Other', 'hourly_rate_cents': 200}, path)
    # Raw SQL also passes through the same database protection as API/bulk edits.
    with db.get_connection(path) as c:
        c.execute(f'UPDATE trainings SET {field}=? WHERE id=?', (value, target['id']))
        c.execute(f'UPDATE trainings SET {field}=? WHERE id=?', (target[field], target['id']))
        c.execute('UPDATE trainings SET manually_modified=0 WHERE id=?', (target['id'],))
    assert db.get_record('trainings', target['id'], path)['manually_modified'] == 1
