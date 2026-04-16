"""User-scoping helpers for operator-visible history data."""

from __future__ import annotations

import re
from typing import Optional

from fastapi import Header, HTTPException, status

_SAFE_USER_ID = re.compile(r"^(auth|guest):[A-Za-z0-9_-]{8,128}$")


def _normalize_user_id(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    if not normalized:
        return None
    if not _SAFE_USER_ID.match(normalized):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid X-Insight-User header.",
        )
    return normalized


async def get_optional_user_id(
    x_insight_user: str | None = Header(None, alias="X-Insight-User"),
) -> Optional[str]:
    return _normalize_user_id(x_insight_user)


async def require_user_id(
    x_insight_user: str | None = Header(None, alias="X-Insight-User"),
) -> str:
    user_id = _normalize_user_id(x_insight_user)
    if user_id:
        return user_id
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="X-Insight-User header is required.",
    )
