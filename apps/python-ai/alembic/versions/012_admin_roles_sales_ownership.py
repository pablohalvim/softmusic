"""Admin roles + sales ownership on users/bands

Revision ID: 012
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect, text

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns(table)}
    return column in cols


def upgrade() -> None:
    if not _has_column("users", "registered_by_admin_id"):
        op.add_column(
            "users",
            sa.Column("registered_by_admin_id", sa.String(length=32), nullable=True),
        )
        op.create_index("ix_users_registered_by_admin_id", "users", ["registered_by_admin_id"])

    if not _has_column("bands", "registered_by_admin_id"):
        op.add_column(
            "bands",
            sa.Column("registered_by_admin_id", sa.String(length=32), nullable=True),
        )
        op.create_index("ix_bands_registered_by_admin_id", "bands", ["registered_by_admin_id"])

    # Normaliza roles legados para full_admin.
    op.execute(
        text(
            "UPDATE admin_users SET role = 'full_admin' "
            "WHERE role IS NULL OR role NOT IN ('full_admin', 'salesperson')"
        )
    )


def downgrade() -> None:
    if _has_column("bands", "registered_by_admin_id"):
        op.drop_index("ix_bands_registered_by_admin_id", table_name="bands")
        op.drop_column("bands", "registered_by_admin_id")
    if _has_column("users", "registered_by_admin_id"):
        op.drop_index("ix_users_registered_by_admin_id", table_name="users")
        op.drop_column("users", "registered_by_admin_id")
