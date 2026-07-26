"""Roles selecionadas por integrante na escala

Revision ID: 010
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return name in inspect(bind).get_table_names()


def upgrade() -> None:
    if _has_table("band_schedule_member_roles"):
        return
    op.create_table(
        "band_schedule_member_roles",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("schedule_id", sa.String(length=32), nullable=False),
        sa.Column("member_id", sa.String(length=32), nullable=False),
        sa.Column("role_id", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_bsmr_schedule", "band_schedule_member_roles", ["schedule_id"])
    op.create_index("ix_bsmr_member", "band_schedule_member_roles", ["member_id"])
    op.create_index(
        "uq_bsmr_schedule_member_role",
        "band_schedule_member_roles",
        ["schedule_id", "member_id", "role_id"],
        unique=True,
    )


def downgrade() -> None:
    if _has_table("band_schedule_member_roles"):
        op.drop_table("band_schedule_member_roles")
