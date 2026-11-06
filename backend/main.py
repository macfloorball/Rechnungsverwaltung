import calendar
import base64
import binascii
import json
import logging
import sqlite3
import struct
from contextlib import asynccontextmanager
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.database import (
    DATABASE_PATH,
    PROJECT_ROOT,
    create_invoice_with_items,
    create_record,
    delete_record,
    get_invoice,
    get_organization,
    get_record,
    initialize_database,
    list_records,
    update_organization,
    update_record,
)
from backend.invoice_generator import (
    InvoiceLine,
    build_invoice_filename,
    render_invoice_pdf,
)
from backend.models import (
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
    initialize_database()
    yield


app = FastAPI(title="TTC-Rechnungsverwaltung", lifespan=lifespan)
logger = logging.getLogger(__name__)


def get_database_path() -> Path:
    return DATABASE_PATH


def get_invoice_directory() -> Path:
    return PROJECT_ROOT / "rechnungen"


DatabasePath = Annotated[Path, Depends(get_database_path)]
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
        if key not in {"logo_data", "logo_path"}
    } | {"logo_available": organization["logo_data"] is not None}


@app.exception_handler(sqlite3.IntegrityError)
async def handle_integrity_error(_, _error: sqlite3.IntegrityError) -> JSONResponse:
    logger.warning("Database constraint violation: %s", _error.sqlite_errorname)
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": "Die Änderung verletzt eine Datenbankregel"},
    )


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
    if len(payload.activities) > 4:
        raise HTTPException(
            status_code=422,
            detail="Es können höchstens vier Tätigkeitsarten verwaltet werden",
        )

    with sqlite3.connect(database_path) as connection:
        for activity in payload.activities:
            if activity.id is None:
                connection.execute(
                    """
                    INSERT INTO activity_types (name, hourly_rate_cents, is_active)
                    VALUES (?, ?, ?)
                    """,
                    (
                        activity.name,
                        activity.hourly_rate_cents,
                        activity.is_active,
                    ),
                )
            else:
                exists = connection.execute(
                    "SELECT 1 FROM activity_types WHERE id = ?",
                    (activity.id,),
                ).fetchone()
                if exists is None:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"Tätigkeitsart {activity.id} wurde nicht gefunden",
                    )
                connection.execute(
                    """
                    UPDATE activity_types
                    SET name = ?, hourly_rate_cents = ?, is_active = ?
                    WHERE id = ?
                    """,
                    (
                        activity.name,
                        activity.hourly_rate_cents,
                        activity.is_active,
                        activity.id,
                    ),
                )
    return get_settings(database_path)


@app.get("/api/weekly-plan")
def get_weekly_plan(database_path: DatabasePath) -> list[dict[str, Any]]:
    return list_records("weekly_plan", database_path=database_path)


@app.put("/api/weekly-plan")
def put_weekly_plan(
    entries: list[WeeklyPlanEntry],
    database_path: DatabasePath,
) -> list[dict[str, Any]]:
    with sqlite3.connect(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("DELETE FROM weekly_plan")
        connection.executemany(
            """
            INSERT INTO weekly_plan
                (weekday, activity_type_id, hours, is_active)
            VALUES (?, ?, ?, ?)
            """,
            [
                (
                    entry.weekday,
                    entry.activity_type_id,
                    entry.hours,
                    entry.is_active,
                )
                for entry in entries
            ],
        )
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
    plan = list_records(
        "weekly_plan",
        {"is_active": 1},
        database_path,
    )
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
        saved_activity_ids = {
            training["activity_type_id"] for training in day_trainings
        }
        for training in day_trainings:
            activity = activities.get(training["activity_type_id"])
            training["activity_name"] = (
                activity["name"] if activity is not None else None
            )
        for entry in plan:
            activity_id = entry["activity_type_id"]
            if (
                entry["weekday"] == current_date.weekday()
                and activity_id not in saved_activity_ids
            ):
                activity = activities.get(activity_id)
                if activity is not None and activity["is_active"]:
                    day_trainings.append(
                        {
                            "id": None,
                            "training_date": day_string,
                            "activity_type_id": activity["id"],
                            "activity_name": activity["name"],
                            "hours": entry["hours"],
                            "status": "planned",
                            "note": None,
                            "unit_rate_cents": activity["hourly_rate_cents"],
                        }
                    )
        days.append({"date": day_string, "trainings": day_trainings})

    return {"year": year, "month": month, "days": days}


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
    for field in ("training_date", "activity_type_id", "hours", "status"):
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
        if activity is None or not activity["is_active"]:
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
    for training in list_records("trainings", database_path=database_path):
        training_date = date.fromisoformat(training["training_date"])
        if not (
            month_start <= training_date <= month_end
            and training["status"] == "completed"
        ):
            continue
        activity = activities.get(training["activity_type_id"])
        if activity is None:
            continue
        amount_cents = int(
            (Decimal(str(training["hours"])) * training["unit_rate_cents"]).quantize(
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


@app.post("/api/invoices/preview")
def preview_invoice(
    payload: InvoicePeriod,
    database_path: DatabasePath,
) -> dict[str, Any]:
    items, total_amount_cents = _build_invoice_items(
        payload.year,
        payload.month,
        database_path,
    )
    return {
        "year": payload.year,
        "month": payload.month,
        "items": items,
        "total_amount_cents": total_amount_cents,
    }


@app.get("/api/invoices")
def list_invoices(database_path: DatabasePath) -> list[dict[str, Any]]:
    invoices = list_records("invoices", database_path=database_path)
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
    private_fields = {"invoice_snapshot_json", "logo_snapshot", "logo_media_type"}
    return [
        {key: value for key, value in invoice.items() if key not in private_fields}
        for invoice in sorted_invoices
    ]


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
    if existing_invoices:
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
    sequence = organization["next_invoice_number"]
    prefix = organization["invoice_number_prefix"].strip()
    existing_numbers = (
        invoice["invoice_number"]
        for invoice in list_records("invoices", database_path=database_path)
        if invoice["invoice_number"]
    )
    previous_sequence = 0
    for existing_number in existing_numbers:
        parts = existing_number.split("-")
        if (
            len(parts) >= 3
            and "-".join(parts[:-2]) == prefix
            and parts[-2].isdigit()
            and parts[-1].isdigit()
        ):
            previous_sequence = max(previous_sequence, int(parts[-1]))
    sequence = max(sequence, previous_sequence + 1)
    invoice_number = f"{prefix}-{payload.year}-{sequence:04d}"
    invoice_date = date.today()
    invoice_snapshot = {
        key: value
        for key, value in organization.items()
        if key not in {"id", "logo_data", "logo_path", "created_at", "updated_at"}
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

    filename = build_invoice_filename(payload.year, payload.month)
    pdf_path = invoice_directory / filename
    invoice_directory.mkdir(parents=True, exist_ok=True)
    pdf_content = render_invoice_pdf(
        payload.year,
        payload.month,
        invoice_date,
        [
            InvoiceLine(
                description=item["description"],
                training_date=date.fromisoformat(item["training_date"]),
                hours=Decimal(str(item["hours"])),
                amount_cents=item["amount_cents"],
                unit_rate_cents=item["unit_rate_cents"],
            )
            for item in items
        ],
        total_amount_cents,
    )
    try:
        with pdf_path.open("xb") as pdf_file:
            pdf_file.write(pdf_content)
    except FileExistsError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Die PDF-Datei für diesen Monat existiert bereits",
        ) from error
    except Exception:
        pdf_path.unlink(missing_ok=True)
        raise

    try:
        invoice_id = create_invoice_with_items(
            {
                "year": payload.year,
                "month": payload.month,
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
            expected_next_invoice_number=organization["next_invoice_number"],
            updated_next_invoice_number=sequence + 1,
        )
    except ValueError as error:
        pdf_path.unlink(missing_ok=True)
        if "rechnungsnummernkreis" in str(error):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Der Rechnungsnummernkreis wurde parallel geändert. Bitte versuche es erneut.",
            ) from error
        raise
    except Exception:
        pdf_path.unlink(missing_ok=True)
        raise

    invoice = get_invoice(invoice_id, database_path)
    if invoice is None:
        raise RuntimeError(f"Die soeben erstellte Rechnung {invoice_id} fehlt")
    return {
        key: value
        for key, value in invoice.items()
        if key not in {"invoice_snapshot_json", "logo_snapshot", "logo_media_type"}
    }


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

    stored_path = Path(invoice["pdf_path"])
    pdf_path = (invoice_directory / stored_path).resolve()
    invoice_directory = invoice_directory.resolve()
    if (
        stored_path.is_absolute()
        or stored_path
        != Path(build_invoice_filename(invoice["year"], invoice["month"]))
        or not pdf_path.is_relative_to(invoice_directory)
        or not pdf_path.is_file()
        or pdf_path.suffix.lower() != ".pdf"
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Gespeicherte PDF-Rechnung wurde nicht gefunden",
        )
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=build_invoice_filename(invoice["year"], invoice["month"]),
        content_disposition_type="inline",
    )


app.mount(
    "/",
    StaticFiles(directory=PROJECT_ROOT / "frontend", html=True),
    name="frontend",
)
