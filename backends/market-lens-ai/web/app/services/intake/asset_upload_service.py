"""Asset upload service — validates and stores creative assets."""

from __future__ import annotations

import logging
from typing import Optional

from ...repositories.asset_repository import AssetRepository
from ...schemas.creative_asset import (
    ALLOWED_MIME_TYPES,
    MAX_FILE_SIZE_BYTES,
    CreativeAssetMetadata,
    CreativeAssetResponse,
)

logger = logging.getLogger("market-lens")


class UploadError(Exception):
    """Raised when upload validation fails."""


# Magic bytes → actual MIME type mapping
_MAGIC_SIGNATURES: list[tuple[bytes, str]] = [
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"RIFF", "image/webp"),  # WebP starts with RIFF....WEBP
]


def _detect_mime_from_bytes(data: bytes) -> str | None:
    """Detect actual image MIME type from binary magic bytes."""
    for magic, mime in _MAGIC_SIGNATURES:
        if data[:len(magic)] == magic:
            # Extra check for WebP: RIFF + WEBP at offset 8
            if mime == "image/webp":
                if len(data) >= 12 and data[8:12] == b"WEBP":
                    return mime
                continue
            return mime
    return None


async def upload_asset(
    *,
    file_name: str,
    mime_type: str,
    data: bytes,
    width: Optional[int] = None,
    height: Optional[int] = None,
    repo: AssetRepository,
) -> CreativeAssetResponse:
    """Validate, store, and return metadata for an uploaded asset."""
    if mime_type not in ALLOWED_MIME_TYPES:
        raise UploadError(
            f"Unsupported file type: {mime_type}. "
            f"Allowed: {', '.join(sorted(ALLOWED_MIME_TYPES))}"
        )

    # Detect actual MIME type from binary content and correct mismatches
    detected_mime = _detect_mime_from_bytes(data)
    if detected_mime and detected_mime != mime_type:
        logger.warning(
            "MIME type mismatch: declared=%s, detected=%s (file=%s). Using detected type.",
            mime_type, detected_mime, file_name,
        )
        mime_type = detected_mime
    elif detected_mime is None and len(data) > 0:
        raise UploadError(
            f"Could not verify image format from file content. "
            f"Declared type: {mime_type}, file: {file_name}"
        )

    size = len(data)
    if size > MAX_FILE_SIZE_BYTES:
        raise UploadError(
            f"File too large: {size} bytes (max {MAX_FILE_SIZE_BYTES} bytes)"
        )
    if size == 0:
        raise UploadError("Empty file")

    metadata = CreativeAssetMetadata(
        file_name=file_name,
        mime_type=mime_type,
        size_bytes=size,
        width=width,
        height=height,
    )

    repo.save(metadata, data)
    logger.info("Asset uploaded: asset_id=%s file=%s", metadata.asset_id, file_name)

    return CreativeAssetResponse(
        asset_id=metadata.asset_id,
        file_name=metadata.file_name,
        mime_type=metadata.mime_type,
        size_bytes=metadata.size_bytes,
        width=metadata.width,
        height=metadata.height,
        asset_type=metadata.asset_type.value,
        created_at=metadata.created_at,
    )
