"""API routes for external tool integrations (webhook & import).

SECURITY NOTES:
- SSRF protection via validate_operator_url() for all external URLs
- Bearer token or API key authentication required for all write operations
- Rate limiting applied at middleware level (see main.py)
- In-memory storage has TTL (1 hour) and max size (1000 entries) limits
- Metadata dict has max_length (10KB) and depth (5 levels) constraints
- callback_url is validated but NOT executed (async processing not implemented)
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException, Security, status
from pydantic import BaseModel, Field, HttpUrl, field_validator

from ..policies import validate_operator_url

logger = logging.getLogger("market-lens.integrations")

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

# ── Configuration ───────────────────────────────────────────────

_MAX_STORE_SIZE = 1000
_TTL_SECONDS = 3600  # 1 hour
_MAX_METADATA_BYTES = 10 * 1024  # 10KB
_MAX_METADATA_DEPTH = 5

# ── In-memory store with TTL and size limits ────────────────────

class _TTLStore:
    """In-memory store with automatic TTL expiration and size limit."""

    def __init__(self, max_size: int = _MAX_STORE_SIZE, ttl: int = _TTL_SECONDS):
        self._store: dict[str, tuple[dict, float]] = {}
        self._max_size = max_size
        self._ttl = ttl

    def get(self, key: str) -> dict | None:
        if entry := self._store.get(key):
            data, expiry = entry
            if time.time() < expiry:
                return data
            # Expired, remove it
            del self._store[key]
        return None

    def set(self, key: str, value: dict) -> None:
        # Remove expired entries first
        self._cleanup()

        # Enforce size limit (evict oldest if needed)
        if len(self._store) >= self._max_size and key not in self._store:
            # Find and remove oldest entry
            oldest_key = min(self._store.keys(), key=lambda k: self._store[k][1])
            del self._store[oldest_key]

        expiry = time.time() + self._ttl
        self._store[key] = (value, expiry)

    def _cleanup(self) -> None:
        now = time.time()
        expired = [k for k, (_, expiry) in self._store.items() if expiry < now]
        for k in expired:
            del self._store[k]

    def size(self) -> int:
        self._cleanup()
        return len(self._store)


_webhook_requests = _TTLStore()
_import_requests = _TTLStore()


# ── Authentication (delegated to shared auth module) ─────────────
from ..auth import API_KEYS, verify_token as verify_integration_token  # noqa: E402


async def verify_integration_auth_optional(
    authorization: str | None = Header(None, alias="Authorization"),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
) -> str | None:
    """Optional auth for read-only endpoints."""
    if not authorization and not x_api_key:
        return None

    try:
        return await verify_integration_token(authorization, x_api_key)
    except HTTPException:
        return None


# ── Request / Response Models ────────────────────────────────────

def _validate_metadata_size(value: dict | None) -> dict | None:
    """Validate metadata size and depth constraints."""
    if value is None:
        return None

    # Check JSON serialization size
    import json
    try:
        serialized = json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError) as e:
        raise ValueError(f"Metadata must be JSON-serializable: {e}")

    if len(serialized.encode('utf-8')) > _MAX_METADATA_BYTES:
        raise ValueError(f"Metadata exceeds maximum size of {_MAX_METADATA_BYTES} bytes")

    # Check depth
    def _check_depth(obj, current_depth=0):
        if current_depth > _MAX_METADATA_DEPTH:
            raise ValueError(f"Metadata exceeds maximum depth of {_MAX_METADATA_DEPTH}")
        if isinstance(obj, dict):
            for v in obj.values():
                _check_depth(v, current_depth + 1)
        elif isinstance(obj, list):
            for item in obj:
                _check_depth(item, current_depth + 1)

    try:
        _check_depth(value)
    except ValueError as e:
        raise ValueError(str(e))

    return value


class WebhookReviewRequest(BaseModel):
    """External tool requests an AI review of a creative asset."""
    source_tool: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    asset_url: HttpUrl
    asset_type: str = "banner"
    callback_url: HttpUrl | None = None
    industry: str | None = None
    metadata: dict | None = None

    @field_validator("asset_type")
    @classmethod
    def validate_asset_type(cls, v: str) -> str:
        if v not in ("banner", "lp"):
            raise ValueError("asset_type must be 'banner' or 'lp'")
        return v

    @field_validator("industry")
    @classmethod
    def validate_industry(cls, v: str | None) -> str | None:
        if v is not None and v not in ("real_estate", "ecommerce", "beauty", "b2b"):
            raise ValueError("industry must be one of: real_estate, ecommerce, beauty, b2b")
        return v

    @field_validator("asset_url", "callback_url")
    @classmethod
    def validate_ssrf(cls, v: HttpUrl | None) -> HttpUrl | None:
        if v is None:
            return None
        # SSRF protection: reject private IPs, loopback, metadata IPs
        err = validate_operator_url(str(v))
        if err:
            raise ValueError(f"URL validation failed: {err}")
        return v

    @field_validator("metadata")
    @classmethod
    def validate_metadata_constraints(cls, v: dict | None) -> dict | None:
        return _validate_metadata_size(v)


class ImportAssetRequest(BaseModel):
    """Import a creative asset from an external URL for review."""
    url: HttpUrl
    name: str | None = Field(None, max_length=256)
    source_tool: str | None = Field(None, max_length=64)
    tags: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v: list[str]) -> list[str]:
        return [t[:64] for t in v]

    @field_validator("url")
    @classmethod
    def validate_ssrf(cls, v: HttpUrl) -> HttpUrl:
        # SSRF protection
        err = validate_operator_url(str(v))
        if err:
            raise ValueError(f"URL validation failed: {err}")
        return v


class WebhookResponse(BaseModel):
    request_id: str
    status: str
    message: str
    created_at: str


class ImportResponse(BaseModel):
    import_id: str
    status: str
    url: str
    name: str | None
    created_at: str


class IntegrationStatus(BaseModel):
    service: str
    status: str
    supported_tools: list[str]
    supported_asset_types: list[str]
    supported_industries: list[str]
    version: str
    auth_required: bool


# ── Endpoints ────────────────────────────────────────────────────

@router.get("/status")
async def integration_status() -> IntegrationStatus:
    """Check integration service status and capabilities."""
    return IntegrationStatus(
        service="Market Lens AI Integration API",
        status="operational",
        supported_tools=["shinzaemon", "canva", "ad_com", "generic"],
        supported_asset_types=["banner", "lp"],
        supported_industries=["real_estate", "ecommerce", "beauty", "b2b"],
        version="1.1.0",
        auth_required=len(API_KEYS) > 0,
    )


@router.post("/webhook/review")
async def webhook_review_request(
    req: WebhookReviewRequest,
    auth: str = Security(verify_integration_token),
) -> WebhookResponse:
    """
    Receive a review request from an external creative tool.

    The review will be queued and processed asynchronously.
    Note: callback_url is validated but NOT executed (async processing pending Pack C).

    Authentication: Bearer token or X-API-Key header required.
    """
    request_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()

    _webhook_requests.set(request_id, {
        "request_id": request_id,
        "source_tool": req.source_tool,
        "asset_url": str(req.asset_url),
        "asset_type": req.asset_type,
        "callback_url": str(req.callback_url) if req.callback_url else None,
        "industry": req.industry,
        "metadata": req.metadata,
        "status": "accepted",
        "created_at": now,
    })

    logger.info(
        "Webhook review request %s from %s (auth=%s): %s",
        request_id, req.source_tool, auth[:8] + "***", req.asset_url,
    )

    return WebhookResponse(
        request_id=request_id,
        status="accepted",
        message=f"Review request accepted. Asset will be reviewed with {'industry=' + req.industry + ' template' if req.industry else 'default'} criteria.",
        created_at=now,
    )


@router.get("/webhook/review/{request_id}")
async def get_webhook_status(
    request_id: str,
    auth: str | None = Security(verify_integration_auth_optional),
):
    """Check the status of a webhook review request."""
    if not re.match(r"^[0-9a-f]{12}$", request_id):
        raise HTTPException(status_code=422, detail="Invalid request_id format")

    entry = _webhook_requests.get(request_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Request not found")
    return entry


@router.post("/import")
async def import_asset(
    req: ImportAssetRequest,
    auth: str = Security(verify_integration_token),
) -> ImportResponse:
    """
    Import a creative asset from an external URL.

    The asset will be fetched and stored for subsequent review.

    Authentication: Bearer token or X-API-Key header required.
    """
    import_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()

    _import_requests.set(import_id, {
        "import_id": import_id,
        "url": str(req.url),
        "name": req.name,
        "source_tool": req.source_tool,
        "tags": req.tags,
        "status": "queued",
        "created_at": now,
    })

    logger.info("Asset import %s (auth=%s): %s", import_id, auth[:8] + "***", req.url)

    return ImportResponse(
        import_id=import_id,
        status="queued",
        url=str(req.url),
        name=req.name,
        created_at=now,
    )


@router.get("/import/{import_id}")
async def get_import_status(
    import_id: str,
    auth: str | None = Security(verify_integration_auth_optional),
):
    """Check the status of an asset import."""
    if not re.match(r"^[0-9a-f]{12}$", import_id):
        raise HTTPException(status_code=422, detail="Invalid import_id format")

    entry = _import_requests.get(import_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Import not found")
    return entry
