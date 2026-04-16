"""Schemas for competitor compare review (M5.3)."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class CompetitorData(BaseModel):
    """Data about a single competitor for comparison."""

    url: str
    domain: str
    title: str = ""
    description: str = ""


class CompareReviewRequest(BaseModel):
    """Request to run a competitor comparison review."""

    asset_id: str
    competitors: list[CompetitorData] = Field(min_length=1, max_length=5)
    brand_info: str = ""
    operator_memo: str = ""
    model: Optional[str] = None
    provider: Optional[str] = None
    api_key: Optional[str] = Field(default=None, repr=False)
