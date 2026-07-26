"""Geração de arquivos .ics (VCALENDAR) para Google Agenda / clients."""

from __future__ import annotations

from datetime import UTC, datetime


def _fold(line: str) -> str:
    """RFC 5545 line folding at 75 octets (approx ASCII)."""
    if len(line) <= 75:
        return line
    parts = [line[:75]]
    rest = line[75:]
    while rest:
        parts.append(" " + rest[:74])
        rest = rest[74:]
    return "\r\n".join(parts)


def _escape_text(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
        .replace("\r", "")
    )


def _fmt_utc(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def build_ics(
    *,
    uid: str,
    summary: str,
    description: str,
    location: str,
    starts_at: datetime,
    ends_at: datetime,
    sequence: int = 0,
    method: str = "REQUEST",
    status: str = "CONFIRMED",
) -> str:
    now = datetime.now(UTC)
    method_upper = method.upper()
    status_upper = "CANCELLED" if method_upper == "CANCEL" else status.upper()
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//SoftMusic//Agenda//PT",
        "CALSCALE:GREGORIAN",
        f"METHOD:{method_upper}",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{_fmt_utc(now)}",
        f"DTSTART:{_fmt_utc(starts_at)}",
        f"DTEND:{_fmt_utc(ends_at)}",
        f"SUMMARY:{_escape_text(summary)}",
        f"DESCRIPTION:{_escape_text(description)}",
        f"LOCATION:{_escape_text(location)}",
        f"SEQUENCE:{max(0, int(sequence))}",
        f"STATUS:{status_upper}",
        "TRANSP:OPAQUE",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"
