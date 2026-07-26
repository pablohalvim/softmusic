"""Billing: invoice kinds/status, holidays, Asaas settings, delete songs perm

Revision ID: 007
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns(table)}
    return column in cols


def _has_table(table: str) -> bool:
    bind = op.get_bind()
    return table in inspect(bind).get_table_names()


def upgrade() -> None:
    if not _has_column("users", "asaas_customer_id"):
        op.add_column("users", sa.Column("asaas_customer_id", sa.String(64), nullable=True))

    if not _has_column("band_members", "can_delete_songs"):
        op.add_column(
            "band_members",
            sa.Column("can_delete_songs", sa.Boolean(), nullable=False, server_default=sa.false()),
        )

    if not _has_column("invoices", "invoice_kind"):
        op.add_column(
            "invoices",
            sa.Column("invoice_kind", sa.String(32), nullable=False, server_default="first"),
        )
    if not _has_column("invoices", "invoice_number"):
        op.add_column("invoices", sa.Column("invoice_number", sa.Integer(), nullable=True))
    if not _has_column("invoices", "asaas_payload_json"):
        op.add_column("invoices", sa.Column("asaas_payload_json", sa.Text(), nullable=True))
    if not _has_column("invoices", "reminder_due_soon_sent_at"):
        op.add_column(
            "invoices",
            sa.Column("reminder_due_soon_sent_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_column("invoices", "reminder_overdue_sent_at"):
        op.add_column(
            "invoices",
            sa.Column("reminder_overdue_sent_at", sa.DateTime(timezone=True), nullable=True),
        )

    op.execute("UPDATE invoices SET status = 'awaiting_payment' WHERE status = 'pending'")
    op.execute("UPDATE invoices SET status = 'refunded' WHERE status = 'refund'")

    if not _has_column("invoice_line_items", "plan_code"):
        op.add_column("invoice_line_items", sa.Column("plan_code", sa.String(32), nullable=True))
    if not _has_column("invoice_line_items", "item_kind"):
        op.add_column(
            "invoice_line_items",
            sa.Column("item_kind", sa.String(32), nullable=False, server_default="plan_base"),
        )
    if not _has_column("invoice_line_items", "quantity"):
        op.add_column(
            "invoice_line_items",
            sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        )
    if not _has_column("invoice_line_items", "unit_amount_cents"):
        op.add_column(
            "invoice_line_items",
            sa.Column("unit_amount_cents", sa.Integer(), nullable=False, server_default="0"),
        )

    if not _has_table("national_holidays"):
        op.create_table(
            "national_holidays",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("holiday_date", sa.Date(), nullable=False, index=True),
            sa.Column("is_movable", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("holiday_date", name="uq_national_holidays_date"),
        )

        from app.domain.holidays import generate_national_holidays

        holidays = generate_national_holidays(2024, 2050)
        now = datetime.now(UTC)
        holidays_table = sa.table(
            "national_holidays",
            sa.column("id", sa.String),
            sa.column("name", sa.String),
            sa.column("holiday_date", sa.Date),
            sa.column("is_movable", sa.Boolean),
            sa.column("created_at", sa.DateTime),
        )
        rows = [
            {
                "id": _new_id("hol"),
                "name": name,
                "holiday_date": d,
                "is_movable": movable,
                "created_at": now,
            }
            for name, d, movable in holidays
        ]
        batch = 200
        for i in range(0, len(rows), batch):
            op.bulk_insert(holidays_table, rows[i : i + batch])

    if not _has_table("system_settings"):
        op.create_table(
            "system_settings",
            sa.Column("key", sa.String(64), primary_key=True),
            sa.Column("value", sa.Text(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_by_admin_id", sa.String(32), nullable=True),
        )
        now = datetime.now(UTC)
        settings_table = sa.table(
            "system_settings",
            sa.column("key", sa.String),
            sa.column("value", sa.Text),
            sa.column("updated_at", sa.DateTime),
            sa.column("updated_by_admin_id", sa.String),
        )
        op.bulk_insert(
            settings_table,
            [
                {
                    "key": "asaas_api_key",
                    "value": "",
                    "updated_at": now,
                    "updated_by_admin_id": None,
                },
                {
                    "key": "asaas_environment",
                    "value": "sandbox",
                    "updated_at": now,
                    "updated_by_admin_id": None,
                },
                {
                    "key": "asaas_webhook_token",
                    "value": "",
                    "updated_at": now,
                    "updated_by_admin_id": None,
                },
            ],
        )


def downgrade() -> None:
    if _has_table("system_settings"):
        op.drop_table("system_settings")
    if _has_table("national_holidays"):
        op.drop_table("national_holidays")
    for col in ("unit_amount_cents", "quantity", "item_kind", "plan_code"):
        if _has_column("invoice_line_items", col):
            op.drop_column("invoice_line_items", col)
    op.execute("UPDATE invoices SET status = 'pending' WHERE status = 'awaiting_payment'")
    for col in (
        "reminder_overdue_sent_at",
        "reminder_due_soon_sent_at",
        "asaas_payload_json",
        "invoice_number",
        "invoice_kind",
    ):
        if _has_column("invoices", col):
            op.drop_column("invoices", col)
    if _has_column("band_members", "can_delete_songs"):
        op.drop_column("band_members", "can_delete_songs")
    if _has_column("users", "asaas_customer_id"):
        op.drop_column("users", "asaas_customer_id")
