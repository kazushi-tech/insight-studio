"""Policy routes."""

from __future__ import annotations

from fastapi import APIRouter

from ..models import PoliciesResponse
from ..policies import MAX_URLS, POLITE_DELAY_SEC, allowed_domains

router = APIRouter()


@router.get("/api/policies", response_model=PoliciesResponse)
async def get_policies():
    return PoliciesResponse(
        max_urls=MAX_URLS,
        polite_delay_sec=POLITE_DELAY_SEC,
        allowed_domains=[],
        notes="公開URLのみ対象（SSRF防御によるプライベートIP除外）",
    )
