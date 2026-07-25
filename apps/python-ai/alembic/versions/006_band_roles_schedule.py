"""Band roles, management flags, saved addresses and schedules

Revision ID: 006
"""

from __future__ import annotations

import secrets

import sqlalchemy as sa
from alembic import op

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None

DEFAULT_ROLES = (
    "Ministro",
    "Vocalista Principal",
    "Back Vocal",
    "Baixo",
    "Guitarra",
    "Baterista",
    "Tecladista",
    "Violinista",
    "Saxofonista",
    "Percussionista",
)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def upgrade() -> None:
    op.add_column(
        "band_members",
        sa.Column("can_invite_members", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "band_members",
        sa.Column("can_manage_members", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.create_table(
        "band_roles",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("band_id", sa.String(32), nullable=False, index=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "band_member_roles",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("member_id", sa.String(32), nullable=False, index=True),
        sa.Column("role_id", sa.String(32), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "band_saved_addresses",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("band_id", sa.String(32), nullable=False, index=True),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("formatted_address", sa.String(500), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("place_id", sa.String(256), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "band_schedules",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("band_id", sa.String(32), nullable=False, index=True),
        sa.Column("title", sa.String(200), nullable=True),
        sa.Column("created_by_user_id", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "band_schedule_occurrences",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("schedule_id", sa.String(32), nullable=False, index=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("formatted_address", sa.String(500), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("place_id", sa.String(256), nullable=True),
        sa.Column("saved_address_id", sa.String(32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "band_schedule_members",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("schedule_id", sa.String(32), nullable=False, index=True),
        sa.Column("member_id", sa.String(32), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    conn = op.get_bind()
    bands = conn.execute(sa.text("SELECT id FROM bands")).fetchall()
    for (band_id,) in bands:
        for idx, name in enumerate(DEFAULT_ROLES):
            conn.execute(
                sa.text(
                    """
                    INSERT INTO band_roles (id, band_id, name, sort_order, is_default, created_at, updated_at)
                    VALUES (:id, :band_id, :name, :sort_order, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
                    """
                ),
                {
                    "id": _new_id("rol"),
                    "band_id": band_id,
                    "name": name,
                    "sort_order": idx,
                },
            )

    # Owners get management flags
    conn.execute(
        sa.text(
            """
            UPDATE band_members
            SET can_invite_members = 1, can_manage_members = 1, can_analyze_songs = 1
            WHERE role = 'owner'
            """
        )
    )


def downgrade() -> None:
    op.drop_table("band_schedule_members")
    op.drop_table("band_schedule_occurrences")
    op.drop_table("band_schedules")
    op.drop_table("band_saved_addresses")
    op.drop_table("band_member_roles")
    op.drop_table("band_roles")
    op.drop_column("band_members", "can_manage_members")
    op.drop_column("band_members", "can_invite_members")
