"""Schedule occurrences: title, calendar_uid, sequence, removed_at, updated_at

Revision ID: 009
"""

from __future__ import annotations

import secrets

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect, text

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns(table)}
    return column in cols


def _has_index(table: str, name: str) -> bool:
    bind = op.get_bind()
    indexes = {idx["name"] for idx in inspect(bind).get_indexes(table)}
    return name in indexes


def upgrade() -> None:
    if not _has_column("band_schedule_occurrences", "title"):
        op.add_column(
            "band_schedule_occurrences",
            sa.Column("title", sa.String(length=220), nullable=True),
        )
    if not _has_column("band_schedule_occurrences", "calendar_uid"):
        op.add_column(
            "band_schedule_occurrences",
            sa.Column("calendar_uid", sa.String(length=120), nullable=True),
        )
    if not _has_column("band_schedule_occurrences", "calendar_sequence"):
        op.add_column(
            "band_schedule_occurrences",
            sa.Column("calendar_sequence", sa.Integer(), nullable=False, server_default="0"),
        )
    if not _has_column("band_schedule_occurrences", "removed_at"):
        op.add_column(
            "band_schedule_occurrences",
            sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_column("band_schedule_occurrences", "updated_at"):
        op.add_column(
            "band_schedule_occurrences",
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )

    bind = op.get_bind()
    rows = bind.execute(
        text(
            """
            SELECT o.id, o.kind, o.schedule_id, s.title
            FROM band_schedule_occurrences o
            LEFT JOIN band_schedules s ON s.id = o.schedule_id
            WHERE o.calendar_uid IS NULL OR o.title IS NULL
            """
        )
    ).mappings().all()
    for row in rows:
        schedule_title = (row["title"] or "Escala").strip() or "Escala"
        occ_title = schedule_title if row["kind"] == "event" else f"Ensaio {schedule_title}"
        uid = f"softmusic-{row['id']}-{secrets.token_hex(8)}@softmusic.com.br"
        bind.execute(
            text(
                """
                UPDATE band_schedule_occurrences
                SET title = COALESCE(title, :title),
                    calendar_uid = COALESCE(calendar_uid, :uid),
                    updated_at = COALESCE(updated_at, created_at)
                WHERE id = :id
                """
            ),
            {"title": occ_title, "uid": uid, "id": row["id"]},
        )

    if not _has_index("band_schedule_occurrences", "ix_band_schedule_occurrences_calendar_uid"):
        op.create_index(
            "ix_band_schedule_occurrences_calendar_uid",
            "band_schedule_occurrences",
            ["calendar_uid"],
            unique=True,
        )


def downgrade() -> None:
    if _has_index("band_schedule_occurrences", "ix_band_schedule_occurrences_calendar_uid"):
        op.drop_index("ix_band_schedule_occurrences_calendar_uid", table_name="band_schedule_occurrences")
    for col in ("updated_at", "removed_at", "calendar_sequence", "calendar_uid", "title"):
        if _has_column("band_schedule_occurrences", col):
            op.drop_column("band_schedule_occurrences", col)
