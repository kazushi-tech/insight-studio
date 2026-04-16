"""Shared test fixtures."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest


# ---------------------------------------------------------------------------
# Fix Windows tmp_path permissions by redirecting to a local directory
# ---------------------------------------------------------------------------

def pytest_configure(config):
    """Redirect pytest temp directory to a local folder to avoid permission errors."""
    local_tmp = Path(__file__).parent.parent / ".pytest_tmp"
    local_tmp.mkdir(exist_ok=True)
    os.environ.setdefault("PYTEST_DEBUG_TEMPROOT", str(local_tmp))


FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def clear_rate_limit():
    """Clear rate limit store before each test to prevent 429 errors."""
    from web.app import main
    main._rate_store.clear()
    yield


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
