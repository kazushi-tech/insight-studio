"""Creative asset schemas for upload, storage, and retrieval."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


def _new_asset_id() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> datetime:
    return datetime.now(timezone.utc)


ALLOWED_MIME_TYPES = frozenset({
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
})

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


class AssetType(str, Enum):
    banner = "banner"
    screenshot = "screenshot"


class CreativeAssetMetadata(BaseModel):
    """Metadata stored alongside the binary asset file."""

    asset_id: str = Field(default_factory=_new_asset_id)
    file_name: str
    mime_type: str
    size_bytes: int
    width: Optional[int] = None
    height: Optional[int] = None
    asset_type: AssetType = AssetType.banner
    created_at: datetime = Field(default_factory=_now)

    @field_validator("mime_type")
    @classmethod
    def _check_mime(cls, v: str) -> str:
        if v not in ALLOWED_MIME_TYPES:
            raise ValueError(
                f"Unsupported file type: {v}. Allowed: {', '.join(sorted(ALLOWED_MIME_TYPES))}"
            )
        return v

    @field_validator("size_bytes")
    @classmethod
    def _check_size(cls, v: int) -> int:
        if v > MAX_FILE_SIZE_BYTES:
            raise ValueError(
                f"File too large: {v} bytes. Max allowed: {MAX_FILE_SIZE_BYTES} bytes"
            )
        if v <= 0:
            raise ValueError("File size must be positive")
        return v


class CreativeAssetResponse(BaseModel):
    """Response after successful upload."""

    asset_id: str
    file_name: str
    mime_type: str
    size_bytes: int
    width: Optional[int] = None
    height: Optional[int] = None
    asset_type: str
    created_at: datetime
