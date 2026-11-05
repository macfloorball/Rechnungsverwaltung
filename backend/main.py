import calendar
import logging
import sqlite3
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
    get_record,
    initialize_database,
    list_records,
    update_record,
)
from backend.models import (
    InvoiceCreate,
    InvoicePeriod,
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


DatabasePath = Annotated[Path, Depends(get_database_path)]


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


@app.get("/api/settings")
def get_settings(database_path: DatabasePath) -> dict[str, Any]:
    return {"activities": list_records("activity_types", database_path=database_path)}


@app.put("/api/settings")
def put_settings(
    payload: SettingsUpdate,
    database_path: DatabasePath,
) -> dict[str, Any]:
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
                if activity is not None:
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


@app.post("/api/invoices", status_code=status.HTTP_201_CREATED)
def post_invoice(
    payload: InvoiceCreate,
    database_path: DatabasePath,
) -> dict[str, Any]:
    items, total_amount_cents = _build_invoice_items(
        payload.year,
        payload.month,
        database_path,
    )
    invoice_id = create_invoice_with_items(
        {
            "year": payload.year,
            "month": payload.month,
            "invoice_date": payload.invoice_date.isoformat(),
            "invoice_number": payload.invoice_number,
            "total_amount_cents": total_amount_cents,
        },
        items,
        database_path,
    )
    return get_invoice(invoice_id, database_path) or {}


@app.get("/api/invoices/{invoice_id}/pdf")
def get_invoice_pdf(invoice_id: int, database_path: DatabasePath) -> FileResponse:
    invoice = get_invoice(invoice_id, database_path)
    if invoice is None or not invoice["pdf_path"]:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Gespeicherte PDF-Rechnung wurde nicht gefunden",
        )

    pdf_path = Path(invoice["pdf_path"]).resolve()
    invoice_directory = (PROJECT_ROOT / "rechnungen").resolve()
    if (
        not pdf_path.is_relative_to(invoice_directory)
        or not pdf_path.is_file()
        or pdf_path.suffix.lower() != ".pdf"
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Gespeicherte PDF-Rechnung wurde nicht gefunden",
        )
    return FileResponse(pdf_path, media_type="application/pdf")


app.mount(
    "/",
    StaticFiles(directory=PROJECT_ROOT / "frontend", html=True),
    name="frontend",
)
