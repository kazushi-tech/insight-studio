"""Pydantic schemas for competitor URL discovery (M5.2)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from ..models import TokenUsage


class CandidateStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class DiscoverySearchRequest(BaseModel):
    """Request to discover competitor URLs for a brand."""

    brand_url: str
    api_key: Optional[str] = Field(default=None, repr=False)


class SearchResultItem(BaseModel):
    """Single search result from provider."""

    url: str
    domain: str
    title: str = ""
    snippet: str = ""


class DiscoveryCandidate(BaseModel):
    """A discovered competitor candidate with scoring."""

    id: str
    search_id: str
    url: str
    domain: str
    title: str = ""
    snippet: str = ""
    score: int = 0
    status: CandidateStatus = CandidateStatus.pending
    created_at: datetime
    updated_at: Optional[datetime] = None


class DiscoverySearchResponse(BaseModel):
    """Response after executing a discovery search."""

    search_id: str
    brand_url: str
    brand_domain: str
    query_used: str
    candidates: list[DiscoveryCandidate]


class CandidateListResponse(BaseModel):
    """Response for listing candidates of a search."""

    search_id: str
    candidates: list[DiscoveryCandidate]


class CandidateActionResponse(BaseModel):
    """Response after approving/rejecting a candidate."""

    id: str
    status: CandidateStatus


# ── One-click Discovery Analyze schemas ──────────────────────


class DiscoveryAnalyzeRequest(BaseModel):
    """ワンクリック Discovery + 分析リクエスト"""

    brand_url: str
    api_key: Optional[str] = Field(default=None, repr=False)
    search_api_key: Optional[str] = Field(default=None, repr=False)
    model: Optional[str] = None
    provider: Optional[str] = None


class FetchedSite(BaseModel):
    """取得したサイトのサマリー"""

    url: str
    domain: str
    title: str = ""
    description: str = ""
    og_image_url: Optional[str] = None
    analysis_source: str = "page_fetch"
    error: Optional[str] = None


class DiscoveryAnalyzeResponse(BaseModel):
    """ワンクリック Discovery + 分析レスポンス"""

    search_id: str
    brand_url: str
    brand_domain: str
    query_used: str
    candidate_count: int
    fetched_sites: list[FetchedSite]
    analyzed_count: int
    report_md: str
    quality_status: str = "pass"
    quality_issues: list[str] = Field(default_factory=list)
    quality_is_critical: bool = False
    token_usage: Optional[TokenUsage] = None
    industry: str = ""
    excluded_candidates: list[str] = Field(default_factory=list)
