import base64
from backend.signatures import geometry
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from html import escape
from io import BytesIO
from typing import Protocol, Sequence

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
from reportlab.pdfbase.pdfmetrics import getAscentDescent
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
POSITION_TABLE_TOP = PAGE_HEIGHT - 307
POSITION_COLUMN_WIDTHS = (240, 90, 45, PAGE_WIDTH - 2 * PAGE_MARGIN - 375)
POSITION_HEADER = ("Trainingseinheit:", "Datum", "Std.:", "Betrag:")
FOOTER_ROW_GAP = 40
FOOTER_LINE_GAP = 8
CONTENT_STYLE = ParagraphStyle(
    "InvoiceContent",
    fontName=BODY_FONT,
    fontSize=BODY_FONT_SIZE,
    leading=14,
    textColor=colors.black,
)
CONTENT_RIGHT_STYLE = ParagraphStyle(
    "InvoiceContentRight",
    parent=CONTENT_STYLE,
    alignment=2,
)
CONTENT_BOLD_STYLE = ParagraphStyle(
    "InvoiceContentBold",
    parent=CONTENT_STYLE,
    fontName=BODY_FONT_BOLD,
)


def build_invoice_filename(year: int, month: int) -> str:
    if not 1 <= year <= 9999:
        raise ValueError("Das Rechnungsjahr muss zwischen 1 und 9999 liegen")
    if not 1 <= month <= 12:
        raise ValueError("Der Abrechnungsmonat muss zwischen 1 und 12 liegen")
    return f"Rechnung_TTC_{year:04d}-{month:02d}.pdf"


@dataclass(frozen=True)
class InvoiceContactDetails:
    recipient_lines: tuple[str, ...] = ()
    sender_lines: tuple[str, ...] = ()
    tax_lines: tuple[str, ...] = ()


@dataclass(frozen=True)
class InvoiceFooterDetails:
    account_holder: str = ""
    iban: str = ""
    bic: str = ""
    bank_name: str = ""
    payment_notice: str = ""
    invoice_footer: str = ""
    due_date: date | None = None
    tax_notice: str = ""


@dataclass(frozen=True)
class InvoiceDetails:
    contact: InvoiceContactDetails = InvoiceContactDetails()
    footer: InvoiceFooterDetails = InvoiceFooterDetails()
    invoice_number: str = ""
    city: str = ""
    invoice_text: str = ""
    standard_service_description: str = ""
    signature: dict | None = None
    logo_data: bytes | None = None
    logo_media_type: str | None = None


CONTACT_DETAILS = InvoiceContactDetails()
FOOTER_DETAILS = InvoiceFooterDetails()


@dataclass(frozen=True)
class InvoiceLine:
    description: str
    training_date: date
    hours: Decimal | None
    amount_cents: int
    unit_rate_cents: int | None = None


class _TextCanvas(Protocol):
    def setFont(self, name: str, size: int) -> None: ...

    def drawString(self, x: float, y: float, text: str) -> None: ...

    def drawRightString(self, x: float, y: float, text: str) -> None: ...

    def setLineWidth(self, width: float) -> None: ...

    def line(self, x1: float, y1: float, x2: float, y2: float) -> None: ...


def _draw_paragraph(
    pdf: Canvas,
    text: str,
    x: float,
    top_y: float,
    width: float,
    style: ParagraphStyle = CONTENT_STYLE,
) -> float:
    paragraph = Paragraph(escape(text).replace("\n", "<br/>"), style)
    _, height = paragraph.wrap(width, PAGE_HEIGHT)
    paragraph.drawOn(pdf, x, top_y - height)
    return top_y - height - 4


def _draw_image(
    pdf: Canvas,
    image_data: bytes,
    top_y: float,
) -> float:
    image = ImageReader(BytesIO(image_data))
    width, height = image.getSize()
    if width <= 0 or height <= 0:
        raise ValueError("Das Logo hat ungültige Abmessungen")
    box_width = 140
    box_height = 55
    scale = min(box_width / width, box_height / height)
    rendered_width = width * scale
    rendered_height = height * scale
    x = PAGE_WIDTH - PAGE_MARGIN - rendered_width
    y = top_y - rendered_height
    pdf.drawImage(
        image,
        x,
        y,
        width=rendered_width,
        height=rendered_height,
        preserveAspectRatio=True,
        mask="auto",
    )
    return y


def draw_invoice_rate_details(
    pdf: _TextCanvas,
    items: Sequence[InvoiceLine],
    top_y: float = HEADING_Y - 27,
    intro_text: str = "",
    service_description: str = "",
) -> float:
    rates = list(
        dict.fromkeys(
            (item.description, item.unit_rate_cents)
            for item in items
            if item.unit_rate_cents is not None
        )
    )
    y = top_y
    if rates:
        pdf.setFont(BODY_FONT_BOLD, BODY_FONT_SIZE)
        pdf.drawString(PAGE_MARGIN, y, "Honorar:")
        y -= 18
        pdf.setFont(BODY_FONT, BODY_FONT_SIZE)
        for description, rate_cents in rates:
            line = f"{_format_euros(rate_cents)} / Stunde {description}"
            pdf.drawString(PAGE_MARGIN, y, line)
            y -= LINE_HEIGHT

    if service_description:
        y -= 4
        for line in service_description.splitlines():
            pdf.drawString(PAGE_MARGIN, y, line)
            y -= LINE_HEIGHT
    pdf.drawString(
        PAGE_MARGIN,
        y - 4,
        intro_text or "Hiermit stelle ich folgenden Betrag in Rechnung:",
    )
    y -= 18
    return y


def render_invoice_pdf(
    year: int,
    month: int,
    invoice_date: date,
    items: Sequence[InvoiceLine],
    total_amount_cents: int,
    details: InvoiceDetails | None = None,
    layout_result: dict | None = None,
) -> bytes:
    build_invoice_filename(year, month)
    details = details or InvoiceDetails()
    output = BytesIO()
    pdf = Canvas(output, pagesize=A4)
    contact_bottom_y = draw_party_blocks(
        pdf,
        details.contact,
        details.logo_data,
        details.logo_media_type,
    )
    heading_y = contact_bottom_y - 42
    draw_invoice_heading(
        pdf,
        year,
        month,
        invoice_date,
        city=details.city,
        invoice_number=details.invoice_number,
        top_y=heading_y,
    )
    intro_y = draw_invoice_rate_details(
        pdf,
        items,
        top_y=heading_y - 30,
        intro_text=details.invoice_text,
        service_description=details.standard_service_description,
    )
    # Split ReportLab's existing table; repeat its header on subsequent pages.
    table = build_position_table(items)
    top = intro_y - 12
    page_count = 1
    while True:
        _, height = table.wrapOn(pdf, PAGE_WIDTH - 2 * PAGE_MARGIN, PAGE_HEIGHT)
        if height <= top - PAGE_MARGIN:
            table.drawOn(pdf, PAGE_MARGIN, top - height)
            bottom = top - height
            break
        parts = table.splitOn(pdf, PAGE_WIDTH - 2 * PAGE_MARGIN, top - PAGE_MARGIN)
        if not parts:
            raise ValueError("Eine Rechnungsposition ist zu groß für eine PDF-Seite.")
        _, height = parts[0].wrapOn(pdf, PAGE_WIDTH - 2 * PAGE_MARGIN, PAGE_HEIGHT)
        parts[0].drawOn(pdf, PAGE_MARGIN, top - height)
        pdf.showPage()
        page_count += 1
        top = PAGE_HEIGHT - PAGE_MARGIN
        table = parts[1]
    # Measure footer on a disposable canvas before drawing, to avoid partial output.
    try:
        final_y = draw_invoice_footer(Canvas(BytesIO(), pagesize=A4), total_amount_cents, bottom, details.footer)
    except ValueError:
        pdf.showPage()
        page_count += 1
        bottom = PAGE_HEIGHT - PAGE_MARGIN
    def footer_page():
        nonlocal page_count
        pdf.showPage()
        page_count += 1
    final_y = draw_invoice_footer(pdf, total_amount_cents, bottom, details.footer, new_page=footer_page)
    signature = details.signature
    collision = False
    if signature and signature.get('enabled') and signature.get('data_base64'):
        left, top_mm, box_width, box_height = geometry(signature)
        # All invoice content on the last page lies above final_y. Conservatively
        # treat its full content band as occupied rather than permit hidden text.
        mm = 72 / 25.4
        content_top = PAGE_MARGIN if page_count > 1 else BLOCK_TOP
        collision = (top_mm * mm < PAGE_HEIGHT - final_y and
                     (top_mm + box_height) * mm > content_top and
                     left * mm < PAGE_WIDTH - PAGE_MARGIN and
                     (left + box_width) * mm > PAGE_MARGIN)
        image_height = signature['width_mm'] * signature['image_height'] / signature['image_width']
        pdf.drawImage(ImageReader(BytesIO(base64.b64decode(signature['data_base64']))),
                      signature['x_mm'] * mm, PAGE_HEIGHT - (top_mm + image_height) * mm,
                      width=signature['width_mm'] * mm, height=image_height * mm, mask='auto')
        pdf.setFont(BODY_FONT, BODY_FONT_SIZE)
        pdf.drawCentredString((signature['x_mm'] + signature['width_mm'] / 2) * mm,
                             PAGE_HEIGHT - (top_mm + image_height + 5) * mm, signature.get('name', ''))
    if layout_result is not None:
        layout_result.update(pages=page_count, collision=collision)
    pdf.save()
    return output.getvalue()


def draw_party_blocks(
    pdf: Canvas,
    contact_details: InvoiceContactDetails = CONTACT_DETAILS,
    logo_data: bytes | None = None,
    logo_media_type: str | None = None,
) -> float:
    if logo_data is not None and logo_media_type not in {"image/png", "image/jpeg"}:
        raise ValueError("Der Logo-Dateityp wird nicht unterstützt")

    top_y = PAGE_HEIGHT - BLOCK_TOP
    image_bottom = (
        _draw_image(pdf, logo_data, top_y) if logo_data is not None else top_y
    )
    sender_x = PAGE_WIDTH / 2 + 10
    sender_width = PAGE_WIDTH - PAGE_MARGIN - sender_x
    recipient_width = PAGE_WIDTH / 2 - PAGE_MARGIN - 10
    left_y = top_y
    right_y = top_y
    pdf.setFont(BODY_FONT, BODY_FONT_SIZE)

    for line in contact_details.recipient_lines:
        left_y = _draw_paragraph(
            pdf,
            line,
            PAGE_MARGIN,
            left_y,
            recipient_width,
        )

    for line in contact_details.sender_lines:
        right_y = _draw_paragraph(
            pdf,
            line,
            sender_x,
            right_y,
            sender_width,
            CONTENT_RIGHT_STYLE,
        )

    for line in contact_details.tax_lines:
        right_y = _draw_paragraph(
            pdf,
            line,
            sender_x,
            right_y,
            sender_width,
            CONTENT_RIGHT_STYLE,
        )

    if logo_data is not None:
        right_y = min(right_y, image_bottom - 4)
    return min(left_y, right_y)


def draw_invoice_heading(
    pdf: _TextCanvas,
    year: int,
    month: int,
    invoice_date: date,
    city: str = "",
    invoice_number: str = "",
    top_y: float = HEADING_Y,
) -> None:
    if not 1 <= year <= 9999:
        raise ValueError("Das Rechnungsjahr muss zwischen 1 und 9999 liegen")
    if not 1 <= month <= 12:
        raise ValueError("Der Abrechnungsmonat muss zwischen 1 und 12 liegen")

    period = f"{GERMAN_MONTHS[month - 1]} {year}"
    heading = f"Rechnung für Leistungen im Zeitraum {period}"
    invoice_date_text = f"{city + ', ' if city else ''}{invoice_date:%d.%m.%Y}"

    pdf.setFont(BODY_FONT_BOLD, BODY_FONT_SIZE)
    pdf.drawString(PAGE_MARGIN, top_y, heading)
    pdf.setFont(BODY_FONT, BODY_FONT_SIZE)
    pdf.drawRightString(PAGE_WIDTH - PAGE_MARGIN, top_y, invoice_date_text)
    if invoice_number:
        pdf.drawString(PAGE_MARGIN, top_y - 17, f"Rechnungsnummer: {invoice_number}")


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
    rows = [[Paragraph(label, header_style) for label in POSITION_HEADER]]
    for item in items:
        if (item.hours is not None and item.hours <= 0) or item.amount_cents < 0:
            raise ValueError("Rechnungspositionen müssen gültige Werte enthalten")
        rows.append(
            [
                Paragraph(escape(item.description), description_style),
                item.training_date.strftime("%d.%m.%Y"),
                _format_hours(item.hours) if item.hours is not None else "–",
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


def draw_invoice_footer(
    pdf: _TextCanvas,
    total_amount_cents: int,
    table_bottom_y: float,
    details: InvoiceFooterDetails = FOOTER_DETAILS,
    *, new_page=None,
) -> float:
    if total_amount_cents < 0:
        raise ValueError("Die Rechnungssumme darf nicht negativ sein")

    total_y = table_bottom_y - FOOTER_ROW_GAP
    # Canvas text coordinates mark the baseline, not the visual text centre.
    ascent, _ = getAscentDescent(BODY_FONT_BOLD, BODY_FONT_SIZE)
    rule_top_y = total_y + ascent + FOOTER_LINE_GAP
    # Neither "Endsumme:" nor the formatted amount has descending glyphs.
    rule_bottom_y = total_y - FOOTER_LINE_GAP
    lines = []
    if details.account_holder:
        lines.append(f"Kontoinhaber: {details.account_holder}")
    if details.iban:
        iban = "".join(details.iban.split())
        lines.append("IBAN: " + " ".join(iban[i:i+4] for i in range(0, len(iban), 4)))
    if details.bic:
        lines.append(f"BIC: {details.bic}")
    if details.bank_name:
        lines.append(f"Bank: {details.bank_name}")
    if details.due_date:
        lines.append(f"Zahlbar bis: {details.due_date:%d.%m.%Y}")
    if details.payment_notice:
        lines.extend(details.payment_notice.splitlines())
    if details.invoice_footer:
        lines.extend(details.invoice_footer.splitlines())

    content_top_y = rule_bottom_y - 30
    if lines:
        lines.insert(0, "Bankverbindung:")
    tax_lines = details.tax_notice.split("\n") if details.tax_notice.strip() else []
    bank_heading_index = len(tax_lines)
    lines = tax_lines + lines
    rendered = [
        Paragraph(
            escape(line) or "<br/>",
            CONTENT_BOLD_STYLE if index == bank_heading_index and line == "Bankverbindung:" else CONTENT_STYLE,
        )
        for index, line in enumerate(lines)
    ]
    heights = [
        paragraph.wrap(PAGE_WIDTH - 2 * PAGE_MARGIN, PAGE_HEIGHT)[1]
        for paragraph in rendered
    ]
    final_y = content_top_y - sum(height + 4 for height in heights)
    if final_y < PAGE_MARGIN and new_page is None:
        raise ValueError("Die Rechnungspositionen passen nicht mit dem Footer auf eine Seite")

    pdf.setLineWidth(0.5)
    pdf.line(PAGE_MARGIN, rule_top_y, PAGE_WIDTH - PAGE_MARGIN, rule_top_y)
    pdf.setFont(BODY_FONT_BOLD, BODY_FONT_SIZE)
    pdf.drawString(PAGE_MARGIN, total_y, "Endsumme:")
    pdf.drawRightString(
        PAGE_WIDTH - PAGE_MARGIN,
        total_y,
        _format_euros(total_amount_cents),
    )
    pdf.line(PAGE_MARGIN, rule_bottom_y, PAGE_WIDTH - PAGE_MARGIN, rule_bottom_y)

    y = content_top_y
    for paragraph, height in zip(rendered, heights, strict=True):
        if y - height < PAGE_MARGIN and new_page is not None:
            new_page()
            y = PAGE_HEIGHT - PAGE_MARGIN
        paragraph.drawOn(pdf, PAGE_MARGIN, y - height)
        y -= height + 4
    return y
