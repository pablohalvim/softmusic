"""SaaS: users, bands, billing, moderation

Revision ID: 003
"""

from alembic import op
import sqlalchemy as sa

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "songs",
        sa.Column("moderation_status", sa.String(length=32), nullable=False, server_default="active"),
    )
    op.add_column("songs", sa.Column("blocked_reason", sa.Text(), nullable=True))
    op.add_column("songs", sa.Column("blocked_by_admin_id", sa.String(length=32), nullable=True))
    op.add_column("songs", sa.Column("blocked_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "users",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("full_name", sa.String(length=200), nullable=False),
        sa.Column("cpf", sa.String(length=11), nullable=False),
        sa.Column("cpf_hash", sa.String(length=64), nullable=False),
        sa.Column("birth_date", sa.Date(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("phone", sa.String(length=20), nullable=False),
        sa.Column("address_street", sa.String(length=200), nullable=False),
        sa.Column("address_number", sa.String(length=20), nullable=False),
        sa.Column("address_complement", sa.String(length=100), nullable=True),
        sa.Column("address_neighborhood", sa.String(length=100), nullable=False),
        sa.Column("address_city", sa.String(length=100), nullable=False),
        sa.Column("address_state", sa.String(length=2), nullable=False),
        sa.Column("address_zip", sa.String(length=8), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_cpf_hash", "users", ["cpf_hash"], unique=True)

    op.create_table(
        "admin_users",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("full_name", sa.String(length=200), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False, server_default="support"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_admin_users_email", "admin_users", ["email"], unique=True)

    op.create_table(
        "billing_accounts",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("owner_user_id", sa.String(length=32), nullable=False),
        sa.Column("asaas_customer_id", sa.String(length=64), nullable=True),
        sa.Column("asaas_subscription_id", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("grace_period_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_billing_accounts_owner", "billing_accounts", ["owner_user_id"], unique=True)

    op.create_table(
        "bands",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("owner_user_id", sa.String(length=32), nullable=False),
        sa.Column("billing_account_id", sa.String(length=32), nullable=False),
        sa.Column("plan_code", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column("billing_exempt", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("exempt_reason", sa.Text(), nullable=True),
        sa.Column("exempt_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("member_limit", sa.Integer(), nullable=False),
        sa.Column("extra_member_price_cents", sa.Integer(), nullable=False),
        sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_bands_owner", "bands", ["owner_user_id"])
    op.create_index("ix_bands_billing_account", "bands", ["billing_account_id"])

    op.create_table(
        "band_members",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("band_id", sa.String(length=32), nullable=False),
        sa.Column("user_id", sa.String(length=32), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False, server_default="member"),
        sa.Column("can_analyze_songs", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("invited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_band_members_band", "band_members", ["band_id"])
    op.create_index("ix_band_members_user", "band_members", ["user_id"])
    op.create_unique_constraint("uq_band_members_band_user", "band_members", ["band_id", "user_id"])

    op.create_table(
        "band_invites",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("band_id", sa.String(length=32), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("can_analyze_songs", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_band_invites_token", "band_invites", ["token_hash"], unique=True)

    op.create_table(
        "band_songs",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("band_id", sa.String(length=32), nullable=False),
        sa.Column("song_id", sa.String(length=32), nullable=False),
        sa.Column("linked_by_user_id", sa.String(length=32), nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_band_songs_band", "band_songs", ["band_id"])
    op.create_index("ix_band_songs_song", "band_songs", ["song_id"])
    op.create_unique_constraint("uq_band_songs_band_song", "band_songs", ["band_id", "song_id"])

    op.create_table(
        "billing_subscription_items",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("billing_account_id", sa.String(length=32), nullable=False),
        sa.Column("band_id", sa.String(length=32), nullable=False),
        sa.Column("plan_code", sa.String(length=32), nullable=False),
        sa.Column("member_count", sa.Integer(), nullable=False),
        sa.Column("monthly_amount_cents", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_billing_items_account", "billing_subscription_items", ["billing_account_id"])

    op.create_table(
        "invoices",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("billing_account_id", sa.String(length=32), nullable=False),
        sa.Column("asaas_payment_id", sa.String(length=64), nullable=True),
        sa.Column("total_amount_cents", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payment_method", sa.String(length=32), nullable=True),
        sa.Column("invoice_url", sa.Text(), nullable=True),
        sa.Column("pix_qr_payload", sa.Text(), nullable=True),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_invoices_billing_account", "invoices", ["billing_account_id"])

    op.create_table(
        "invoice_line_items",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("invoice_id", sa.String(length=32), nullable=False),
        sa.Column("band_id", sa.String(length=32), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
    )
    op.create_index("ix_invoice_line_items_invoice", "invoice_line_items", ["invoice_id"])

    op.create_table(
        "song_blocks",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("song_id", sa.String(length=32), nullable=True),
        sa.Column("youtube_video_id", sa.String(length=16), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("blocked_by_admin_id", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_song_blocks_youtube", "song_blocks", ["youtube_video_id"])

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("actor_type", sa.String(length=32), nullable=False),
        sa.Column("actor_id", sa.String(length=32), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.String(length=32), nullable=True),
        sa.Column("payload_json", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_audit_logs_entity", "audit_logs", ["entity_type", "entity_id"])

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("user_id", sa.String(length=32), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_refresh_tokens_user", "refresh_tokens", ["user_id"])
    op.create_index("ix_refresh_tokens_hash", "refresh_tokens", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_table("refresh_tokens")
    op.drop_table("audit_logs")
    op.drop_table("song_blocks")
    op.drop_table("invoice_line_items")
    op.drop_table("invoices")
    op.drop_table("billing_subscription_items")
    op.drop_table("band_songs")
    op.drop_table("band_invites")
    op.drop_table("band_members")
    op.drop_table("bands")
    op.drop_table("billing_accounts")
    op.drop_table("admin_users")
    op.drop_table("users")
    op.drop_column("songs", "blocked_at")
    op.drop_column("songs", "blocked_by_admin_id")
    op.drop_column("songs", "blocked_reason")
    op.drop_column("songs", "moderation_status")
