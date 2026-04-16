"""Landing page capture service — reuses existing fetcher/extractor."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from ...extractor import extract
from ...fetcher import fetch_html
from ...schemas.review_request import LandingPageInput

logger = logging.getLogger("market-lens")


@dataclass
class LpCaptureResult:
    """Captured LP data ready for review."""

    landing_page: LandingPageInput
    screenshot_path: Optional[str] = None
    error: Optional[str] = None


async def capture_landing_page(
    url: str,
    *,
    screenshot_dir: Optional[str] = None,
    fetch_timeout: float = 25.0,
    fetch_max_retries: int = 2,
) -> LpCaptureResult:
    """Fetch and extract structured data from a landing page URL.

    Reuses the existing fetcher.fetch_html and extractor.extract pipeline
    to avoid duplicating scan logic.
    """
    html, fetch_err = await fetch_html(url, timeout=fetch_timeout, max_retries=fetch_max_retries)
    if fetch_err:
        logger.warning("LP fetch failed for %s: %s", url, fetch_err)
        return LpCaptureResult(
            landing_page=LandingPageInput(url=url),
            error=f"Fetch failed: {fetch_err}",
        )

    data = extract(url, html)

    lp_input = LandingPageInput(
        url=url,
        title=data.title,
        meta_description=data.meta_description,
        first_view_text=data.hero_copy or data.h1,
        cta_text=data.main_cta,
        extracted_benefits=data.feature_bullets,
        trust_elements=data.testimonials[:5] if data.testimonials else [],
    )

    has_meaningful_data = any([lp_input.title, lp_input.first_view_text,
                               lp_input.cta_text, lp_input.meta_description])
    if not has_meaningful_data:
        logger.warning("LP extraction yielded no data for %s (likely JS-rendered)", url)

    screenshot_path = None
    if screenshot_dir:
        from ...fetcher import take_screenshot
        from pathlib import Path

        ss_dir = Path(screenshot_dir)
        ss_dir.mkdir(parents=True, exist_ok=True)
        ss_path = str(ss_dir / "lp_screenshot.png")
        ss_err = await take_screenshot(url, ss_path)
        if ss_err:
            logger.warning("LP screenshot failed for %s: %s", url, ss_err)
        else:
            screenshot_path = ss_path

    return LpCaptureResult(
        landing_page=lp_input,
        screenshot_path=screenshot_path,
    )
