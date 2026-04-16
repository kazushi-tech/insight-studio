"""Tests for PDF export service (Playwright-based)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from web.app.schemas.review_result import (
    EvidenceItem,
    EvidenceType,
    ImprovementPoint,
    ReviewPoint,
    ReviewResult,
    RubricScore,
    TestIdea,
)
from web.app.services.exports.pdf_export_service import PdfExportError, export_pdf

_MODULE = "web.app.services.exports.pdf_export_service"


def _make_review() -> ReviewResult:
    return ReviewResult(
        review_type="banner_review",
        summary="ECセールバナーとして基本的な訴求力を備えている",
        good_points=[
            ReviewPoint(point="50%OFFの数字訴求が目立つ", reason="赤背景に白文字で視認しやすい"),
        ],
        keep_as_is=[
            ReviewPoint(point="ブランドカラーの統一感", reason="ガイドラインに沿っている"),
        ],
        improvements=[
            ImprovementPoint(
                point="CTAボタンが小さい", reason="CTAが目立たない", action="CTAを20%拡大する",
            ),
        ],
        test_ideas=[
            TestIdea(
                hypothesis="CTA文言変更でCTR向上", variable="CTAテキスト",
                expected_impact="CTR 5-10%向上",
            ),
        ],
        evidence=[
            EvidenceItem(
                evidence_type=EvidenceType.client_material,
                evidence_source="ブランドガイドライン v2.1",
                evidence_text="メインカラーは赤",
            ),
        ],
        target_hypothesis="20-40代女性",
        message_angle="期間限定値引き訴求",
        rubric_scores=[
            RubricScore(rubric_id="hook_strength", score=4, comment="数字が目を引く"),
        ],
    )


def _build_playwright_mock(pdf_bytes: bytes = b"%PDF-1.4 fake pdf content"):
    """Build a full mock chain for playwright async context manager."""
    mock_page = AsyncMock()
    mock_page.set_content = AsyncMock()
    mock_page.pdf = AsyncMock(return_value=pdf_bytes)

    mock_browser = AsyncMock()
    mock_browser.new_page = AsyncMock(return_value=mock_page)
    mock_browser.close = AsyncMock()

    mock_playwright = AsyncMock()
    mock_playwright.chromium.launch = AsyncMock(return_value=mock_browser)

    mock_context_manager = AsyncMock()
    mock_context_manager.__aenter__ = AsyncMock(return_value=mock_playwright)
    mock_context_manager.__aexit__ = AsyncMock(return_value=False)

    mock_async_playwright = MagicMock(return_value=mock_context_manager)
    return mock_async_playwright, mock_page, mock_browser, mock_playwright


class TestExportPdf:
    @pytest.mark.asyncio
    async def test_generates_pdf_bytes(self):
        """export_pdf returns PDF bytes from Playwright."""
        expected = b"%PDF-1.4 test output"
        mock_ap, mock_page, _, _ = _build_playwright_mock(pdf_bytes=expected)
        with patch(f"{_MODULE}._async_playwright", mock_ap):
            result = await export_pdf(_make_review(), review_date="2026-03-22")
        assert result == expected

    @pytest.mark.asyncio
    async def test_uses_a4_format(self):
        """Playwright page.pdf is called with format='A4'."""
        mock_ap, mock_page, _, _ = _build_playwright_mock()
        with patch(f"{_MODULE}._async_playwright", mock_ap):
            await export_pdf(_make_review(), review_date="2026-03-22")
        mock_page.pdf.assert_awaited_once_with(format="A4")

    @pytest.mark.asyncio
    async def test_html_passed_to_playwright(self):
        """render_onepager_html output is passed to page.set_content."""
        mock_ap, mock_page, _, _ = _build_playwright_mock()
        with patch(f"{_MODULE}._async_playwright", mock_ap):
            await export_pdf(_make_review(), review_date="2026-03-22")
        call_args = mock_page.set_content.call_args
        html_arg = call_args[0][0]
        assert "<!DOCTYPE html>" in html_arg
        assert "クリエイティブレビュー" in html_arg

    @pytest.mark.asyncio
    async def test_browser_closed_after_generation(self):
        """Browser is closed after PDF generation."""
        mock_ap, _, mock_browser, _ = _build_playwright_mock()
        with patch(f"{_MODULE}._async_playwright", mock_ap):
            await export_pdf(_make_review(), review_date="2026-03-22")
        mock_browser.close.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_playwright_not_installed_raises_error(self):
        """When _async_playwright is None, PdfExportError is raised."""
        with patch(f"{_MODULE}._async_playwright", None):
            with pytest.raises(PdfExportError, match="Playwright is not installed"):
                await export_pdf(_make_review())

    @pytest.mark.asyncio
    async def test_browser_not_installed_raises_error(self):
        """When browser binary is missing, PdfExportError mentions install command."""
        mock_ap, _, _, mock_playwright = _build_playwright_mock()
        mock_playwright.chromium.launch = AsyncMock(
            side_effect=Exception("Executable doesn't exist")
        )
        with patch(f"{_MODULE}._async_playwright", mock_ap):
            with pytest.raises(PdfExportError, match="Playwright browsers not installed"):
                await export_pdf(_make_review())
