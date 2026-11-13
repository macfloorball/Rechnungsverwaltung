from datetime import date
import re
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


class OrganizationSettingsUpdate(APIModel):
    name: str = Field(default="", max_length=200)
    address: str = Field(default="", max_length=500)
    street: str = Field(default="", max_length=200)
    postal_code: str = Field(default="", max_length=20)
    city: str = Field(default="", max_length=100)
    recipient_name: str = Field(default="", max_length=200)
    recipient_street: str = Field(default="", max_length=200)
    recipient_postal_code: str = Field(default="", max_length=20)
    recipient_city: str = Field(default="", max_length=100)
    recipient_email: str = Field(default="", max_length=254)
    issuer_first_name: str = Field(default="", max_length=100)
    issuer_last_name: str = Field(default="", max_length=100)
    email: str = Field(default="", max_length=254)
    phone: str | None = Field(default=None, max_length=50)
    iban: str = Field(default="", max_length=34)
    bic: str | None = Field(default=None, max_length=11)
    account_holder: str = Field(default="", max_length=200)
    bank_name: str | None = Field(default=None, max_length=200)
    tax_number: str | None = Field(default=None, max_length=100)
    vat_id: str | None = Field(default=None, max_length=100)
    additional_tax_info: str | None = Field(default=None, max_length=1000)
    logo_enabled: bool = False
    invoice_number_prefix: str = Field(default="RE", min_length=1, max_length=30)
    payment_due_days: int = Field(default=14, ge=0, le=3650)
    invoice_text: str = Field(default="", max_length=2000)
    payment_notice: str = Field(default="", max_length=2000)
    standard_service_description: str = Field(default="", max_length=500)
    invoice_footer: str = Field(default="", max_length=2000)

    @field_validator(
        "name",
        "address",
        "street",
        "postal_code",
        "city",
        "recipient_name",
        "recipient_street",
        "recipient_postal_code",
        "recipient_city",
        "recipient_email",
        "issuer_first_name",
        "issuer_last_name",
        "email",
        "iban",
        "account_holder",
        "invoice_number_prefix",
        "invoice_text",
        "payment_notice",
        "standard_service_description",
        "invoice_footer",
        mode="before",
    )
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("phone", "bic", "bank_name", "tax_number", "vat_id", "additional_tax_info")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @field_validator("email", "recipient_email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        if value and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Bitte gib eine gültige E-Mail-Adresse ein")
        return value

    @field_validator("iban")
    @classmethod
    def validate_iban(cls, value: str) -> str:
        value = "".join(value.upper().split())
        if not value:
            return value
        if not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]{11,30}", value):
            raise ValueError("Bitte gib eine gültige IBAN ein")
        rearranged = value[4:] + value[:4]
        remainder = 0
        for character in rearranged:
            digits = str(ord(character) - ord("A") + 10) if character.isalpha() else character
            for digit in digits:
                remainder = (remainder * 10 + int(digit)) % 97
        if remainder != 1:
            raise ValueError("Bitte gib eine gültige IBAN ein")
        return value

    @field_validator("bic")
    @classmethod
    def validate_bic(cls, value: str | None) -> str | None:
        if value and not re.fullmatch(r"[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?", value.upper()):
            raise ValueError("Bitte gib eine gültige BIC ein")
        return value.upper() if value else value

    @field_validator("invoice_number_prefix")
    @classmethod
    def validate_invoice_number_prefix(cls, value: str) -> str:
        if not value or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", value):
            raise ValueError("Das Rechnungsnummern-Präfix enthält ungültige Zeichen")
        return value


class LogoUpload(APIModel):
    media_type: Literal["image/png", "image/jpeg"]
    data_base64: str = Field(min_length=1, max_length=2_800_000)


class WeeklyPlanEntry(APIModel):
    id: int | None = Field(default=None, gt=0)
    weekday: int = Field(ge=0, le=6)
    activity_type_id: int = Field(gt=0)
    hours: int = Field(gt=0, strict=True)
    is_active: bool = True


class TrainingCreate(APIModel):
    training_date: date
    activity_type_id: int = Field(gt=0)
    hours: int | None = Field(default=None, gt=0, strict=True)
    status: Literal["planned", "completed", "cancelled"] = "planned"
    note: str | None = Field(default=None, max_length=1000)


class TrainingUpdate(APIModel):
    training_date: date | None = None
    activity_type_id: int | None = Field(default=None, gt=0)
    hours: int | None = Field(default=None, gt=0, strict=True)
    status: Literal["planned", "completed", "cancelled"] | None = None
    note: str | None = Field(default=None, max_length=1000)


class InvoicePeriod(APIModel):
    year: int = Field(ge=1, le=9999)
    month: int = Field(ge=1, le=12)


class InvoiceCreate(InvoicePeriod):
    invoice_date: date | None = None

class BackupRequest(APIModel):
    directory: str | None = Field(default=None, min_length=1, max_length=4096)
