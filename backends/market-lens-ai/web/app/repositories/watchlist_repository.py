"""Watchlist repository — in-memory CRUD for watchlists and entries (Phase 7)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from ..schemas.watchlist_v2 import (
    DiffResult,
    SourceType,
    Watchlist,
    WatchlistCreate,
    WatchlistEntry,
    WatchlistEntryCreate,
    WatchlistUpdate,
)


class WatchlistRepository:
    """In-memory watchlist repository with project-level grouping."""

    def __init__(self):
        self._watchlists: dict[str, Watchlist] = {}
        self._entries: dict[str, WatchlistEntry] = {}
        self._diffs: dict[str, list[DiffResult]] = {}

    @staticmethod
    def _new_id() -> str:
        return uuid.uuid4().hex[:12]

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    # ── Watchlist CRUD ──

    def create_watchlist(self, req: WatchlistCreate) -> Watchlist:
        wl = Watchlist(
            id=self._new_id(),
            name=req.name,
            description=req.description,
            project_id=req.project_id,
            created_at=self._now(),
        )
        self._watchlists[wl.id] = wl
        return wl

    def get_watchlist(self, watchlist_id: str) -> Watchlist | None:
        wl = self._watchlists.get(watchlist_id)
        if wl is None:
            return None
        count = sum(1 for e in self._entries.values() if e.watchlist_id == watchlist_id)
        return wl.model_copy(update={"entry_count": count})

    def list_watchlists(self, project_id: str | None = None) -> list[Watchlist]:
        result = list(self._watchlists.values())
        if project_id:
            result = [w for w in result if w.project_id == project_id]
        enriched = []
        for wl in result:
            count = sum(1 for e in self._entries.values() if e.watchlist_id == wl.id)
            enriched.append(wl.model_copy(update={"entry_count": count}))
        return sorted(enriched, key=lambda w: w.created_at, reverse=True)

    def update_watchlist(self, watchlist_id: str, req: WatchlistUpdate) -> Watchlist | None:
        wl = self._watchlists.get(watchlist_id)
        if wl is None:
            return None
        updates: dict = {"updated_at": self._now()}
        if req.name is not None:
            updates["name"] = req.name
        if req.description is not None:
            updates["description"] = req.description
        updated = wl.model_copy(update=updates)
        self._watchlists[watchlist_id] = updated
        return self.get_watchlist(watchlist_id)

    def delete_watchlist(self, watchlist_id: str) -> bool:
        if watchlist_id not in self._watchlists:
            return False
        del self._watchlists[watchlist_id]
        to_remove = [eid for eid, e in self._entries.items() if e.watchlist_id == watchlist_id]
        for eid in to_remove:
            del self._entries[eid]
        return True

    # ── Entry CRUD ──

    def add_entry(self, watchlist_id: str, req: WatchlistEntryCreate) -> WatchlistEntry | None:
        if watchlist_id not in self._watchlists:
            return None
        entry = WatchlistEntry(
            id=self._new_id(),
            watchlist_id=watchlist_id,
            url=req.url,
            label=req.label,
            source_type=req.source_type,
            check_interval_hours=req.check_interval_hours,
            created_at=self._now(),
        )
        self._entries[entry.id] = entry
        return entry

    def get_entry(self, entry_id: str) -> WatchlistEntry | None:
        return self._entries.get(entry_id)

    def list_entries(self, watchlist_id: str) -> list[WatchlistEntry]:
        return sorted(
            [e for e in self._entries.values() if e.watchlist_id == watchlist_id],
            key=lambda e: e.created_at,
            reverse=True,
        )

    def delete_entry(self, entry_id: str) -> bool:
        if entry_id not in self._entries:
            return False
        del self._entries[entry_id]
        return True

    def update_snapshot_hash(self, entry_id: str, hash_val: str) -> None:
        entry = self._entries.get(entry_id)
        if entry:
            self._entries[entry_id] = entry.model_copy(
                update={"last_snapshot_hash": hash_val, "last_checked_at": self._now()}
            )

    # ── Diff history ──

    _MAX_DIFFS_PER_ENTRY = 100

    def store_diff(self, entry_id: str, diff: DiffResult) -> None:
        diffs = self._diffs.setdefault(entry_id, [])
        diffs.append(diff)
        if len(diffs) > self._MAX_DIFFS_PER_ENTRY:
            self._diffs[entry_id] = diffs[-self._MAX_DIFFS_PER_ENTRY:]

    def get_diffs(self, entry_id: str, limit: int = 10) -> list[DiffResult]:
        diffs = self._diffs.get(entry_id, [])
        return sorted(diffs, key=lambda d: d.checked_at, reverse=True)[:limit]
