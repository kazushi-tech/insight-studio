"""SQLAlchemy Core table definitions for Market Lens AI."""

from __future__ import annotations

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    MetaData,
    String,
    Table,
    Text,
)

metadata = MetaData()

assets = Table(
    "assets",
    metadata,
    Column("id", String(12), primary_key=True),
    Column("file_name", String, nullable=False),
    Column("mime_type", String, nullable=False),
    Column("size_bytes", Integer, nullable=False),
    Column("width", Integer, nullable=True),
    Column("height", Integer, nullable=True),
    Column("asset_type", String(32), nullable=False, server_default="banner"),
    Column("created_at", DateTime, nullable=False),
)

asset_data = Table(
    "asset_data",
    metadata,
    Column("asset_id", String(12), ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True),
    Column("data", LargeBinary, nullable=False),
)

review_runs = Table(
    "review_runs",
    metadata,
    Column("id", String(12), primary_key=True),
    Column("asset_id", String(12), ForeignKey("assets.id"), nullable=False),
    Column("review_type", String(32), nullable=False),
    Column("status", String(16), nullable=False, server_default="pending"),
    Column("brand_info", Text, nullable=True),
    Column("operator_memo", Text, nullable=True),
    Column("model", String(64), nullable=True),
    Column("lp_url", String, nullable=True),
    Column("created_at", DateTime, nullable=False),
    Column("updated_at", DateTime, nullable=True),
)

review_outputs = Table(
    "review_outputs",
    metadata,
    Column("run_id", String(12), ForeignKey("review_runs.id", ondelete="CASCADE"), primary_key=True),
    Column("output_json", Text, nullable=False),
    Column("model_used", String(64), nullable=True),
    Column("created_at", DateTime, nullable=True),
)

export_records = Table(
    "export_records",
    metadata,
    Column("id", String(12), primary_key=True),
    Column("run_id", String(12), ForeignKey("review_runs.id", ondelete="CASCADE"), nullable=False),
    Column("format", String(16), nullable=False),
    Column("file_name", String, nullable=False),
    Column("file_size_bytes", Integer, nullable=True),
    Column("created_at", DateTime, nullable=False),
)

# ── Discovery tables (M5.2) ────────────────────────────────

discovery_searches = Table(
    "discovery_searches",
    metadata,
    Column("id", String(12), primary_key=True),
    Column("brand_url", String, nullable=False),
    Column("brand_domain", String, nullable=False),
    Column("query_used", String, nullable=False),
    Column("provider", String(16), nullable=False, server_default="cse"),
    Column("result_count", Integer, nullable=False, server_default="0"),
    Column("created_at", DateTime, nullable=False),
)

discovery_candidates = Table(
    "discovery_candidates",
    metadata,
    Column("id", String(12), primary_key=True),
    Column(
        "search_id",
        String(12),
        ForeignKey("discovery_searches.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("url", String, nullable=False),
    Column("domain", String, nullable=False),
    Column("title", String, nullable=True),
    Column("snippet", Text, nullable=True),
    Column("score", Integer, nullable=False, server_default="0"),
    Column("status", String(16), nullable=False, server_default="pending"),
    Column("created_at", DateTime, nullable=False),
    Column("updated_at", DateTime, nullable=True),
)

# ── Library tables (M5.5) ─────────────────────────────────

library_items = Table(
    "library_items",
    metadata,
    Column("id", String(12), primary_key=True),
    Column("item_type", String(32), nullable=False),
    Column("title", String(200), nullable=False),
    Column("description", Text, nullable=True),
    Column("url", String, nullable=True),
    Column("tags", String, nullable=True),
    Column("created_at", DateTime, nullable=False),
    Column("updated_at", DateTime, nullable=True),
)

# ── Monitoring tables (M5.6 + Phase 7) ───────────────────

watchlists = Table(
    "watchlists",
    metadata,
    Column("id", String(12), primary_key=True),
    Column("name", String(200), nullable=False),
    Column("description", Text, nullable=True),
    Column("project_id", String(64), nullable=True),
    Column("created_at", DateTime, nullable=False),
    Column("updated_at", DateTime, nullable=True),
)

watchlist_entries = Table(
    "watchlist_entries",
    metadata,
    Column("id", String(12), primary_key=True),
    Column(
        "watchlist_id",
        String(12),
        ForeignKey("watchlists.id", ondelete="CASCADE"),
        nullable=True,
    ),
    Column("url", String, nullable=False),
    Column("label", String, nullable=True),
    Column("source_type", String(32), nullable=False, server_default="official_site"),
    Column("check_interval_hours", Integer, nullable=False, server_default="24"),
    Column("last_checked_at", DateTime, nullable=True),
    Column("last_snapshot_hash", String(64), nullable=True),
    Column("created_at", DateTime, nullable=False),
)

watchlist_snapshots = Table(
    "watchlist_snapshots",
    metadata,
    Column("id", String(12), primary_key=True),
    Column(
        "entry_id",
        String(12),
        ForeignKey("watchlist_entries.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("content_hash", String(64), nullable=False),
    Column("title", String, nullable=True),
    Column("headlines", Text, nullable=True),
    Column("ctas", Text, nullable=True),
    Column("meta_description", Text, nullable=True),
    Column("created_at", DateTime, nullable=False),
)

digest_reports = Table(
    "digest_reports",
    metadata,
    Column("id", String(12), primary_key=True),
    Column(
        "entry_id",
        String(12),
        ForeignKey("watchlist_entries.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("status", String(16), nullable=False, server_default="pending"),
    Column("changes_detected", Integer, nullable=False, server_default="0"),
    Column("diff_json", Text, nullable=True),
    Column("summary", Text, nullable=True),
    Column("created_at", DateTime, nullable=False),
)

# ── Job tables (Phase 8) ─────────────────────────────────

jobs = Table(
    "jobs",
    metadata,
    Column("id", String(12), primary_key=True),
    Column("job_type", String(32), nullable=False),
    Column("cron_expression", String(64), nullable=True),
    Column("target_id", String(12), nullable=True),
    Column("status", String(16), nullable=False, server_default="active"),
    Column("last_run_at", DateTime, nullable=True),
    Column("next_run_at", DateTime, nullable=True),
    Column("created_at", DateTime, nullable=False),
    Column("updated_at", DateTime, nullable=True),
)

job_results = Table(
    "job_results",
    metadata,
    Column("id", String(12), primary_key=True),
    Column(
        "job_id",
        String(12),
        ForeignKey("jobs.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("status", String(16), nullable=False),
    Column("started_at", DateTime, nullable=False),
    Column("completed_at", DateTime, nullable=True),
    Column("result_json", Text, nullable=True),
    Column("error_message", Text, nullable=True),
)

# ── Delivery tables (Phase 8) ────────────────────────────

delivery_configs = Table(
    "delivery_configs",
    metadata,
    Column("id", String(12), primary_key=True),
    Column("channel", String(16), nullable=False),
    Column("target", String, nullable=False),
    Column("enabled", Integer, nullable=False, server_default="1"),
    Column("config_json", Text, nullable=True),
    Column("created_at", DateTime, nullable=False),
    Column("updated_at", DateTime, nullable=True),
)

delivery_logs = Table(
    "delivery_logs",
    metadata,
    Column("id", String(12), primary_key=True),
    Column(
        "config_id",
        String(12),
        ForeignKey("delivery_configs.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("status", String(16), nullable=False),
    Column("digest_id", String(12), nullable=True),
    Column("sent_at", DateTime, nullable=True),
    Column("error_message", Text, nullable=True),
)

# ── Admin tables (Phase 9) ───────────────────────────────

usage_events = Table(
    "usage_events",
    metadata,
    Column("id", String(12), primary_key=True),
    Column("event_type", String(32), nullable=False),
    Column("workspace_id", String(64), nullable=True),
    Column("detail_json", Text, nullable=True),
    Column("created_at", DateTime, nullable=False),
)

# ── Generation tables (M5.7) ──────────────────────────────

generated_assets = Table(
    "generated_assets",
    metadata,
    Column("id", String(12), primary_key=True),
    Column(
        "review_run_id",
        String(12),
        ForeignKey("review_runs.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("status", String(16), nullable=False, server_default="pending"),
    Column("prompt_used", Text, nullable=True),
    Column("error_message", Text, nullable=True),
    Column("image_path", Text, nullable=True),
    Column("created_at", DateTime, nullable=False),
    Column("completed_at", DateTime, nullable=True),
)
