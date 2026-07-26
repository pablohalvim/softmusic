"""Song global library share flags

Revision ID: 011
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns(table)}
    return column in cols


def upgrade() -> None:
    if not _has_column("songs", "created_by_user_id"):
        op.add_column("songs", sa.Column("created_by_user_id", sa.String(length=32), nullable=True))
        op.create_index("ix_songs_created_by_user_id", "songs", ["created_by_user_id"])
    if not _has_column("songs", "is_global"):
        op.add_column(
            "songs",
            sa.Column("is_global", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.create_index("ix_songs_is_global", "songs", ["is_global"])


def downgrade() -> None:
    if _has_column("songs", "is_global"):
        op.drop_index("ix_songs_is_global", table_name="songs")
        op.drop_column("songs", "is_global")
    if _has_column("songs", "created_by_user_id"):
        op.drop_index("ix_songs_created_by_user_id", table_name="songs")
        op.drop_column("songs", "created_by_user_id")
