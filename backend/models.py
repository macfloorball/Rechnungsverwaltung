from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class APIModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ActivityInput(APIModel):
    id: int | None = Field(default=None, gt=0)
    name: str = Field(min_length=1, max_length=100)
    hourly_rate_cents: int = Field(ge=0)
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Der Name darf nicht leer sein")
        return value


class SettingsUpdate(APIModel):
    activities: list[ActivityInput]


class WeeklyPlanEntry(APIModel):
    id: int | None = Field(default=None, gt=0)
    weekday: int = Field(ge=0, le=6)
    activity_type_id: int = Field(gt=0)
    hours: float = Field(gt=0, allow_inf_nan=False)
    is_active: bool = True


class TrainingCreate(APIModel):
    training_date: date
    activity_type_id: int = Field(gt=0)
    hours: float = Field(gt=0, allow_inf_nan=False)
    status: Literal["planned", "completed", "cancelled"] = "planned"
    note: str | None = Field(default=None, max_length=1000)


class TrainingUpdate(APIModel):
    training_date: date | None = None
    activity_type_id: int | None = Field(default=None, gt=0)
    hours: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    status: Literal["planned", "completed", "cancelled"] | None = None
    note: str | None = Field(default=None, max_length=1000)


class InvoicePeriod(APIModel):
    year: int = Field(ge=1, le=9999)
    month: int = Field(ge=1, le=12)


class InvoiceCreate(InvoicePeriod):
    invoice_date: date
    invoice_number: str | None = Field(default=None, max_length=100)