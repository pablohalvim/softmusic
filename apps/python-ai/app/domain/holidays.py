"""Feriados nacionais brasileiros (fixos + móveis via Páscoa / Gauss)."""

from __future__ import annotations

from datetime import date, timedelta


def easter_date(year: int) -> date:
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def generate_national_holidays(start_year: int, end_year: int) -> list[tuple[str, date, bool]]:
    items: list[tuple[str, date, bool]] = []
    for year in range(start_year, end_year + 1):
        fixed = [
            ("Confraternização Universal", date(year, 1, 1)),
            ("Tiradentes", date(year, 4, 21)),
            ("Dia do Trabalho", date(year, 5, 1)),
            ("Independência do Brasil", date(year, 9, 7)),
            ("Nossa Senhora Aparecida", date(year, 10, 12)),
            ("Finados", date(year, 11, 2)),
            ("Proclamação da República", date(year, 11, 15)),
            ("Natal", date(year, 12, 25)),
        ]
        for name, d in fixed:
            items.append((name, d, False))
        easter = easter_date(year)
        movable = [
            ("Carnaval", easter + timedelta(days=-47)),
            ("Sexta-feira Santa", easter + timedelta(days=-2)),
            ("Páscoa", easter),
            ("Corpus Christi", easter + timedelta(days=60)),
        ]
        for name, d in movable:
            items.append((name, d, True))
    return items
