from io import BytesIO

from reportlab.pdfgen.canvas import Canvas

from backend.invoice_generator import (
    BODY_FONT,
    BODY_FONT_BOLD,
    CONTACT_DETAILS,
    PAGE_HEIGHT,
    PAGE_MARGIN,
    PAGE_WIDTH,
    draw_party_blocks,
)


class RecordingCanvas:
    def __init__(self) -> None:
        self.fonts: list[tuple[str, int]] = []
        self.left_aligned: list[tuple[int, float, str]] = []
        self.right_aligned: list[tuple[float, float, str]] = []

    def setFont(self, name: str, size: int) -> None:
        self.fonts.append((name, size))

    def drawString(self, x: int, y: float, text: str) -> None:
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