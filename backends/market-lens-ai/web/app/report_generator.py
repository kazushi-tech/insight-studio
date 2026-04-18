"""Generate the final Markdown report (agency-grade, client-facing)."""

from __future__ import annotations

import logging
import re as _re
from dataclasses import dataclass
from urllib.parse import urlparse

from .deterministic_evaluator import VERDICT_DEFER, evaluate_all
from .models import ExtractedData, ScanResult

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ReportBundle:
    report_md: str
    quality_issues: list[str]
    quality_is_critical: bool
    quality_status: str


# ── Quality Gate (Tasks A, B, G) ──────────────────────────────────

# Model-generated date patterns to strip from analysis body (Task B)
_MODEL_DATE_PATTERNS = [
    _re.compile(r'(?:作成日|分析実施日|実施日|レポート作成日)\s*[:：]\s*\d{4}年\d{1,2}月\d{1,2}日[^\n]*'),
    _re.compile(r'(?:作成日|分析実施日|実施日|レポート作成日)\s*[:：]\s*\d{4}-\d{2}-\d{2}[^\n]*'),
    _re.compile(r'(?:対象URL数|分析URL数)\s*[:：]\s*\d+[^\n]*'),
]

# Year references older than execution year (Task B)
_YEAR_PATTERN = _re.compile(r'(20[0-2]\d)年(?!代)')

# Heading patterns for deterministic detection (Task G)
_HEADING_LINE = _re.compile(r'^#{1,3}\s+(.+)$', _re.MULTILINE)

# Table row pattern
_TABLE_ROW = _re.compile(r'^\|.*\|$', _re.MULTILINE)

# Unclosed table row (starts with | but doesn't end with |)
_UNCLOSED_TABLE_ROW = _re.compile(r'^\|[^|]*[^|]$', _re.MULTILINE)

# Required section headings in order (Task G)
_REQUIRED_HEADING_ORDER = [
    "エグゼクティブサマリー",
    "分析対象と比較前提",
    "競合比較サマリー",
    "ブランド別評価",
    "実行プラン",
]

# Backward compat: also accept the legacy heading name
_HEADING_ALIASES = {
    "広告運用アクションプラン": "実行プラン",
}

# Critical issue types that should block delivery (Task A)
_CRITICAL_PATTERNS = {
    "truncation": [
        _re.compile(r'\|[^|]+$'),            # Unclosed table row at end
        _re.compile(r'#{1,3}\s+\S{1,4}$'),   # Heading too short (truncated)
    ],
    "section_missing": [],  # Populated dynamically
    "table_unclosed": [
        _re.compile(r'\|[^|\n]+\n(?!\|)'),   # Table mid-row break
    ],
}


def _strip_model_dates(analysis_md: str, created_year: str) -> str:
    """Remove model-generated date/metadata lines that conflict with renderer dates (Task B)."""
    cleaned = analysis_md
    for pattern in _MODEL_DATE_PATTERNS:
        cleaned = pattern.sub('', cleaned)

    # Fix year references that are older than execution year
    def _fix_year(match):
        year_str = match.group(1)
        if year_str != created_year and int(year_str) < int(created_year):
            return f'{created_year}年'
        return match.group(0)

    cleaned = _YEAR_PATTERN.sub(_fix_year, cleaned)

    # Clean up blank lines left by removals
    cleaned = _re.sub(r'\n{3,}', '\n\n', cleaned)
    return cleaned.strip()


def _quality_gate_check(analysis_md: str, result: ScanResult) -> tuple[list[str], bool]:
    """Validate report quality deterministically (Task G).

    Returns:
        (issues, is_critical): list of issue descriptions, and whether
        the report should be blocked from client delivery (Task A).
    """
    issues: list[str] = []
    is_critical = False

    created_year = str(result.created_at.year)
    created_ymd = result.created_at.strftime("%Y-%m-%d")

    # ── 1. Date consistency (Task B, deterministic) ──
    for match in _YEAR_PATTERN.finditer(analysis_md):
        year_str = match.group(1)
        if year_str != created_year and int(year_str) < int(created_year):
            issues.append(f"日付矛盾: 本文に「{match.group(0)}」が含まれるが、実行日時は{created_ymd}")
            # Auto-fixable — not critical after stripping

    # ── 2. Required headings check (Task G — fixed) ──
    found_headings = []
    for m in _HEADING_LINE.finditer(analysis_md):
        heading_text = m.group(1).strip()
        found_headings.append(heading_text)

    # Normalize heading aliases (e.g. legacy "広告運用アクションプラン" → "実行プラン")
    normalized_headings = []
    for h in found_headings:
        replaced = h
        for old_name, new_name in _HEADING_ALIASES.items():
            if old_name in replaced:
                replaced = replaced.replace(old_name, new_name)
        normalized_headings.append(replaced)

    # Check which required headings are present
    headings_present = {}
    for req in _REQUIRED_HEADING_ORDER:
        found = any(req in h for h in normalized_headings) or any(req in h for h in found_headings)
        headings_present[req] = found
        if not found and req in ("エグゼクティブサマリー", "分析対象と比較前提"):
            # Only the first 2 are strictly required
            issues.append(f"見出し欠損: 「{req}」セクションが見つかりません")
            is_critical = True

    # ── 3. Heading order validation (Task G — deterministic) ──
    # Only validate if both sections exist
    if headings_present.get("競合比較サマリー") and headings_present.get("参考観測枠"):
        # Find positions of these sections
        summary_pos = None
        ref_pos = None
        for m in _HEADING_LINE.finditer(analysis_md):
            heading_text = m.group(1).strip()
            if "競合比較サマリー" in heading_text and summary_pos is None:
                summary_pos = m.start()
            if "参考観測" in heading_text and ref_pos is None:
                ref_pos = m.start()

        # Only flag if 競合比較サマリー is a TOP-LEVEL section that appears AFTER 参考観測
        # Ignore if they're at different heading levels (e.g., 参考観測 inside ブランド別評価)
        if (summary_pos is not None and ref_pos is not None
                and ref_pos < summary_pos):
            # Check if 参考観測 is in the preamble (before any main section)
            # or inside another section — those are OK
            text_before_ref = analysis_md[:ref_pos]
            main_sections_before = _re.findall(r'^##\s+', text_before_ref, _re.MULTILINE)
            if len(main_sections_before) <= 1:
                # 参考観測 appears early, before main sections — this is OK (it's in the preamble)
                pass
            else:
                issues.append("構造エラー: 競合比較サマリーが参考観測枠の後に来ている")
                is_critical = True

    # ── 4. Truncation detection (Task G — precise) ──
    text = analysis_md.rstrip()
    last_lines = text.split('\n')[-5:]

    for line in last_lines:
        stripped = line.strip()
        if not stripped:
            continue

        # Unclosed table row: starts with | but doesn't end with |
        if stripped.startswith('|') and not stripped.endswith('|'):
            issues.append(f"末尾欠け: テーブル行が途切れている — 「{stripped[-60:]}」")
            is_critical = True
            break

        # Unclosed brackets
        if _re.search(r'「[^」]*$', stripped):
            issues.append(f"末尾欠け: カギ括弧が閉じていない — 「{stripped[-60:]}」")
            is_critical = True
            break

        # Very short last non-empty line that looks like a truncated heading.
        # Do not flag known valid section headings such as "## 実行プラン".
        if _re.match(r'^#{1,3}\s+\S{1,5}$', stripped):
            heading_text = _re.sub(r'^#{1,3}\s+', "", stripped)
            normalized_heading = _HEADING_ALIASES.get(heading_text, heading_text)
            if normalized_heading not in _REQUIRED_HEADING_ORDER:
                issues.append(f"末尾欠け: 見出しが途切れている可能性 — 「{stripped}」")
                is_critical = True
                break

    # ── 4b. Heading number consistency (sub-section promotion detection) ──
    # Detect when 3-1/3-2/3-3 sub-sections are incorrectly promoted to top-level headings
    _SUBSECTION_PATTERNS = [
        ("市場概況", "3-1"),
        ("広告投資推定", "3-2"),
        ("消費者インサイト", "3-3"),
    ]
    promoted_subs = []
    for m in _HEADING_LINE.finditer(analysis_md):
        heading_text = m.group(0).strip()
        # Top-level = ## (not ### or deeper)
        if heading_text.startswith("## ") and not heading_text.startswith("### "):
            for keyword, expected_sub in _SUBSECTION_PATTERNS:
                if keyword in heading_text:
                    promoted_subs.append(f"{expected_sub} {keyword}")
    if promoted_subs:
        issues.append(f"構造エラー: サブセクションがトップレベルに昇格 — {', '.join(promoted_subs)}")
        is_critical = True

    # ── 4c. Section 4 brand truncation detection ──
    # Check if brand evaluations are cut off mid-way (e.g. table separator without data)
    section4_match = _re.search(
        r'(?:##\s*(?:\d+[.．]\s*)?ブランド別評価)(.*?)(?=\n##\s+(?:\d+[.．]\s*)?実行プラン|\n##\s+(?:\d+[.．]\s*)?(?:5[.．])|\Z)',
        analysis_md,
        _re.DOTALL,
    )
    if section4_match:
        s4_content = section4_match.group(1)
        # Detect separator-only table rows at end (truncated mid-table)
        s4_lines = [l for l in s4_content.rstrip().split('\n') if l.strip()]
        if s4_lines:
            last_s4 = s4_lines[-1].strip()
            if _re.match(r'^\|[-\s|]+\|$', last_s4):
                issues.append("Section 4 途中切断: ブランド別評価テーブルがセパレータ行で終了しています")
                is_critical = True

    # ── 5. Action plan presence check (Task A) ──
    if not headings_present.get("実行プラン", False):
        # Check if there's any action-like section
        has_action_section = any(
            "実行プラン" in h or "アクション" in h or "施策" in h or "改善提案" in h
            for h in normalized_headings
        )
        if not has_action_section:
            issues.append("セクション欠損: アクションプランが見つかりません")
            is_critical = True

    # ── 5b. 最優先3施策 sub-heading presence check (Task A — schema contract) ──
    # Require a dedicated `### 最優先3施策` sub-heading inside the action plan section.
    # Inline "最優先施策:" text in executive summary does NOT satisfy this requirement.
    if headings_present.get("実行プラン", False) or any(
        "実行プラン" in h or "アクション" in h for h in normalized_headings
    ):
        has_priority3_heading = any(
            _re.match(r'^#{2,4}\s+.*最優先\s*[3３]\s*施策', h.strip())
            for h in [m.group(0) for m in _HEADING_LINE.finditer(analysis_md)]
        )
        if not has_priority3_heading:
            issues.append(
                "セクション欠損: 最優先3施策サブセクションが見つかりません"
                "（エグゼクティブサマリー内のインライン記述は代替になりません）"
            )
            is_critical = True

    # ── 6. Section 5-2 completeness check (Task E) ──
    # For multi-URL reports, verify that 5-2 search ad section is complete
    if len(result.urls) > 1:
        has_section_52 = bool(_re.search(r'5-2[.．].*検索広告', analysis_md))
        has_section_51 = bool(_re.search(r'5-1[.．].*LP', analysis_md))

        if has_section_51 and not has_section_52:
            # Section 5-1 exists but 5-2 is missing entirely
            issues.append("Section 5-2 欠損: 検索広告施策セクションが見つかりません")
            is_critical = True
        elif has_section_52:
            # Check if the 5-2 table is properly closed
            section_52_match = _re.search(
                r'5-2[.．].*検索広告.*?\n(.*?)(?=\n#{1,4}\s+5-3|#{1,4}\s+施策数|#{1,4}\s+出力完結|$)',
                analysis_md,
                _re.DOTALL,
            )
            if section_52_match:
                section_52_content = section_52_match.group(1).rstrip()
                # Check if the last non-empty line of the table is properly closed
                s52_lines = [l for l in section_52_content.split('\n') if l.strip()]
                if s52_lines:
                    last_line = s52_lines[-1].strip()
                    # If the last content line starts with | but doesn't end with |
                    if last_line.startswith('|') and not last_line.endswith('|'):
                        issues.append("Section 5-2 未完: 検索広告施策テーブルが途切れています")
                        is_critical = True

        # Check: if only 最優先3施策 + 5-1 exist but 5-2 is missing
        has_priority_3 = bool(_re.search(r'最優先.*施策', analysis_md))
        if has_priority_3 and has_section_51 and not has_section_52:
            issues.append("Section 5 未完: 最優先3施策と5-1のみで5-2検索広告施策が欠損")
            is_critical = True

    # ── 7. L5 ad copy check (Task B v3) ──
    # Detect L5-only info used as ad copy without qualification
    _l5_ad_copy_patterns = [
        _re.compile(r'(?:推奨訴求|広告見出し|コピー案)[^\n]*(?:アンチドーピング対応|品質認証取得|認証済み)'),
        _re.compile(r'L5[^\n]*(?:対応プロテイン|対応サプリ|検査済み|安心して使える)'),
    ]
    for pat in _l5_ad_copy_patterns:
        m = pat.search(analysis_md)
        if m:
            issues.append(f"L5転用警告: L5 only 情報が広告コピーに転用されている可能性 — 「{m.group(0)[:60]}」")
            # Warning, not critical — model may have properly qualified it

    # ── 8. Pricing copy without data check (Task C v3) ──
    # Detect ¥ price patterns in action plan for brands with unknown pricing
    has_pricing_unknown = any(
        d.pricing_snippet in (None, '', '取得不可')
        for d in result.extracted
    )
    if has_pricing_unknown:
        price_in_action = _re.search(
            r'(?:5-1|5-2|実行プラン|LP改善|施策)[^\n]*¥[\d,]+',
            analysis_md,
        )
        if price_in_action:
            issues.append("価格未取得警告: 価格未取得ブランドに対して¥表記の価格コピーが含まれています")

    # ── 9. Fixed budget ratio check (Task D v3) ──
    fixed_ratio_pattern = _re.compile(
        r'(?:指名防衛|指名)\s*(\d{2,3})\s*[/:／：]\s*(?:非指名|カテゴリ)\s*(\d{2,3})'
    )
    ratio_match = fixed_ratio_pattern.search(analysis_md)
    if ratio_match:
        # Check if it's qualified with 目安/仮説/レンジ
        context_start = max(0, ratio_match.start() - 100)
        context = analysis_md[context_start:ratio_match.end() + 50]
        if not _re.search(r'(?:目安|仮説|初期|レンジ|Phase|phase)', context):
            issues.append("予算配分警告: 固定比率が条件なしで記載されています（phase設計推奨）")

    # ── 10. Label mismatch check (Phase A-6) ──
    mismatch_issues = _check_label_mismatch(analysis_md, result)
    for m in mismatch_issues:
        issues.append(m)

    return issues, is_critical


# Axis labels as written in reports (synonyms) mapped to deterministic evaluator keys.
_AXIS_LABEL_TO_KEY = {
    "検索意図一致": "search_intent_match",
    "検索意図": "search_intent_match",
    "FV訴求": "fv_appeal",
    "FV": "fv_appeal",
    "CTA明確性": "cta_clarity",
    "CTA": "cta_clarity",
    "信頼構築": "trust_building",
    "信頼": "trust_building",
    "価格・オファー": "price_offer",
    "価格": "price_offer",
    "オファー": "price_offer",
    "購買導線": "purchase_flow",
    "購買": "purchase_flow",
}


def _brand_token_from_url(url: str) -> str:
    try:
        host = urlparse(url).hostname or url
    except Exception:
        host = url
    return host.replace("www.", "").split(".")[0] if host else ""


def _check_label_mismatch(analysis_md: str, result: ScanResult) -> list[str]:
    """Detect `確認済み` claims whose underlying source fields are empty.

    Uses the deterministic evaluator: any axis row that reports `確認済み`
    but the deterministic evaluator emitted `評価保留` for the same brand is
    a label mismatch. These surface in Appendix A and on the front-end via
    ``reportQuality.js`` label-mismatch detection.
    """
    if not getattr(result, "extracted", None):
        return []

    try:
        evaluations = evaluate_all(result.extracted)
    except Exception as exc:
        logger.warning("label mismatch evaluator failed: %s", exc)
        return []

    issues: list[str] = []
    # Parse the body into per-brand sections by using the first-token of each URL as a hint.
    # We only need to find axis rows that carry `確認済み`. To be brand-scoped, we look for
    # the nearest preceding brand token in the last ~400 characters before the row.
    table_row_re = _re.compile(r"^\|[^\n]+\|$", _re.MULTILINE)
    for m in table_row_re.finditer(analysis_md):
        row = m.group(0)
        # Quickly reject rows that don't include 確認済み
        if "確認済み" not in row:
            continue
        cells = [c.strip() for c in row.strip("|").split("|")]
        # First cell is the axis label in per-brand evaluation tables.
        axis_label = cells[0] if cells else ""
        axis_key = None
        for label, key in _AXIS_LABEL_TO_KEY.items():
            if axis_label == label or label in axis_label:
                axis_key = key
                break
        if axis_key is None:
            continue

        # Locate the preceding brand anchor (最寄りの URL token in the preceding 500 chars).
        window = analysis_md[max(0, m.start() - 500) : m.start()]
        matched_eval = None
        for ev in evaluations:
            token = _brand_token_from_url(ev.url)
            if token and token in window:
                matched_eval = ev
        if matched_eval is None:
            continue
        verdict = matched_eval.verdict_for(axis_key)
        if verdict and verdict.verdict == VERDICT_DEFER:
            issues.append(
                f"Label mismatch: {matched_eval.brand_label} の「{axis_label}」行で"
                f"「確認済み」と記載されているが、抽出データでは根拠が空のため"
                f"`評価保留` が妥当です。"
            )

    return issues


def generate_report_bundle(result: ScanResult, analysis_md: str) -> ReportBundle:
    lines: list[str] = []

    # ── Task B: Strip model-generated dates ──
    created_year = str(result.created_at.year)
    analysis_md = _strip_model_dates(analysis_md, created_year)

    # ── Quality Gate (Tasks A, G) ──
    quality_issues, is_critical = _quality_gate_check(analysis_md, result)

    if quality_issues:
        logger.warning(
            "report_quality_gate issues=%s critical=%s run_id=%s",
            quality_issues, is_critical, result.run_id,
        )

    # ── Header (renderer-owned metadata — Task B) ──
    if len(result.urls) == 1:
        lines.append("# Market Lens AI — 競合LP分析レポート")
    else:
        lines.append("# Market Lens AI — 競合比較分析レポート")

    lines.append("")
    # Only renderer-controlled dates (Task B)
    lines.append(f"**実行日時**: {result.created_at.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    lines.append(f"**対象URL数**: {len(result.urls)}")
    lines.append("")

    # ── Body (Client-facing — no quality warnings) (Task A) ──
    lines.append(analysis_md)
    lines.append("")

    # 注記・前提条件
    if "注記・前提条件" not in analysis_md:
        lines.append("## 注記・前提条件")
        lines.append("")
        lines.append("- 競合情報・業界ポジションはAIの推定に基づきます。実際の市場状況と異なる場合があります。")
        lines.append("- 重要な意思決定には別途調査を推奨します。")
        lines.append("- HTML抽出はデスクトップ表示ベースであり、動的コンテンツやログイン後コンテンツは取得できません。")
        lines.append("")

    # ── Appendix（監査・再確認用 — Task C: clearly separated） ──
    lines.append("---")
    lines.append("")
    lines.append("<!-- appendix-start -->")

    # Appendix A: Quality audit (moved from client body — Task A)
    if quality_issues:
        lines.append("## Appendix A. 品質監査")
        lines.append("")
        if is_critical:
            lines.append("**品質判定: 未達（再試行推奨）**")
        else:
            lines.append("**品質判定: 合格（軽微な注意事項あり）**")
        lines.append("")
        for issue in quality_issues:
            lines.append(f"- {issue}")
        lines.append("")

    # Appendix B: Extraction details
    appendix_label = "B" if quality_issues else "A"
    lines.append(f"## Appendix {appendix_label}. 抽出詳細")
    lines.append("")
    for data in result.extracted:
        lines.append(f"### {data.url}")
        lines.append(f"- **タイトル**: {data.title or '取得不可'}")
        lines.append(f"- **Meta Description**: {data.meta_description or '取得不可'}")
        lines.append(f"- **OG Type**: {data.og_type or '取得不可'}")
        lines.append(f"- **H1**: {data.h1 or '取得不可'}")
        lines.append(f"- **Hero Copy**: {data.hero_copy or '取得不可'}")
        lines.append(f"- **Main CTA**: {data.main_cta or '取得不可'}")
        lines.append(f"- **Pricing**: {data.pricing_snippet or '取得不可'}")
        if data.feature_bullets:
            lines.append("- **Features**:")
            for f in data.feature_bullets:
                lines.append(f"  - {f}")
        if data.body_text_snippet:
            lines.append(f"- **本文抜粋**: {data.body_text_snippet[:200]}")
        if data.urgency_elements:
            lines.append("- **緊急性要素**:")
            for u in data.urgency_elements[:3]:
                lines.append(f"  - {u}")
        if data.trust_badges:
            lines.append("- **信頼バッジ**:")
            for t in data.trust_badges[:3]:
                lines.append(f"  - {t}")
        if data.guarantees:
            lines.append("- **保証**:")
            for g in data.guarantees[:3]:
                lines.append(f"  - {g}")
        if data.image_alts:
            lines.append("- **画像alt（販促・商品情報）**:")
            for a in data.image_alts[:5]:
                lines.append(f"  - {a}")
        if data.banner_texts:
            lines.append("- **バナー・キャンペーンテキスト**:")
            for b in data.banner_texts[:5]:
                lines.append(f"  - {b}")
        if data.contact_paths:
            lines.append("- **お問い合わせ・見積り導線**:")
            for c in data.contact_paths[:5]:
                lines.append(f"  - {c}")
        if data.promo_claims:
            lines.append("- **販促訴求（送料無料・割引・納期）**:")
            for p in data.promo_claims[:5]:
                lines.append(f"  - {p}")
        if data.corporate_elements:
            lines.append("- **法人・実績・代理店情報**:")
            for e in data.corporate_elements[:5]:
                lines.append(f"  - {e}")
        if data.offer_terms:
            lines.append("- **オファー条件**:")
            for o in data.offer_terms[:3]:
                lines.append(f"  - {o}")
        if data.review_signals:
            lines.append("- **レビュー信号**:")
            for r in data.review_signals[:3]:
                lines.append(f"  - {r}")
        if data.shipping_signals:
            lines.append("- **配送条件**:")
            for s in data.shipping_signals[:3]:
                lines.append(f"  - {s}")
        if data.screenshot_path:
            lines.append(f"- **Screenshot**: `{data.screenshot_path}`")
        if data.error:
            lines.append(f"- **エラー**: {data.error}")
        lines.append("")

    # Appendix C: Execution metadata
    exec_label = "C" if quality_issues else "B"
    lines.append("---")
    lines.append("")
    lines.append(f"## Appendix {exec_label}. 実行メタデータ")
    lines.append("")
    lines.append(f"- **Run ID**: `{result.run_id}`")
    lines.append(f"- **処理時間**: {result.total_time_sec:.1f} 秒")
    if result.token_usage:
        lines.append(f"- **モデル**: {result.token_usage.model}")
        lines.append(f"- **Prompt Tokens**: {result.token_usage.prompt_tokens}")
        lines.append(f"- **Completion Tokens**: {result.token_usage.completion_tokens}")
        lines.append(f"- **Total Tokens**: {result.token_usage.total_tokens}")
    lines.append(f"- **ステータス**: {result.status}")
    if result.error:
        lines.append(f"- **エラー**: {result.error}")
    lines.append("")

    lines.append("<!-- appendix-end -->")
    lines.append("")

    return ReportBundle(
        report_md="\n".join(lines),
        quality_issues=quality_issues,
        quality_is_critical=is_critical,
        quality_status="fail" if is_critical else "pass",
    )


def generate_report(result: ScanResult, analysis_md: str) -> str:
    return generate_report_bundle(result, analysis_md).report_md
