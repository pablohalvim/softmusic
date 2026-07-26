"""Regras de vencimento SoftMusic (dia 10 + pró-rata + dias úteis)."""

from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta


def next_due_anchor(from_date: date, day: int = 10) -> date:
    """Próximo dia `day` estritamente após from_date (ou o próprio se for o dia)."""
    if from_date.day <= day:
        candidate = date(from_date.year, from_date.month, day)
        if candidate >= from_date:
            return candidate
    if from_date.month == 12:
        return date(from_date.year + 1, 1, day)
    return date(from_date.year, from_date.month + 1, day)


def days_until(from_date: date, target: date) -> int:
    return max(0, (target - from_date).days)


def adjust_business_day(due: date, holiday_dates: set[date]) -> date:
    """Sábado/domingo → segunda; se segunda feriado → terça (e avança enquanto feriado/fim de semana)."""
    current = due
    for _ in range(14):
        if current.weekday() >= 5 or current in holiday_dates:
            current = current + timedelta(days=1)
            continue
        return current
    return current


def first_invoice_quote(
    today: date,
    monthly_cents: int,
    *,
    holiday_dates: set[date] | None = None,
    min_days_for_full: int = 4,
    trial_due_offset_days: int = 2,
) -> tuple[int, date, date, date]:
    """Retorna (amount_cents, due_date, period_start, period_end)."""
    holidays = holiday_dates or set()
    anchor = next_due_anchor(today)
    remaining = days_until(today, anchor)

    if remaining < min_days_for_full:
        # Valor cheio, vencimento no próximo dia 10 (ajustado).
        due = adjust_business_day(anchor, holidays)
        # Período: hoje até véspera do próximo ciclo após o anchor
        period_end = due
        return monthly_cents, due, today, period_end

    daily = monthly_cents / 30.0
    amount = int(round(daily * remaining))
    amount = max(amount, 0)
    due = today + timedelta(days=trial_due_offset_days)
    return amount, due, today, anchor - timedelta(days=1)


def band_monthly_cents(plan_code: str, member_count: int, plan_limits: dict[str, tuple[int, int, int]]) -> int:
    base, limit, extra = plan_limits[plan_code]
    return base + max(0, member_count - limit) * extra


def month_period_for_due(due: date) -> tuple[date, date]:
    start = date(due.year, due.month, 1)
    end = date(due.year, due.month, monthrange(due.year, due.month)[1])
    return start, end
