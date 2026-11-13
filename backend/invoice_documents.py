"""Validate the existing invoice-to-PDF association without changing data."""
from pathlib import Path
from typing import Any

from backend.database import get_invoice_document_owners
from backend.invoice_generator import build_invoice_filename


class InvoiceDocumentAssociationError(ValueError):
    """The stored reference does not identify this invoice's PDF uniquely."""


def invoice_document_name(invoice: dict[str, Any]) -> str:
    expected = build_invoice_filename(invoice["year"], invoice["month"])
    if invoice["is_preview"] or invoice["pdf_path"] != expected:
        raise InvoiceDocumentAssociationError
    return expected


def get_owned_invoice_document(
    invoice: dict[str, Any], database_path: Path,
) -> str:
    reference = invoice_document_name(invoice)
    if get_invoice_document_owners(reference, database_path) != [invoice["id"]]:
        raise InvoiceDocumentAssociationError
    return reference
