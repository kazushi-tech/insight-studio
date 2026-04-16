"""Watchlist routes — CRUD for project-level watchlists + diff retrieval (Phase 7)."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import verify_auth_optional, verify_token

from ..schemas.watchlist_v2 import (
    DiffResult,
    Watchlist,
    WatchlistCreate,
    WatchlistDetail,
    WatchlistEntry,
    WatchlistEntryCreate,
    WatchlistUpdate,
)
from ..policies import validate_operator_url
from ..repositories.watchlist_repository import WatchlistRepository
from ..services.collection_policy import validate_source

_ID_RE = re.compile(r"^[0-9a-f]{12}$")
_MAX_WATCHLISTS_PER_PROJECT = 20
_MAX_WATCHLISTS_GLOBAL = 100
_MAX_ENTRIES_PER_WATCHLIST = 50


def _check_id(val: str, name: str = "id") -> None:
    if not _ID_RE.match(val):
        raise HTTPException(status_code=422, detail=f"Invalid {name}: {val}")


def create_watchlist_router(
    repo: WatchlistRepository | None = None,
    monitor=None,
) -> APIRouter:
    """Factory that creates watchlist routes."""
    router = APIRouter(prefix="/api/watchlists", tags=["watchlists"])
    _repo = repo or WatchlistRepository()
    _monitor = monitor

    # ── Watchlist CRUD ──

    @router.post("", response_model=Watchlist)
    async def create_watchlist(req: WatchlistCreate, _: str = Depends(verify_token)):
        # Global limit check
        all_watchlists = _repo.list_watchlists()
        if len(all_watchlists) >= _MAX_WATCHLISTS_GLOBAL:
            raise HTTPException(
                status_code=409,
                detail="Global watchlist limit reached",
            )
        # Per-project limit check
        existing = [w for w in all_watchlists if w.project_id == req.project_id]
        if len(existing) >= _MAX_WATCHLISTS_PER_PROJECT:
            raise HTTPException(
                status_code=422,
                detail=f"Watchlist limit reached ({_MAX_WATCHLISTS_PER_PROJECT} per project)",
            )
        return _repo.create_watchlist(req)

    @router.get("", response_model=list[Watchlist])
    async def list_watchlists(project_id: str | None = Query(default=None), _: str | None = Depends(verify_auth_optional)):
        return _repo.list_watchlists(project_id=project_id)

    @router.get("/{watchlist_id}", response_model=WatchlistDetail)
    async def get_watchlist(watchlist_id: str, _: str | None = Depends(verify_auth_optional)):
        _check_id(watchlist_id, "watchlist_id")
        wl = _repo.get_watchlist(watchlist_id)
        if wl is None:
            raise HTTPException(status_code=404, detail="Watchlist not found")
        entries = _repo.list_entries(watchlist_id)
        return WatchlistDetail(watchlist=wl, entries=entries)

    @router.patch("/{watchlist_id}", response_model=Watchlist)
    async def update_watchlist(watchlist_id: str, req: WatchlistUpdate, _: str = Depends(verify_token)):
        _check_id(watchlist_id, "watchlist_id")
        wl = _repo.update_watchlist(watchlist_id, req)
        if wl is None:
            raise HTTPException(status_code=404, detail="Watchlist not found")
        return wl

    @router.delete("/{watchlist_id}")
    async def delete_watchlist(watchlist_id: str, _: str = Depends(verify_token)):
        _check_id(watchlist_id, "watchlist_id")
        if not _repo.delete_watchlist(watchlist_id):
            raise HTTPException(status_code=404, detail="Watchlist not found")
        return {"deleted": True}

    # ── Entry CRUD ──

    @router.post("/{watchlist_id}/entries", response_model=WatchlistEntry)
    async def add_entry(watchlist_id: str, req: WatchlistEntryCreate, _: str = Depends(verify_token)):
        _check_id(watchlist_id, "watchlist_id")

        # SSRF check
        ssrf_err = validate_operator_url(req.url)
        if ssrf_err:
            raise HTTPException(status_code=422, detail=ssrf_err)

        # Collection policy check
        policy_err = validate_source(req.url, req.source_type.value)
        if policy_err:
            raise HTTPException(status_code=422, detail=policy_err)

        # Entry limit check
        current_entries = _repo.list_entries(watchlist_id)
        if len(current_entries) >= _MAX_ENTRIES_PER_WATCHLIST:
            raise HTTPException(
                status_code=422,
                detail=f"Entry limit reached ({_MAX_ENTRIES_PER_WATCHLIST} per watchlist)",
            )

        entry = _repo.add_entry(watchlist_id, req)
        if entry is None:
            raise HTTPException(status_code=404, detail="Watchlist not found")
        return entry

    @router.delete("/{watchlist_id}/entries/{entry_id}")
    async def delete_entry(watchlist_id: str, entry_id: str, _: str = Depends(verify_token)):
        _check_id(watchlist_id, "watchlist_id")
        _check_id(entry_id, "entry_id")
        if not _repo.delete_entry(entry_id):
            raise HTTPException(status_code=404, detail="Entry not found")
        return {"deleted": True}

    # ── Diff retrieval ──

    @router.get("/{watchlist_id}/entries/{entry_id}/diffs", response_model=list[DiffResult])
    async def get_diffs(watchlist_id: str, entry_id: str, limit: int = Query(default=10, ge=1, le=50), _: str | None = Depends(verify_auth_optional)):
        _check_id(watchlist_id, "watchlist_id")
        _check_id(entry_id, "entry_id")
        return _repo.get_diffs(entry_id, limit=limit)

    # ── Manual check ──

    @router.post("/{watchlist_id}/entries/{entry_id}/check", response_model=DiffResult)
    async def check_entry(watchlist_id: str, entry_id: str, _: str = Depends(verify_token)):
        _check_id(watchlist_id, "watchlist_id")
        _check_id(entry_id, "entry_id")
        if _monitor is None:
            raise HTTPException(status_code=501, detail="Monitor not configured")
        entry = _repo.get_entry(entry_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Entry not found")
        return await _monitor.check_entry(entry)

    return router
