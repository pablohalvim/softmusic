"""Multitracks (user-uploaded sessions, independent from Demucs)

Revision ID: 018
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    bind = op.get_bind()
    return table in inspect(bind).get_table_names()


def upgrade() -> None:
    if not _has_table("multitracks"):
        op.create_table(
            "multitracks",
            sa.Column("id", sa.String(length=32), primary_key=True),
            sa.Column("band_id", sa.String(length=32), nullable=False, index=True),
            sa.Column("song_id", sa.String(length=32), nullable=True, index=True),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("source_key", sa.String(length=16), nullable=False),
            sa.Column("source_mode", sa.String(length=16), nullable=False, server_default="major"),
            sa.Column("bpm", sa.Float(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_by_user_id", sa.String(length=32), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )

    if not _has_table("multitrack_tracks"):
        op.create_table(
            "multitrack_tracks",
            sa.Column("id", sa.String(length=32), primary_key=True),
            sa.Column("multitrack_id", sa.String(length=32), nullable=False, index=True),
            sa.Column("name", sa.String(length=128), nullable=False),
            sa.Column("role", sa.String(length=64), nullable=False, server_default="other"),
            sa.Column("file_name", sa.String(length=255), nullable=False),
            sa.Column("original_file_name", sa.String(length=255), nullable=True),
            sa.Column("duration_seconds", sa.Float(), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("gain", sa.Float(), nullable=False, server_default="1"),
            sa.Column("muted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("pitch_shift", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )

    if not _has_table("multitrack_key_variants"):
        op.create_table(
            "multitrack_key_variants",
            sa.Column("id", sa.String(length=32), primary_key=True),
            sa.Column("multitrack_id", sa.String(length=32), nullable=False, index=True),
            sa.Column("target_key", sa.String(length=16), nullable=False),
            sa.Column("semitones", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="queued"),
            sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("storage_prefix", sa.String(length=64), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint(
                "multitrack_id",
                "target_key",
                name="uq_multitrack_key_variants_mt_target",
            ),
        )


def downgrade() -> None:
    if _has_table("multitrack_key_variants"):
        op.drop_table("multitrack_key_variants")
    if _has_table("multitrack_tracks"):
        op.drop_table("multitrack_tracks")
    if _has_table("multitracks"):
        op.drop_table("multitracks")
