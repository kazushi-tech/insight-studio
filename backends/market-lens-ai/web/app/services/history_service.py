"""History management service."""

from __future__ import annotations

import logging
from typing import Optional

from ..models import ScanResult
from ..repositories.scan_repository import ScanRepository

logger = logging.getLogger("market-lens")


def list_scans(owner_id: str | None, repo: ScanRepository) -> list[dict]:
    """Return scan summaries visible to the current owner only."""
    if not owner_id:
        return []
    return repo.list_all(owner_id)


def get_scan(run_id: str, owner_id: str | None, repo: ScanRepository) -> Optional[ScanResult]:
    """Load a single scan by run_id. Raises ValueError for invalid IDs."""
    result = repo.load(run_id)
    if result is None:
        return None
    if not owner_id or result.owner_id != owner_id:
        return None
    return result


def delete_scan(run_id: str, owner_id: str | None, repo: ScanRepository) -> bool:
    """Delete a scan. Raises ValueError for invalid IDs. Returns True if found."""
    result = repo.load(run_id)
    if result is None:
        return False
    if not owner_id or result.owner_id != owner_id:
        return False
    deleted = repo.delete(run_id)
    if deleted:
        logger.info("Scan deleted: run_id=%s", run_id)
    return deleted
