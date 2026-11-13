import asyncio
import builtins
import errno
import os
from pathlib import Path
import subprocess
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from backend.database import initialize_database
from backend.document_errors import (
    DocumentChangedError, DocumentOperationError, document_operation,
)
from backend.document_responses import DocumentPDFResponse


@pytest.mark.parametrize("failure,code,status", [
    (FileNotFoundError("private-path"), "missing", 503),
    (FileExistsError("private-path"), "exists", 409),
    (PermissionError("private-path"), "access", 503),
    (OSError(errno.EROFS, "private-path"), "access", 503),
    (OSError(errno.ENOSPC, "private-path"), "space", 503),
    (OSError(getattr(errno, "EDQUOT", errno.ENOSPC), "private-path"), "space", 503),
    (OSError(getattr(errno, "EOPNOTSUPP", errno.EXDEV), "private-path"), "unsupported", 503),
    (NotImplementedError("private-path"), "unsupported", 503),
    (NotADirectoryError("private-path"), "invalid", 503),
    (ValueError("private-path"), "invalid", 503),
    (DocumentChangedError("private-path"), "changed", 409),
    (OSError(errno.EIO, "private-path"), "io", 503),
])
def test_document_errors_have_fixed_actionable_messages(failure, code, status):
    with pytest.raises(DocumentOperationError) as caught:
        with document_operation("write"):
            raise failure
    assert caught.value.code == code
    assert caught.value.status_code == status
    assert "private-path" not in str(caught.value)
    assert "nicht gespeichert" in str(caught.value)


@pytest.mark.parametrize("windows,code", [(32, "access"), (112, "space"), (50, "unsupported"), (267, "invalid")])
def test_windows_file_errors_are_classified_without_platform_specific_text(windows, code):
    error = OSError("private-path")
    error.winerror = windows
    with pytest.raises(DocumentOperationError) as caught:
        with document_operation("prepare"):
            raise error
    assert caught.value.code == code
    assert "private-path" not in str(caught.value)


def test_pdf_response_keeps_range_and_download_headers(tmp_path):
    file = tmp_path / "invoice.pdf"
    file.write_bytes(b"%PDF-0123456789")
    app = FastAPI()

    @app.get("/pdf")
    def pdf():
        return DocumentPDFResponse(file, media_type="application/pdf", filename="invoice.pdf", content_disposition_type="inline")

    with TestClient(app) as client:
        response = client.get("/pdf", headers={"Range": "bytes=0-4"})
        assert response.status_code == 206
        assert response.content == b"%PDF-"
        assert response.headers["content-range"] == "bytes 0-4/15"
        assert "inline" in response.headers["content-disposition"]
        response = client.get("/pdf", headers={"Range": "bytes=0-4,10-14"})
        assert response.status_code == 206
        assert len(response.content) == int(response.headers["content-length"])
        assert "multipart/byteranges" in response.headers["content-type"]
        assert client.get("/pdf", headers={"Range": "bytes=100-"}).status_code == 416


def test_pdf_open_failure_returns_json_before_success_headers(tmp_path, monkeypatch):
    file = tmp_path / "private-user.pdf"
    file.write_bytes(b"%PDF-original")
    app = FastAPI()
    original_open = builtins.open

    def denied_open(path, *args, **kwargs):
        if path == file:
            raise PermissionError("private-user.pdf")
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", denied_open)

    @app.get("/pdf")
    def pdf():
        return DocumentPDFResponse(file, media_type="application/pdf", filename="invoice.pdf")

    with TestClient(app) as client:
        response = client.get("/pdf")
    assert response.status_code == 503
    assert "Zugriffsrechte" in response.json()["detail"]
    assert "private-user.pdf" not in response.text
    assert "content-disposition" not in response.headers


def test_interrupted_pdf_stream_does_not_start_a_second_response(monkeypatch, tmp_path):
    from fastapi.responses import FileResponse

    async def interrupted(self, scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"partial", "more_body": True})
        raise OSError("private-user.pdf")

    monkeypatch.setattr(FileResponse, "__call__", interrupted)
    messages = []

    async def send(message):
        messages.append(message)

    with pytest.raises(RuntimeError, match="erneut abrufen") as caught:
        asyncio.run(DocumentPDFResponse(tmp_path / "invoice.pdf")({"type": "http"}, None, send))
    assert "private-user.pdf" not in str(caught.value)
    assert [message["type"] for message in messages].count("http.response.start") == 1


def test_pdf_disappearing_before_transfer_has_no_unhandled_error_or_path_leak(tmp_path):
    file = tmp_path / "private-user.pdf"
    file.write_bytes(b"%PDF-original")
    app = FastAPI()

    @app.get("/pdf")
    def pdf():
        response = DocumentPDFResponse(file, media_type="application/pdf")
        file.unlink()
        return response

    with TestClient(app) as client:
        response = client.get("/pdf")
    assert response.status_code == 503
    assert "Verfügbarkeit" in response.json()["detail"]
    assert "private-user.pdf" not in response.text
    assert not file.exists()


def test_startup_document_failure_preserves_database_and_blocking_file(tmp_path):
    profile = tmp_path / "User Data"
    database = profile / "ttc.db"
    initialize_database(database)
    before = database.read_bytes()
    blocking = tmp_path / "private-user-file"
    blocking.write_bytes(b"original")
    result = subprocess.run(
        [sys.executable, "-c", "import asyncio\nfrom backend.main import app, lifespan\nasync def start():\n    async with lifespan(app):\n        pass\nasyncio.run(start())"],
        cwd=Path(__file__).resolve().parent.parent,
        env=os.environ | {"TTC_DATA_DIRECTORY": str(profile), "TTC_DOCUMENT_DIRECTORY": str(blocking), "TTC_LEGACY_DATABASE": str(tmp_path / "absent.db")},
        capture_output=True, text=True, timeout=15,
    )
    assert result.returncode != 0
    assert "TTC_DOCUMENT_ERROR:invalid" in result.stderr
    assert str(blocking) not in result.stderr
    assert database.read_bytes() == before
    assert blocking.read_bytes() == b"original"
