"""PDF export service — converts one-pager HTML to PDF via Playwright.

Uses Playwright headless Chromium to render the one-pager HTML and produce
a high-fidelity A4 PDF.
"""

from __future__ import annotations

import logging
from typing import Optional

from ...schemas.review_result import ReviewResult
from .onepager_render_service import render_onepager_html

logger = logging.getLogger("market-lens")

# Import async_playwright at module level so tests can patch it.
# If playwright is not installed, _async_playwright will be None.
_async_playwright = None
try:
    from playwright.async_api import async_playwright as _async_playwright
except ImportError:
    pass


class PdfExportError(Exception):
    """Raised when PDF generation fails."""


async def export_pdf(
    result: ReviewResult,
    *,
    title: str = "クリエイティブレビュー サマリー",
    subtitle: str = "",
    review_date: Optional[str] = None,
) -> bytes:
    """Generate PDF bytes from a ReviewResult using Playwright.

    Args:
        result: The structured review output.
        title: One-pager title.
        subtitle: Subtitle (brand/campaign).
        review_date: Date string (YYYY-MM-DD). Defaults to today.

    Returns:
        PDF file content as bytes.

    Raises:
        PdfExportError: Playwright not available or PDF generation fails.
    """
    html_content = render_onepager_html(
        result, title=title, subtitle=subtitle, review_date=review_date,
    )

    if _async_playwright is None:
        raise PdfExportError(
            "Playwright is not installed. Install it with: pip install playwright"
        )

    try:
        async with _async_playwright() as p:
            try:
                browser = await p.chromium.launch(headless=True)
            except Exception as e:
                raise PdfExportError(
                    "Playwright browsers not installed. "
                    "Run: python -m playwright install chromium"
                ) from e

            try:
                page = await browser.new_page()
                await page.set_content(html_content, wait_until="networkidle")
                pdf_bytes = await page.pdf(format="A4")
            finally:
                await browser.close()
    except PdfExportError:
        raise
    except Exception as e:
        raise PdfExportError(f"PDF generation failed: {e}") from e

    logger.info("PDF export: generated %d bytes via Playwright", len(pdf_bytes))
    return pdf_bytes
