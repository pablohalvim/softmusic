"""Invite permissions: invite/manage/delete flags on band_invites

Revision ID: 008
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns(table)}
    return column in cols


def upgrade() -> None:
    if not _has_column("band_invites", "can_invite_members"):
        op.add_column(
            "band_invites",
            sa.Column("can_invite_members", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
    if not _has_column("band_invites", "can_manage_members"):
        op.add_column(
            "band_invites",
            sa.Column("can_manage_members", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
    if not _has_column("band_invites", "can_delete_songs"):
        op.add_column(
            "band_invites",
            sa.Column("can_delete_songs", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    for col in ("can_delete_songs", "can_manage_members", "can_invite_members"):
        if _has_column("band_invites", col):
            op.drop_column("band_invites", col)
