"""Schedule songs repertoire (song + musical key)

Revision ID: 015
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    bind = op.get_bind()
    return table in inspect(bind).get_table_names()


def upgrade() -> None:
    if _has_table("band_schedule_songs"):
        return
    op.create_table(
        "band_schedule_songs",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("schedule_id", sa.String(length=32), nullable=False, index=True),
        sa.Column("song_id", sa.String(length=32), nullable=False, index=True),
        sa.Column("musical_key", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    if _has_table("band_schedule_songs"):
        op.drop_table("band_schedule_songs")
