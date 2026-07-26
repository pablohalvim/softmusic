"""Band song link_source (created vs imported_global)

Revision ID: 013
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect, text

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns(table)}
    return column in cols


def upgrade() -> None:
    if not _has_column("band_songs", "link_source"):
        op.add_column(
            "band_songs",
            sa.Column(
                "link_source",
                sa.String(length=32),
                nullable=False,
                server_default="created",
            ),
        )
        # Heurística: se a música existia bem antes do vínculo, veio da global.
        op.execute(
            text(
                """
                UPDATE band_songs bs
                JOIN songs s ON s.id = bs.song_id
                SET bs.link_source = 'imported_global'
                WHERE TIMESTAMPDIFF(SECOND, s.created_at, bs.linked_at) > 30
                """
            )
        )


def downgrade() -> None:
    if _has_column("band_songs", "link_source"):
        op.drop_column("band_songs", "link_source")
