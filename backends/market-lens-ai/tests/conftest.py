"""Shared test fixtures."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import pytest


os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault(
    "RATE_LIMIT_HASH_SECRET",
    "market-lens-tests-rate-limit-secret-at-least-32-bytes",
)


# ---------------------------------------------------------------------------
# Fix Windows tmp_path permissions by redirecting to a local directory
# ---------------------------------------------------------------------------

def pytest_configure(config):
    """Give each pytest process an isolated Windows-safe temp root.

    A shared repository-local ``.pytest_tmp`` can be left with an ACL or an
    open handle from an interrupted run.  Once that happens every ``tmp_path``
    fixture fails before the test body starts.  A process-scoped directory in
    the OS temp root avoids cross-run locking while keeping tests API-key free.
    """
    process_tmp = Path(tempfile.gettempdir()) / f"insight-studio-pytest-{os.getpid()}"
    process_tmp.mkdir(parents=True, exist_ok=True)
    os.environ["PYTEST_DEBUG_TEMPROOT"] = str(process_tmp)


FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def clear_rate_limit():
    """Provide migration-owned shared control tables for isolated tests."""
    import sqlalchemy as sa

    from web.app.shared_rate_limits import clear_rate_limit_buckets
    from web.app.tenant_auth import (
        INTERNAL_PROJECT_ID,
        INTERNAL_WORKSPACE_ID,
        _session_factory_for_url,
        get_managed_session_factory,
    )
    from web.app.tenant_schema import (
        ai_budget_accounts,
        ai_usage_ledger,
        metadata,
        projects,
        workspaces,
    )

    factory = get_managed_session_factory()
    engine = factory.kw["bind"]
    metadata.create_all(engine)
    with engine.begin() as connection:
        if connection.execute(
            sa.select(workspaces.c.id).where(workspaces.c.id == INTERNAL_WORKSPACE_ID)
        ).scalar_one_or_none() is None:
            connection.execute(
                sa.insert(workspaces).values(
                    id=INTERNAL_WORKSPACE_ID,
                    slug="insight-studio-internal",
                    name="Insight Studio Internal",
                    status="active",
                    is_internal=True,
                )
            )
        if connection.execute(
            sa.select(projects.c.id).where(projects.c.id == INTERNAL_PROJECT_ID)
        ).scalar_one_or_none() is None:
            connection.execute(
                sa.insert(projects).values(
                    id=INTERNAL_PROJECT_ID,
                    workspace_id=INTERNAL_WORKSPACE_ID,
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
    clear_rate_limit_buckets()
    yield
    _session_factory_for_url.cache_clear()


@pytest.fixture
def sample_html():
    return (FIXTURES_DIR / "sample_page.html").read_text(encoding="utf-8")


@pytest.fixture
def minimal_html():
    return (FIXTURES_DIR / "minimal_page.html").read_text(encoding="utf-8")


@pytest.fixture
def tmp_allowlist(tmp_path):
    """Create a temporary allowlist JSON file and return its Path."""
    data = {
        "domains": [
            {"domain": "example.com", "label": "Example", "allowed": True},
            {"domain": "acme.com", "label": "Acme", "allowed": True},
            {"domain": "blocked.com", "label": "Blocked", "allowed": False},
        ]
    }
    p = tmp_path / "allowlist.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    return p
