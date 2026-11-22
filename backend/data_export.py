"""Human-readable CSV/document export from the existing consistent snapshot."""
import base64
import csv
import io
import os
import shutil
import sqlite3
import tempfile
import zipfile
from contextlib import closing
from pathlib import Path

from backend.backup_service import create_backup
from backend.database import TABLE_COLUMNS


def csv_value(value):
    if isinstance(value, bytes):
        return 'base64:' + base64.b64encode(value).decode('ascii')
    if isinstance(value, str) and (value[:1] in ('\t', '\r', '\n') or value.lstrip()[:1] in ('=', '+', '-', '@')):
        return "'" + value  # Prevent spreadsheet formula execution.
    return value


def create_export(database: Path, documents: Path, destination: Path) -> Path:
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.ttc-export-', dir=destination) as temporary:
        stage = Path(temporary)
        snapshot = create_backup(database, documents, stage)
        result = stage / 'export.zip'
        with zipfile.ZipFile(snapshot) as source, zipfile.ZipFile(result, 'x', compression=zipfile.ZIP_DEFLATED) as output:
            database_copy = stage / 'ttc.db'
            with source.open('database/ttc.db') as reader, database_copy.open('xb') as writer:
                shutil.copyfileobj(reader, writer)
            with closing(sqlite3.connect(database_copy)) as connection:
                for table in (*TABLE_COLUMNS, "invoice_counters", "invoice_number_legacy_floors", "invoice_number_retired"):
                    cursor = connection.execute(f'SELECT * FROM {table} ORDER BY rowid')
                    text = io.StringIO(newline='')
                    writer = csv.writer(text, delimiter=';')
                    writer.writerow(column[0] for column in cursor.description)
                    for row in cursor:
                        writer.writerow(csv_value(value) for value in row)
                    output.writestr(f'csv/{table}.csv', text.getvalue().encode('utf-8-sig'))
            for name in source.namelist():
                if name.startswith('documents/'):
                    with source.open(name) as reader, output.open(name, 'w') as writer:
                        shutil.copyfileobj(reader, writer)
            output.writestr('HINWEISE.txt', 'CSV: UTF-8 mit BOM, Semikolon, ISO-Datumswerte, Geldbeträge in Cent.\nBinärwerte: base64:-Präfix. Formelfähige Texte erhalten ein vorangestelltes Apostroph.\nExport dient zur Auswertung, nicht zur Wiederherstellung. Dafür vollständiges Backup verwenden.\n')
        result.chmod(0o600)
        with result.open('r+b') as stream:
            os.fsync(stream.fileno())
        target = destination / 'ttc-datenexport.zip'
        os.link(result, target)
        return target
