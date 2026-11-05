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
    InvoiceLine,
    InvoiceFooterDetails,
    build_position_table,
    build_invoice_filename,
    draw_invoice_footer,
    draw_party_blocks,
    draw_invoice_heading,
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
            )
        ],
        3000,
    )

    assert pdf.startswith(b"%PDF-")
    assert pdf.endswith(b"%%EOF\n")


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


def test_party_blocks_include_template_contact_details() -> None:
    pdf = RecordingCanvas()
    draw_party_blocks(pdf)

    assert [line[2] for line in pdf.left_aligned] == list(
        CONTACT_DETAILS.recipient_lines
    )
    assert [line[2] for line in pdf.right_aligned] == [
        *CONTACT_DETAILS.sender_lines,
        "Steuer ID:",
    ]
    assert pdf.left_aligned[0][0] == PAGE_MARGIN
    assert pdf.right_aligned[0][0] == PAGE_WIDTH - PAGE_MARGIN
    assert pdf.fonts == [(BODY_FONT, 11), (BODY_FONT_BOLD, 11)]
    assert pdf.right_aligned[-1][1] < pdf.right_aligned[-2][1]


def test_party_blocks_render_to_a_valid_pdf() -> None:
    output = BytesIO()
    pdf = Canvas(output, pagesize=(PAGE_WIDTH, PAGE_HEIGHT))
    draw_party_blocks(pdf)
    pdf.save()

    assert output.getvalue().startswith(b"%PDF-")


def test_invoice_heading_includes_period_and_invoice_date() -> None:
    pdf = RecordingCanvas()
    draw_invoice_heading(pdf, 2026, 7, date(2026, 8, 1))

    assert pdf.left_aligned == [
        (
            PAGE_MARGIN,
            HEADING_Y,
            "Rechnung für die Übungsleitung im Zeitraum Juli 2026",
        )
    ]
    assert pdf.right_aligned == [
        (PAGE_WIDTH - PAGE_MARGIN, HEADING_Y, "Köln, 01.08.2026")
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
    pdf = RecordingCanvas()
    sender_y = draw_invoice_footer(pdf, 27000, 430)

    left_text = [line[2] for line in pdf.left_aligned]
    assert left_text == [
        "Endsumme:",
        "Bankverbindung:",
        "Kontoinhaber: Danilo Kappen",
        "IBAN:",
        "Volksbank Köln Bonn eG",
        "Mit freundlichen Grüßen",
        "Danilo Kappen",
    ]
    assert pdf.right_aligned == [(PAGE_WIDTH - PAGE_MARGIN, 390, "270€")]
    assert len(pdf.lines) == 2
    assert all(line[0] == PAGE_MARGIN and line[2] == PAGE_WIDTH - PAGE_MARGIN for line in pdf.lines)
    assert sender_y == pdf.left_aligned[-1][1]
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
    assert b"Bankverbindung:" in output.getvalue()
    assert b"Volksbank K" in output.getvalue()
    assert b"Mit freundlichen Gr" in output.getvalue()