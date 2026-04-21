"""Pydantic models for Market Lens AI."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field


def _new_run_id() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ExtractedData(BaseModel):
    url: str
    title: str = ""
    meta_description: str = ""
    h1: str = ""
    hero_copy: str = ""
    main_cta: str = ""
    pricing_snippet: str = ""
    # BtoB pricing status (Section C-3):
    #   "available"    — 価格情報が取得できた（通常の pricing_snippet）
    #   "inquiry_only" — 「要問い合わせ」「個別見積」等のBtoB標準導線のみ
    #   "not_found"    — 価格ページ・問い合わせ導線ともに検出できない
    pricing_status: Literal["available", "inquiry_only", "not_found"] = "not_found"
    feature_bullets: list[str] = Field(default_factory=list)
    body_text_snippet: str = ""
    og_type: str = ""
    og_image_url: Optional[str] = None
    screenshot_path: Optional[str] = None
    error: Optional[str] = None
    secondary_ctas: list[str] = Field(default_factory=list)
    faq_items: list[str] = Field(default_factory=list)
    testimonials: list[str] = Field(default_factory=list)
    urgency_elements: list[str] = Field(default_factory=list)
    trust_badges: list[str] = Field(default_factory=list)
    guarantees: list[str] = Field(default_factory=list)
    # Phase 4: 水回りCRO品質改善 — 画像・バナー・販促訴求の抽出強化
    image_alts: list[str] = Field(default_factory=list)
    banner_texts: list[str] = Field(default_factory=list)
    contact_paths: list[str] = Field(default_factory=list)
    promo_claims: list[str] = Field(default_factory=list)
    corporate_elements: list[str] = Field(default_factory=list)
    # Agency-grade expansion
    offer_terms: list[str] = Field(default_factory=list)
    review_signals: list[str] = Field(default_factory=list)
    shipping_signals: list[str] = Field(default_factory=list)


class TokenUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    model: str = ""
    # True when the LLM returned stop_reason="max_tokens" (output was truncated).
    truncated: bool = False


class ScanResult(BaseModel):
    run_id: str = Field(default_factory=_new_run_id)
    created_at: datetime = Field(default_factory=_now)
    owner_id: Optional[str] = None
    status: str = "pending"
    urls: list[str] = Field(default_factory=list)
    extracted: list[ExtractedData] = Field(default_factory=list)
    report_md: str = ""
    quality_status: str = "pass"
    quality_issues: list[str] = Field(default_factory=list)
    quality_is_critical: bool = False
    total_time_sec: float = 0.0
    token_usage: Optional[TokenUsage] = None
    error: Optional[str] = None


class ScanRequest(BaseModel):
    urls: list[str]
    model: Optional[str] = None
    provider: Optional[str] = None
    api_key: Optional[str] = Field(default=None, repr=False)


class ScanResponse(BaseModel):
    run_id: str
    status: str
    report_md: str
    quality_status: str = "pass"
    quality_issues: list[str] = Field(default_factory=list)
    quality_is_critical: bool = False
    total_time_sec: float
    error: Optional[str] = None


class PoliciesResponse(BaseModel):
    max_urls: int
    polite_delay_sec: float
    allowed_domains: list[str]
    notes: str
