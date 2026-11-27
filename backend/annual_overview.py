"""Profile-scoped billing totals shared by screen and exports; amounts stay in cents."""
import csv
from html import escape
from io import BytesIO, StringIO

from backend.database import get_connection, profile_id
from backend.data_export import csv_value
from backend.invoice_generator import GERMAN_MONTHS


def overview(database_path, year):
    with get_connection(database_path) as connection:
        name = connection.execute('SELECT profile_name FROM organizations WHERE id=?', (profile_id(database_path),)).fetchone()[0]
        rows = connection.execute('SELECT year, month, total_amount_cents FROM invoices WHERE organization_id=? AND is_preview=0', (profile_id(database_path),)).fetchall()
    amounts = [0] * 12
    for billing_year, month, cents in rows:
        if billing_year == year:
            amounts[month - 1] += cents
    return dict(profile_name=name, year=year, years=sorted({year, *(row[0] for row in rows)}, reverse=True),
                months=[dict(month=i + 1, name=name, amount_cents=amounts[i]) for i, name in enumerate(GERMAN_MONTHS)],
                total_amount_cents=sum(amounts), invoice_count=sum(row[0] == year for row in rows))


def money(cents):
    return f'{cents // 100:,}'.replace(',', '.') + f',{cents % 100:02d}'


def export_csv(data):
    stream = StringIO(newline='')
    writer = csv.writer(stream, delimiter=';')
    writer.writerow(['Profil', 'Abrechnungsjahr', 'Monat', 'Abgerechneter Betrag (EUR)'])
    for row in data['months']:
        writer.writerow([csv_value(data['profile_name']), data['year'], row['name'], money(row['amount_cents'])])
    writer.writerow([csv_value(data['profile_name']), data['year'], 'Jahressumme', money(data['total_amount_cents'])])
    return stream.getvalue().encode('utf-8-sig')


def export_pdf(data):
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    stream = BytesIO()
    styles = getSampleStyleSheet()
    document = SimpleDocTemplate(stream, pagesize=(595.28, 841.89), leftMargin=55, rightMargin=55, topMargin=50, bottomMargin=50)
    rows = [['Monat', 'Abgerechneter Betrag']]
    rows += [[row['name'], money(row['amount_cents']) + ' €'] for row in data['months']]
    rows += [['Jahressumme', money(data['total_amount_cents']) + ' €']]
    table = Table(rows, colWidths=[270, 215], rowHeights=29)
    table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'), ('FONTSIZE', (0, 0), (-1, -1), 11),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'), ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e8eef5')),
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#e8eef5')),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LINEBELOW', (0, 0), (-1, -1), .3, colors.HexColor('#ccd5df')),
    ]))
    document.build([Paragraph(f'Jahresübersicht {data["year"]}', styles['Title']),
                    Paragraph('Profil: ' + escape(data['profile_name']), styles['Normal']), Spacer(1, 12),
                    Paragraph('Gespeicherte endgültige Rechnungen nach Abrechnungsmonat.', styles['Normal']),
                    Spacer(1, 20), table])
    return stream.getvalue()
