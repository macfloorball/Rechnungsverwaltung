"""Validate the existing invoice-to-PDF association without changing data."""
import re
from pathlib import Path
from typing import Any

from backend.database import get_invoice_document_owners, list_records
from backend.document_storage import DocumentStore
from backend.invoice_generator import build_invoice_filename


class InvoiceDocumentAssociationError(ValueError):
    """The stored reference does not identify this invoice's PDF uniquely."""


def invoice_document_name(invoice: dict[str, Any]) -> str:
    expected = build_invoice_filename(invoice["year"], invoice["month"])
    if invoice.get("organization_id", 1) != 1:
        expected = f"profile-{invoice['organization_id']}-{expected}"
    revision = re.fullmatch(re.escape(expected[:-4]) + r"-revision-[0-9a-f]{32}\.pdf", invoice["pdf_path"] or "")
    if invoice["is_preview"] or (invoice["pdf_path"] != expected and not revision):
        raise InvoiceDocumentAssociationError
    return invoice["pdf_path"]


def get_owned_invoice_document(
    invoice: dict[str, Any], database_path: Path,
) -> str:
    reference = invoice_document_name(invoice)
    if get_invoice_document_owners(reference, database_path) != [invoice["id"]]:
        raise InvoiceDocumentAssociationError
    return reference


def prepare_invoice_documents(
    database_path: Path, directory: Path, legacy_directory: Path,
) -> None:
    documents = DocumentStore(directory)
    if documents.directory == Path(legacy_directory).absolute():
        return
    legacy = None
    for invoice in list_records("invoices", {"is_preview": 0}, database_path):
        try:
            reference = get_owned_invoice_document(invoice, database_path)
        except InvoiceDocumentAssociationError:
            # Preserve inconsistent legacy records; normal API checks still
            # reject them. Never infer ownership from directory contents.
            continue
        target = documents.directory / reference
        if target.exists() or target.is_symlink():
            documents.get_file(reference)
            continue
        # An already complete target must remain usable even if an old source
        # directory has become unavailable or no longer represents a directory.
        if legacy is None:
            legacy = DocumentStore(legacy_directory)
        if documents.directory == legacy.directory:
            return
        try:
            legacy.get_file(reference)
        except FileNotFoundError:
            # Missing PDFs remain missing and produce the existing API 404.
            continue
        documents.copy_missing_from(legacy, reference)
