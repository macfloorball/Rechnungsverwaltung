"""One numbering policy for previews, finalization and explicit corrections."""
from datetime import date
import re


class NumberingError(ValueError):
    pass


def parse_number(number, year, prefix=None):
    match = re.fullmatch(r"(?:(.+)-)?([0-9]{4})-([0-9]{2})", number or "")
    if not match or int(match[2]) != year or not 1 <= int(match[3]) <= 12:
        raise NumberingError(f"Bitte eine Rechnungsnummer im Format {year:04d}-01 bis {year:04d}-12 eingeben (optional mit konfiguriertem Präfix).")
    if match[1] and (not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", match[1]) or
                     (prefix is not None and match[1] != prefix)):
        raise NumberingError("Bitte das konfigurierte Rechnungsnummern-Präfix verwenden oder das Präfix weglassen.")
    return int(match[3])


def year_rows(connection, identifier, year):
    rows = connection.execute("SELECT id, invoice_date, invoice_number, year FROM invoices WHERE organization_id=? AND is_preview=0 ORDER BY id", (identifier,)).fetchall()
    result = []
    for row in rows:
        try:
            belongs = date.fromisoformat(row[1]).year == year
        except (ValueError, TypeError):
            belongs = row[3] == year
        if belongs:
            result.append(row)
    return result


def numbering_state(connection, identifier, year):
    serials = []
    issues = []
    records = []
    for row in year_rows(connection, identifier, year):
        record = {"id": row[0], "invoice_number": row[2]}
        try:
            date.fromisoformat(row[1])
            serial = parse_number(row[2], year)
            record["serial"] = serial
            if serial in serials:
                issues.append(f"Doppelte laufende Nummer {serial}: Rechnung {row[0]} ({row[2]}).")
            serials.append(serial)
        except (ValueError, TypeError):
            issues.append(f"Ungültige Bestandsnummer: Rechnung {row[0]} ({row[2] or 'ohne Nummer'}).")
        records.append(record)
    maximum = max(serials, default=0)
    gaps = sorted(set(range(1, maximum + 1)) - set(serials))
    if gaps:
        issues.append("Lücken in der Nummernfolge: " + ", ".join(map(str, gaps)) + ".")
    next_number = maximum + 1
    counter = connection.execute("SELECT next_number FROM invoice_counters WHERE organization_id=? AND year=?", (identifier, year)).fetchone()
    legacy = connection.execute("SELECT minimum_number FROM invoice_number_legacy_floors WHERE organization_id=?", (identifier,)).fetchone()
    previous_next = counter[0] if counter else (legacy[0] if legacy else 1)
    retired = [row[0] for row in connection.execute("SELECT serial FROM invoice_number_retired WHERE organization_id=? AND year=? ORDER BY serial", (identifier, year))]
    release_required = previous_next > next_number or next_number in retired
    if release_required:
        issues.append("Eine gelöschte oder früher gesperrte Nummer würde wiederverwendet. Bitte die Wiederverwendung ausdrücklich freigeben.")
    if next_number > 12:
        issues.append("Der Bereich der zwölf laufenden Rechnungsnummern ist erreicht. Eine automatische Nummer 13 wird nicht vergeben.")
    if issues:
        message = " ".join(issues) + " Unter Rechnung konfigurieren → Nummernkreis und gespeicherte Rechnungen prüfen. Rechnungen werden niemals automatisch umnummeriert."
    else:
        message = f"Nächste automatische Nummer: {year:04d}-{next_number:02d}. Die Vorschau verbraucht keine Nummer."
    return {"year": year, "next_number": next_number, "minimum_number": next_number,
            "invoice_number": f"{year:04d}-{next_number:02d}" if not issues else None,
            "issues": issues, "gaps": gaps, "records": records,
            "release_required": release_required, "retired_numbers": retired,
            "automatic_allowed": not issues, "message": message}


def select_number(connection, identifier, year, manual=None, exclude_id=None):
    state = numbering_state(connection, identifier, year)
    if manual:
        prefix = connection.execute("SELECT invoice_number_prefix FROM organizations WHERE id=?", (identifier,)).fetchone()
        if prefix is None:
            raise NumberingError("Profil wurde nicht gefunden.")
        serial = parse_number(manual, year, prefix[0])
        for row in year_rows(connection, identifier, year):
            if row[0] == exclude_id:
                continue
            try:
                collision = parse_number(row[2], year) == serial
            except NumberingError:
                collision = row[2] == manual
            if collision:
                raise NumberingError("Diese laufende Rechnungsnummer ist in diesem Profil und Jahr bereits vergeben (auch mit anderem Präfix).")
        if exclude_id is None and (serial in state["retired_numbers"] or serial < state["next_number"] and state["release_required"]):
            raise NumberingError("Diese Nummer wurde bereits verwendet. Bitte die Wiederverwendung im Nummernkreis ausdrücklich freigeben.")
        return manual, serial
    if not state["automatic_allowed"]:
        raise NumberingError(state["message"])
    return state["invoice_number"], state["next_number"]


def remember_next(connection, identifier, year, next_number):
    connection.execute("INSERT INTO invoice_counters VALUES (?, ?, ?, ?) ON CONFLICT(organization_id, year) DO UPDATE SET next_number=excluded.next_number, minimum_number=excluded.minimum_number", (identifier, year, next_number, next_number))
    connection.execute("UPDATE organizations SET next_invoice_number=? WHERE id=?", (next_number, identifier))
