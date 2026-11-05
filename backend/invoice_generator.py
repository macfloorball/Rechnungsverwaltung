from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from html import escape
from typing import Protocol, Sequence

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph, Table, TableStyle

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
POSITION_TABLE_TOP = PAGE_HEIGHT - 330
POSITION_COLUMN_WIDTHS = (240, 90, 45, PAGE_WIDTH - 2 * PAGE_MARGIN - 375)
POSITION_HEADER = ("Trainingseinheit:", "Datum", "Std.:", "Betrag:")


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


@dataclass(frozen=True)
class InvoiceLine:
    description: str
    training_date: date
    hours: Decimal
    amount_cents: int


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


def _format_hours(hours: Decimal) -> str:
    return format(hours.normalize(), "f").replace(".", ",")


def _format_euros(amount_cents: int) -> str:
    euros, cents = divmod(amount_cents, 100)
    whole_euros = f"{euros:,}".replace(",", ".")
    if cents == 0:
        return f"{whole_euros}€"
    return f"{whole_euros},{cents:02d}€"


def build_position_table(items: Sequence[InvoiceLine]) -> Table:
    description_style = ParagraphStyle(
        "InvoicePosition",
        fontName=BODY_FONT,
        fontSize=BODY_FONT_SIZE,
        leading=13,
        textColor=colors.black,
    )
    header_style = ParagraphStyle(
        "InvoicePositionHeader",
        parent=description_style,
        fontName=BODY_FONT_BOLD,
    )
    rows = [
        [Paragraph(label, header_style) for label in POSITION_HEADER]
    ]
    for item in items:
        if item.hours <= 0 or item.amount_cents < 0:
            raise ValueError("Rechnungspositionen müssen gültige Werte enthalten")
        rows.append(
            [
                Paragraph(escape(item.description), description_style),
                item.training_date.strftime("%d.%m.%Y"),
                _format_hours(item.hours),
                _format_euros(item.amount_cents),
            ]
        )

    table = Table(
        rows,
        colWidths=POSITION_COLUMN_WIDTHS,
        repeatRows=1,
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (0, 0), (1, -1), "LEFT"),
                ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
                ("FONTNAME", (0, 0), (-1, 0), BODY_FONT_BOLD),
                ("FONTNAME", (0, 1), (-1, -1), BODY_FONT),
                ("FONTSIZE", (0, 0), (-1, -1), BODY_FONT_SIZE),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, 0), 4),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
                ("TOPPADDING", (0, 1), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 1),
            ]
        )
    )
    return table


def draw_position_table(
    pdf: Canvas,
    items: Sequence[InvoiceLine],
    top_y: float = POSITION_TABLE_TOP,
) -> float:
    table = build_position_table(items)
    _, height = table.wrapOn(pdf, PAGE_WIDTH - 2 * PAGE_MARGIN, top_y)
    bottom_y = top_y - height
    table.drawOn(pdf, PAGE_MARGIN, bottom_y)
    return bottom_y