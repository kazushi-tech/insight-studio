"""Shared authentication module for Market Lens AI.

Extracts verify_token / verify_auth_optional from integration_routes
so that all Pack C routers can share a single auth mechanism.

MVP mode: when API_KEYS is empty, authentication is skipped.
"""

from __future__ import annotations

import os
import logging

from fastapi import Header, HTTPException, status

logger = logging.getLogger("market-lens.auth")

# ── Key store ────────────────────────────────────────────────────
# Merges INTEGRATION_API_KEYS (legacy) and API_KEYS into one set.
API_KEYS: set[str] = set()

for _env_name in ("API_KEYS", "INTEGRATION_API_KEYS"):
    _raw = os.getenv(_env_name, "")
    if _raw:
        API_KEYS.update(k.strip() for k in _raw.split(",") if k.strip())


# ── Helpers ──────────────────────────────────────────────────────

def _extract_credential(
    authorization: str | None,
    x_api_key: str | None,
) -> str | None:
    """Return the first valid credential found, or None."""
    if authorization:
        if authorization.startswith("Bearer "):
            token = authorization[7:].strip()
            if token and token in API_KEYS:
                return token
        if authorization in API_KEYS:
            return authorization
    if x_api_key and x_api_key in API_KEYS:
        return x_api_key
    return None


# ── Dependencies ─────────────────────────────────────────────────

async def verify_token(
    authorization: str | None = Header(None, alias="Authorization"),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
) -> str:
    """Mandatory auth — required for write endpoints.

    Returns the verified credential or "dev" in MVP mode.
    Raises 401 when keys are configured but credentials are missing/invalid.
    """
    if not API_KEYS:
        return "dev"

    cred = _extract_credential(authorization, x_api_key)
    if cred:
        return cred

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing authentication. Provide Bearer token or X-API-Key header.",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def verify_byok_or_token(
    authorization: str | None = Header(None, alias="Authorization"),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
) -> str:
    """BYOK 互換 auth: API_KEYS 設定時は検証、未設定時は通過."""
    if not API_KEYS:
        return "byok"
    cred = _extract_credential(authorization, x_api_key)
    if cred:
        return cred
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing authentication. Provide Bearer token or X-API-Key header.",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def verify_auth_optional(
    authorization: str | None = Header(None, alias="Authorization"),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
) -> str | None:
    """Optional auth — for read endpoints.

    Returns credential if provided, None otherwise.
    Never raises 401 (read endpoints are public).
    """
    if not API_KEYS:
        return "dev"

    return _extract_credential(authorization, x_api_key)
