"""Tests for Markdown report generation (agency-grade, client-facing)."""

from __future__ import annotations

from web.app.models import ExtractedData, ScanResult, TokenUsage
from web.app.report_generator import generate_report, generate_report_bundle


# ---------- Appendix B: metadata in report ----------

class TestReportContainsUsage:
    def test_model_name_in_report(self):
        result = ScanResult(
            run_id="rpt001",
            urls=["https://example.com"],
            status="completed",
            total_time_sec=3.7,
            token_usage=TokenUsage(
                prompt_tokens=100,
                completion_tokens=200,
                total_tokens=300,
                model="gemini-3.1-flash-lite-preview",
            ),
        )
        md = generate_report(result, "## Analysis\nSome analysis.")
        assert "gemini-3.1-flash-lite-preview" in md

    def test_prompt_token_count_in_report(self):
        result = ScanResult(
            run_id="rpt002",
            urls=[],
            status="completed",
            token_usage=TokenUsage(
                prompt_tokens=50,
                completion_tokens=150,
                total_tokens=200,
                model="gemini-3.1-flash-lite-preview",
            ),
        )
        md = generate_report(result, "")
        assert "50" in md

    def test_completion_token_count_in_report(self):
        result = ScanResult(
            run_id="rpt003",
            urls=[],
            status="completed",
            token_usage=TokenUsage(
                prompt_tokens=50,
                completion_tokens=150,
                total_tokens=200,
                model="gemini-3.1-flash-lite-preview",
            ),
        )
        md = generate_report(result, "")
        assert "150" in md

    def test_total_token_count_in_report(self):
        result = ScanResult(
            run_id="rpt004",
            urls=[],
            status="completed",
            token_usage=TokenUsage(
                prompt_tokens=50,
                completion_tokens=150,
                total_tokens=200,
                model="gemini-3.1-flash-lite-preview",
            ),
        )
        md = generate_report(result, "")
        assert "200" in md

    def test_report_without_usage_does_not_crash(self):
        result = ScanResult(run_id="rpt005", urls=[], status="completed")
        md = generate_report(result, "")
        assert "rpt005" in md


# ---------- Extracted data in report ----------

class TestReportContainsUrls:
    def test_extracted_url_in_report(self):
        result = ScanResult(
            run_id="rpt010",
            urls=["https://example.com", "https://acme.com"],
            status="completed",
            extracted=[
                ExtractedData(
                    url="https://example.com",
                    title="Example Site",
                    h1="Welcome",
                    pricing_snippet="$29/month",
                ),
                ExtractedData(
                    url="https://acme.com",
                    title="Acme",
                    feature_bullets=["Fast", "Reliable"],
                ),
            ],
        )
        md = generate_report(result, "## Competitive Summary\nDetails here.")
        assert "https://example.com" in md
        assert "https://acme.com" in md

    def test_extracted_title_in_report(self):
        result = ScanResult(
            run_id="rpt011",
            urls=["https://example.com"],
            status="completed",
            extracted=[
                ExtractedData(url="https://example.com", title="My Awesome Product"),
            ],
        )
        md = generate_report(result, "")
        assert "My Awesome Product" in md

    def test_pricing_snippet_in_report(self):
        result = ScanResult(
            run_id="rpt012",
            urls=["https://example.com"],
            status="completed",
            extracted=[
                ExtractedData(url="https://example.com", pricing_snippet="$99/year"),
            ],
        )
        md = generate_report(result, "")
        assert "$99/year" in md

    def test_feature_bullets_in_report(self):
        result = ScanResult(
            run_id="rpt013",
            urls=["https://example.com"],
            status="completed",
            extracted=[
                ExtractedData(
                    url="https://example.com",
                    feature_bullets=["Lightning fast", "Easy to use"],
                ),
            ],
        )
        md = generate_report(result, "")
        assert "Lightning fast" in md
        assert "Easy to use" in md

    def test_analysis_md_included(self):
        result = ScanResult(run_id="rpt014", urls=[], status="completed")
        analysis = "## Competitive Summary\nProduct A beats Product B on price."
        md = generate_report(result, analysis)
        assert "Competitive Summary" in md
        assert "Product A beats Product B on price." in md

    def test_run_id_in_report(self):
        result = ScanResult(run_id="unique_run_999", urls=[], status="completed")
        md = generate_report(result, "")
        assert "unique_run_999" in md

    def test_error_field_in_report(self):
        result = ScanResult(
            run_id="rpt015",
            urls=["https://example.com"],
            status="error",
            error="Connection timeout",
        )
        md = generate_report(result, "")
        assert "Connection timeout" in md


# ---------- Agency-grade: Appendix separation ----------

class TestAppendixSeparation:
    """Verify body/appendix split in the generated report."""

    def _make_result(self, **kwargs):
        return ScanResult(
            run_id="app001",
            urls=["https://example.com"],
            status="completed",
            total_time_sec=2.5,
            extracted=[
                ExtractedData(url="https://example.com", title="Test Site"),
            ],
            token_usage=TokenUsage(
                prompt_tokens=100,
                completion_tokens=200,
                total_tokens=300,
                model="test-model",
            ),
            **kwargs,
        )

    @staticmethod
    def _valid_analysis():
        return (
            "## エグゼクティブサマリー\n"
            "要約\n\n"
            "## 分析対象と比較前提\n"
            "前提\n\n"
            "## 競合比較サマリー\n"
            "比較\n\n"
            "## ブランド別評価\n"
            "評価\n\n"
            "## 実行プラン\n"
            "### 最優先3施策\n"
            "施策"
        )

    def test_appendix_a_label_present(self):
        md = generate_report(self._make_result(), self._valid_analysis())
        assert "## Appendix A. 抽出詳細" in md

    def test_appendix_b_label_present(self):
        md = generate_report(self._make_result(), self._valid_analysis())
        assert "## Appendix B. 実行メタデータ" in md

    def test_old_extraction_label_absent(self):
        """旧「## 抽出詳細」見出しが存在しないこと."""
        md = generate_report(self._make_result(), self._valid_analysis())
        assert "## 抽出詳細" not in md

    def test_old_metadata_label_absent(self):
        """旧「## 実行メタデータ」見出しが存在しないこと."""
        md = generate_report(self._make_result(), self._valid_analysis())
        assert "## 実行メタデータ" not in md

    def test_notes_section_present(self):
        """「## 注記・前提条件」セクションが本文末尾に存在すること."""
        md = generate_report(self._make_result(), self._valid_analysis())
        assert "## 注記・前提条件" in md

    def test_notes_before_appendix(self):
        """注記セクションがAppendixより前にあること."""
        md = generate_report(self._make_result(), self._valid_analysis())
        notes_pos = md.index("## 注記・前提条件")
        appendix_pos = md.index("## Appendix A.")
        assert notes_pos < appendix_pos

    def test_metadata_in_appendix_b_not_body(self):
        """token数はAppendix B内にあり、本文（analysis_md前）にはないこと."""
        md = generate_report(self._make_result(), self._valid_analysis())
        appendix_b_start = md.index("## Appendix B.")
        body_section = md[:appendix_b_start]
        appendix_section = md[appendix_b_start:]
        assert "Prompt Tokens" not in body_section
        assert "Prompt Tokens" in appendix_section

    def test_run_id_in_appendix_b(self):
        """Run IDはAppendix B内にあること."""
        md = generate_report(self._make_result(), self._valid_analysis())
        appendix_b_start = md.index("## Appendix B.")
        appendix_section = md[appendix_b_start:]
        assert "app001" in appendix_section

    def test_no_old_disclaimer_format(self):
        """旧免責注記（blockquote形式）が存在しないこと."""
        md = generate_report(self._make_result(), self._valid_analysis())
        assert "> **注意**:" not in md


# ---------- Agency-grade: new extracted fields in appendix ----------

class TestAppendixNewFields:
    """Verify new extraction fields appear in Appendix A."""

    def _make_result_with_fields(self):
        return ScanResult(
            run_id="fields001",
            urls=["https://example.com"],
            status="completed",
            extracted=[
                ExtractedData(
                    url="https://example.com",
                    title="Test",
                    offer_terms=["初回限定50%OFF"],
                    review_signals=["★4.5 (120件)"],
                    shipping_signals=["送料無料"],
                ),
            ],
        )

    def test_offer_terms_in_appendix(self):
        md = generate_report(self._make_result_with_fields(), "## Analysis")
        assert "初回限定50%OFF" in md

    def test_review_signals_in_appendix(self):
        md = generate_report(self._make_result_with_fields(), "## Analysis")
        assert "★4.5 (120件)" in md

    def test_shipping_signals_in_appendix(self):
        md = generate_report(self._make_result_with_fields(), "## Analysis")
        assert "送料無料" in md


# ---------- Follow-up Fix 1: 注記・前提条件が1回しか出ない ----------

class TestNotesSingleOwner:
    """注記・前提条件が最終レポートにちょうど1回だけ出ることを確認."""

    def _make_result(self):
        return ScanResult(
            run_id="notes001",
            urls=["https://example.com"],
            status="completed",
            total_time_sec=2.0,
            extracted=[ExtractedData(url="https://example.com", title="Test")],
        )

    def test_notes_appears_exactly_once(self):
        """analysis_mdに注記・前提条件が含まれていても、最終レポートで1回のみ."""
        analysis_with_notes = "## 分析\n## 注記・前提条件\nこれは分析側の注記"
        md = generate_report(self._make_result(), analysis_with_notes)
        count = md.count("注記・前提条件")
        assert count == 1, f"注記・前提条件が{count}回出現している"

    def test_generator_always_adds_notes(self):
        """analysis_mdに注記がない場合でもgeneratorが追加する."""
        md = generate_report(self._make_result(), "## 分析内容")
        assert "注記・前提条件" in md


class TestStructuredQualityBundle:
    def _make_result(self):
        return ScanResult(
            run_id="quality001",
            urls=["https://example.com", "https://comp-a.com"],
            status="completed",
            extracted=[ExtractedData(url="https://example.com", title="Example")],
        )

    def test_bundle_returns_structured_quality_fields(self):
        bundle = generate_report_bundle(self._make_result(), "## エグゼクティブサマリー\n本文")
        assert bundle.quality_status in ("pass", "fail")
        assert isinstance(bundle.quality_issues, list)
        assert isinstance(bundle.quality_is_critical, bool)

    def test_critical_quality_failure_does_not_inject_marker_into_body(self):
        analysis = "## エグゼクティブサマリー\n| 壊れた行"
        bundle = generate_report_bundle(self._make_result(), analysis)
        assert bundle.quality_is_critical is True
        assert "品質基準未達" not in bundle.report_md.split("<!-- appendix-start -->")[0]
        assert "## Appendix A. 品質監査" in bundle.report_md
