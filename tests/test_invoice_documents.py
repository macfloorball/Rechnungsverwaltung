from pathlib import Path

import pytest

from backend.database import (
    InvoiceDocumentConflictError, create_invoice_with_items, create_record,
    get_invoice, get_invoice_document_owners, get_organization, initialize_database,
    save_invoice_preview,
)
from backend.invoice_documents import (
    InvoiceDocumentAssociationError, get_owned_invoice_document, invoice_document_name,
    prepare_invoice_documents,
)
from backend.document_storage import DocumentStore


def invoice_values(month=11, reference="Rechnung_TTC_2026-11.pdf"):
    return {
        "year": 2026, "month": month, "invoice_date": "2026-11-30",
        "total_amount_cents": 0, "pdf_path": reference, "is_preview": 0,
    }


@pytest.mark.parametrize("reference,preview", [
    (None, 0), ("", 0), ("../Rechnung_TTC_2026-11.pdf", 0),
    ("Rechnung_TTC_2026-12.pdf", 0), ("rechnung_ttc_2026-11.pdf", 0),
    ("Rechnung_TTC_2026-11.pdf", 1),
])
def test_invalid_or_preview_reference_is_not_an_invoice_document(reference, preview):
    invoice = invoice_values(reference=reference) | {"is_preview": preview}
    with pytest.raises(InvoiceDocumentAssociationError):
        invoice_document_name(invoice)


def test_legacy_reference_is_preserved_after_restart(tmp_path: Path):
    path = tmp_path / "ttc.db"
    initialize_database(path)
    invoice_id = create_invoice_with_items(invoice_values(), [], path)
    before = path.read_bytes()
    initialize_database(path)
    invoice = get_invoice(invoice_id, path)
    assert get_owned_invoice_document(invoice, path) == "Rechnung_TTC_2026-11.pdf"
    assert path.read_bytes() == before


@pytest.mark.parametrize("reference", ["Rechnung_TTC_2026-11.pdf", "rechnung_ttc_2026-11.PDF"])
def test_shared_reference_is_ambiguous_without_modifying_legacy_data(tmp_path, reference):
    path = tmp_path / "ttc.db"
    initialize_database(path)
    invoice_id = create_invoice_with_items(invoice_values(), [], path)
    other_id = create_record("invoices", invoice_values(12, reference), path)
    before = path.read_bytes()
    assert get_invoice_document_owners("Rechnung_TTC_2026-11.pdf", path) == [invoice_id, other_id]
    with pytest.raises(InvoiceDocumentAssociationError):
        get_owned_invoice_document(get_invoice(invoice_id, path), path)
    assert path.read_bytes() == before


def test_finalization_conflict_preserves_preview_and_number_sequence(tmp_path):
    path = tmp_path / "ttc.db"
    initialize_database(path)
    create_invoice_with_items(invoice_values(12, "rechnung_ttc_2026-11.PDF"), [], path)
    preview_id = save_invoice_preview(2026, 11, "2026-11-30", 0, [], path)
    preview = get_invoice(preview_id, path)
    sequence = get_organization(path)["next_invoice_number"]
    with pytest.raises(InvoiceDocumentConflictError):
        create_invoice_with_items(
            invoice_values(), [], path,
            expected_next_invoice_number=sequence,
            updated_next_invoice_number=sequence + 1,
        )
    assert get_invoice(preview_id, path) == preview
    assert get_organization(path)["next_invoice_number"] == sequence


def test_prepare_copies_only_uniquely_assigned_final_documents(tmp_path):
    path = tmp_path / "ttc.db"
    initialize_database(path)
    legacy = DocumentStore(tmp_path / "old")
    target = tmp_path / "documents"
    create_invoice_with_items(invoice_values(), [], path)
    create_record("invoices", invoice_values(12, "Rechnung_TTC_2026-12.pdf"), path)
    create_record("invoices", invoice_values(10, "Rechnung_TTC_2026-12.pdf"), path)
    create_record("invoices", invoice_values(9, "../other.pdf"), path)
    create_record("invoices", invoice_values(8, "Rechnung_TTC_2026-08.pdf") | {"is_preview": 1}, path)
    # A valid reference whose file is missing must not prevent other imports.
    create_record("invoices", invoice_values(7, "Rechnung_TTC_2026-07.pdf"), path)
    for name in ("Rechnung_TTC_2026-11.pdf", "Rechnung_TTC_2026-12.pdf", "Rechnung_TTC_2026-08.pdf", "orphan.pdf"):
        legacy.save_new(name, name.encode())
    before = path.read_bytes()
    originals = {file.name: file.read_bytes() for file in legacy.directory.iterdir()}
    prepare_invoice_documents(path, target, legacy.directory)
    assert [file.name for file in target.iterdir()] == ["Rechnung_TTC_2026-11.pdf"]
    assert (target / "Rechnung_TTC_2026-11.pdf").read_bytes() == b"Rechnung_TTC_2026-11.pdf"
    assert {file.name: file.read_bytes() for file in legacy.directory.iterdir()} == originals
    assert path.read_bytes() == before
    prepare_invoice_documents(path, target, legacy.directory)
    assert path.read_bytes() == before


def test_empty_profile_and_unchanged_web_directory_need_no_copy(tmp_path):
    path = tmp_path / "ttc.db"
    initialize_database(path)
    target = tmp_path / "documents"
    prepare_invoice_documents(path, target, tmp_path / "old")
    assert not target.exists()
    prepare_invoice_documents(path, target, target)
    assert not target.exists()
