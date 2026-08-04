"""Multitrack time signature (compasso)

Revision ID: 019
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns(table)}
    return column in cols


def upgrade() -> None:
    if not _has_column("multitracks", "time_signature"):
        op.add_column(
            "multitracks",
            sa.Column(
                "time_signature",
                sa.String(length=8),
                nullable=False,
                server_default="4/4",
            ),
        )


def downgrade() -> None:
    if _has_column("multitracks", "time_signature"):
        op.drop_column("multitracks", "time_signature")
