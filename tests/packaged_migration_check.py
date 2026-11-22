"""Run with the shipped interpreter: all data is created in a temporary profile."""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile


def main():
    with tempfile.TemporaryDirectory(prefix="ttc-migration-check-") as temporary:
        root = Path(temporary)
        os.environ["TTC_DATA_DIRECTORY"] = str(root / "profile")
        os.environ["TTC_DOCUMENT_DIRECTORY"] = str(root / "documents")
        # Imports must succeed without relying on a host Python or its packages.
        import fastapi
        import reportlab
        import uvicorn
        import backend.database as database

        path = root / "profile" / "ttc.db"
        document = root / "documents" / "existing.pdf"
        document.parent.mkdir()
        document.write_bytes(b"%PDF-preserve-this-document")
        original = database._migrate_profile_identifiers
        database._migrate_profile_identifiers = lambda connection: None
        database.initialize_database()
        database._migrate_profile_identifiers = original
        database.update_organization({"recipient_name": "Migration check", "next_invoice_number": 42})

        def interrupted(connection):
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("CREATE TABLE interrupted_update (id INTEGER)")
            connection.execute("INSERT INTO schema_migrations (version) VALUES (?)", (database.SCHEMA_VERSION,))
            raise sqlite3.DatabaseError("controlled migration failure")

        database._migrate_profile_identifiers = interrupted
        try:
            database.initialize_database()
        except sqlite3.DatabaseError:
            pass
        else:
            raise AssertionError("Migration failure was not reported")
        finally:
            database._migrate_profile_identifiers = original
        with closing(sqlite3.connect(path)) as connection, connection:
            assert database.get_schema_version(connection) == database.SCHEMA_VERSION - 1
            assert not connection.execute("SELECT name FROM sqlite_master WHERE name='interrupted_update'").fetchall()
        copies = list(path.parent.glob("*.before-migration-*.sqlite3"))
        assert copies
        with closing(sqlite3.connect(copies[0])) as connection, connection:
            assert connection.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
            assert database.get_schema_version(connection) == database.SCHEMA_VERSION - 1
        database.initialize_database()
        assert database.get_organization()["next_invoice_number"] == 42
        assert database.get_organization()["recipient_name"] == "Migration check"
        before_restart = hashlib.sha256(path.read_bytes()).hexdigest()
        database.initialize_database()
        assert hashlib.sha256(path.read_bytes()).hexdigest() == before_restart
        with closing(sqlite3.connect(path)) as connection, connection:
            assert database.get_schema_version(connection) == database.SCHEMA_VERSION
            connection.execute("INSERT INTO schema_migrations (version) VALUES (?)", (database.SCHEMA_VERSION + 1,))
        before_rejection = path.read_bytes()
        try:
            database.initialize_database()
        except ValueError:
            pass
        else:
            raise AssertionError("Future schema was not rejected")
        assert path.read_bytes() == before_rejection
        assert document.read_bytes() == b"%PDF-preserve-this-document"
        print(json.dumps({"migrationCheck": "ok", "backend": database.__file__}))


if __name__ == "__main__":
    main()
