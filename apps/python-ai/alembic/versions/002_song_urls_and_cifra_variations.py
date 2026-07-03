"""Song source URLs and cifra variations

Revision ID: 002
"""

from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("songs", sa.Column("youtube_url", sa.Text(), nullable=True))
    op.add_column("songs", sa.Column("youtube_video_id", sa.String(length=16), nullable=True))
    op.add_column("songs", sa.Column("cifra_club_url", sa.Text(), nullable=True))
    op.create_index("ix_songs_youtube_video_id", "songs", ["youtube_video_id"])

    op.create_table(
        "cifra_variations",
        sa.Column("id", sa.String(length=40), primary_key=True),
        sa.Column("song_id", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("snapshot_json", sa.Text(), nullable=False),
        sa.Column("cifra_club_url", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_cifra_variations_song_id", "cifra_variations", ["song_id"])


def downgrade() -> None:
    op.drop_index("ix_cifra_variations_song_id", table_name="cifra_variations")
    op.drop_table("cifra_variations")
    op.drop_index("ix_songs_youtube_video_id", table_name="songs")
    op.drop_column("songs", "cifra_club_url")
    op.drop_column("songs", "youtube_video_id")
    op.drop_column("songs", "youtube_url")
