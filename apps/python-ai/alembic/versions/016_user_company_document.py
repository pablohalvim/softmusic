"""Users: pessoa jurídica (is_company) + documento até 14 dígitos (CNPJ)

Revision ID: 016
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns(table)}
    return column in cols


def upgrade() -> None:
    if not _has_column("users", "is_company"):
        op.add_column(
            "users",
            sa.Column("is_company", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
    op.alter_column(
        "users",
        "cpf",
        existing_type=sa.String(length=11),
        type_=sa.String(length=14),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "users",
        "cpf",
        existing_type=sa.String(length=14),
        type_=sa.String(length=11),
        existing_nullable=False,
    )
    if _has_column("users", "is_company"):
        op.drop_column("users", "is_company")
