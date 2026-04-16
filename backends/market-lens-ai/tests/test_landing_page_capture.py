"""Tests for landing page capture service."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from web.app.schemas.review_request import LandingPageInput
from web.app.services.intake.landing_page_capture_service import (
    LpCaptureResult,
    capture_landing_page,
)


SAMPLE_HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>夏の大セール | MONOSTORE</title>
    <meta name="description" content="人気アイテムが最大50%OFF">
</head>
<body>
    <h1>夏の大セール</h1>
    <header><p>最大50%OFF 期間限定キャンペーン</p></header>
    <a class="btn-primary" href="/sale">セール会場へ</a>
    <section class="features">
        <ul>
            <li>送料無料</li>
            <li>翌日配送</li>
        </ul>
    </section>
</body>
</html>
"""


@pytest.mark.asyncio
async def test_capture_success():
    with patch(
        "web.app.services.intake.landing_page_capture_service.fetch_html",
        new_callable=AsyncMock,
        return_value=(SAMPLE_HTML, None),
    ):
        result = await capture_landing_page("https://example.com/sale")

    assert result.error is None
    lp = result.landing_page
    assert lp.url == "https://example.com/sale"
    assert "MONOSTORE" in lp.title
    assert "50%OFF" in lp.meta_description
    assert lp.cta_text == "セール会場へ"
    assert isinstance(lp.extracted_benefits, list)


@pytest.mark.asyncio
async def test_capture_fetch_failure():
    with patch(
        "web.app.services.intake.landing_page_capture_service.fetch_html",
        new_callable=AsyncMock,
        return_value=("", "HTTP 403"),
    ):
        result = await capture_landing_page("https://example.com/blocked")

    assert result.error is not None
    assert "403" in result.error
    assert result.landing_page.url == "https://example.com/blocked"


@pytest.mark.asyncio
async def test_capture_returns_lp_input_type():
    with patch(
        "web.app.services.intake.landing_page_capture_service.fetch_html",
        new_callable=AsyncMock,
        return_value=(SAMPLE_HTML, None),
    ):
        result = await capture_landing_page("https://example.com")

    assert isinstance(result.landing_page, LandingPageInput)
    assert isinstance(result, LpCaptureResult)
