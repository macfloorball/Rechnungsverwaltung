from dataclasses import dataclass
from datetime import date
from typing import Protocol

from reportlab.lib.pagesizes import A4

PAGE_WIDTH, PAGE_HEIGHT = A4
PAGE_MARGIN = 70
BLOCK_TOP = 74
LINE_HEIGHT = 15
BODY_FONT = "Helvetica"
BODY_FONT_BOLD = "Helvetica-Bold"
BODY_FONT_SIZE = 11
HEADING_Y = PAGE_HEIGHT - 185
GERMAN_MONTHS = (
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
)


@dataclass(frozen=True)
class InvoiceContactDetails:
    recipient_lines: tuple[str, ...] = (
        "1. TTC Köln e.V.",
        "Herr Michael Simon",
        "Raschdorffstraße 28",
        "50933 Köln",
    )
    sender_lines: tuple[str, ...] = (
        "Danilo Kappen",
        "Peter-von-Fliesteden Str. 18",
        "50933 Köln",
        "Tel.: +49 1573 464 7094",
    )
    tax_id_label: str = "Steuer ID:"


CONTACT_DETAILS = InvoiceContactDetails()


class _TextCanvas(Protocol):
    def setFont(self, name: str, size: int) -> None: ...

    def drawString(self, x: float, y: float, text: str) -> None: ...

    def drawRightString(self, x: float, y: float, text: str) -> None: ...


def draw_party_blocks(
    pdf: _TextCanvas,
    contact_details: InvoiceContactDetails = CONTACT_DETAILS,
) -> None:
    pdf.setFont(BODY_FONT, BODY_FONT_SIZE)

    for index, line in enumerate(contact_details.recipient_lines):
        y = PAGE_HEIGHT - BLOCK_TOP - index * LINE_HEIGHT
        pdf.drawString(PAGE_MARGIN, y, line)

    for index, line in enumerate(contact_details.sender_lines):
        y = PAGE_HEIGHT - BLOCK_TOP - index * LINE_HEIGHT
        pdf.drawRightString(PAGE_WIDTH - PAGE_MARGIN, y, line)

    tax_id_y = (
        PAGE_HEIGHT
        - BLOCK_TOP
        - len(contact_details.sender_lines) * LINE_HEIGHT
        - 12
    )
    pdf.setFont(BODY_FONT_BOLD, BODY_FONT_SIZE)
    pdf.drawRightString(PAGE_WIDTH - PAGE_MARGIN, tax_id_y, contact_details.tax_id_label)


def draw_invoice_heading(
    pdf: _TextCanvas,
    year: int,
    month: int,
    invoice_date: date,
    city: str = "Köln",
) -> None:
    if not 1 <= year <= 9999:
        raise ValueError("Das Rechnungsjahr muss zwischen 1 und 9999 liegen")
    if not 1 <= month <= 12:
        raise ValueError("Der Abrechnungsmonat muss zwischen 1 und 12 liegen")

    period = f"{GERMAN_MONTHS[month - 1]} {year}"
    heading = f"Rechnung für die Übungsleitung im Zeitraum {period}"
    invoice_date_text = f"{city}, {invoice_date:%d.%m.%Y}"

    pdf.setFont(BODY_FONT_BOLD, BODY_FONT_SIZE)
    pdf.drawString(PAGE_MARGIN, HEADING_Y, heading)
    pdf.setFont(BODY_FONT, BODY_FONT_SIZE)
    pdf.drawRightString(PAGE_WIDTH - PAGE_MARGIN, HEADING_Y, invoice_date_text)