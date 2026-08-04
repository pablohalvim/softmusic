"""Song key variants (pitch-shift stems)

Revision ID: 017
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    bind = op.get_bind()
    return table in inspect(bind).get_table_names()


def upgrade() -> None:
    if _has_table("song_key_variants"):
        return
    op.create_table(
        "song_key_variants",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("song_id", sa.String(length=32), nullable=False, index=True),
        sa.Column("target_key", sa.String(length=16), nullable=False),
        sa.Column("semitones", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="queued"),
        sa.Column("job_id", sa.String(length=32), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("storage_prefix", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("song_id", "target_key", name="uq_song_key_variants_song_target"),
    )


def downgrade() -> None:
    if _has_table("song_key_variants"):
        op.drop_table("song_key_variants")
