from io import BytesIO
from datetime import date
from decimal import Decimal

from reportlab.pdfgen.canvas import Canvas

from backend.invoice_generator import (
    BODY_FONT,
    BODY_FONT_BOLD,
    CONTACT_DETAILS,
    HEADING_Y,
    PAGE_HEIGHT,
    PAGE_MARGIN,
    PAGE_WIDTH,
    POSITION_COLUMN_WIDTHS,
    POSITION_HEADER,
    InvoiceLine,
    build_position_table,
    draw_party_blocks,
    draw_invoice_heading,
    draw_position_table,
)


class RecordingCanvas:
    def __init__(self) -> None:
        self.fonts: list[tuple[str, int]] = []
        self.left_aligned: list[tuple[float, float, str]] = []
        self.right_aligned: list[tuple[float, float, str]] = []

    def setFont(self, name: str, size: int) -> None:
        self.fonts.append((name, size))

    def drawString(self, x: float, y: float, text: str) -> None:
        self.left_aligned.append((x, y, text))

    def drawRightString(self, x: float, y: float, text: str) -> None:
        self.right_aligned.append((x, y, text))


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