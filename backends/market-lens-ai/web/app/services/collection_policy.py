"""Collection policy — validate sources for watchlist monitoring (Phase 7)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import urlparse

_DEFAULT_PATH = "config/collection_policy.json"

_ALLOWED_SOURCE_TYPES = {"official_site", "ad_library", "manual_import"}
_BLOCKED_DOMAINS: set[str] = set()
_MAX_ENTRIES = 50


def _load_policy() -> dict:
    """Load collection policy from file or env."""
    policy_json = os.getenv("COLLECTION_POLICY_JSON")
    if policy_json:
        return json.loads(policy_json)

    path = Path(os.getenv("COLLECTION_POLICY_PATH", _DEFAULT_PATH))
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def _get_blocked_domains() -> set[str]:
    policy = _load_policy()
    return set(policy.get("blocked_domains", []))


def _get_allowed_source_types() -> set[str]:
    policy = _load_policy()
    types = policy.get("allowed_source_types", list(_ALLOWED_SOURCE_TYPES))
    return set(types)


def validate_source(url: str, source_type: str) -> str | None:
    """Validate URL + source_type against collection policy.

    Returns error message if blocked, None if OK.
    """
    allowed_types = _get_allowed_source_types()
    if source_type not in allowed_types:
        return f"Source type '{source_type}' is not allowed. Allowed: {', '.join(sorted(allowed_types))}"

    try:
        hostname = urlparse(url).hostname or ""
    except Exception:
        return "Invalid URL"

    blocked = _get_blocked_domains()
    for domain in blocked:
        if hostname == domain or hostname.endswith("." + domain):
            return f"Domain '{hostname}' is blocked by collection policy"

    return None


def get_max_entries_per_watchlist() -> int:
    policy = _load_policy()
    return policy.get("max_entries_per_watchlist", _MAX_ENTRIES)
