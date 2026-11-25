"""Local PNG signatures and PDF coordinates (millimetres, origin top left)."""
import base64
from io import BytesIO
import warnings

from PIL import Image
from reportlab.pdfbase.pdfmetrics import stringWidth

from backend.models import SignatureLayout


def decode_png(encoded):
    try:
        data = base64.b64decode(encoded, validate=True)
        if len(data) > 2_000_000:
            raise ValueError()
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format != 'PNG' or image.width > 4000 or image.height > 4000 or image.width * image.height > 16_000_000:
                    raise ValueError()
                image.verify()
            with Image.open(BytesIO(data)) as image:
                image.load()
                width, height = image.size
        return data, width, height
    except Exception as error:
        raise ValueError('Bitte eine unbeschädigte PNG-Unterschrift mit höchstens 2 MB und 4000 × 4000 Pixeln wählen.') from error


def geometry(signature):
    """Include the centred issuer name in bounds and collision tests."""
    width = signature['width_mm']
    height = width * signature['image_height'] / signature['image_width']
    name_width = stringWidth(signature.get('name', ''), 'Helvetica', 11) * 25.4 / 72
    box_width = max(width, name_width)
    left = signature['x_mm'] + (width - box_width) / 2
    top = signature['y_mm']
    if left < 0 or left + box_width > 210 or top < 0 or top + height + 7 > 297:
        raise ValueError('Unterschrift einschließlich Name muss vollständig innerhalb der PDF-Seite liegen.')
    return left, top, box_width, height + 7


def validate_signature(signature):
    if signature and signature.get('data_base64'):
        SignatureLayout.model_validate({k: signature[k] for k in SignatureLayout.model_fields})
        signature["name_width_mm"] = stringWidth(signature.get("name", ""), "Helvetica", 11) * 25.4 / 72
        geometry(signature)
    return signature
