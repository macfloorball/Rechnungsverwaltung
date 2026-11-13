"""Keep PDF download errors actionable before response headers are sent."""
import logging

from fastapi.responses import FileResponse, JSONResponse

from backend.document_errors import DocumentOperationError, error_code

logger = logging.getLogger(__name__)


def document_error_response(error: DocumentOperationError) -> JSONResponse:
    logger.warning("Document operation failed: %s/%s", error.operation, error.code)
    return JSONResponse(status_code=error.status_code, content={"detail": error.detail})


class DocumentPDFResponse(FileResponse):
    async def __call__(self, scope, receive, send):
        pending_headers = None
        started = False

        async def send_when_ready(message):
            nonlocal pending_headers, started
            if message["type"] == "http.response.start":
                pending_headers = message
                return
            if pending_headers is not None:
                started = True
                await send(pending_headers)
                pending_headers = None
            await send(message)

        # Let FileResponse retain its range/header behavior, but keep file reads
        # here rather than delegating them to a server-specific pathsend extension.
        extensions = dict(scope.get("extensions", {}))
        extensions.pop("http.response.pathsend", None)
        safe_scope = dict(scope, extensions=extensions)
        try:
            await super().__call__(safe_scope, receive, send_when_ready)
        except (OSError, ValueError, RuntimeError) as error:
            failure = DocumentOperationError(error_code(error), "read")
            if started:
                logger.warning("Document transfer interrupted: %s", failure.code)
                # Status/headers can no longer be changed after a partial body.
                raise RuntimeError("Die PDF-Übertragung wurde unterbrochen. Bitte die Datei erneut abrufen.") from None
            await document_error_response(failure)(scope, receive, send)
