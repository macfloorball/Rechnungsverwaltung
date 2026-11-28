from backend.database import list_archived_profiles
from dataclasses import replace
from backend.models import SignatureLayout, SignatureUpload, SignatureRevision
from backend.signatures import decode_png, validate_signature
import calendar
import base64
import binascii
import json
import logging
import os
import sqlite3
import struct
import uuid
import sys
from contextlib import asynccontextmanager
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Response, Request, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.desktop_update_gate import DesktopUpdateGate
from backend.paths import get_database_path as resolve_database_path
from backend.paths import (
    get_document_directory, get_default_document_directory, get_legacy_document_directory,
)
from backend.document_storage import DocumentIdentity, DocumentStore
from backend.document_errors import DocumentOperationError, document_operation
from backend.document_responses import DocumentPDFResponse, document_error_response
from backend.invoice_documents import (
    InvoiceDocumentAssociationError, get_owned_invoice_document, invoice_document_name,
    prepare_invoice_documents,
)
from backend.storage_import import prepare_database
from backend.storage_errors import DatabaseAccessError, MESSAGES, error_code

from backend.database import (
    get_invoice_counter, set_invoice_counter, set_invoice_start_number, get_connection,
    profile_deletion_summary, delete_profile_transaction,
    ProfileDatabasePath, profile_id, list_profiles, create_profile, rename_profile,
    save_activities,
    save_weekly_plan,
    ensure_weekly_plan_month,
    complete_planned_month,
    RecordNotFoundError,
    InvalidRecordError,
    PROJECT_ROOT,
    InvoiceAlreadyExistsError,
    InvoiceDocumentConflictError,
    InvoicePreviewDeletionError,
    InvoiceDeletionConflictError,
    invoice_document_deletion_guard,
    create_invoice_with_items,
    create_record,
    delete_final_invoice,
    delete_record,
    get_invoice,
    get_organization,
    get_record,
    list_records,
    save_invoice_preview,
    update_organization,
    update_record,
)
from backend.invoice_numbering import NumberingError, select_number, numbering_state, remember_next

from backend.invoice_generator import (
    InvoiceContactDetails,
    InvoiceDetails,
    InvoiceFooterDetails,
    InvoiceLine,
    build_invoice_filename,
    render_invoice_pdf,
)
from backend.models import (
    InvoiceCounterUpdate,
    InvoiceStartNumberUpdate,
    InvoiceNumberCorrection,
    ProfileInput,
    ProfileDeleteConfirmation,
    BackupRequest,
    InvoiceCreate,
    InvoicePeriod,
    LogoUpload,
    OrganizationSettingsUpdate,
    SettingsUpdate,
    TrainingCreate,
    TrainingUpdate,
    WeeklyPlanEntry,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        target = getattr(app.state, "test_database_path", None) or resolve_database_path()
        legacy = os.environ.get("TTC_LEGACY_DATABASE")
        prepare_database(target, Path(legacy) if legacy else None)
    except (OSError, sqlite3.Error, ValueError) as error:
        code = error_code(error)
        print("TTC_DATABASE_ERROR:" + code, file=sys.stderr, flush=True)
        raise RuntimeError(MESSAGES[code]) from None
    try:
        with document_operation("prepare"):
            directory = getattr(app.state, "test_invoice_directory", None) or get_invoice_directory()
            prepare_invoice_documents(target, directory, get_default_document_directory())
            prepare_invoice_documents(target, directory, get_legacy_document_directory())
    except DocumentOperationError as error:
        print("TTC_DOCUMENT_ERROR:" + error.code, file=sys.stderr, flush=True)
        raise RuntimeError(error.detail) from None
    yield


# Die eingebauten Dokumentationsoberflächen laden externe CDN-Ressourcen.
# Das lokale OpenAPI-Schema bleibt für Entwicklung und Werkzeuge verfügbar.
app = FastAPI(
    title="TT Rechnungsverwaltung",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    swagger_ui_oauth2_redirect_url=None,
)
app.add_middleware(DesktopUpdateGate, token=os.environ.get("TTC_DESKTOP_UPDATE_CONTROL"))
logger = logging.getLogger(__name__)


def get_database_path() -> Path:
    return resolve_database_path()


def get_invoice_directory() -> Path:
    with document_operation("configure"):
        return get_document_directory()


def _cleanup_invoice_pdf(documents: DocumentStore, name: str, identity: DocumentIdentity) -> None:
    with document_operation("cleanup"):
        documents.delete(name, expected=identity, missing_ok=True)


def get_profile_database_path(request: Request, database_path: Annotated[Path, Depends(get_database_path)]) -> Path:
    header = request.headers.get("X-Profile-ID")
    query = request.query_params.get("profile_id")
    if header is not None and query is not None and header != query:
        raise HTTPException(status_code=422, detail="Widersprüchlicher Profilkontext")
    raw = header if header is not None else query if query is not None else "1"
    if len(raw) > 19 or not raw.isascii() or not raw.isdigit() or not 1 <= int(raw) <= 9223372036854775807:
        raise HTTPException(status_code=422, detail="Ungültige Profil-ID")
    identifier = int(raw)
    organization = get_organization(database_path, identifier)
    if organization is None or organization.get("is_archived"):
        raise HTTPException(status_code=404, detail="Profil wurde nicht gefunden")
    return ProfileDatabasePath(database_path, identifier)


DatabasePath = Annotated[Path, Depends(get_profile_database_path)]
InvoiceDirectory = Annotated[Path, Depends(get_invoice_directory)]
MAX_LOGO_BYTES = 2_000_000
MAX_LOGO_DIMENSION = 4000
MAX_LOGO_PIXELS = 16_000_000


def _validate_logo_image(data: bytes, media_type: str) -> None:
    if not data or len(data) > MAX_LOGO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Das Logo darf höchstens 2 MB groß sein",
        )

    if media_type == "image/png":
        if (
            not data.startswith(b"\x89PNG\r\n\x1a\n")
            or len(data) < 33
            or data[12:16] != b"IHDR"
            or b"IEND" not in data[-12:]
        ):
            raise HTTPException(
                status_code=422,
                detail="Die Logo-Datei ist kein gültiges PNG-Bild",
            )
        width, height = struct.unpack(">II", data[16:24])
    else:
        if not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
            raise HTTPException(
                status_code=422,
                detail="Die Logo-Datei ist kein gültiges JPEG-Bild",
            )
        width = height = 0
        position = 2
        start_of_frame = {
            0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
            0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF,
        }
        while position < len(data) - 2:
            if data[position] != 0xFF:
                break
            while position < len(data) and data[position] == 0xFF:
                position += 1
            if position >= len(data):
                break
            marker = data[position]
            position += 1
            if marker == 0xDA:
                break
            if marker in {0xD8, 0xD9, 0x01} or 0xD0 <= marker <= 0xD7:
                continue
            if position + 2 > len(data):
                break
            segment_length = int.from_bytes(data[position:position + 2], "big")
            if segment_length < 2 or position + segment_length > len(data):
                break
            if marker in start_of_frame and segment_length >= 7:
                height = int.from_bytes(data[position + 3:position + 5], "big")
                width = int.from_bytes(data[position + 5:position + 7], "big")
                break
            position += segment_length
        if width == 0 or height == 0:
            raise HTTPException(
                status_code=422,
                detail="Die Logo-Datei ist kein gültiges JPEG-Bild",
            )

    if (
        width < 1
        or height < 1
        or width > MAX_LOGO_DIMENSION
        or height > MAX_LOGO_DIMENSION
        or width * height > MAX_LOGO_PIXELS
    ):
        raise HTTPException(
            status_code=422,
            detail="Das Logo darf höchstens 4000 × 4000 Pixel groß sein",
        )


def _public_organization_settings(
    organization: dict[str, Any] | None,
) -> dict[str, Any]:
    if organization is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organisationseinstellungen wurden nicht gefunden",
        )
    return {
        key: value
        for key, value in organization.items()
        if key not in {"logo_data", "logo_path", "signature_json"}
    } | {"logo_available": organization["logo_data"] is not None}


@app.exception_handler(sqlite3.IntegrityError)
async def handle_integrity_error(_, _error: sqlite3.IntegrityError) -> JSONResponse:
    logger.warning("Database constraint violation: %s", _error.sqlite_errorname)
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": "Die Änderung verletzt eine Datenbankregel"},
    )


@app.exception_handler(DocumentOperationError)
async def handle_document_error(_, error: DocumentOperationError) -> JSONResponse:
    return document_error_response(error)


@app.exception_handler(sqlite3.DatabaseError)
async def handle_database_error(_, error: sqlite3.DatabaseError) -> JSONResponse:
    code = error_code(error)
    logger.error("Database operation failed: %s", code)
    return JSONResponse(status_code=503, content={"detail": MESSAGES[code]})


@app.exception_handler(RecordNotFoundError)
async def handle_record_not_found(_, error: RecordNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(error)})


@app.exception_handler(InvalidRecordError)
async def handle_invalid_record(_, error: InvalidRecordError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(error)})


@app.get("/api/profiles")
def profiles(database_path: Annotated[Path, Depends(get_database_path)]):
    return list_profiles(database_path)


@app.post("/api/profiles", status_code=201)
def post_profile(payload: ProfileInput, database_path: Annotated[Path, Depends(get_database_path)]):
    return create_profile(payload.name, database_path)


@app.put("/api/profiles/{identifier}")
def put_profile(identifier: int, payload: ProfileInput, database_path: Annotated[Path, Depends(get_database_path)]):
    if not rename_profile(identifier, payload.name, database_path):
        raise HTTPException(status_code=404, detail="Profil wurde nicht gefunden")
    return {"id": identifier, "name": payload.name}


@app.get("/api/profiles/{identifier}/deletion")
def get_profile_deletion(identifier: int, database_path: Annotated[Path, Depends(get_database_path)]):
    return profile_deletion_summary(identifier, database_path)


@app.delete("/api/profiles/{identifier}")
def remove_profile(identifier: int, payload: ProfileDeleteConfirmation,
                   database_path: Annotated[Path, Depends(get_database_path)]):
    with delete_profile_transaction(identifier, payload.model_dump(), database_path):
        pass
    return {"profiles": list_profiles(database_path), "retained_documents": 0}



@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/organization/settings")
def get_organization_settings(database_path: DatabasePath) -> dict[str, Any]:
    return _public_organization_settings(get_organization(database_path))


@app.put("/api/organization/settings")
def put_organization_settings(
    payload: OrganizationSettingsUpdate,
    database_path: DatabasePath,
) -> dict[str, Any]:
    values = payload.model_dump(exclude_unset=True)
    if values.get("logo_enabled"):
        organization = get_organization(database_path)
        if organization is None or organization["logo_data"] is None:
            raise HTTPException(
                status_code=422,
                detail="Lade zuerst ein Logo hoch, bevor du es aktivierst",
            )
    if not update_organization(values, database_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organisationseinstellungen wurden nicht gefunden",
        )
    return _public_organization_settings(get_organization(database_path))


@app.get("/api/organization/invoice-counter/{year}")
def read_invoice_counter(year: int, database_path: DatabasePath):
    if not 1 <= year <= 9999:
        raise HTTPException(status_code=422, detail="Ungültiges Rechnungsjahr")
    return get_invoice_counter(year, database_path)


@app.put("/api/organization/invoice-counter/{year}")
def write_invoice_counter(year: int, payload: InvoiceCounterUpdate, database_path: DatabasePath):
    try:
        return set_invoice_counter(year, payload.next_number, database_path, confirm_reuse=payload.confirm_reuse)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.put("/api/organization/invoice-counter/{year}/start")
def write_invoice_start_number(year: int, payload: InvoiceStartNumberUpdate, database_path: DatabasePath):
    try:
        return set_invoice_start_number(year, payload.start_number, database_path,
                                        confirm_external=payload.confirm_external)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/organization/logo")
def upload_organization_logo(
    payload: LogoUpload,
    database_path: DatabasePath,
) -> dict[str, Any]:
    try:
        logo_data = base64.b64decode(payload.data_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(
            status_code=422,
            detail="Die Logo-Datei ist ungültig kodiert",
        ) from error
    _validate_logo_image(logo_data, payload.media_type)
    update_organization(
        {
            "logo_data": logo_data,
            "logo_media_type": payload.media_type,
            "logo_path": None,
            "logo_enabled": True,
        },
        database_path,
    )
    return _public_organization_settings(get_organization(database_path))


@app.delete("/api/organization/logo")
def delete_organization_logo(database_path: DatabasePath) -> dict[str, Any]:
    update_organization(
        {
            "logo_data": None,
            "logo_media_type": None,
            "logo_path": None,
            "logo_enabled": False,
        },
        database_path,
    )
    return _public_organization_settings(get_organization(database_path))


@app.get("/api/organization/logo")
def get_organization_logo(database_path: DatabasePath) -> Response:
    organization = get_organization(database_path)
    if (
        organization is None
        or organization["logo_data"] is None
        or not organization["logo_media_type"]
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Es ist kein Logo gespeichert",
        )
    return Response(
        content=organization["logo_data"],
        media_type=organization["logo_media_type"],
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/settings")
def get_settings(database_path: DatabasePath) -> dict[str, Any]:
    return {"activities": list_records("activity_types", database_path=database_path)}


@app.put("/api/settings")
def put_settings(
    payload: SettingsUpdate,
    database_path: DatabasePath,
) -> dict[str, Any]:
    save_activities([activity.model_dump() for activity in payload.activities], database_path)
    return get_settings(database_path)


@app.get("/api/weekly-plan")
def get_weekly_plan(database_path: DatabasePath) -> list[dict[str, Any]]:
    return list_records("weekly_plan", database_path=database_path)


@app.put("/api/weekly-plan")
def put_weekly_plan(
    entries: list[WeeklyPlanEntry],
    database_path: DatabasePath,
    response: Response,
) -> list[dict[str, Any]]:
    result = save_weekly_plan([entry.model_dump() for entry in entries], database_path)
    response.headers["X-Weekly-Plan-Sync"] = json.dumps(result)
    return get_weekly_plan(database_path)


@app.get("/api/calendar/{year}/{month}")
def get_calendar(
    year: int,
    month: int,
    database_path: DatabasePath,
) -> dict[str, Any]:
    if not 1 <= year <= 9999 or not 1 <= month <= 12:
        raise HTTPException(
            status_code=422,
            detail="Jahr oder Monat liegt außerhalb des gültigen Bereichs",
        )

    last_day = calendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)
    if month_start >= date.today().replace(day=1):
        ensure_weekly_plan_month(month_start, database_path)
    trainings = list_records("trainings", database_path=database_path)
    activities = {
        activity["id"]: activity
        for activity in list_records("activity_types", database_path=database_path)
    }

    days = []
    for day_number in range(1, last_day + 1):
        current_date = date(year, month, day_number)
        day_string = current_date.isoformat()
        day_trainings = [
            training
            for training in trainings
            if training["training_date"] == day_string
        ]
        for training in day_trainings:
            activity = activities.get(training["activity_type_id"])
            training["activity_name"] = (
                activity["name"] if activity is not None else None
            )
        days.append({"date": day_string, "trainings": day_trainings})

    return {"year": year, "month": month, "days": days}


@app.post("/api/calendar/{year}/{month}/complete")
def complete_calendar_month(
    year: int,
    month: int,
    database_path: DatabasePath,
) -> dict[str, int]:
    if not 1 <= year <= 9999 or not 1 <= month <= 12:
        raise HTTPException(
            status_code=422,
            detail="Jahr oder Monat liegt außerhalb des gültigen Bereichs",
        )

    return {"updated_count": complete_planned_month(year, month, database_path)}


@app.post("/api/trainings", status_code=status.HTTP_201_CREATED)
def post_training(
    payload: TrainingCreate,
    database_path: DatabasePath,
) -> dict[str, Any]:
    activity = get_record(
        "activity_types",
        payload.activity_type_id,
        database_path,
    )
    if activity is None or not activity["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Aktive Tätigkeitsart wurde nicht gefunden",
        )

    training_id = create_record(
        "trainings",
        {
            "training_date": payload.training_date.isoformat(),
            "activity_type_id": payload.activity_type_id,
            "hours": payload.hours,
            "status": payload.status,
            "note": payload.note,
            "unit_rate_cents": activity["hourly_rate_cents"],
        },
        database_path,
    )
    return get_record("trainings", training_id, database_path) or {}


@app.put("/api/trainings/{training_id}")
def put_training(
    training_id: int,
    payload: TrainingUpdate,
    database_path: DatabasePath,
) -> dict[str, Any]:
    existing = get_record("trainings", training_id, database_path)
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trainingstermin wurde nicht gefunden",
        )

    values = payload.model_dump(exclude_unset=True)
    for field in ("training_date", "activity_type_id", "status"):
        if field in values and values[field] is None:
            raise HTTPException(
                status_code=422,
                detail=f"{field} darf nicht null sein",
            )
    if "training_date" in values:
        values["training_date"] = values["training_date"].isoformat()
    if "activity_type_id" in values:
        activity = get_record(
            "activity_types",
            values["activity_type_id"],
            database_path,
        )
        if activity is None or (
            not activity["is_active"]
            and payload.activity_type_id != existing["activity_type_id"]
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Aktive Tätigkeitsart wurde nicht gefunden",
            )
        values["unit_rate_cents"] = activity["hourly_rate_cents"]
    if values:
        update_record("trainings", training_id, values, database_path)
    return get_record("trainings", training_id, database_path) or {}


@app.delete("/api/trainings/{training_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_training(training_id: int, database_path: DatabasePath) -> Response:
    if not delete_record("trainings", training_id, database_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trainingstermin wurde nicht gefunden",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _build_invoice_items(
    year: int,
    month: int,
    database_path: Path,
) -> tuple[list[dict[str, Any]], int]:
    month_start = date(year, month, 1)
    month_end = date(year, month, calendar.monthrange(year, month)[1])
    activities = {
        activity["id"]: activity
        for activity in list_records("activity_types", database_path=database_path)
    }
    items = []
    total_amount_cents = 0
    for training in list_records(
        "trainings",
        {"status": "completed"},
        database_path,
    ):
        training_date = date.fromisoformat(training["training_date"])
        if not month_start <= training_date <= month_end:
            continue
        activity = activities.get(training["activity_type_id"])
        if activity is None:
            continue
        if training["hours"] is None:
            amount_cents = training["unit_rate_cents"]
        else:
            amount_cents = int(
                (
                    Decimal(str(training["hours"]))
                    * training["unit_rate_cents"]
                ).quantize(
                    Decimal("1"),
                    rounding=ROUND_HALF_UP,
                )
            )
        items.append(
            {
                "training_id": training["id"],
                "description": activity["name"],
                "training_date": training["training_date"],
                "hours": training["hours"],
                "unit_rate_cents": training["unit_rate_cents"],
                "amount_cents": amount_cents,
            }
        )
        total_amount_cents += amount_cents
    return items, total_amount_cents


def _with_invoice_signature(organization, override):
    organization = dict(organization)
    signature = json.loads(organization.get("signature_json") or "null")
    if signature:
        if override is not None:
            signature.update(override.model_dump())
        signature["name"] = " ".join(filter(None, (organization.get("issuer_first_name"), organization.get("issuer_last_name"))))
        try:
            validate_signature(signature)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
    organization["signature_json"] = json.dumps(signature)
    return organization


def _signature_preview_pdf(year, month, invoice_date, items, total, details):
    layout = {}
    lines = _pdf_lines(items)
    content = render_invoice_pdf(year, month, invoice_date, lines, total, details, layout)
    result = {"pdf_base64": base64.b64encode(content).decode(), "layout": layout}
    if details.signature and details.signature.get("enabled"):
        # An unsigned background prevents a stationary ghost image while dragging.
        background = render_invoice_pdf(year, month, invoice_date, lines, total, replace(details, signature=None))
        result["background_pdf_base64"] = base64.b64encode(background).decode()
    return result


def _pdf_lines(items):
    return [InvoiceLine(description=item["description"], training_date=date.fromisoformat(item["training_date"]),
        hours=Decimal(str(item["hours"])) if item["hours"] is not None else None,
        amount_cents=item["amount_cents"], unit_rate_cents=item["unit_rate_cents"]) for item in items]


@app.post("/api/invoices/preview")
def preview_invoice(
    payload: InvoiceCreate,
    database_path: DatabasePath,
) -> dict[str, Any]:
    items, total_amount_cents = _build_invoice_items(
        payload.year,
        payload.month,
        database_path,
    )
    invoice_date = payload.invoice_date or date.today()
    save_invoice_preview(
        payload.year,
        payload.month,
        invoice_date.isoformat(),
        total_amount_cents,
        items,
        database_path,
    )
    organization = get_organization(database_path)
    numbering = get_invoice_counter(invoice_date.year, database_path)
    proposed = numbering["invoice_number"]
    if payload.invoice_number:
        with get_connection(database_path) as connection:
            try:
                proposed, _ = select_number(connection, profile_id(database_path), invoice_date.year, payload.invoice_number)
            except NumberingError as error:
                raise HTTPException(422, str(error)) from error
    organization = _with_invoice_signature(organization, payload.signature)
    signature = json.loads(organization.get("signature_json") or "null")
    pdf_preview = {}
    if payload.render_pdf:
        try:
            pdf_preview = _signature_preview_pdf(payload.year, payload.month, invoice_date,
                items, total_amount_cents, _invoice_pdf_details(organization, proposed or ""))
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
    return {
        "invoice_date": invoice_date.isoformat(),
        "invoice_number": proposed,
        "signature": signature,
        **pdf_preview,
        "numbering": numbering,
        "numbering_mode": "manual" if payload.invoice_number else "automatic",
        "tax_id": organization.get("tax_id"),
        "additional_tax_info": organization.get("additional_tax_info"),
        "iban": " ".join(organization["iban"][i:i+4] for i in range(0, len(organization["iban"]), 4)),
        "bic": organization["bic"],
        "account_holder": organization["account_holder"],
        "bank_name": organization["bank_name"],
        "year": payload.year,
        "month": payload.month,
        "items": items,
        "total_amount_cents": total_amount_cents,
    }


@app.get("/api/annual-overview/{year}")
def annual_overview(year: int, database_path: DatabasePath):
    if not 1 <= year <= 9999:
        raise HTTPException(422, "Abrechnungsjahr muss zwischen 1 und 9999 liegen.")
    from backend.annual_overview import overview
    return overview(database_path, year)


@app.get("/api/annual-overview/{year}/{format}")
def annual_overview_export(year: int, format: str, database_path: DatabasePath):
    from backend.annual_overview import export_csv, export_pdf
    if format not in ("csv", "pdf"):
        raise HTTPException(404, "Unbekanntes Exportformat")
    data = annual_overview(year, database_path)
    content = export_csv(data) if format == "csv" else export_pdf(data)
    return Response(content, media_type="text/csv" if format == "csv" else "application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="Jahresuebersicht-{year}.{format}"'})


@app.get("/api/invoices")
def list_invoices(database_path: DatabasePath) -> list[dict[str, Any]]:
    invoices = [
        invoice
        for invoice in list_records("invoices", database_path=database_path)
        if not invoice["is_preview"]
    ]
    sorted_invoices = sorted(
        invoices,
        key=lambda invoice: (
            invoice["year"],
            invoice["month"],
            invoice["created_at"],
            invoice["id"],
        ),
        reverse=True,
    )
    private_fields = {
        "invoice_snapshot_json",
        "logo_snapshot",
        "logo_media_type",
        "is_preview",
    }
    result = []
    for invoice in sorted_invoices:
        try:
            snapshot = json.loads(invoice["invoice_snapshot_json"] or "null")
        except (ValueError, TypeError):
            snapshot = None
        recipient = ""
        if isinstance(snapshot, dict):
            recipient = " · ".join(
                value.strip() for key in ("recipient_name", "recipient_contact_name")
                if isinstance(value := snapshot.get(key), str) and value.strip()
            )
        result.append({
            **{key: value for key, value in invoice.items() if key not in private_fields},
            "recipient": recipient,
        })
    return result


def _invoice_pdf_details(organization, invoice_number):
    recipient_lines = tuple(
        line
        for line in (
            organization["recipient_name"],
            " ".join(filter(None, (organization.get("recipient_salutation"),
                                       organization.get("recipient_contact_name")))),
            organization["recipient_street"],
            organization["recipient_postal_code"] + (
                f" {organization['recipient_city']}"
                if organization["recipient_city"]
                else ""
            ),
            organization["recipient_email"],
        )
        if line
    )
    sender_lines = tuple(
        line
        for line in (
            organization["name"],
            " ".join(
                part
                for part in (
                    organization["issuer_first_name"],
                    organization["issuer_last_name"],
                )
                if part
            ),
            organization["street"],
            organization["address"],
            organization["postal_code"] + (
                f" {organization['city']}" if organization["city"] else ""
            ),
            organization["email"],
            organization["phone"] or "",
        )
        if line
    )
    tax_lines = tuple(
        line
        for line in (
            f"Steuer ID: {organization['tax_id']}" if organization.get("tax_id") else "",
            f"Steuernummer: {organization['tax_number']}"
            if organization["tax_number"]
            else "",
            f"USt-IdNr.: {organization['vat_id']}"
            if organization["vat_id"]
            else "",
        )
        if line
    )
    pdf_details = InvoiceDetails(
        signature=json.loads(organization.get("signature_json") or "null"),
        contact=InvoiceContactDetails(
            recipient_lines=recipient_lines,
            sender_lines=sender_lines,
            tax_lines=tax_lines,
        ),
        footer=InvoiceFooterDetails(
            tax_notice=organization.get("additional_tax_info") or "",
            account_holder=organization["account_holder"],
            iban=organization["iban"],
            bic=organization["bic"] or "",
            bank_name=organization["bank_name"] or "",
            payment_notice=organization["payment_notice"],
            invoice_footer=organization["invoice_footer"],
        ),
        invoice_number=invoice_number,
        city=organization["city"],
        invoice_text=organization["invoice_text"],
        standard_service_description=organization[
            "standard_service_description"
        ],
        logo_data=(
            organization["logo_data"] if organization["logo_enabled"] else None
        ),
        logo_media_type=(
            organization["logo_media_type"] if organization["logo_enabled"] else None
        ),
    )

    return pdf_details


@app.post("/api/invoices", status_code=status.HTTP_201_CREATED)
def post_invoice(
    payload: InvoiceCreate,
    database_path: DatabasePath,
    invoice_directory: InvoiceDirectory,
) -> dict[str, Any]:
    items, total_amount_cents = _build_invoice_items(
        payload.year,
        payload.month,
        database_path,
    )
    if not items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Für den ausgewählten Monat gibt es keine abrechenbaren Termine",
        )

    existing_invoices = list_records(
        "invoices",
        {"year": payload.year, "month": payload.month},
        database_path,
    )
    if any(not invoice["is_preview"] for invoice in existing_invoices):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Für diesen Monat wurde bereits eine Rechnung erstellt",
        )

    organization = get_organization(database_path)
    if organization is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organisationseinstellungen wurden nicht gefunden",
        )
    invoice_date = payload.invoice_date or date.today()
    with get_connection(database_path) as connection:
        try:
            invoice_number, sequence = select_number(connection, profile_id(database_path), invoice_date.year, payload.invoice_number)
        except NumberingError as error:
            raise HTTPException(409, str(error)) from error
    organization = _with_invoice_signature(organization, payload.signature)
    invoice_snapshot = {
        key: value
        for key, value in organization.items()
        if key not in {"id", "logo_data", "logo_path", "created_at", "updated_at",
                       "payment_due_days", "invoice_number_prefix", "next_invoice_number"}
    }
    invoice_snapshot.update(
        {
            "invoice_number": invoice_number,
            "invoice_date": invoice_date.isoformat(),
            "year": payload.year,
            "month": payload.month,
            "items": items,
        }
    )
    pdf_details = _invoice_pdf_details(organization, invoice_number)

    filename = build_invoice_filename(payload.year, payload.month)
    if profile_id(database_path) != 1:
        filename = f"profile-{profile_id(database_path)}-{filename}"
    with document_operation("write"):
        documents = DocumentStore(invoice_directory)
    pdf_content = render_invoice_pdf(
        payload.year,
        payload.month,
        invoice_date,
        [
            InvoiceLine(
                description=item["description"],
                training_date=date.fromisoformat(item["training_date"]),
                hours=(
                    Decimal(str(item["hours"]))
                    if item["hours"] is not None
                    else None
                ),
                amount_cents=item["amount_cents"],
                unit_rate_cents=item["unit_rate_cents"],
            )
            for item in items
        ],
        total_amount_cents,
        pdf_details,
    )
    with document_operation("write"):
        _, pdf_identity = documents.save_new_with_identity(filename, pdf_content)
    try:
        invoice_id = create_invoice_with_items(
            {
                "year": payload.year,
                "month": payload.month,
                "is_preview": 0,
                "organization_id": organization["id"],
                "invoice_date": invoice_date.isoformat(),
                "invoice_number": invoice_number,
                "total_amount_cents": total_amount_cents,
                "pdf_path": filename,
                "invoice_snapshot_json": json.dumps(
                    invoice_snapshot,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                "logo_snapshot": (
                    organization["logo_data"]
                    if organization["logo_enabled"]
                    else None
                ),
                "logo_media_type": (
                    organization["logo_media_type"]
                    if organization["logo_enabled"]
                    else None
                ),
            },
            [
                {**item, "organization_id": organization["id"]}
                for item in items
            ],
            database_path,
            expected_next_invoice_number=sequence,
            updated_next_invoice_number=sequence + 1,
            manual_invoice_number=bool(payload.invoice_number),
        )
    except InvoiceAlreadyExistsError as error:
        _cleanup_invoice_pdf(documents, filename, pdf_identity)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Für diesen Monat wurde bereits eine Rechnung erstellt",
        ) from error
    except InvoiceDocumentConflictError as error:
        _cleanup_invoice_pdf(documents, filename, pdf_identity)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Die PDF-Datei ist bereits einer anderen Rechnung zugeordnet",
        ) from error
    except ValueError as error:
        _cleanup_invoice_pdf(documents, filename, pdf_identity)
        if isinstance(error, NumberingError) or "rechnungsnummernkreis" in str(error).lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(error),
            ) from error
        raise
    except Exception:
        _cleanup_invoice_pdf(documents, filename, pdf_identity)
        raise

    invoice = get_invoice(invoice_id, database_path)
    if invoice is None:
        raise RuntimeError(f"Die soeben erstellte Rechnung {invoice_id} fehlt")
    return {
        key: value
        for key, value in invoice.items()
        if key not in {"invoice_snapshot_json", "logo_snapshot", "logo_media_type"}
    }


@app.put("/api/invoices/{invoice_id}/number")
def correct_invoice_number(invoice_id: int, payload: InvoiceNumberCorrection,
                           database_path: DatabasePath, invoice_directory: InvoiceDirectory):
    return _revise_invoice(invoice_id, payload, database_path, invoice_directory)


def _revise_invoice(invoice_id, payload, database_path, invoice_directory, signature_override=None):
    invoice = get_invoice(invoice_id, database_path)
    if signature_override is not None and invoice and invoice["pdf_path"] != signature_override.expected_pdf_path:
        raise HTTPException(409, "Die Rechnung wurde zwischenzeitlich geändert. Bitte erneut öffnen.")
    if invoice is None or invoice["is_preview"]:
        raise HTTPException(404, "Gespeicherte endgültige Rechnung wurde nicht gefunden")
    if invoice["invoice_number"] != payload.expected_invoice_number:
        raise HTTPException(409, "Die Rechnung wurde geändert. Bitte Archiv neu laden.")
    number = payload.invoice_number.strip()
    if number == invoice["invoice_number"] and signature_override is None:
        raise HTTPException(422, "Bitte eine geänderte Rechnungsnummer eingeben.")
    try:
        invoice_date = date.fromisoformat(invoice["invoice_date"])
        snapshot = json.loads(invoice["invoice_snapshot_json"] or "null")
        # Historical content must come exclusively from the saved snapshot.
        required = set(OrganizationSettingsUpdate.model_fields) - {"payment_due_days", "invoice_number_prefix", "recipient_salutation", "recipient_contact_name", "tax_id"}
        if not isinstance(snapshot, dict) or not required <= snapshot.keys():
            raise ValueError
        if (snapshot.get("year") != invoice["year"] or snapshot.get("month") != invoice["month"] or
                sum(item["amount_cents"] for item in invoice["items"]) != invoice["total_amount_cents"] or
                snapshot.get("invoice_number") != invoice["invoice_number"] or
                snapshot.get("invoice_date") != invoice["invoice_date"] or
                snapshot.get("items") != [{key: item[key] for key in
                    ("training_id", "description", "training_date", "hours", "unit_rate_cents", "amount_cents")}
                    for item in invoice["items"]]):
            raise ValueError
    except (ValueError, TypeError, KeyError):
        raise HTTPException(409, "Diese Bestandsrechnung besitzt keine vollständigen, passenden historischen Rechnungsangaben. Eine sichere PDF-Neuerzeugung ist nicht möglich; Original und Nummer bleiben erhalten.") from None
    if signature_override is not None:
        signature = json.loads(snapshot.get("signature_json") or "null")
        if not signature:
            raise HTTPException(422, "Diese Rechnung enthält keinen gespeicherten Unterschriftenstand.")
        signature.update(signature_override.model_dump(include=set(SignatureLayout.model_fields)))
        try:
            validate_signature(signature)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        snapshot["signature_json"] = json.dumps(signature)
    snapshot["invoice_number"] = number
    organization = {"recipient_salutation": "", "recipient_contact_name": "", "tax_id": None, **snapshot, "logo_data": invoice["logo_snapshot"], "logo_media_type": invoice["logo_media_type"]}
    old_reference = None
    old_identity = None
    with document_operation("inspect"):
        documents = DocumentStore(invoice_directory)
        if invoice["pdf_path"]:
            try:
                old_reference = get_owned_invoice_document(invoice, database_path)
                old_identity = documents.get_identity(old_reference)
            except FileNotFoundError:
                pass
            except InvoiceDocumentAssociationError:
                raise HTTPException(409, "Die gespeicherte PDF ist nicht eindeutig zugeordnet. Die Korrektur wurde abgebrochen.") from None
    with get_connection(database_path) as connection:
        try:
            select_number(connection, profile_id(database_path), invoice_date.year, number, exclude_id=invoice_id)
        except NumberingError as error:
            raise HTTPException(422, str(error)) from error
    content = render_invoice_pdf(invoice["year"], invoice["month"], invoice_date,
        [InvoiceLine(description=item["description"], training_date=date.fromisoformat(item["training_date"]),
                     hours=Decimal(str(item["hours"])) if item["hours"] is not None else None,
                     amount_cents=item["amount_cents"], unit_rate_cents=item["unit_rate_cents"])
         for item in invoice["items"]], invoice["total_amount_cents"], _invoice_pdf_details(organization, number))
    base = build_invoice_filename(invoice["year"], invoice["month"])
    if profile_id(database_path) != 1:
        base = f"profile-{profile_id(database_path)}-{base}"
    reference = base[:-4] + "-revision-" + uuid.uuid4().hex + ".pdf"
    with document_operation("write"):
        _, identity = documents.save_new_with_identity(reference, content)
    try:
        with get_connection(database_path) as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.row_factory = sqlite3.Row
            current = connection.execute("SELECT * FROM invoices WHERE id=? AND organization_id=current_profile()", (invoice_id,)).fetchone()
            if current is None or any(invoice.get(key) != value for key, value in dict(current).items()):
                raise HTTPException(409, "Die Rechnung wurde zwischenzeitlich geändert. Bitte neu laden.")
            try:
                select_number(connection, profile_id(database_path), invoice_date.year, number, exclude_id=invoice_id)
            except NumberingError as error:
                raise HTTPException(409, str(error)) from error
            if old_reference and [row[0] for row in connection.execute("SELECT id FROM invoices WHERE pdf_path=? COLLATE NOCASE", (old_reference,))] != [invoice_id]:
                raise HTTPException(409, "Die PDF-Zuordnung wurde zwischenzeitlich geändert.")
            if old_identity is not None:
                with document_operation("inspect"):
                    if documents.get_identity(old_reference) != old_identity:
                        raise HTTPException(409, "Die PDF wurde zwischenzeitlich geändert. Bitte prüfen.")
            connection.execute("UPDATE invoices SET invoice_number=?, invoice_snapshot_json=?, pdf_path=? WHERE id=?", (number, json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), reference, invoice_id))
            # A confirmed correction resets only this year's derived counter.
            # Explicit deletion markers remain until separately released.
            state = numbering_state(connection, profile_id(database_path), invoice_date.year)
            remember_next(connection, profile_id(database_path), invoice_date.year, state["next_number"])
    except Exception:
        _cleanup_invoice_pdf(documents, reference, identity)
        raise
    retained = False
    if old_reference and old_identity is not None:
        try:
            with invoice_document_deletion_guard(old_reference, database_path):
                documents.delete(old_reference, expected=old_identity, missing_ok=True)
        except (OSError, ValueError, DatabaseAccessError):
            retained = True
    return {"id": invoice_id, "invoice_number": number, "pdf_path": reference,
            "retained_previous_document": retained,
            "numbering": get_invoice_counter(invoice_date.year, database_path)}


@app.delete("/api/invoices/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invoice(
    invoice_id: int,
    database_path: DatabasePath,
    invoice_directory: InvoiceDirectory,
) -> Response:
    existing_invoice = get_invoice(invoice_id, database_path)
    if existing_invoice is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Endgültige Rechnung wurde nicht gefunden",
        )
    if existing_invoice["is_preview"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Rechnungsvorschauen können nicht gelöscht werden",
        )
    try:
        if existing_invoice["pdf_path"]:
            get_owned_invoice_document(existing_invoice, database_path)
    except InvoiceDocumentAssociationError as error:
        # Another completed deletion can invalidate the earlier ownership snapshot.
        if get_invoice(invoice_id, database_path) is None:
            raise HTTPException(404, "Endgültige Rechnung wurde nicht gefunden") from None
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Die zugehörige PDF-Datei konnte nicht sicher zugeordnet werden",
        ) from error

    pdf_identity = None
    with document_operation("inspect"):
        documents = DocumentStore(invoice_directory)
        if existing_invoice["pdf_path"]:
            try:
                pdf_identity = documents.get_identity(existing_invoice["pdf_path"])
            except FileNotFoundError:
                pass

    try:
        invoice = delete_final_invoice(invoice_id, database_path, expected_invoice=existing_invoice)
    except InvoiceDeletionConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Die Rechnung oder ihre Dateizuordnung wurde zwischenzeitlich geändert. Die Rechnung wurde nicht gelöscht; bitte den Bestand neu laden und prüfen.",
        ) from error
    except InvoicePreviewDeletionError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Rechnungsvorschauen können nicht gelöscht werden",
        ) from error
    if invoice is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Endgültige Rechnung wurde nicht gefunden",
        )

    pdf_path = invoice["pdf_path"]
    if pdf_path and pdf_identity is not None:
        try:
            expected_filename = invoice_document_name(invoice)
        except InvoiceDocumentAssociationError as error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Rechnung wurde gelöscht, die PDF-Datei konnte nicht sicher zugeordnet werden",
            ) from error
        try:
            with invoice_document_deletion_guard(expected_filename, database_path):
                with document_operation("delete"):
                    documents.delete(expected_filename, expected=pdf_identity, missing_ok=True)
        except InvoiceDeletionConflictError:
            raise DocumentOperationError("changed", "delete") from None
        except sqlite3.DatabaseError as error:
            logger.warning("Invoice document ownership check failed: %s", error_code(error))
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Die Rechnung wurde gelöscht, die PDF blieb erhalten, weil ihre Zuordnung nicht geprüft werden konnte. Datenbankverfügbarkeit und Dateibestand prüfen.",
            ) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/invoices/{invoice_id}/pdf")
def get_invoice_pdf(
    invoice_id: int,
    database_path: DatabasePath,
    invoice_directory: InvoiceDirectory,
) -> FileResponse:
    invoice = get_invoice(invoice_id, database_path)
    if invoice is None or not invoice["pdf_path"]:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Gespeicherte PDF-Rechnung wurde nicht gefunden",
        )

    try:
        reference = get_owned_invoice_document(invoice, database_path)
    except InvoiceDocumentAssociationError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Gespeicherte PDF-Rechnung wurde nicht gefunden",
        ) from error
    with document_operation("read"):
        pdf_path = DocumentStore(invoice_directory).get_file(reference)
    return DocumentPDFResponse(
        pdf_path,
        media_type="application/pdf",
        filename=reference,
        content_disposition_type="inline",
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/backups")
def backup_data(request: BackupRequest, database_path: DatabasePath, invoice_directory: InvoiceDirectory) -> dict:
    from backend.backup_service import create_backup
    try:
        path = create_backup(database_path, invoice_directory, Path(request.directory) if request.directory else Path.home() / "ttc-rechnungsverwaltung-backups")
        return {"path": str(path)}
    except (OSError, sqlite3.Error, ValueError) as error:
        logger.warning("Backup failed: %s", type(error).__name__)
        raise HTTPException(503, "Sicherung fehlgeschlagen. Datenbestand, Zugriffsrechte und freien Speicher prüfen; vorhandene Daten bleiben erhalten.") from None


@app.get("/api/exports/download")
def export_data(database_path: DatabasePath, invoice_directory: InvoiceDirectory) -> FileResponse:
    import shutil
    import tempfile
    from starlette.background import BackgroundTask
    from backend.data_export import create_export
    temporary = Path(tempfile.mkdtemp(prefix="ttc-export-"))
    try:
        path = create_export(database_path, invoice_directory, temporary)
        return FileResponse(path, media_type="application/zip", filename="ttc-datenexport.zip",
                            background=BackgroundTask(shutil.rmtree, temporary))
    except (OSError, sqlite3.Error, ValueError):
        shutil.rmtree(temporary)
        raise HTTPException(503, "Export fehlgeschlagen. Dokumente, Datenbank, Zugriffsrechte und freien Speicher prüfen.") from None


@app.get("/api/organization/signature")
def get_signature(database_path: DatabasePath):
    organization = get_organization(database_path)
    return json.loads(organization.get("signature_json") or "null")


@app.post("/api/organization/signature")
def upload_signature(payload: SignatureUpload, database_path: DatabasePath):
    try:
        _, width, height = decode_png(payload.data_base64)
        signature = {**SignatureLayout().model_dump(), "data_base64": payload.data_base64,
                     "image_width": width, "image_height": height}
        # Tall images start higher on the page; retain the original aspect ratio.
        signature["y_mm"] = max(0, min(245, 290 - 50 * height / width))
        validate_signature(signature)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    update_organization({"signature_json": json.dumps(signature)}, database_path)
    return signature


@app.put("/api/organization/signature")
def update_signature(payload: SignatureLayout, database_path: DatabasePath):
    signature = get_signature(database_path)
    if not signature:
        raise HTTPException(404, "Bitte zuerst eine Unterschrift hinterlegen.")
    signature.update(payload.model_dump())
    try:
        validate_signature(signature)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    update_organization({"signature_json": json.dumps(signature)}, database_path)
    return signature


@app.delete("/api/organization/signature")
def delete_signature(database_path: DatabasePath):
    update_organization({"signature_json": None}, database_path)
    return {"deleted": True}


@app.get("/api/invoices/{invoice_id}/signature")
def saved_invoice_signature(invoice_id: int, database_path: DatabasePath):
    invoice = get_invoice(invoice_id, database_path)
    if not invoice or invoice["is_preview"]:
        raise HTTPException(404, "Rechnung wurde nicht gefunden.")
    snapshot = json.loads(invoice["invoice_snapshot_json"] or "{}")
    return {"signature": json.loads(snapshot.get("signature_json") or "null"),
            "invoice_number": invoice["invoice_number"], "pdf_path": invoice["pdf_path"]}


@app.post("/api/invoices/{invoice_id}/signature/preview")
def preview_saved_signature(invoice_id: int, payload: SignatureLayout, database_path: DatabasePath):
    invoice = get_invoice(invoice_id, database_path)
    if not invoice or invoice["is_preview"]:
        raise HTTPException(404, "Rechnung wurde nicht gefunden.")
    snapshot = json.loads(invoice["invoice_snapshot_json"] or "{}")
    signature = json.loads(snapshot.get("signature_json") or "null")
    if not signature:
        raise HTTPException(422, "Diese Rechnung enthält keinen gespeicherten Unterschriftenstand.")
    signature.update(payload.model_dump())
    try:
        validate_signature(signature)
        organization = {**snapshot, "signature_json": json.dumps(signature),
                        "logo_data": invoice["logo_snapshot"], "logo_media_type": invoice["logo_media_type"]}
        result = _signature_preview_pdf(invoice["year"], invoice["month"], date.fromisoformat(invoice["invoice_date"]),
            invoice["items"], invoice["total_amount_cents"], _invoice_pdf_details(organization, invoice["invoice_number"]))
    except (ValueError, KeyError) as error:
        raise HTTPException(422, "Der gespeicherte Rechnungsstand oder die Position ist ungültig.") from error
    return {"signature": signature, **result}


@app.put("/api/invoices/{invoice_id}/signature")
def revise_saved_signature(invoice_id: int, payload: SignatureRevision, database_path: DatabasePath,
                           invoice_directory: InvoiceDirectory):
    invoice = get_invoice(invoice_id, database_path)
    if not invoice or invoice["is_preview"]:
        raise HTTPException(404, "Rechnung wurde nicht gefunden.")
    if invoice["pdf_path"] != payload.expected_pdf_path:
        raise HTTPException(409, "Die Rechnung wurde zwischenzeitlich geändert. Bitte erneut öffnen.")
    return _revise_invoice(invoice_id, InvoiceNumberCorrection(invoice_number=invoice["invoice_number"],
        expected_invoice_number=invoice["invoice_number"], confirmed=True), database_path,
        invoice_directory, payload)


def _archived_database(identifier, database_path):
    organization = get_organization(database_path, identifier)
    if organization is None or not organization.get("is_archived"):
        raise HTTPException(404, "Archiviertes Profil wurde nicht gefunden.")
    return ProfileDatabasePath(database_path, identifier)


@app.get("/api/archived-profiles")
def archived_profiles(database_path: Annotated[Path, Depends(get_database_path)]):
    return list_archived_profiles(database_path)


@app.get("/api/archived-profiles/{identifier}/invoices")
def archived_invoices(identifier: int, database_path: Annotated[Path, Depends(get_database_path)]):
    return list_invoices(_archived_database(identifier, database_path))


@app.get("/api/archived-profiles/{identifier}/invoices/{invoice_id}/pdf")
def archived_invoice_pdf(identifier: int, invoice_id: int,
                         database_path: Annotated[Path, Depends(get_database_path)],
                         invoice_directory: InvoiceDirectory):
    return get_invoice_pdf(invoice_id, _archived_database(identifier, database_path), invoice_directory)


class RevalidatedStaticFiles(StaticFiles):
    """Revalidate local assets across desktop updates, including ES modules."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


app.mount(
    "/",
    RevalidatedStaticFiles(
        directory=PROJECT_ROOT / os.environ.get("TTC_FRONTEND_DIRECTORY", "frontend"),
        html=True,
    ),
    name="frontend",
)


