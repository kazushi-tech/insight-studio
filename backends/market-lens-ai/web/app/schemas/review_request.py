"""Review request schemas."""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class ReviewType(str, Enum):
    banner_review = "banner_review"
    ad_lp_review = "ad_lp_review"
    competitor_compare = "competitor_compare"


class LandingPageInput(BaseModel):
    """LP data for ad-to-LP fit review."""

    url: str
    title: str = ""
    meta_description: str = ""
    first_view_text: str = ""
    cta_text: str = ""
    extracted_benefits: list[str] = Field(default_factory=list)
    trust_elements: list[str] = Field(default_factory=list)


class BannerReviewRequest(BaseModel):
    """Request to review a single banner."""

    asset_id: str
    brand_info: str = ""
    operator_memo: str = ""
    model: Optional[str] = None
    provider: Optional[str] = None
    api_key: Optional[str] = Field(default=None, repr=False)


class AdLpReviewRequest(BaseModel):
    """Request to review ad-to-LP message fit."""

    asset_id: str
    landing_page: LandingPageInput
    brand_info: str = ""
    operator_memo: str = ""
    model: Optional[str] = None
    provider: Optional[str] = None
    api_key: Optional[str] = Field(default=None, repr=False)
