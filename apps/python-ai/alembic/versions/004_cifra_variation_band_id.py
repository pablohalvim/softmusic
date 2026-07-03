"""Scope cifra variations per band

Revision ID: 004
"""

from alembic import op
import sqlalchemy as sa

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cifra_variations", sa.Column("band_id", sa.String(length=32), nullable=True))
    op.create_index("ix_cifra_variations_band_id", "cifra_variations", ["band_id"])


def downgrade() -> None:
    op.drop_index("ix_cifra_variations_band_id", table_name="cifra_variations")
    op.drop_column("cifra_variations", "band_id")
