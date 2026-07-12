"""Stripe billing state and versioned legal acceptance records.

Revision ID: 012
Revises: 011
Create Date: 2026-07-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "billing_customers",
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("provider", sa.String(32), nullable=False, server_default="stripe"),
        sa.Column("provider_customer_id", sa.String(255), nullable=False),
        sa.Column("billing_email", sa.String(320), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("provider_customer_id", name="uq_billing_customers_provider_id"),
    )

    op.create_table(
        "subscriptions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(32), nullable=False, server_default="stripe"),
        sa.Column("provider_subscription_id", sa.String(255), nullable=False),
        sa.Column("price_id", sa.String(255), nullable=False),
        sa.Column("plan_key", sa.String(100), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancel_at_period_end", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_provider_event_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "provider_subscription_id", name="uq_subscriptions_provider_id"
        ),
    )
    op.create_index(
        "ix_subscriptions_workspace_status",
        "subscriptions",
        ["workspace_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_subscriptions_period_end",
        "subscriptions",
        ["status", "current_period_end"],
        unique=False,
    )

    op.create_table(
        "billing_webhook_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("provider", sa.String(32), nullable=False, server_default="stripe"),
        sa.Column("provider_event_id", sa.String(255), nullable=False),
        sa.Column("event_type", sa.String(150), nullable=False),
        sa.Column("provider_event_created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_sha256", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("attempts >= 0", name="ck_billing_webhook_events_attempts"),
        sa.UniqueConstraint(
            "provider_event_id", name="uq_billing_webhook_events_provider_id"
        ),
    )
    op.create_index(
        "ix_billing_webhook_events_status",
        "billing_webhook_events",
        ["status", "received_at"],
        unique=False,
    )

    op.create_table(
        "legal_document_versions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("document_key", sa.String(64), nullable=False),
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("revision_number", sa.Integer, nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("public_url", sa.String(500), nullable=False),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("effective_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("requires_reacceptance", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("required_at_signup", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("revision_number >= 1", name="ck_legal_document_versions_revision"),
        sa.UniqueConstraint(
            "document_key", "version", name="uq_legal_document_versions_key_version"
        ),
        sa.UniqueConstraint(
            "document_key", "revision_number",
            name="uq_legal_document_versions_key_revision",
        ),
    )
    op.create_index(
        "ix_legal_document_versions_effective",
        "legal_document_versions",
        ["document_key", "effective_at"],
        unique=False,
    )

    op.create_table(
        "legal_acceptances",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "app_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "document_version_id",
            sa.String(36),
            sa.ForeignKey("legal_document_versions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("subject_user_ref_hash", sa.String(64), nullable=False),
        sa.Column("workspace_scope_key", sa.String(36), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("ip_hash", sa.String(64), nullable=True),
        sa.Column("user_agent_hash", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "subject_user_ref_hash", "workspace_scope_key", "document_version_id",
            name="uq_legal_acceptances_subject_scope_doc",
        ),
    )
    op.create_index(
        "ix_legal_acceptances_user",
        "legal_acceptances",
        ["app_user_id", "accepted_at"],
        unique=False,
    )
    op.create_index(
        "ix_legal_acceptances_workspace",
        "legal_acceptances",
        ["workspace_id", "accepted_at"],
        unique=False,
    )

    op.create_table(
        "deletion_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "requested_by_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("request_type", sa.String(32), nullable=False),
        sa.Column("target_ref_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="requested"),
        sa.Column("execute_after", sa.DateTime(timezone=True), nullable=False),
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "request_type IN ('account', 'workspace')",
            name="ck_deletion_requests_type",
        ),
        sa.CheckConstraint(
            "status IN ('requested', 'processing', 'canceled', 'completed', 'failed')",
            name="ck_deletion_requests_status",
        ),
    )
    active_deletion = sa.text("status IN ('requested', 'processing')")
    op.create_index(
        "uq_deletion_requests_active_target",
        "deletion_requests",
        ["request_type", "target_ref_hash"],
        unique=True,
        postgresql_where=active_deletion,
        sqlite_where=active_deletion,
    )
    op.create_index(
        "ix_deletion_requests_due",
        "deletion_requests",
        ["status", "execute_after"],
        unique=False,
    )

    op.create_table(
        "privacy_export_artifacts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "request_event_id",
            sa.String(36),
            sa.ForeignKey("audit_events.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "requested_by_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("scope", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="processing"),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("encryption_key_id", sa.String(100), nullable=True),
        sa.Column("json_nonce_ciphertext", sa.LargeBinary, nullable=True),
        sa.Column("csv_nonce_ciphertext", sa.LargeBinary, nullable=True),
        sa.Column("content_sha256", sa.String(64), nullable=True),
        sa.Column("size_bytes", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("record_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error_code", sa.String(100), nullable=True),
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "scope IN ('account', 'workspace')",
            name="ck_privacy_export_artifacts_scope",
        ),
        sa.CheckConstraint(
            "status IN ('processing', 'ready', 'failed', 'expired')",
            name="ck_privacy_export_artifacts_status",
        ),
        sa.CheckConstraint("attempts >= 0", name="ck_privacy_export_artifacts_attempts"),
        sa.CheckConstraint("size_bytes >= 0", name="ck_privacy_export_artifacts_size"),
        sa.CheckConstraint("record_count >= 0", name="ck_privacy_export_artifacts_records"),
        sa.UniqueConstraint(
            "request_event_id", name="uq_privacy_export_artifacts_request_event"
        ),
    )
    op.create_index(
        "ix_privacy_export_artifacts_status_expiry",
        "privacy_export_artifacts",
        ["status", "expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_privacy_export_artifacts_status_expiry",
        table_name="privacy_export_artifacts",
    )
    op.drop_table("privacy_export_artifacts")
    op.drop_index("ix_deletion_requests_due", table_name="deletion_requests")
    op.drop_index("uq_deletion_requests_active_target", table_name="deletion_requests")
    op.drop_table("deletion_requests")
    op.drop_index("ix_legal_acceptances_workspace", table_name="legal_acceptances")
    op.drop_index("ix_legal_acceptances_user", table_name="legal_acceptances")
    op.drop_table("legal_acceptances")
    op.drop_index(
        "ix_legal_document_versions_effective", table_name="legal_document_versions"
    )
    op.drop_table("legal_document_versions")
    op.drop_index(
        "ix_billing_webhook_events_status", table_name="billing_webhook_events"
    )
    op.drop_table("billing_webhook_events")
    op.drop_index("ix_subscriptions_period_end", table_name="subscriptions")
    op.drop_index("ix_subscriptions_workspace_status", table_name="subscriptions")
    op.drop_table("subscriptions")
    op.drop_table("billing_customers")
