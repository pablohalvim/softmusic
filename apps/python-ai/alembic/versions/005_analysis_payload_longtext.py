"""Enlarge analysis_results.payload_json to LONGTEXT

O payload da análise pode passar de 64KB (limite do TEXT no MySQL), causando
"Data too long for column 'payload_json'". LONGTEXT comporta até 4GB.

Revision ID: 005
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "analysis_results",
        "payload_json",
        existing_type=sa.Text(),
        type_=mysql.LONGTEXT(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "analysis_results",
        "payload_json",
        existing_type=mysql.LONGTEXT(),
        type_=sa.Text(),
        existing_nullable=False,
    )
