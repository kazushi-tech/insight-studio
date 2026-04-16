"""Playwright-specific PDF export tests (M5.4 / WP-B4)."""

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


@pytest.fixture()
def sample_review() -> ReviewResult:
    return ReviewResult(
        review_type="banner_review",
        summary="テスト用レビュー結果",
        good_points=[
            ReviewPoint(point="良い点A", reason="理由A"),
        ],
        keep_as_is=[
            ReviewPoint(point="維持点A", reason="理由B"),
        ],
        improvements=[
            ImprovementPoint(point="改善点A", reason="理由C", action="アクションA"),
        ],
        test_ideas=[
            TestIdea(hypothesis="仮説A", variable="変数A", expected_impact="効果A"),
        ],
        evidence=[
            EvidenceItem(
                evidence_type=EvidenceType.client_material,
                evidence_source="出典A",
                evidence_text="根拠A",
            ),
        ],
        target_hypothesis="ターゲット仮説",
        message_angle="メッセージ角度",
        rubric_scores=[
            RubricScore(rubric_id="test_rubric", score=3, comment="コメント"),
        ],
    )


def _build_pw_mock(pdf_bytes: bytes = b"%PDF-1.4 mock"):
    """Build a full mock chain for _async_playwright."""
    mock_page = AsyncMock()
    mock_page.set_content = AsyncMock()
    mock_page.pdf = AsyncMock(return_value=pdf_bytes)

    mock_browser = AsyncMock()
    mock_browser.new_page = AsyncMock(return_value=mock_page)
    mock_browser.close = AsyncMock()

    mock_pw = AsyncMock()
    mock_pw.chromium.launch = AsyncMock(return_value=mock_browser)

    mock_cm = AsyncMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_pw)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    mock_fn = MagicMock(return_value=mock_cm)
    return mock_fn, mock_page, mock_browser, mock_pw


class TestPlaywrightPdfGeneration:
    """Tests focused on Playwright PDF generation mechanics."""

    @pytest.mark.asyncio
    async def test_pdf_bytes_returned(self, sample_review):
        """Generated PDF bytes are returned directly."""
        expected = b"%PDF-1.4 specific content here"
        mock_fn, _, _, _ = _build_pw_mock(pdf_bytes=expected)
        with patch(f"{_MODULE}._async_playwright", mock_fn):
            result = await export_pdf(sample_review, review_date="2026-01-01")
        assert result == expected
        assert isinstance(result, bytes)

    @pytest.mark.asyncio
    async def test_render_html_used_as_input(self, sample_review):
        """render_onepager_html output is set as page content."""
        mock_fn, mock_page, _, _ = _build_pw_mock()
        with patch(f"{_MODULE}._async_playwright", mock_fn):
            await export_pdf(
                sample_review,
                title="カスタムタイトル",
                subtitle="サブタイトル",
                review_date="2026-01-01",
            )
        html_arg = mock_page.set_content.call_args[0][0]
        assert "カスタムタイトル" in html_arg
        assert "サブタイトル" in html_arg
        assert "テスト用レビュー結果" in html_arg

    @pytest.mark.asyncio
    async def test_a4_format_specified(self, sample_review):
        """page.pdf() is called with format='A4'."""
        mock_fn, mock_page, _, _ = _build_pw_mock()
        with patch(f"{_MODULE}._async_playwright", mock_fn):
            await export_pdf(sample_review, review_date="2026-01-01")
        mock_page.pdf.assert_awaited_once_with(format="A4")

    @pytest.mark.asyncio
    async def test_error_wrapped_in_pdf_export_error(self, sample_review):
        """Generic Playwright errors are wrapped in PdfExportError."""
        mock_fn, mock_page, _, _ = _build_pw_mock()
        mock_page.pdf = AsyncMock(side_effect=RuntimeError("rendering crashed"))
        with patch(f"{_MODULE}._async_playwright", mock_fn):
            with pytest.raises(PdfExportError, match="PDF generation failed"):
                await export_pdf(sample_review, review_date="2026-01-01")

    @pytest.mark.asyncio
    async def test_browser_not_installed_error(self, sample_review):
        """Missing browser binary produces actionable error message."""
        mock_fn, _, _, mock_pw = _build_pw_mock()
        mock_pw.chromium.launch = AsyncMock(
            side_effect=Exception("Browser not found")
        )
        with patch(f"{_MODULE}._async_playwright", mock_fn):
            with pytest.raises(PdfExportError, match="python -m playwright install chromium"):
                await export_pdf(sample_review, review_date="2026-01-01")
