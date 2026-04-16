"""Watchlist & WatchlistEntry schemas for Phase 7 (project-level grouping)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class SourceType(str, Enum):
    """Allowed source types for watchlist entries."""

    official_site = "official_site"
    ad_library = "ad_library"
    manual_import = "manual_import"


class WatchlistCreate(BaseModel):
    """Request to create a new watchlist (project-level)."""

    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    project_id: str = Field(default="", max_length=64)


class WatchlistUpdate(BaseModel):
    """Request to update a watchlist."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None


class Watchlist(BaseModel):
    """A project-level watchlist grouping competitor entries."""

    id: str
    name: str
    description: str = ""
    project_id: str = ""
    entry_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None


class WatchlistEntryCreate(BaseModel):
    """Request to add a competitor URL to a watchlist."""

    url: str = Field(min_length=1)
    label: str = ""
    source_type: SourceType = SourceType.official_site
    check_interval_hours: int = Field(default=24, ge=1, le=168)


class WatchlistEntry(BaseModel):
    """A monitored competitor URL entry within a watchlist."""

    id: str
    watchlist_id: str
    url: str
    label: str = ""
    source_type: SourceType = SourceType.official_site
    check_interval_hours: int = 24
    last_checked_at: Optional[datetime] = None
    last_snapshot_hash: str = ""
    created_at: datetime


class WatchlistDetail(BaseModel):
    """Watchlist with its entries."""

    watchlist: Watchlist
    entries: list[WatchlistEntry]


class DiffResult(BaseModel):
    """Result of comparing two snapshots."""

    entry_id: str
    url: str
    changes_detected: bool = False
    headline_changes: list[str] = Field(default_factory=list)
    cta_changes: list[str] = Field(default_factory=list)
    design_changes: list[str] = Field(default_factory=list)
    summary: str = ""
    checked_at: datetime
