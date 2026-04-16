"""Schemas for AI Banner Generation (M5.7)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class BannerGenStatus(str, Enum):
    pending = "pending"
    generating = "generating"
    completed = "completed"
    failed = "failed"


class BannerGenRequest(BaseModel):
    """Request to generate an improved banner based on review results."""

    review_run_id: str = Field(min_length=1)
    style_guidance: str = ""
    model: Optional[str] = None
    api_key: Optional[str] = Field(default=None, repr=False)


class BannerGenResult(BaseModel):
    """Result of banner generation."""

    id: str
    review_run_id: str
    status: BannerGenStatus = BannerGenStatus.pending
    prompt_used: str = ""
    error_message: str = ""
    image_url: Optional[str] = None
    image_path: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
