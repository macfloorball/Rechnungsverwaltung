import base64
import re
from io import BytesIO
from datetime import date
from decimal import Decimal

from reportlab.pdfgen.canvas import Canvas

from backend.invoice_generator import (
    BODY_FONT,
    BODY_FONT_BOLD,
    CONTACT_DETAILS,
    FOOTER_DETAILS,
    HEADING_Y,
    PAGE_HEIGHT,
    PAGE_MARGIN,
    PAGE_WIDTH,
    POSITION_COLUMN_WIDTHS,
    POSITION_HEADER,
    InvoiceContactDetails,
    InvoiceDetails,
    InvoiceLine,
    InvoiceFooterDetails,
    build_position_table,
    build_invoice_filename,
    draw_invoice_footer,
    draw_party_blocks,
    draw_invoice_heading,
    draw_invoice_rate_details,
    draw_position_table,
    render_invoice_pdf,
)


def test_invoice_filename_uses_zero_padded_year_and_month() -> None:
    assert build_invoice_filename(2026, 1) == "Rechnung_TTC_2026-01.pdf"
    assert build_invoice_filename(2026, 11) == "Rechnung_TTC_2026-11.pdf"
    assert build_invoice_filename(1, 12) == "Rechnung_TTC_0001-12.pdf"


def test_invoice_filename_rejects_invalid_year_or_month() -> None:
    for year, month in ((0, 1), (10000, 1), (2026, 0), (2026, 13)):
        try:
            build_invoice_filename(year, month)
        except ValueError:
            pass
        else:
            raise AssertionError("Ungültiger Rechnungszeitraum wurde akzeptiert")


def test_render_invoice_pdf_creates_complete_pdf_document() -> None:
    pdf = render_invoice_pdf(
        2026,
        11,
        date(2026, 12, 1),
        [
            InvoiceLine(
                description="Training",
                training_date=date(2026, 11, 5),
                hours=Decimal("2"),
                amount_cents=3000,
                unit_rate_cents=1500,
            )
        ],
        3000,
    )

    assert pdf.startswith(b"%PDF-")
    assert pdf.endswith(b"%%EOF\n")


def test_invoice_pdf_uses_standard_fonts_and_symbol_fallbacks() -> None:
    pdf = render_invoice_pdf(
        2026,
        11,
        date(2026, 12, 1),
        [InvoiceLine(
            description="Übung für ÄÖÜ, äöü, ß · 30 € · Ω ✓",
            training_date=date(2026, 11, 5),
            hours=Decimal("2"),
            amount_cents=3000,
            unit_rate_cents=1500,
        )],
        3000,
    )
    assert set(re.findall(rb"/BaseFont /([^\s/>]+)", pdf)) == {
        b"Helvetica", b"Helvetica-Bold", b"Symbol", b"ZapfDingbats",
    }
    assert b"/FontFile" not in pdf


class RecordingCanvas:
    def __init__(self) -> None:
        self.fonts: list[tuple[str, int]] = []
        self.left_aligned: list[tuple[float, float, str]] = []
        self.right_aligned: list[tuple[float, float, str]] = []
        self.lines: list[tuple[float, float, float, float]] = []

    def setFont(self, name: str, size: int) -> None:
        self.fonts.append((name, size))

    def drawString(self, x: float, y: float, text: str) -> None:
        self.left_aligned.append((x, y, text))

    def drawRightString(self, x: float, y: float, text: str) -> None:
        self.right_aligned.append((x, y, text))

    def setLineWidth(self, width: float) -> None:
        pass

    def line(self, x1: float, y1: float, x2: float, y2: float) -> None:
        self.lines.append((x1, y1, x2, y2))


def test_invoice_rate_details_include_prices_and_intro_text() -> None:
    pdf = RecordingCanvas()
    draw_invoice_rate_details(
        pdf,
        [
            InvoiceLine(
                description="Trainingseinheit",
                training_date=date(2026, 7, 3),
                hours=Decimal("2"),
                amount_cents=3000,
                unit_rate_cents=1500,
            ),
            InvoiceLine(
                description="Assistenz-Trainingseinheit",
                training_date=date(2026, 7, 3),
                hours=Decimal("1"),
                amount_cents=2000,
                unit_rate_cents=2000,
            ),
        ],
    )

    assert [line[2] for line in pdf.left_aligned] == [
        "Honorar:",
        "15€ / Stunde Trainingseinheit",
        "20€ / Stunde Assistenz-Trainingseinheit",
        "Hiermit stelle ich folgenden Betrag in Rechnung:",
    ]


def test_party_blocks_include_template_contact_details() -> None:
    pdf = RecordingCanvas()
    details = InvoiceContactDetails(
        recipient_lines=("Rechnungsempfänger GmbH", "Beispielstraße 1"),
        sender_lines=("Beispielverein", "Max Muster"),
        tax_lines=("Steuernummer: 12/345/67890",),
    )
    output = BytesIO()
    canvas = Canvas(output, pagesize=(PAGE_WIDTH, PAGE_HEIGHT), pageCompression=0)
    draw_party_blocks(canvas, details)
    canvas.save()

    assert output.getvalue().startswith(b"%PDF-")
    assert CONTACT_DETAILS == InvoiceContactDetails()
    assert b"Danilo Kappen" not in output.getvalue()
    assert b"Michael Simon" not in output.getvalue()


def test_party_blocks_render_to_a_valid_pdf() -> None:
    output = BytesIO()
    pdf = Canvas(output, pagesize=(PAGE_WIDTH, PAGE_HEIGHT))
    draw_party_blocks(pdf)
    pdf.save()

    assert output.getvalue().startswith(b"%PDF-")


def test_invoice_heading_includes_period_and_invoice_date() -> None:
    pdf = RecordingCanvas()
    draw_invoice_heading(
        pdf,
        2026,
        7,
        date(2026, 8, 1),
        city="Bonn",
        invoice_number="BEISP-2026-0001",
    )

    assert pdf.left_aligned == [
        (
            PAGE_MARGIN,
            HEADING_Y,
            "Rechnung für Leistungen im Zeitraum Juli 2026",
        ),
        (PAGE_MARGIN, HEADING_Y - 17, "Rechnungsnummer: BEISP-2026-0001"),
    ]
    assert pdf.right_aligned == [
        (PAGE_WIDTH - PAGE_MARGIN, HEADING_Y, "Bonn, 01.08.2026")
    ]
    assert pdf.fonts == [(BODY_FONT_BOLD, 11), (BODY_FONT, 11)]


def test_invoice_heading_rejects_invalid_month() -> None:
    pdf = RecordingCanvas()

    try:
        draw_invoice_heading(pdf, 2026, 13, date(2026, 12, 1))
    except ValueError as error:
        assert str(error) == "Der Abrechnungsmonat muss zwischen 1 und 12 liegen"
    else:
        raise AssertionError("Ungültiger Abrechnungsmonat wurde akzeptiert")


def test_position_table_formats_invoice_fields_like_template() -> None:
    table = build_position_table(
        [
            InvoiceLine(
                description="Trainingseinheit-Freitag",
                training_date=date(2026, 7, 3),
                hours=Decimal("2"),
                amount_cents=3000,
            ),
            InvoiceLine(
                description="Assistenz-Trainingseinheit",
                training_date=date(2026, 7, 10),
                hours=Decimal("1.5"),
                amount_cents=3050,
            ),
        ]
    )

    header, first_row, second_row = table._cellvalues
    assert [cell.getPlainText() for cell in header] == list(POSITION_HEADER)
    assert first_row[0].getPlainText() == "Trainingseinheit-Freitag"
    assert first_row[1:] == ["03.07.2026", "2", "30€"]
    assert second_row[0].getPlainText() == "Assistenz-Trainingseinheit"
    assert second_row[1:] == ["10.07.2026", "1,5", "30,50€"]
    assert sum(table._colWidths) == PAGE_WIDTH - 2 * PAGE_MARGIN
    assert tuple(table._colWidths) == POSITION_COLUMN_WIDTHS


def test_position_table_draws_to_a_valid_pdf() -> None:
    output = BytesIO()
    pdf = Canvas(output, pagesize=(PAGE_WIDTH, PAGE_HEIGHT), pageCompression=0)
    bottom_y = draw_position_table(
        pdf,
        [
            InvoiceLine(
                description="Spielbetreuung",
                training_date=date(2026, 7, 3),
                hours=Decimal("2"),
                amount_cents=2400,
            )
        ],
    )
    pdf.save()

    assert bottom_y < PAGE_HEIGHT
    assert output.getvalue().startswith(b"%PDF-")
    assert b"Spielbetreuung" in output.getvalue()


def test_invoice_footer_includes_total_bank_details_and_greeting() -> None:
    output = BytesIO()
    pdf = Canvas(output, pagesize=(PAGE_WIDTH, PAGE_HEIGHT), pageCompression=0)
    details = InvoiceFooterDetails(
        account_holder="Beispielverein",
        iban="DE89370400440532013000",
        bic="GENODEF1S04",
        bank_name="Beispielbank",
        payment_notice="Bitte innerhalb von 14 Tagen zahlen.",
        invoice_footer="Vereinsregister Bonn",
        due_date=date(2026, 8, 15),
    )
    draw_invoice_footer(pdf, 27000, 430, details)
    commands = "\n".join(pdf._code)
    pdf.save()

    assert output.getvalue().startswith(b"%PDF-")
    assert "Kontoinhaber: Beispielverein" in commands
    assert "IBAN: DE89 3704 0044 0532 0130 00" in commands
    assert "BIC: GENODEF1S04" in commands
    assert "Beispielbank" in commands
    assert "Zahlbar bis: 15.08.2026" in commands
    assert "Bitte innerhalb von 14 Tagen zahlen." in commands
    assert "Vereinsregister Bonn" in commands
    assert FOOTER_DETAILS.iban == ""


def test_invoice_footer_rejects_negative_total_and_page_overflow() -> None:
    pdf = RecordingCanvas()
    for total, table_bottom in ((-1, 430), (0, 130)):
        try:
            draw_invoice_footer(pdf, total, table_bottom)
        except ValueError:
            pass
        else:
            raise AssertionError("Ungültige Footer-Werte wurden akzeptiert")


def test_invoice_footer_renders_bank_and_greeting_to_pdf() -> None:
    output = BytesIO()
    pdf = Canvas(output, pagesize=(PAGE_WIDTH, PAGE_HEIGHT), pageCompression=0)
    draw_invoice_footer(
        pdf,
        27000,
        430,
        InvoiceFooterDetails(iban=""),
    )
    pdf.save()

    assert output.getvalue().startswith(b"%PDF-")
    assert b"/Subtype /Image" not in output.getvalue()
    assert FOOTER_DETAILS == InvoiceFooterDetails()


def test_invoice_without_optional_details_and_with_logo_renders() -> None:
    item = InvoiceLine(
        description="Training",
        training_date=date(2026, 11, 5),
        hours=Decimal("1"),
        amount_cents=1500,
        unit_rate_cents=1500,
    )
    without_optional = render_invoice_pdf(
        2026,
        11,
        date(2026, 11, 6),
        [item],
        1500,
        InvoiceDetails(),
    )
    logo = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2cAAAAASUVORK5CYII="
    )
    with_logo = render_invoice_pdf(
        2026,
        11,
        date(2026, 11, 6),
        [item],
        1500,
        InvoiceDetails(
            contact=InvoiceContactDetails(("Empfänger",), ("Absender",)),
            logo_data=logo,
            logo_media_type="image/png",
        ),
    )

    assert without_optional.startswith(b"%PDF-")
    assert with_logo.startswith(b"%PDF-")
    assert b"/Subtype /Image" not in without_optional
    assert b"/Subtype /Image" in with_logo


def test_total_rules_have_equal_clearance_from_font_bounds():
    from reportlab.pdfbase.pdfmetrics import getAscentDescent
    from backend.invoice_generator import BODY_FONT_SIZE, FOOTER_LINE_GAP
    pdf = RecordingCanvas()
    draw_invoice_footer(pdf, 3000, 430)
    baseline = next(y for _, y, text in pdf.left_aligned if text == 'Endsumme:')
    ascent, _ = getAscentDescent(BODY_FONT_BOLD, BODY_FONT_SIZE)
    top, bottom = (line[1] for line in pdf.lines)
    assert abs(top - (baseline + ascent) - FOOTER_LINE_GAP) < 0.001
    assert abs(baseline - bottom - FOOTER_LINE_GAP) < 0.001
