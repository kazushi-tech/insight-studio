"""Shared test-only managed-database fixture.

Production code never creates tables at startup.  Tests that exercise legacy
HTTP routes still need the migration-owned shared rate-limit table, so this
fixture creates only that table in an isolated in-memory SQLite database.
"""

from __future__ import annotations

import os

import pytest


os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault(
    "RATE_LIMIT_HASH_SECRET",
    "ads-tests-rate-limit-hash-secret-at-least-32-bytes",
)


@pytest.fixture(autouse=True)
def _isolated_shared_rate_limit_database():
    import sqlalchemy as sa

    from web.app.platform.rate_limits import _clerk_verifier
    from web.app.platform.schema import (
        ai_budget_accounts,
        ai_usage_ledger,
        platform_metadata,
        projects,
        rate_limit_buckets,
        workspaces,
    )
    from web.app.platform_db import get_platform_engine, reset_platform_engine_for_tests

    internal_workspace_id = "00000000-0000-0000-0000-000000000001"
    internal_project_id = "00000000-0000-0000-0000-000000000002"

    reset_platform_engine_for_tests()
    engine = get_platform_engine()
    platform_metadata.create_all(
        engine,
        tables=[
            workspaces,
            projects,
            rate_limit_buckets,
            ai_budget_accounts,
            ai_usage_ledger,
        ],
    )
    with engine.begin() as connection:
        connection.execute(
            sa.insert(workspaces).values(
                id=internal_workspace_id,
                slug="insight-studio-internal",
                name="Insight Studio Internal",
                status="active",
                is_internal=True,
            )
        )
        connection.execute(
            sa.insert(projects).values(
                id=internal_project_id,
                workspace_id=internal_workspace_id,
                slug="legacy-internal",
                name="Legacy Internal Data",
                status="active",
                is_internal=True,
                is_demo=False,
                version=1,
            )
        )
        connection.execute(sa.delete(ai_usage_ledger))
        connection.execute(sa.delete(ai_budget_accounts))
        connection.execute(sa.delete(rate_limit_buckets))
    _clerk_verifier.cache_clear()
    yield
    _clerk_verifier.cache_clear()
    reset_platform_engine_for_tests()
