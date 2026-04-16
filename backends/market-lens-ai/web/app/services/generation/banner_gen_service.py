"""Banner generation service — review result to improved banner (M5.7)."""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ...schemas.banner_generation import BannerGenResult, BannerGenStatus
from ...schemas.review_result import ReviewResult
from .gen_prompt_builder import build_banner_gen_prompt

logger = logging.getLogger("market-lens.generation")

GENERATIONS_DIR = Path("data/generations")

_ID_RE = re.compile(r"^[0-9a-f]{12}$")
_SENSITIVE_PATTERNS = re.compile(
    r"(api[_-]?key|token|secret|credential|authorization|bearer)",
    re.IGNORECASE,
)
_MAX_ERROR_LEN = 500


def _sanitize_error(exc: Exception) -> str:
    """Sanitize exception message to prevent leaking sensitive info."""
    msg = str(exc)
    if _SENSITIVE_PATTERNS.search(msg):
        return "Image generation failed due to an API error."
    if len(msg) > _MAX_ERROR_LEN:
        msg = msg[:_MAX_ERROR_LEN] + "…"
    return msg


class BannerGenError(Exception):
    """Raised when banner generation fails."""


class BannerGenService:
    """In-memory banner generation service (image generation disabled in Claude-only mode)."""

    def __init__(self, *, generations_dir: Path | None = None):
        self._results: dict[str, BannerGenResult] = {}
        self._generations_dir = generations_dir or GENERATIONS_DIR

    def _new_id(self) -> str:
        return uuid.uuid4().hex[:12]

    def _now(self) -> datetime:
        return datetime.now(timezone.utc)

    def _image_dir(self, gen_id: str) -> Path:
        return self._generations_dir / gen_id

    def _image_path(self, gen_id: str) -> Path:
        if not _ID_RE.match(gen_id):
            raise ValueError(f"Invalid gen_id format: {gen_id}")
        return self._image_dir(gen_id) / "banner.png"

    async def generate(
        self,
        *,
        review_run_id: str,
        review_result: ReviewResult,
        style_guidance: str = "",
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        original_image: bytes | None = None,
        original_width: int | None = None,
        original_height: int | None = None,
    ) -> BannerGenResult:
        """Banner image generation is disabled in Claude-only mode.

        Claude API does not support image generation. Returns a failed result
        with an explanatory message.
        """
        gen_id = self._new_id()
        now = self._now()

        result = BannerGenResult(
            id=gen_id,
            review_run_id=review_run_id,
            status=BannerGenStatus.failed,
            prompt_used="",
            created_at=now,
            completed_at=now,
            error_message="画像生成は現在利用できません。Claude API はテキスト分析専用です。",
        )
        self._results[gen_id] = result
        return result

    def get_result(self, gen_id: str) -> BannerGenResult | None:
        """Get a generation result by ID."""
        return self._results.get(gen_id)

    def get_image(self, gen_id: str) -> bytes | None:
        """Return image bytes for a completed generation, or None."""
        result = self._results.get(gen_id)
        if result is None or result.status != BannerGenStatus.completed:
            return None
        img_path = self._image_path(gen_id)
        if not img_path.exists():
            return None
        return img_path.read_bytes()
