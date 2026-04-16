"""Competitor monitor — fetch pages and detect changes (Phase 7)."""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone

from ..schemas.watchlist_v2 import DiffResult, WatchlistEntry
from ..repositories.watchlist_repository import WatchlistRepository
from .diff_analyzer import DiffAnalyzer

logger = logging.getLogger("market-lens.monitor")


class CompetitorMonitor:
    """Fetches watchlist entry URLs and detects content changes."""

    def __init__(
        self,
        repo: WatchlistRepository,
        fetcher=None,
        extractor=None,
    ):
        self._repo = repo
        self._fetcher = fetcher
        self._extractor = extractor
        self._diff_analyzer = DiffAnalyzer()

    @staticmethod
    def _new_id() -> str:
        return uuid.uuid4().hex[:12]

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    def _compute_hash(self, data: dict) -> str:
        canonical = json.dumps(data, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(canonical.encode()).hexdigest()[:16]

    async def check_entry(self, entry: WatchlistEntry) -> DiffResult:
        """Check a single watchlist entry for changes.

        In production, this would fetch the URL and extract structured data.
        For now, returns a no-change result (actual fetch delegated to fetcher).
        """
        snapshot = await self._fetch_snapshot(entry.url)
        new_hash = self._compute_hash(snapshot)
        old_hash = entry.last_snapshot_hash

        changes_detected = bool(old_hash and old_hash != new_hash)

        diff = DiffResult(
            entry_id=entry.id,
            url=entry.url,
            changes_detected=changes_detected,
            checked_at=self._now(),
        )

        if changes_detected:
            diff = self._diff_analyzer.analyze(diff, snapshot)

        self._repo.update_snapshot_hash(entry.id, new_hash)
        self._repo.store_diff(entry.id, diff)

        logger.info(
            "Checked %s — changes=%s hash=%s->%s",
            entry.url,
            changes_detected,
            old_hash or "none",
            new_hash,
        )
        return diff

    async def check_watchlist(self, watchlist_id: str) -> list[DiffResult]:
        """Check all entries in a watchlist."""
        entries = self._repo.list_entries(watchlist_id)
        results = []
        for entry in entries:
            try:
                result = await self.check_entry(entry)
                results.append(result)
            except Exception as exc:
                logger.error("Failed to check %s: %s", entry.url, exc)
                results.append(
                    DiffResult(
                        entry_id=entry.id,
                        url=entry.url,
                        changes_detected=False,
                        summary=f"Check failed: {exc}",
                        checked_at=self._now(),
                    )
                )
        return results

    async def _fetch_snapshot(self, url: str) -> dict:
        """Fetch URL and extract structured data.

        Uses the injected fetcher/extractor if available, else returns stub.
        """
        if self._fetcher and self._extractor:
            try:
                html = await self._fetcher.fetch(url)
                extracted = self._extractor.extract(html)
                return {
                    "title": extracted.get("title", ""),
                    "headlines": extracted.get("headlines", []),
                    "ctas": extracted.get("ctas", []),
                    "meta_description": extracted.get("meta_description", ""),
                }
            except Exception as exc:
                logger.warning("Fetch failed for %s: %s", url, exc)

        return {
            "title": "",
            "headlines": [],
            "ctas": [],
            "meta_description": "",
        }
