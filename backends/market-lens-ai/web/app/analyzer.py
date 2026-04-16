"""Build prompts and run provider-aware analysis."""

from __future__ import annotations

import logging
import re as _re
from pathlib import Path

from .models import ExtractedData, TokenUsage
from .llm_client import call_multimodal_model as _call_multimodal_model
from .llm_client import call_text_model as _call_text_model

logger = logging.getLogger(__name__)

_FEATURE_LIMIT = 5
_BODY_SNIPPET_LIMIT = 800
_SECONDARY_CTA_LIMIT = 3
_FAQ_LIMIT = 3
_REVIEW_LIMIT = 2
_SIGNAL_LIMIT = 3
_COMPARISON_BODY_SNIPPET_LIMIT = 300
_COMPARISON_LIST_LIMIT = 3
_SINGLE_URL_MAX_OUTPUT_TOKENS = 2560
_MULTI_URL_MAX_OUTPUT_TOKENS = 4096
_MULTI_URL_MAX_OUTPUT_TOKENS_3_SITES = 6144
_MULTI_URL_MAX_OUTPUT_TOKENS_4PLUS_SITES = 5120

_NAV_LABEL_CHECK = _re.compile(
    r"^(?:BRAND|CATEGORY|RANKING|SHOP|COLLECTION|MENU|NEWS|"
    r"ブランド|カテゴリ|ランキング|新着|特集|お知らせ|"
    r"インスピレーション|コレクション|ショップ)(?:[／/\s　]|$)",
    _re.IGNORECASE,
)


def _hero_copy_quality_note(hero: str) -> str:
    if not hero:
        return ""
    if len(hero) < 20 and _NAV_LABEL_CHECK.match(hero):
        return " 【注意: ナビゲーションラベルの可能性。本文抜粋を参照】"
    return ""


def _inline_list(items: list[str], *, limit: int, fallback: str = "取得不可") -> str:
    if not items:
        return fallback
    return " / ".join(item for item in items[:limit] if item) or fallback


def _format_site_data(data: ExtractedData, *, compact: bool = False) -> str:
    feat_slice = data.feature_bullets[:_FEATURE_LIMIT] if data.feature_bullets else []
    features = "\n".join(f"  - {f}" for f in feat_slice) if feat_slice else "  取得不可"
    snippet = data.body_text_snippet[:_BODY_SNIPPET_LIMIT] if data.body_text_snippet else "取得不可"
    sec_slice = data.secondary_ctas[:_SECONDARY_CTA_LIMIT] if data.secondary_ctas else []
    secondary = ", ".join(sec_slice) if sec_slice else "取得不可"
    faq_slice = data.faq_items[:_FAQ_LIMIT] if data.faq_items else []
    faqs = "\n".join(f"  - {q}" for q in faq_slice) if faq_slice else "  取得不可"
    rev_slice = data.testimonials[:_REVIEW_LIMIT] if data.testimonials else []
    reviews = "\n".join(f"  - {t}" for t in rev_slice) if rev_slice else "  取得不可"

    # ブランド名推定: H1 > title > URL
    brand_name = ""
    if data.h1 and len(data.h1) <= 30:
        brand_name = data.h1
    elif data.title:
        brand_name = data.title.split('|')[0].split('-')[0].split('–')[0].strip()[:30]

    # 取得率サマリ（改善B）
    fields = {
        'タイトル': data.title, 'Meta Description': data.meta_description,
        'H1': data.h1, 'Hero Copy': data.hero_copy, 'Main CTA': data.main_cta,
        'Pricing': data.pricing_snippet, 'Features': bool(data.feature_bullets),
        'Body Text': data.body_text_snippet, 'FAQ': bool(data.faq_items),
        'Testimonials': bool(data.testimonials),
    }
    available = sum(1 for v in fields.values() if v)
    total = len(fields)

    hero_note = _hero_copy_quality_note(data.hero_copy)

    # 新規抽出フィールド（Phase 3H）
    urg_slice = data.urgency_elements[:_SIGNAL_LIMIT] if data.urgency_elements else []
    urgency_display = "\n".join(f"  - {u}" for u in urg_slice) if urg_slice else "  検出なし"
    trust_slice = data.trust_badges[:_SIGNAL_LIMIT] if data.trust_badges else []
    trust_display = "\n".join(f"  - {t}" for t in trust_slice) if trust_slice else "  検出なし"
    guar_slice = data.guarantees[:_SIGNAL_LIMIT] if data.guarantees else []
    guarantee_display = "\n".join(f"  - {g}" for g in guar_slice) if guar_slice else "  検出なし"

    # Phase 4: 水回りCRO品質改善 — 画像・バナー・販促訴求
    alt_slice = data.image_alts[:5] if data.image_alts else []
    alt_display = "\n".join(f"  - {a}" for a in alt_slice) if alt_slice else "  検出なし"
    banner_slice = data.banner_texts[:5] if data.banner_texts else []
    banner_display = "\n".join(f"  - {b}" for b in banner_slice) if banner_slice else "  検出なし"
    contact_slice = data.contact_paths[:5] if data.contact_paths else []
    contact_display = "\n".join(f"  - {c}" for c in contact_slice) if contact_slice else "  検出なし"
    promo_slice = data.promo_claims[:5] if data.promo_claims else []
    promo_display = "\n".join(f"  - {p}" for p in promo_slice) if promo_slice else "  検出なし"
    corp_slice = data.corporate_elements[:5] if data.corporate_elements else []
    corp_display = "\n".join(f"  - {e}" for e in corp_slice) if corp_slice else "  検出なし"

    # 証拠強度メタデータ（Phase 4 + Task B）
    has_body = bool(data.body_text_snippet and len(data.body_text_snippet) >= 200)
    has_image_alts = bool(data.image_alts)
    has_banners = bool(data.banner_texts)
    evidence_sources = []
    if has_body:
        evidence_sources.append("本文テキスト")
    if has_image_alts:
        evidence_sources.append("画像alt")
    if has_banners:
        evidence_sources.append("バナーテキスト")
    evidence_note = ", ".join(evidence_sources) if evidence_sources else "限定的"

    # 追加抽出フィールド（agency-grade拡張）
    offer_slice = data.offer_terms[:_SIGNAL_LIMIT] if data.offer_terms else []
    offer_display = "\n".join(f"  - {o}" for o in offer_slice) if offer_slice else "  検出なし"
    review_slice = data.review_signals[:_SIGNAL_LIMIT] if data.review_signals else []
    review_signal_display = "\n".join(f"  - {r}" for r in review_slice) if review_slice else "  検出なし"
    ship_slice = data.shipping_signals[:_SIGNAL_LIMIT] if data.shipping_signals else []
    shipping_display = "\n".join(f"  - {s}" for s in ship_slice) if ship_slice else "  検出なし"

    # Task B: 品質スコア・信頼度ラベル
    quality_score = getattr(data, '_extraction_quality_score', None)
    is_low_quality = getattr(data, '_is_low_quality', False)
    if quality_score is not None:
        if quality_score >= 0.6:
            confidence_label = "高信頼"
        elif quality_score >= 0.3:
            confidence_label = "推定"
        else:
            confidence_label = "低信頼（評価保留推奨）"
        quality_info = f"- **データ品質スコア**: {quality_score:.2f}（{confidence_label}）"
    elif is_low_quality:
        quality_info = "- **データ品質スコア**: 低（評価保留推奨）"
    else:
        quality_info = ""

    header = f"### {brand_name}（{data.url}）" if brand_name else f"### {data.url}"
    if compact:
        compact_snippet = (
            data.body_text_snippet[:_COMPARISON_BODY_SNIPPET_LIMIT]
            if data.body_text_snippet else "取得不可"
        )
        compact_features = _inline_list(feat_slice, limit=_COMPARISON_LIST_LIMIT)
        compact_faqs = _inline_list(faq_slice, limit=2)
        compact_reviews = _inline_list(rev_slice, limit=1)
        compact_promos = _inline_list(
            (data.promo_claims or []) + (data.urgency_elements or []) + (data.banner_texts or []),
            limit=4,
            fallback="検出なし",
        )
        compact_trust = _inline_list(
            (data.trust_badges or []) + (data.guarantees or []) + (data.corporate_elements or []),
            limit=4,
            fallback="検出なし",
        )
        compact_contact = _inline_list(data.contact_paths, limit=3)
        compact_alts = _inline_list(data.image_alts, limit=3, fallback="検出なし")
        compact_secondary = _inline_list(sec_slice, limit=2)
        compact_offers = _inline_list(data.offer_terms, limit=3, fallback="検出なし")
        compact_reviews = _inline_list(data.review_signals, limit=2, fallback="検出なし")
        compact_shipping = _inline_list(data.shipping_signals, limit=2, fallback="検出なし")
        compact_quality = quality_info.replace("- **", "").replace("**", "").strip() if quality_info else ""
        compact_quality_line = f"- **データ品質**: {compact_quality}\n" if compact_quality else ""
        compact_error_line = f"- **取得状態**: {data.error}\n" if data.error else ""
        return f"""{header}
- **データ取得率**: {available}/{total} フィールド取得成功
{compact_quality_line}- **証拠強度**: {evidence_note}
- **タイトル/H1**: {data.title or '取得不可'} / {data.h1 or '取得不可'}
- **Hero Copy**: {data.hero_copy or '取得不可'}{hero_note}
- **Main CTA / Secondary CTA**: {data.main_cta or '取得不可'} / {compact_secondary}
- **Pricing**: {data.pricing_snippet or '取得不可'}
{compact_error_line}- **特徴**: {compact_features}
- **FAQ / 顧客の声**: {compact_faqs} / {compact_reviews}
- **本文抜粋**: {compact_snippet}
- **販促シグナル**: {compact_promos}
- **信頼シグナル**: {compact_trust}
- **お問い合わせ・見積り導線**: {compact_contact}
- **画像alt**: {compact_alts}
- **オファー条件**: {compact_offers}
- **レビュー信号**: {compact_reviews}
- **配送条件**: {compact_shipping}
"""
    return f"""{header}
- **データ取得率**: {available}/{total} フィールド取得成功
{quality_info}
- **証拠強度**: {evidence_note}
- **タイトル**: {data.title or '取得不可'}
- **Meta Description**: {data.meta_description or '取得不可'}
- **OG Type**: {data.og_type or '取得不可'}
- **H1**: {data.h1 or '取得不可'}
- **Hero Copy**: {data.hero_copy or '取得不可'}{hero_note}
- **Main CTA**: {data.main_cta or '取得不可'}
- **Secondary CTAs**: {secondary}
- **Pricing**: {data.pricing_snippet or '取得不可'}
- **取得状態**: {data.error or 'ページ取得成功'}
- **Features**:
{features}
- **FAQ**:
{faqs}
- **顧客の声**:
{reviews}
- **本文抜粋**: {snippet}
- **緊急性要素**:
{urgency_display}
- **信頼バッジ**:
{trust_display}
- **保証・リスク反転**:
{guarantee_display}
- **画像alt（販促・商品情報）**:
{alt_display}
- **バナー・キャンペーンテキスト**:
{banner_display}
- **お問い合わせ・見積り導線**:
{contact_display}
- **販促訴求（送料無料・割引・納期）**:
{promo_display}
- **法人・実績・代理店情報**:
{corp_display}
- **オファー条件**:
{offer_display}
- **レビュー信号**:
{review_signal_display}
- **配送条件**:
{shipping_display}
"""


def _build_discovery_context_section(metadata: dict | None) -> str:
    """Build the 対象整理 section from discovery metadata."""
    if not metadata:
        return ""

    lines = ["## Discovery 入力メタデータ\n"]

    # Input brand
    input_brand = metadata.get("input_brand", "")
    input_url = metadata.get("input_brand_url", "")
    if input_brand:
        lines.append(f"- **入力ブランド**: {input_brand} ({input_url})")

    # Industry
    industry = metadata.get("industry", "")
    if industry:
        lines.append(f"- **推定業界**: {industry}")

    # Discovered candidates
    candidates = metadata.get("discovered_candidates", [])
    if candidates:
        lines.append("\n### 発見競合候補")
        lines.append("| ドメイン | タイトル | スコア | 競合分類 |")
        lines.append("|---|---|---|---|")
        for c in candidates[:10]:
            lines.append(
                f"| {c.get('domain', '')} | {c.get('title', '')[:40]} | "
                f"{c.get('score', '')} | {c.get('tier', '')} |"
            )

    # Analyzed targets (per-attempt)
    analyzed_targets = metadata.get("analyzed_targets", [])
    if analyzed_targets:
        lines.append("\n### 実分析対象")
        for t in analyzed_targets:
            lines.append(f"- {t.get('domain', '')} ({t.get('url', '')})")

    # Excluded candidates (quality gate)
    excluded = metadata.get("excluded_candidates", [])
    if excluded:
        lines.append("\n### 除外候補（品質ゲート）")
        for ex in excluded:
            lines.append(f"- {ex.get('reason', ex.get('domain', ''))}")

    # Omitted candidates (analysis limit / degrade-retry)
    omitted = metadata.get("omitted_candidates", [])
    if omitted:
        lines.append("\n### 分析対象外（上限/縮小）")
        for om in omitted:
            lines.append(f"- {om.get('domain', '')} — {om.get('reason', '')}")

    lines.append("")

    # ── Task A v3: 発見候補と実分析対象の分離サマリー（必須表示） ──
    n_candidates = len(candidates) if candidates else 0
    n_analyzed = len(analyzed_targets) if analyzed_targets else 0
    n_excluded = len(excluded) if excluded else 0
    n_omitted = len(omitted) if omitted else 0
    n_reference = n_candidates - n_analyzed - n_excluded - n_omitted
    if n_reference < 0:
        n_reference = 0

    lines.append("\n### 対象整理サマリー（Task A 必須表示）")
    lines.append("| 項目 | 数 |")
    lines.append("|------|-----|")
    lines.append(f"| 入力ブランド | 1 |")
    lines.append(f"| 発見競合候補数 | {n_candidates} |")
    lines.append(f"| 実分析対象数 | {n_analyzed} |")
    lines.append(f"| 参考観測数 | {n_reference} |")
    lines.append(f"| 除外候補数 | {n_excluded + n_omitted} |")
    lines.append("")

    # 未分析候補の明示（Task A v3: 発見されたが分析対象外の候補を明記）
    all_analyzed_domains = {t.get('domain', '') for t in analyzed_targets} if analyzed_targets else set()
    unanalyzed_candidates = []
    if candidates:
        for c in candidates:
            domain = c.get('domain', '')
            if domain and domain not in all_analyzed_domains:
                reason = "品質ゲートで除外" if any(
                    ex.get('domain', '') == domain for ex in (excluded or [])
                ) else "分析上限/縮小による除外" if any(
                    om.get('domain', '') == domain for om in (omitted or [])
                ) else "今回未分析"
                unanalyzed_candidates.append((domain, c.get('title', '')[:30], reason))

    if unanalyzed_candidates:
        lines.append("### 今回未分析の発見候補（Task A 必須表示）")
        lines.append("| ドメイン | タイトル | 除外理由 |")
        lines.append("|---|---|---|")
        for domain, title, reason in unanalyzed_candidates[:10]:
            lines.append(f"| {domain} | {title} | {reason} |")
        lines.append("")

    # 競合セット設計サマリー（Task A: 冒頭固定表示）
    tier_summary = metadata.get("competitive_tiers", {})
    if tier_summary:
        lines.append("\n### 競合セット設計")
        lines.append("| 項目 | 内容 |")
        lines.append("|------|------|")
        for tier_name, members in tier_summary.items():
            if isinstance(members, list):
                members_str = ", ".join(str(m) for m in members) if members else "該当なし"
            else:
                members_str = str(members)
            lines.append(f"| {tier_name} | {members_str} |")
        if not tier_summary.get("reason"):
            lines.append("| 分類理由 | 業界・価格帯・ターゲットの近接性に基づく自動推定 |")
        else:
            lines.append(f"| 分類理由 | {tier_summary['reason']} |")

    lines.append("")
    lines.append(
        "**重要（Task A v3）**: 「発見された競合候補」と「今回の実分析対象」を明確に分離すること。"
        "レポート冒頭（セクション2）の対象整理テーブルで以下を必ず明示:"
    )
    lines.append("- 入力ブランド（1社固定）")
    lines.append("- 発見競合候補数")
    lines.append("- 実分析対象数")
    lines.append("- 参考観測数")
    lines.append("- 除外候補数（除外理由を各候補に明記）")
    lines.append("")
    lines.append(
        "**必須表現（Task A）**: `発見された競合候補` / `今回の実分析対象` / `参考観測枠` / `今回未分析` "
        "— これらの表現を使い分けること。「競合」とだけ書いて発見候補と分析対象を混ぜてはならない。"
    )
    lines.append("")
    if unanalyzed_candidates:
        lines.append(
            "**未分析候補の明示（Task A v3）**: 上記の「今回未分析」候補がレポートの「分析対象と比較前提」"
            "セクションで省略されていてはならない。発見されたが分析対象に含めなかった候補とその理由を1行で記載すること。"
            "これにより、なぜ現在の分析対象セットが選ばれたかの根拠が明確になる。"
        )
        lines.append("")

    # 比較スコープの一貫表記を強制（Task A: taxonomy 固定）
    lines.append("### 比較スコープの表記ルール（必須・Task A）")
    lines.append("レポート冒頭（エグゼクティブサマリー直後）で以下の4項目を必ず明示すること:")
    lines.append("- **入力ブランド（control）**: ユーザーが指定したブランド名（**常に1社**）")
    lines.append("- **実競合比較対象数**: 主比較に含める競合の数")
    lines.append("- **参考観測数**: 品質不足で参考扱いとするサイト数")
    lines.append("- **比較対象総数**: 1 + 実競合比較対象数 + 参考観測数")
    lines.append("")
    lines.append("**入力ブランド数は常に1** — 複数URLが入力されても、入力ブランド（control）は最初の1社のみ。残りは実競合比較対象または参考観測枠に分類する。")
    lines.append("")
    lines.append("例: 「本レポートは SAURUS（入力ブランド）を含む4サイト比較です。"
                 "実競合比較対象は WINZONE / MPN の2社、Glico は参考観測です。」")
    lines.append("")
    lines.append("**禁止事項（Task A）**:")
    lines.append("- 入力ブランドと競合を並べて両方とも `入力ブランド` と書くこと")
    lines.append("- `入力ブランド数: 2` 以上を出力すること（常に1）")
    lines.append("- `競合N社のうち主比較は〇〇・△△` のように control を競合側へ混ぜること")
    lines.append("")
    lines.append("**必須表記**:")
    lines.append("- 入力ブランド数: 1")
    lines.append("- 実競合比較対象数: N")
    lines.append("- 参考観測数: N")
    lines.append("- 比較対象総数: 1 + N + N")
    lines.append("")
    lines.append("**厳守**: 本文中で「競合N社」「N社比較」「Nサイト中」等の数え方を使う場合、"
                 "上記の定義と一致させること。タイトルと本文で数が矛盾してはならない。")
    lines.append("")

    return "\n".join(lines) + "\n"


def _build_reference_observation_section() -> str:
    """Build prompt instructions for 参考観測枠 (evaluation-pending sites)."""
    return """
## 評価保留ルール — 参考観測枠

品質スコアが「低信頼（評価保留推奨）」のサイトは以下のように扱う:
1. **主比較テーブル（総合サマリー）から除外する** — ランキングや順位に含めない
2. 代わりに `## 参考観測枠` セクションを設け、以下のテーブルで出力:
   `| ブランド | 保留理由 | 現時点で言えること | 次回取得したい情報 |`
3. 個別プロファイルでは分析するが、スコアは `—（評価保留）` と表記
4. 「参考観測枠」のサイトに対して改善提案は最小限（1件以下）に留める
"""


_SPORTS_SUPPLEMENT_TEMPLATE = """
## スポーツサプリメント・健康食品業界 固定観点

業界推定結果が「スポーツサプリメント/プロテイン/健康食品/アミノ酸/BCAA」の場合、以下を固定観点に含める:

1. **アンチドーピング / 第三者認証**: インフォームドチョイス、WADA準拠、NSF認証等
2. **国産 / GMP / 製薬会社信頼**: 製造品質、国内製造、GMP工場
3. **味 / 飲みやすさ**: フレーバー数、溶けやすさ、口コミ評価
4. **価格 / 定期便 / 送料**: 単価、定期割引、送料無料条件、まとめ買い
5. **レビュー / アスリート使用実績**: プロ使用実績、口コミ数、競技レベル
6. **ターゲット層**: 競技者向け（本格派）vs 一般層向け（フィットネス/健康維持）

### L5止まりの訴求抑制（スポーツサプリ固有・Task B）:
- L5止まりの「ANTI DOPING」リンク等からは `関連情報の記載あり` までしか書いてはならない
- 禁止: `アンチドーピング対応` `対応プロテイン` `WADA禁止物質検査済み（確認後）`
- 許容: `アンチドーピング関連情報の掲載有無を確認` `競技者向け品質訴求の余地あり`

### ターゲット層別の訴求評価:
- **競技者向け**: 認証・品質・成分配合・パフォーマンスエビデンスを重視
- **一般層向け**: 味・手軽さ・価格・見た目・口コミを重視
- **安全性訴求**: アレルゲン表示、添加物フリー、原材料の透明性

### 検索意図の型:
- 指名検索: ブランド名 + プロテイン/サプリ
- 比較検討: プロテイン おすすめ / プロテイン 比較 / BCAA ランキング
- 成分特化: HMB 効果 / EAA vs BCAA / ホエイ vs ソイ
- 用途特化: ランニング サプリ / 筋トレ プロテイン / マラソン 補給

### ターゲット層別セグメンテーション（Task D 必須）:
各ブランドの訴求が「誰に向いているか」を以下の4セグメントで評価:

| セグメント | 重視する要素 | 代表的な検索クエリ |
|------------|-------------|-------------------|
| **競技者向け** | 認証・成分配合・純度・WADA準拠 | 「プロテイン 競技」「BCAA 本格」「インフォームドチョイス」 |
| **一般運動層向け** | 味・手軽さ・価格・口コミ数 | 「プロテин おいしい」「手軽に摂れる」「初心者」 |
| **ボディメイク向け** | タンパク質量・カロリー・HMB配合 | 「タンパク質 増量」「HMB プロテイン」「筋肥大」 |
| **マラソン/持久系向け** | アミノ酸・エネルギー補給・携帯性 | 「マラソン サプリ」「持久力 アミノ酸」「ジェル 比較」 |

### セグメンテーション出力ルール:
- 各ブランドについて「主ターゲットセグメント」と「副ターゲットセグメント」を明示
- 同じ「スポーツサプリ」でも、誰向けの訴求かが明確になるように記載
- セグメントが異なるブランド同士は、無理に同列で比較しない

### マーケットプレイス販売チャネル評価（スポーツサプリ固有）:
サプリメント市場では **Amazon・楽天が検索流入の主戦場** であり、D2Cサイト単体の分析では市場の購買導線を見落とす。
各ブランドについて以下を可能な範囲で評価すること:

| 評価項目 | 確認方法 | レポートへの反映 |
|----------|----------|-----------------|
| **Amazon/楽天での出品有無** | サイト内の外部リンク・EC導線から推定 | 購買導線評価に反映（出品ありなら「購買導線弱」の判定を再検討） |
| **モール vs D2C の導線設計** | LP内のCTA先がモールか自社ECか | 実行プランの着地先提案に反映 |
| **Googleショッピング広告** | 非指名クエリでの広告出稿形態の推定 | 5-2検索広告施策の獲得タイプに反映 |

- 自社ECのみの場合: D2C戦略として評価し、モール展開の検討を施策提案に含める
- モール出品がある場合: 「購買導線が弱い」という評価を安易に下さない。モールが実質的な購買チャネルである可能性を明記
- **データ不足の場合**: 「マーケットプレイス展開状況は今回の取得データからは確認不可」と明記し、評価保留とする
"""


_INFERENCE_SUPPRESSION_RULES = """
## 類推表現の抑制ルール（Task C 必須）

### 禁止表現（証拠強度「確認済み」でも使用禁止）:
- 「唯一」「最強」「圧倒的」「完璧」「最高」
- 「到達率が低い」「埋もれている」（データが不完全取得の可能性があるため）
- 「CTR改善余地あり」「CVR改善余地あり」（ベースラインが存在しないため）
- 「確実に」「間違いなく」「絶対に」（予測に対する断定）

### 制限表現（証拠強度「確認済み」+ 限定句付きのみ許可）:
- 「最も強い」→「今回比較したXサイト内では最も強い」
- 「トップ」→「今回分析対象の中では上位」
- 「無い」→「今回取得したデータ範囲では確認できなかった」

### 表現の強さと証拠強度の対応ルール:
| 証拠強度 | 許可される表現レベル |
|----------|---------------------|
| **確認済み** | 「〇〇が確認された」「〇〇の傾向が見られる」 |
| **推定** | 「〇〇と推定される」「〇〇の可能性がある」「〇〇と類推される（根拠: 〇〇）」 |
| **評価保留** | 「データ不足のため評価保留」「現時点では判断不可」 |

### 適用チェック:
- 各結論・評価の表現が、その根拠の証拠強度と一致しているか
- 類推が証拠より先に走っていないか
- 比較表現に「今回比較した中では」「取得データ上は」の限定句があるか
"""


# ── Task D: キーワード意図分類（固定ルール） ──
_KEYWORD_INTENT_TAXONOMY = """
## キーワード意図分類ルール（Task D 必須）

各施策の「主戦場クエリ」は以下の分類に厳密に従うこと:

### 分類定義:
| 分類 | 定義 | 入札戦略 | 代表例 |
|------|------|----------|--------|
| **指名** | ブランド名を含むクエリ | ブランド防衛・ISM維持 | 「SAURUS プロテイン」「SAURUS 公式」 |
| **準指名** | ブランド名+一般語の複合 | ブランド拡張獲得 | 「SAURUS ホエイ」「WINZONE HMB」 |
| **非指名カテゴリ** | ブランド名なしの一般カテゴリ語 | 非指名獲得・新規開拓 | 「プロテイン おすすめ」「HMB サプリ」「ランナー プロテイン」 |
| **比較検討** | おすすめ/比較/評判/ランキング系 | 比較検討獲得 | 「プロテイン 比較」「BCAA おすすめ」「サプリ ランキング」 |
| **リマーケ対象** | 再訪問・再検討を促すクエリ | リマーケティング | 「プロテイン 通販」「サプリ まとめ買い」 |

### 分類ルール（厳守）:
1. **ブランド名含有**: クエリに対象ブランド名が含まれる → 「指名」または「準指名」
2. **一般語のみ**: ブランド名なし + 一般カテゴリ語のみ → 「非指名カテゴリ」（「ランナー プロテイン」等）
3. **比較系語**: 「おすすめ」「比較」「評判」「ランキング」「レビュー」 → 「比較検討」
4. **混同禁止**: 「指名防衛」枠に「非指名カテゴリ」語を入れてはならない
   - ❌: 指名防衛: ランナー プロテイン
   - ✅: 非指名獲得: ランナー プロテイン

### アクションプランへの反映:
- 各アクションの「獲得タイプ」と「主戦場クエリ」の分類が一致していること
- 「指名防衛」施策のクエリは必ずブランド名を含むこと
- 「非指名獲得」施策のクエリはブランド名を含まないこと

### 検索広告施策の出力粒度（Task F 必須）:
5-2. 検索広告施策では、以下の3分類ごとに必ず出力すること:
- **指名防衛**: 推奨クエリ例3+、除外クエリ例2+、着地先、主KPI
- **カテゴリ非指名**: 推奨クエリ例3+、除外クエリ例2+、着地先、主KPI
- **比較検討**: 推奨クエリ例3+、除外クエリ例2+、着地先、主KPI

例:
- 指名防衛: 推奨 `SAURUS プロテイン` / `SAURUS 公式` / `SAURUS 口コミ` — 除外 `SAURUS 解約` / `SAURUS 退会`
- カテゴリ非指名: 推奨 `ランナー プロテイン` / `マラソン サプリ` / `持久力 アミノ酸` — 除外 `プロテイン レシピ` / `プロテイン 太る`
- 比較検討: 推奨 `プロテイン おすすめ` / `マラソン サプリ ランキング` / `BCAA 比較` — 除外 `プロテイン 自作` / `サプリ 副作用`
"""

# ── Task E: 信頼要素 taxonomy ──
_TRUST_ELEMENT_TAXONOMY = """
## 信頼要素の階層分類（Task E 必須）

信頼要素を以下の5階層に分類し、各階層に応じた表現のみ使用すること:

### 階層定義:
| 階層 | 分類 | 広告コピーへの転用 | 表現例 |
|------|------|-------------------|--------|
| **L1 第三者認証 confirmed** | 第三者機関の認証・登録を**機関名・認証番号付き**で確認 | ✅ 強い訴求として使用可 | 「インフォームドチョイス認証」「NSF認証取得」「WADA準拠確認」 |
| **L2 自社品質主張 confirmed** | サイト内での品質に関する自社の主張（本文に具体的説明あり） | ⚠️ 「〇〇を宣言」「〇〇に対応」程度 | 「GMP基準で製造」「品質管理徹底」「国内製造」 |
| **L3 外部実績 confirmed** | 提携先・共催・使用実績の記載 | ✅ 実績として使用可 | 「〇〇大会公式サプリ」「〇〇陸上競技部使用」 |
| **L4 コミュニティ/UGC** | ユーザー投稿・レビュー・SNS言及 | ✅ ソーシャルプルーフとして可 | 「レビュー〇〇件」「Instagram〇〇投稿」 |
| **L5 文言存在 only** | ナビゲーションやラベルに文言が存在するのみ。内容の裏付けなし | ❌ 広告コピーに転用不可・認証と書くのは絶対禁止 | 「ANTI DOPING」リンク、「安心」バナー |

### 絶対禁止ルール:
1. **L5（文言存在 only）から「認証取得済み」を言うことは禁止**:
   - ナビに「品質保証」「ISO」等のリンクがあるだけでは「認証取得済み」「検査体制あり」と書いてはならない
   - ❌: 「ISO認証取得済み」（ナビ文言のみで裏付けなし）
   - ✅: 「品質保証に関するナビ文言の存在を確認（認証内容は未確認）」
2. **認証未確認なのに広告コピーで断定表現を作ることは禁止**:
   - L5の情報を施策の推奨訴求やエグゼクティブサマリーで「認証」として言及してはならない
   - ❌: エグゼクティブサマリーで「品質認証を訴求に活用」（L5のみ）
   - ✅: 「品質関連の情報記載あり（L5）。認証の確認が取れれば訴求に転用可能」
3. **L5 only の場合の訴求提案上限（Task B 強化）**:
   - L5止まりの情報からは `関連情報の記載あり` までしか書いてはならない
   - 以下の表現は L5 only では**絶対禁止**: `対応` `認証` `検査済み` `安心して使える` `準拠` `取得`
   - LP改善案でも、L1確認前のコピー例を作ってはならない
   - **許容表現（L5 only で使ってよい表現）**:
     - `〇〇関連情報の掲載有無を確認`
     - `品質訴求の余地あり`
     - `認証取得が確認できれば主要訴求へ昇格可能`
   - **禁止表現（L5 only で使ってはならない表現）**:
     - `〇〇対応` （例: 対応プロテイン、対応サプリ）
     - `〇〇認証〇〇` 等の断定コピー
     - `〇〇検査済み` 等の検証済み表現
4. **階層昇格の条件**: 下位階層から上位階層への昇格には、複数フィールドでの裏付けが必要
   - L5→L2: 本文に具体的な説明（製造工程・基準名等）がある場合のみ
   - L2→L1: 第三者機関名・認証番号等の具体的裏付けがある場合のみ
   - 昇格時は `L5→L2昇格: 本文に〇〇の記載を確認` と理由を明記
5. **各信頼要素の出力**: 評価テーブルに階層タグを必ず付与
   - 例: `【第三者認証 L1】` `【自社品質主張 L2】` `【文言存在 L5】`
   - L5は必ず `（認証内容は未確認）` の注釈を添える
6. **L5 only からの広告見出し案作成禁止（Task B v3 強化）**:
   - L5 only 情報を広告見出し案・推奨訴求・エグゼクティブサマリーの勝ち筋に直接使ってはならない
   - 例: ナビに `ANTI DOPING` があるだけの状態で:
     - ❌: 推奨訴求「アンチドーピング対応」「公式ランナーサプリ・アンチドーピング対応」
     - ❌: 「アンチドーピング情報」を施策の広告見出し案に組み込む
     - ✅: 「アンチドーピング関連情報の記載あり（内容未確認・L5）」
     - ✅: 「競技者向け品質情報の掲載有無を確認」
     - ✅: 「L1確認後に主要訴求へ昇格」
   - 施策表の推奨訴求列に L5 only の情報を載せる場合は `（L5・要確認）` を必ず付記
"""

# ── Task F: 媒体別KPIレイヤー ──
_MEDIA_KPI_LAYER = """
## 媒体別KPIレイヤー（Task F 必須）

### 検索広告のKPI:
| 項目 | 主KPI | 補助KPI |
|------|-------|---------|
| **指名防衛** | Impression Share / CPC / branded CVR | IS lost to budget / CTR |
| **非指名獲得** | LP-CVR / CPA | CTR / CPC / Search term fit（クエリ一致率） |
| **比較検討** | LP-CVR / CPA | CTR / CPC / 新規セッション率 |

### Meta / ディスプレイのKPI:
| 項目 | 主KPI | 補助KPI |
|------|-------|---------|
| **認知拡大** | LPV / ViewContent率 | CTR / CPC / エンゲージ率 |
| **獲得** | AddToCart率 / CVR | CTR / CPC / LPV |
| **リマーケ** | ViewContent率 / CVR / ROAS | リピート率 / カート放棄回収率 |

### KPI選定の禁止ルール:
- **獲得施策の補助KPIに「滞在時間」を安易に置くことは禁止**。滞在時間は獲得KPIとしては弱く、代わりに LP-CVR / CPA / CTR を使う
- 「滞在時間」が許容されるのは、コンテンツマーケティング施策（記事LP等）のみ
- 「ブックマーク率」も獲得施策のKPIとしては不適切。比較検討コンテンツの補助指標としてのみ許容

### 評価タイミング:
| フェーズ | 期間 | 判定内容 |
|----------|------|----------|
| 学習 | 1-2週 | 配信の安定化を確認 |
| 初回評価 | 4-8週 | 主KPIの方向性を判定 |
| 本格評価 | 8-12週 | CPA / ROAS の収束を確認 |

### 出力ルール:
- 各施策のKPIは上記の媒体別テンプレートから選ぶ
- 効果予測は固定値ではなくレンジまたは方向性で記載
- 「4-8週で評価」「学習フェーズ後に再判定」等の条件を必ず添える
"""

_WATER_INDUSTRY_KEYWORDS = ("水回り", "住宅設備", "建材", "サニタリー", "キッチン", "バス", "水栓", "洗面")

_WATER_INDUSTRY_TEMPLATE = """
## 水回り・住宅設備業界 固定観点

業界推定結果が「水回り/住宅設備/建材/サニタリー/キッチン/バス」の場合、以下を固定観点に含める:

1. **正規品/代理店保証**: 正規代理店表記、メーカー保証の有無
2. **施工可否/適合確認**: 取付対応情報、適合確認導線
3. **納期/在庫**: 発送目安、在庫状況の表示
4. **法人見積/大口発注**: 法人向け導線、大口注文対応
5. **デザイン性**: デザインシリーズ・カラーバリエーションの提示
6. **メンテナンス/交換部材**: アフター対応、交換部品の案内
7. **FAQ/問い合わせの強さ**: 取付・仕様・返品に関するFAQ品質
"""

_WATER_INDUSTRY_TEMPLATE_COMPACT = """
## 水回り・住宅設備の固定観点
- 正規品 / 代理店保証
- 納期 / 在庫 / 送料
- 法人見積 / 大口発注
- 施工可否 / 適合確認
- FAQ / 問い合わせ
- デザイン性 / シリーズ訴求
"""


_MARKET_CONTEXT_LAYER = """
## 市場概況レイヤー（必須・セクション1の直後）

エグゼクティブサマリーの後に、以下の市場概況テーブルを必ず出力すること。
全ての数値はAI推定であり、**必ず【市場推定】ラベルと信頼度を付記**すること。

### 出力フォーマット:
```markdown
### 市場概況（AI推定・参考値）
| 項目 | 推定値 | 信頼度 | 根拠 |
|------|--------|--------|------|
| 日本市場規模 | ¥XXX億（推定） | 低〜中 | 業界動向からの類推 |
| 成長率 | 年率X-Y%（推定） | 低〜中 | 公開データからの類推 |
| 主要チャネル | オンラインXX% / 店舗XX%（推定） | 低 | カテゴリ一般論 |
| 季節性 | ピーク: X月 / オフ: X月（推定） | 低 | カテゴリ一般論 |
| 検索ボリューム目安 | 月間X万〜Y万（推定） | 低 | カテゴリ規模からの類推 |
```

### ルール:
- **点推定禁止**: 全てレンジで記載（例: `年率3-6%`）
- **根拠必須**: 各推定の根拠を1行で明記
- **季節性**: 需要ピーク時期・推奨キャンペーン時期・競合の季節施策傾向を含める
- ソースなしの数値は書かない。推定値の場合は必ず「推定」と明記
"""

_COMPETITIVE_INTELLIGENCE_LAYER = """
## 競合広告投資推定（セクション3に含める）

競合比較サマリーテーブルの後に、以下の広告投資推定テーブルを必ず出力すること。
全てAI推定であり、実際の広告費データではないことを明記。

### 出力フォーマット:
```markdown
### 競合広告投資推定（AI推定・参考値）
| ブランド | 推定月間広告費レンジ | 主戦場 | 推定手法 | 信頼度 |
|----------|---------------------|--------|----------|--------|
| XX | ¥XX万〜¥XX万（推定） | 検索広告中心 | 指名防衛+カテゴリ獲得 | 低 |
```

### 推定の根拠として使用:
- LPの複雑性・ページ数（本格的LP → 投資厚い可能性）
- 可視マーケティング活動（キャンペーン・セール実施）
- 業界水準との比較
- 検索での露出度（ブランド認知度の代理指標）

### ルール:
- **常にレンジ**: 点推定は禁止（例: ¥50万 → ¥30万〜¥80万）
- **「AI推定」ラベル必須**
- 信頼度は原則「低」（実データがないため）
"""

_EVIDENCE_RIGOR_RULES = """
## データカバレッジに基づく結論制限（必須）

サイトのデータ取得率に応じて、結論の強さを制限すること。

### カバレッジ基準:
各サイトのデータ取得率を以下で算出:
- 抽出成功フィールド数 / 総フィールド数（title, h1, hero_copy, main_cta, pricing_snippet, feature_bullets, faq_items, testimonials, body_text_snippet）

### 制限ルール:
| 平均取得率 | 許可される結論 | 禁止される結論 |
|-----------|---------------|---------------|
| ≥7/10 | 全セクション通常評価可 | — |
| 5-6/10 | 定性評価 + 幅広いレンジ推定 | 点推定・強断定 |
| <5/10 | 定性的方向性のみ | 数値推定・定量比較 |

### 共通ルール:
- 全ブランドで特定フィールドが一律取得不可 → 「同条件比較不可」と明記
- pricing_snippet が全ブランドで取得不可 → 価格比較は禁止（推定レンジのみ可）
- main_cta が全ブランドで取得不可 → CTA比較は禁止

### 出力フォーマット:
各サイトのデータ取得率をテーブルで明示:
`| ブランド | 取得率 | 信頼レベル | 制限事項 |`
"""

_CONSUMER_INSIGHTS_LAYER = """
## 消費者インサイト（セクション3-4の間に挿入）

ブランド別評価の前に、消費者インサイトセクションを必ず出力すること。
抽出データとAI推定を組み合わせて記載。

### 出力フォーマット:
```markdown
### 消費者インサイト（AI推定 + 抽出データ）
#### 推定ターゲット層
| ブランド | 推定メインターゲット | 推定サブターゲット | 根拠 |
|----------|--------------------|--------------------|------|

#### 購買決定要因（推定）
- 抽出レビュー/FAQから推定される購買決定要因
- 価格感度の推定（抽出価格 + カテゴリ相場から）

#### カテゴリ共通の購買行動（AI推定）
- 検討→比較→購入の典型的なカスタマージャーニー
- 意思決定にかかる平均期間の推定
- 情報収集チャネルの推定
```

### ルール:
- 推定には必ず【推定】ラベルを付記
- 抽出データに基づく場合は【抽出データ】ラベルを付記
- 根拠のない推測は書かない
"""

_KPI_FRAMEWORK_LAYER = """
## KPI測定計画（セクション5の最後に挿入）

実行プランの最後に、KPI測定計画セクションを必ず出力すること。

### 出力フォーマット:
```markdown
#### 5-4. KPIフレーム・測定計画
| 施策 | 主KPI | 目標値（初期目安） | 測定方法 | 評価タイミング |
|------|-------|-------------------|----------|---------------|
| 指名防衛 | Impression Share | XX%以上 | Google Ads | 2週間後 |
| カテゴリ獲得 | CPA | ¥X,XXX以下 | Google Ads | 4週間後 |
| 比較検討 | LP-CVR | X%以上 | GA4 | 4週間後 |
```

### ルール:
- **目標値は初期目安**: 実測後に調整前提であることを明記
- **評価タイミング**: 学習フェーズ（1-2週）と本格評価（4-8週）を分ける
- **測定方法**: 具体的なツール名を明記
- 全ての目標値に「初期目安・実測後調整」と注記
"""


_EVIDENCE_TRACE_REQUIREMENTS = """
## アクション提案の根拠トレース（必須）

各アクション提案には以下の3つを必ず付与すること:

### 1. 根拠フィールド
アクションの根拠となったデータフィールドを明記:
- `hero_copy` / `pricing` / `promo_claims` / `image_alts` / `contact_paths`
- `trust_badges` / `testimonials` / `feature_bullets` / `body_text` / `faq_items`
- `meta_description` / `main_cta` / `secondary_ctas` / `urgency_elements`
- `offer_terms` / `review_signals` / `shipping_signals`

### 2. 証拠強度
以下の3段階で統一（`強/中/弱` は使用しない）:
- **確認済み**: 複数フィールドで直接確認（例: pricing + promo_claims の両方で確認）
- **推定**: 1フィールドから確認、またはデータの一部から類推
- **評価保留**: データ不足で判断を保留

### 3. ファネル段階
施策が効くファネル段階を明記:
- **認知**: 広告文・LP FV で注意を引く段階
- **興味**: 商品詳細・ベネフィットで興味を深める段階
- **検討**: 比較・口コミ・価格で検討を促す段階
- **確信**: 保証・認証・実績で不安を解消する段階
- **行動**: CTA・オファー・緊急性でCV を促す段階

### 出力フォーマット（実行プラン・アクション提案）:
`| # | ブランド | 優先度 | 施策 | 根拠フィールド | 証拠強度 | ファネル段階 | 期待効果 |`
"""


_AD_OPERATIONS_LAYER = """
## 広告運用設計レイヤー（必須・Task B）

LP診断だけで終わらず、**広告運用に直接移せる設計**まで出力すること。

### 各ブランドについて以下を必ず提示:

#### 1. 獲得タイプ判定
各ブランドを以下のいずれかに分類:
- **指名向き**: ブランド名検索からの流入が主。LPは認証・詳細・購入導線重視
- **非指名獲得向き**: 一般キーワードからの獲得が主。LPはFV訴求・オファー・CTA重視
- **比較検討向き**: 「〇〇 vs △△」「〇〇 おすすめ」等の比較系クエリ。LPは比較表・強み強調重視
- **リマーケ向き**: 再訪問・再検討層。LPは限定オファー・クーポン・残り少ない表示重視

#### 2. 広告運用セット（各ブランド必須）
`| ブランド | 獲得タイプ | 推奨媒体 | 推奨訴求 | 推奨着地先 | 主戦場クエリ | 負けやすい訴求 | 初回テストKPI |`

- **推奨媒体**: Google検索 / Googleディスプレイ / Meta(Instagram) / LINE / Yahoo
- **推奨訴求**: 価格 / 品質認証 / 送料無料 / 定期便 / 初回限定 / 口コミ数 / アスリート実績 等
- **推奨着地先**: 専用獲得LP / 商品カテゴリLP / 比較LP / ブランドTOP / キャンペーンLP
  - 非指名獲得は原則 `専用獲得LP` or `商品カテゴリLP` を優先。`ブランドTOP（改修後）` に安易に逃がさない
- **主戦場クエリ**: 具体的な検索クエリ例（3つ以上）
- **負けやすい訴求**: そのブランドが弱い訴求軸（競合に負ける面）
- **初回テストKPI**: CTR / CPC / CVR / CPA / インプレッションシェア 等

#### 3. 予算配分の方向性（Task D v3: phase 設計必須）
固定比率（例: 指名70/非指名30）ではなく、**phase 設計**で出力すること。
実測前の段階で精密な比率を断定してはならない。

**推奨フォーマット**:
- **Phase 1（初期配信）**: 指名防衛中心 — ブランド検索のImS維持が最優先
- **Phase 2（テスト拡大）**: 非指名カテゴリテスト着手 — 少額で CPA/CVR の方向性を確認
- **Phase 3（実測後再配分）**: CPA / CVR 実測後に指名 vs 非指名 vs 比較検討の予算を再配分

**どうしても比率を出す場合は以下の3条件を必ず付記**:
- `目安` または `初期仮説` と明記
- `実測後に再配分前提` と注記
- 固定値ではなくレンジで記載（例: `指名 60-70% / 非指名 20-30% / 比較 5-15%（初期仮説）`）

**禁止**:
- `指名防衛70 / 非指名30` のような条件なし固定比率
- `非指名60 / 比較検討40` のような根拠なし分割

#### 4. 予算フレーム（AI推定・参考値）
セクション5の先頭に以下の予算フレームテーブルを必ず出力すること。
全てAI推定であり、実際の予算提案ではないことを明記。

```markdown
#### 5-0. 予算フレーム（AI推定・参考値）
| 項目 | 初期月額予算レンジ | 根拠 | 条件 |
|------|-------------------|------|------|
| 指名防衛 | ¥XX万〜¥XX万 | 推定検索ボリューム基準 | 実測後に調整 |
| カテゴリ獲得 | ¥XX万〜¥XX万 | テスト配信前提 | CPA確認後に増額判断 |
| 比較検討 | ¥XX万〜¥XX万 | 競合密度基準 | 効果確認後に拡大 |
| 合計目安 | ¥XX万〜¥XX万 | — | 初期仮説・実測後再配分 |
```

- **常にレンジ**: 点推定は禁止
- **「初期仮説」ラベル必須**: 実測データがない段階での仮設定であることを明記
- **条件列必須**: いつ再評価するかを明記
"""


_CTA_EVALUATION_RULES = """
## CTA明確性の評価ルール（Task D 必須）

CTA明確性は `main_cta` 単独で判定してはならない。以下の購買導線群の合算で評価すること:

### 評価対象の導線群:
1. **商品カードの購入導線**: 商品ページへの遷移ボタン、カート追加
2. **ランキング導線**: 売れ筋ランキング、おすすめ一覧への誘導
3. **定期便導線**: サブスクリプション、定期購入の案内
4. **カテゴリLPへの遷移**: 商品カテゴリ別の着地ページ
5. **見積り・問い合わせ導線**: contact_paths に含まれる導線

### 評価基準:
- `main_cta` が弱くても（例: `お問合せはこちら`）、上記の購買導線群が充実していれば CTA明確性は `中` 以上まで許容
- 逆に `main_cta` が明確でも、他の購買導線が皆無なら CTA明確性を `高` にしない
- `secondary_ctas`、`contact_paths`、`offer_terms` を必ず参照し、導線の総合力で判定する

### 判定マトリクス:
| main_cta | 購買導線群 | CTA明確性 |
|----------|-----------|-----------|
| 強い（購入/カート追加） | 充実 | 高 |
| 強い | 不足 | 中 |
| 弱い（問い合わせ等） | 充実 | 中 |
| 弱い | 不足 | 低 |
| 取得不可 | 充実 | 中（推定） |
| 取得不可 | 不足 | —（評価保留） |
"""

_EFFECT_RANGE_TEMPLATE = """
## 効果予測のレンジ化（必須・Task E）

効果予測は**固定値・断定値を禁止**し、以下のフォーマットで出力すること:

### 禁止表現:
- `CVR +15%` / `CTR +20%` 等の固定数値
- `確実に改善` / `間違いなく効果あり` 等の断定
- `大幅改善` / `劇的変化` 等の根拠なし誇張

### 推奨フォーマット:
- **CVR改善余地**: 小 / 中 / 大（根拠: 〇〇が不足しているため）
- **優先度**: 指名防衛 / 非指名獲得 / リマーケ / テスト
- **期待インパクト**: 1-2週間では学習フェーズ / 4-8週間で本格評価
- **効果レンジ**: 最低〜最高の幅で記載（例: `CPC 10-30%削減の可能性`）

### 予測に条件を付ける:
- `〇〇の条件下で` / `現在のLP構成を維持した場合` 等の前提条件
- データ不足の場合は `評価保留 — 実測後に再判定` と記載
"""


# ── Task C v3: 価格未取得ブランドの制約 ──
_PRICING_UNKNOWN_RULES = """
## 価格未取得ブランドの制約（Task C v3 必須）

Pricing フィールドが `取得不可` のブランドには以下の制約を適用すること:

### 禁止事項:
- `¥〇〇〜` のような仮価格コピーを施策・広告見出し案に含めてはならない
- `価格帯・CTAを追加` のような、価格が判明していることを前提とした提案を出してはならない
- `定期便で〇〇円お得` 等の価格ベースのオファー提案も、価格未取得時は禁止

### 許容表現:
- `商品カテゴリ・購入CTAを明示`（価格に言及しない改善案）
- `価格情報の取得可否を先に確認`（次のアクションとしての確認提案）
- `shopドメインから価格・商品ラインナップを取得する`（情報収集の提案）

### 価格未取得時の施策優先順:
1. shopドメイン / 商品ページの価格・導線情報を取得する
2. 取得後に価格ベースの訴求コピーを設計する
3. 価格情報なしで書けるベネフィット・CTA・カテゴリ訴求に留める
"""


# ── Task E v3: 証拠強度の事実/推定 分離ルール ──
_EVIDENCE_SEPARATION_RULES = """
## 事実と推定の文レベル分離（Task E v3 必須）

証拠強度ラベルをさらに厳密化するため、**事実と解釈を同一文に混ぜることを禁止**する。

### ルール:
- 1文目: 確認済み事実を記述（【確認済み】ラベル付き）
- 2文目: その事実からの解釈・推定を記述（【推定】ラベル付き）
- この2文を1文にまとめてはならない

### 理想形:
- ✅: `【確認済み】main_cta は「お問い合わせ」。` → `【推定】そのため、非指名獲得流入では購買遷移率が下がる可能性がある。`
- ✅: `【確認済み】pricing_snippet は取得不可。` → `【推定】価格訴求による即時CVは期待しにくい。`

### 禁止形:
- ❌: `main_cta は「お問い合わせ」で購買導線が弱い`（事実と解釈が1文に混在）
- ❌: `pricing が取得不可のため CV率は低い`（取得不可 = 低CVR と断定）

### 適用箇所:
- ブランド別評価の根拠列
- 実行プランの根拠フィールド・証拠強度列
- エグゼクティブサマリーの結論文
"""


# ── Task F v3: 検索意図別ブランド勝ち筋の深掘り ──
_SEARCH_INTENT_SEGMENTATION_RULES = """
## 検索意図別ブランド勝ち筋の深掘り（Task F v3 必須）

各ブランドの勝ち筋を「誰に強いか」まで1段深く切ること。
同じ「スポーツサプリ」でも、検索意図によって刺さるブランドが異なる。

### 分離基準:
- **競技者向けに強いブランド**: 認証重視・成分純度・大会実績・品質エビデンス
  - 代表クエリ: `マラソン サプリ 認証` `BCAA 本格` `インフォームドチョイス プロテイン`
- **一般運動層向けに強いブランド**: コスパ・飲みやすさ・口コミ数・初回購入のしやすさ
  - 代表クエリ: `プロテイン おいしい` `プロテイン 安い` `初心者 サプリ`

### 出力ルール:
- 各ブランドについて `主ターゲット検索意図` と `副ターゲット検索意図` を明示
- `競技者向け` と `一般運動層向け` を同一セルに混ぜてはならない
- 勝ち筋が検索意図で分かれる場合、施策表でも獲得タイプ別に行を分ける
- 「このブランドはどの検索意図のユーザーに刺さるか」を1文で明記
"""


# ── Task G v3: 改善施策の優先順位ルール ──
_IMPROVEMENT_PRIORITY_ORDER = """
## 改善施策の優先順位（Task G v3 必須）

施策の優先順位は以下の3段階を厳守すること:

### 理想順:
1. **確認すべきこと**: shopドメインの価格・商品情報・導線確認、認証情報の裏取り等
2. **作るべきもの**: 専用獲得LPの必要性判定、LP改修案の策定等
3. **配信すること**: 指名防衛キャンペーン整備、非指名カテゴリテスト着手等

### 禁止:
- 「確認すべきこと」を飛ばして「配信すること」を最優先に置く
- shopドメインの商品情報が未確認なのに、広告配信設計を先行させる
- 価格未取得のまま価格訴求の広告施策を優先度Sにする

### 出力ルール:
- 実行プランの最優先3施策は、上記の順に並べる
- 「確認」フェーズの施策がある場合は、必ず最初に配置
- 「確認 → 制作 → 配信」の依存関係を明示する（例: `※商品情報取得後に実行`）
"""


_COMPETITIVE_TIER_INSTRUCTIONS = """
## 競合層分類（必須・冒頭固定表示）

レポート冒頭の「分析対象と比較前提」セクションで、**各ブランドを以下の3層に分類**し理由を1行で明記すること:

| 競合層 | 定義 | 比較の扱い |
|--------|------|------------|
| **直競合EC** | 非指名獲得で直接ぶつかる同業EC | 主比較・優先評価 |
| **直競合ブランド** | 指名検索・ブランド想起でぶつかる相手 | 主比較・ブランド防衛観点 |
| **ベンチマーク** | LP設計や訴求だけ参考にする異業種・隣接カテゴリ | 参考比較のみ |

### 競合セット設計ルール:
1. 競合層分類はレポートの冒頭テーブルで固定表示する
2. 主比較対象がレポート間で変わる場合、**なぜその集合になったか**の理由を必ず明記
3. 「直競合EC」が0サイトの場合は、その理由と代替アプローチを説明
4. 各ブランドの分類理由（例: 「同価格帯・同ターゲットの獲得型EC」等）を備考欄に記載

### 総合サマリーに競合分類列を追加（Task C: スコアリング縮小）:
`| ブランド名 | 競合層 | LP種別 | 獲得対応力 | 信頼訴求強度 | 購買導線整備度 | 一言要約 |`
- 獲得対応力 / 信頼訴求強度 / 購買導線整備度 は以下の**強度分類**で評価する:
  - `強` — 明らかに強い、明確な証拠あり
  - `同等` — 他と遜色なし
  - `弱` — 明らかに弱い
  - `—（評価保留）` — 判断不可
- 数値スコア（`26/40` `44/60` 等）は原則廃止。読者に過剰な確からしさを与えるため
- `評価保留` があるブランドには判定を出さず `—（評価保留）` と表記する
- 数値スコアを残す場合は脚注で rubric（各点数の定義）を必ず明示すること
- **必須文言**: 「今回比較したNサイト内での相対評価であり、市場全体の順位を示すものではありません」をテーブルの直後に付記

### 競合母集団の整合性チェック:
- 比較対象が2レポート間で異なる場合: `※本レポートの主比較は〇〇層。別レポートで△△を主比較としている理由は〇〇` の注記を付ける
- 価格比較の土俵が揃っているか: 揃っていない場合は「同条件比較不可」と明記
- ブランド育成の比較相手が適切か: D2Cと代理商ECを同列評価しない
"""


def build_competitive_lp_prompt(extracted: ExtractedData) -> str:
    """Build a single-URL competitive LP analysis prompt."""
    return f"""あなたは広告LP最適化の実務経験を持つCROコンサルタントです。
提示データだけを根拠に、実行可能な改善提案を行ってください。

## 分析対象
{_format_site_data(extracted)}

## 厳守
- 「取得不可」は技術的制約。弱みの根拠にしない
- 本文抜粋から補完できる内容は【推定】ラベル付きで記載
- 推定は必ず根拠を添えて `【推定】` と明記
- Hero Copy に注意タグがある場合は本文抜粋を優先
- 抽象論は禁止。改善案は具体的な見出し・CTA・構成変更まで書く
- 【画像・バナー訴求の活用】画像alt、バナーテキスト、販促訴求フィールドに含まれる情報は、本文テキストと同等に評価に活用すること。これらが豊富にある場合、「データ不足」と判定してはならない

## 不確実性ラベル（必須）
各所見・仮説には以下の3段階いずれかを付与すること:
- **【高信頼】**: 提示データから直接確認できる事実
- **【推定】**: データの一部から類推できるが、完全確認はできない内容
- **【評価不能】**: データが不足しており、判断を保留すべき項目
  - 「評価不能」の項目にはスコアを付けず「評価保留」と記載
  - 「評価不能」と「低評価」を混同しないこと

## 断定抑制ルール（必須）
- データ不足（取得率5/10未満 または 品質スコア「低信頼」）のサイトに対する断定を厳しく制限:
  - 「信頼性ゼロ」「離脱確実」等の強断定は禁止 → 「データ不足のため評価保留」
  - 「広告出稿停止」等の重い提言は、高信頼条件（データ取得率7/10以上 かつ 明確な根拠）を満たす場合のみ許可

## 評価観点
- FV訴求力
- CTA設計
- 信頼構築
- ベネフィット訴求
- 価格心理学
- CV導線設計
- サイト種別判定（正規代理店EC / 専門店EC / メーカー・ブランド / サポート主導）

## 出力
1. `## 総合サマリー`
   3行要約、推定業界、LP種別、サイト完成度(/40)、広告受け皿適性(/40)、総合スコア(/60)、グレード
2. `## 業界・ポジション推定`
   業界・競合・ポジション・LP種別を整理
3. `## サイト完成度スコア(/40)`
   | 軸 | スコア(1-10) | 証拠強度 | 根拠 |
   情報設計 / 信頼構築 / 商品探索性 / サポート導線
4. `## 広告受け皿適性スコア(/40)`
   | 軸 | スコア(1-10) | 証拠強度 | 根拠 |
   FV訴求力 / オファー明確性 / CTAの近さ / 比較検討不安の解消
5. `## CRO 6軸スコア`
   6軸10点満点。Markdownテーブル: `| 評価軸 | スコア(1-10) | 根拠 | 信頼度 |`
   信頼度列に「高信頼」「推定」「評価不能」のいずれかを記載
6. `## 説得アーキテクチャ`
   Cialdini 6原理: Authority / Social Proof / Scarcity / Reciprocity / Commitment / Liking
7. `## ファネル分析`
   AIDCA: Attention / Interest / Desire / Conviction / Action を `| 段階 | 評価(O/P/X) | 根拠 |` で整理
8. `## 業界特化ギャップ`
   サプリメント / 健康食品 / SaaS / EC / D2C / B2B / 水回り・住宅設備 の観点で不足要素を3点以内で要約
9. `## 広告運用アクション（必須）`
   | 項目 | 内容 |
   勝ち訴求 / 避ける訴求 / 推奨検索クエリ意図 / 推奨着地先 / 7日以内施策 / 30日以内施策
   最低3件以上の具体的アクションを提示
10. `## 戦略的改善提案`
    Markdownテーブル:
    `| # | 優先度 | 改善領域 | 現状の問題 | 改善後のコピー例 | 期待CV向上率 | 実装難易度 |`

## 補足
- グレード目安: A=51+, B+=42-50, B=33-41, C=24-32, D=23以下
- コピー例は現状→提案の対比で書く
- 期待CV向上率は推定値でよいが、根拠の方向性を短く添える
- 冗長な前置きは禁止。各根拠は1-2文、各セクションは簡潔にまとめる
- 改善提案は最重要3件まで。表の説明文を長く書きすぎない

## スクリーンショット分析
- スクリーンショットがある場合はファーストビューの視覚階層とCTA視認性も評価
"""


def build_deep_comparison_prompt(
    extracted_list: list[ExtractedData],
    *,
    discovery_metadata: dict | None = None,
) -> str:
    """Build a multi-URL deep comparison prompt (agency-grade)."""
    # Separate main vs reference-observation sites
    main_sites = []
    reference_sites = []
    for d in extracted_list:
        if getattr(d, '_is_low_quality', False):
            reference_sites.append(d)
        else:
            main_sites.append(d)

    main_section = "\n".join(_format_site_data(d, compact=True) for d in main_sites)
    ref_section = "\n".join(_format_site_data(d, compact=True) for d in reference_sites) if reference_sites else ""

    discovery_context = _build_discovery_context_section(discovery_metadata)
    industry = (discovery_metadata or {}).get("industry", "")
    is_sports_supplement = any(
        kw in industry
        for kw in ("サプリ", "プロテイン", "健康食品", "アミノ酸", "BCAA", "supplement", "protein")
    ) if industry else False
    is_water_industry = any(
        kw in industry for kw in _WATER_INDUSTRY_KEYWORDS
    ) if industry else False

    ref_note = ""
    if reference_sites:
        ref_names = ", ".join(
            (d.h1 or d.title or d.url)[:20] for d in reference_sites
        )
        ref_note = f"\n### 参考観測枠（評価保留）サイト\n以下は品質スコアが低く評価保留。主比較テーブルには含めないこと。\n{ref_section}\n"

    return f"""あなたは広告代理店のシニアストラテジストです。
以下のサイトを比較し、クライアントにそのまま提出できる代理店品質の競合分析レポートを作成してください。

{discovery_context}
## 分析対象サイト（主比較対象）
{main_section}
{ref_note}

## 厳守ルール
- 「取得不可」を弱みの根拠にしてはならない
- 本文やメタ情報から補完した内容は `【推定】` と明記（`【本文推定】` は使わず `【推定】` に統一）
- LP種別が異なる場合は同一基準で無理に優劣をつけない。基準タグ `(獲得型EC基準)` `(ブランドサイト基準)` `(参考観測)` を付ける
- Hero Copy に `【注意】` タグがある場合は本文抜粋を優先し、必要なら `（データ制限）` と明記
- 抽象論は禁止。改善案は具体的なコピーと導線変更まで書く
- モバイル最適化はデスクトップHTMLからの推定ベースで評価する
- 【画像・バナー訴求の活用】画像alt、バナーテキスト、販促訴求フィールドに含まれる情報は、本文テキストと同等に評価に活用すること。これらが豊富にある場合、「データ不足」と判定してはならない
- 【お問い合わせ・見積り導線】contact_pathsに情報がある場合、CTA設計・CV導線の評価に反映すること
- 【法人・実績】corporate_elementsに情報がある場合、信頼構築の評価に反映すること
- 後半セクションを省略しないため、個別プロファイルと各根拠は簡潔に書く

## 不確実性ラベル（必須）
各所見・仮説には以下の3段階いずれかを付与すること:
- **【確認済み】**: 提示データから直接確認できる事実
- **【推定】**: データの一部から類推できるが、完全確認はできない内容。必ず根拠を添える
- **【評価保留】**: データが不足しており、判断を保留すべき項目
  - 「評価保留」の項目には数値スコアを付けない
  - 「評価保留」と「低評価」を絶対に混同しないこと
  - 品質スコアが「低信頼」のサイトは `参考観測枠` として扱い、主比較表に含めない

### 評価保留のルール:
- 以下がすべて欠落している項目は「評価保留」とし、**低スコア（1-3点）を付与してはならない**:
  - body text 十分量（200文字以上）
  - 主要CTA抽出
  - 価格/割引/納期の抽出
  - 信頼要素抽出
  - 画像alt/バナー見出し抽出
- 「評価保留」項目はスコアを「—」とし、コメントに「データ不足のため評価保留」と記載
- 本文中に該当情報の推定材料があれば【推定】として評価可

## 断定抑制ルール（必須）
- データ不足（取得率5/10未満 または 品質スコア「低信頼」）のサイトに対する断定を厳しく制限:
  - 「信頼性ゼロ」「離脱確実」「最強」「唯一」「圧勝」「確実に改善」等の過剰断定は禁止
  - 重い提言は高信頼条件（データ取得率7/10以上 かつ 明確な根拠2つ以上）を満たす場合のみ許可
  - データ不足サイトは `参考観測枠` として扱い、主比較から除外する

## サイト種別別ルーブリック

各サイトの種別を判定し、種別に応じた基準で評価:

| 種別 | 判定基準 | 主要CV | CTAの期待水準 |
|------|----------|--------|---------------|
| **正規代理店EC** | 正規代理店・認定店表記あり、商品販売導線あり | 購入・見積り | 商品探索→カート/見積り導線の完全性 |
| **専門店EC** | 特定ジャンルに特化、通販機能あり | 購入・問い合わせ | 割引・ランキング・送料訴求の強さ |
| **メーカー/ブランドサイト** | 自社製品ブランド展開、カタログ・技術情報 | カタログDL・問合せ・見積り | ブランド訴求→商品閲覧→問合せ導線 |
| **サポート/カタログ主導** | FAQ・マニュアル・仕様書が主体 | 情報提供・サポート窓口 | 情報アクセシビリティ・導線の明確さ |

## 比較対象の3区分（必須・Task A）
レポート冒頭で各サイトを以下の3区分のみで分類すること:
- **入力ブランド（control）**: ユーザーが指定した最初の1社（常に1社のみ）
- **実競合比較対象**: データが十分で主比較に含める競合サイト
- **参考観測枠**: データ不足で主比較から除外するサイト
入力ブランド数は常に1。残りの全URLは「実競合比較対象」または「参考観測枠」に振り分ける。
主比較表・主ランキングは「入力ブランド + 実競合比較対象」のみで構成すること。

{_SPORTS_SUPPLEMENT_TEMPLATE if is_sports_supplement else ""}
{_WATER_INDUSTRY_TEMPLATE if is_water_industry else ""}

## 見出し固定ルール（必須）
- 本文の大見出しは以下の5セクションに固定する。追加・省略・順序変更は禁止
- 各見出しは日本語で完結に書くこと。不完全な見出し（例: `説得アー`）は絶対に禁止
- `説得アーキテクチャ` という表現は本文の大見出しに使わない。使う場合はブランド別評価の内部に限定する
- `注記・前提条件` セクションは report_generator 側で自動挿入するため、本文には含めない

## 出力（5セクション固定）

### 1. エグゼクティブサマリー
- 今回の結論を3行で要約:
  - 検索意図別の勝ち筋（どのブランドがどの検索意図に強いか）
  - 獲得向き / 指名向き の判定
  - クライアント向け最優先1施策（直近7日でやるべきこと）
- いきなり細かいスコア表から始めない
- 根拠のない `CVR +20%` のような断定は禁止

### 2. 分析対象と比較前提
まず比較スコープを1文で明示（例: 「本レポートは〇〇を含むNサイト比較です。競合N社のうち主比較はA/B、Cは参考観測です。」）
テーブル: `| 区分 | ブランド | URL | サイト種別 | 役割 | データ品質 | 備考 |`
- 区分: `入力ブランド（control）` / `実競合比較対象` / `参考観測枠`
- サイト種別: `獲得型EC` / `ブランドサイト` / `商品ポータル` / `コーポレートサイト`
- 入力ブランド数: 1（固定） / 実競合比較対象数: N / 参考観測数: N / 比較対象総数: 1+N+N を必ず明記
- 同じ土俵で比較できるか、できない場合は何が違うかを明記

### 3. 競合比較サマリー
主比較テーブル（入力ブランド + 実競合比較対象のみ。参考観測枠は含めない）:
`| ブランド | サイト種別 | 獲得対応力 | 信頼訴求強度 | 購買導線整備度 | 強い訴求 | 弱い訴求 | 判定 |`
- 獲得対応力 / 信頼訴求強度 / 購買導線整備度 は `強 / 同等 / 弱` の3段階で評価（Task C）
- 判定: `非指名獲得向き` / `指名流入向き` / `比較検討向き`
- `参考観測枠` のサイトはこの表に含めない
- `評価保留` があるブランドには判定を出さず `—（評価保留）` と表記する
- 各競合の勝ち筋 / 負け筋を1行で明記
- **必須文言**: テーブル直後に「※今回比較したNサイト内での相対評価であり、市場全体の順位を示すものではありません」を付記

### 3-1. 市場概況（AI推定・参考値）
市場概況テーブルを出力（フォーマットは {_MARKET_CONTEXT_LAYER} の指示に従う）。

### 3-2. 競合広告投資推定（AI推定・参考値）
広告投資推定テーブルを出力（フォーマットは {_COMPETITIVE_INTELLIGENCE_LAYER} の指示に従う）。

### 3-3. 消費者インサイト（AI推定 + 抽出データ）
消費者インサイトを出力（フォーマットは {_CONSUMER_INSIGHTS_LAYER} の指示に従う）。

### 4. ブランド別評価
各ブランドを**短く・鋭く**記述。以下の構成に固定:
- **要約1文**: そのブランドの広告運用上の位置づけ
- **強み2点**: 広告で使える具体的な強み（箇条書き）
- **弱み2点**: 改善が必要な具体的な点（箇条書き）
- **評価テーブル**: `| 評価軸 | 判定 | 根拠 | 証拠強度 |`

評価軸: 検索意図一致 / FV訴求 / CTA明確性 / 信頼構築 / 価格・オファー / 購買導線
判定列: `強 / 同等 / 弱 / —（評価保留）` の4段階（Task C — 数値スコア・順位は使用禁止）
証拠強度: `確認済み` / `推定` / `評価保留`
- `評価保留` の軸にはスコアや優劣判定を付けない — `—（評価保留）`
- `認証 / 言及 / 実績 / UGC` の違いを信頼要素階層（L1-L5）で保ったまま記述
- 長い修辞は削る。根拠の列挙は最小限に

**⚠ Section 4 トークン配分ルール（必須）:**
- 1ブランドあたり **要約1文 + 強み2点 + 弱み2点 + 評価テーブル（6行）** を厳守。追加の長文解説は禁止
- Section 4 全体で **Section 5 よりも短く** なるよう調整すること
- Section 4 が膨張して Section 5 が切れるくらいなら、Section 4 の根拠説明を削ってでも Section 5 を完結させる
- **全ブランドの評価を必ず完了すること。途中で切断してはならない**

### 5. 実行プラン
以下の**3レイヤーに分離**して出力すること。LP改善と広告運用施策を同じ表に混ぜてはならない。
**Section 5 は絶対に途中で終わらせてはならない。token が不足する場合は Section 4 を圧縮してでも Section 5 を完結させること（Task E）。**

#### 5-1. LP改善施策
`| ブランド | 優先度 | 改善内容 | 推奨着地先 | 根拠フィールド | 証拠強度 |`
- 媒体列は不要（LP改修は媒体に依存しない）
- 推奨着地先は以下の3択で明示:
  - **ブランドTOP**: 指名流入の受け皿として
  - **商品カテゴリLP**: カテゴリ検索の着地先として
  - **専用獲得LP**: 非指名獲得の着地先として（非指名獲得は原則こちらを優先）
- 非指名獲得の着地先に「ブランドTOP（改修後）」を安易に指定しない。原則 `専用獲得LP` or `カテゴリLP`

#### 5-2. 検索広告施策（Task F: 運用粒度強化）
`| ブランド | 獲得タイプ | 優先度 | アクション | 推奨訴求 | 推奨着地先 | 主戦場クエリ | 除外クエリ例 | 初回KPI |`
- 獲得タイプは必ず以下の3分類で出力すること:
  - **指名防衛**: ブランド名を含むクエリ（例: `SAURUS プロテイン`）
  - **カテゴリ非指名**: ブランド名なしの一般カテゴリ語（例: `ランナー プロテイン`）
  - **比較検討**: おすすめ/比較/ランキング系（例: `マラソン サプリ おすすめ`）
- 各行に推奨クエリ例（3つ以上）、除外クエリ例（2つ以上）、着地先、主KPIをセットで出す
- 初回KPI: LP-CVR / CPA / Impression Share 等（検索広告のKPIテンプレートから選ぶ）
- **5-2 は絶対に未完で終わらせない。テーブルは最後の行まで閉じること**

#### 5-3. Meta / ディスプレイ施策
`| ブランド | 獲得タイプ | 優先度 | アクション | 推奨訴求 | 推奨着地先 | 初回KPI |`
- 獲得タイプ: 認知拡大 / リマーケ / 獲得
- 初回KPI: LPV / ViewContent率 / AddToCart率 等（Meta/ディスプレイのKPIテンプレートから選ぶ）
- token不足の場合、5-3は `（token制約により省略）` として5-2の完結を優先してよい

#### 施策数の上限ルール:
- **最優先3施策**を冒頭で明示（全レイヤー横断で最も重要な3件）
- 3レイヤー合計で**最大6件**まで。必要なら `補足施策（任意）` として追記可
- 優先度: S / A / B
- 期待効果は方向性またはレンジにとどめる（例: `CVR改善余地: 中`, `期待インパクト: 4-8週で評価`）
- 断定値は禁止。固定数値の改善率（例: `CVR+15%`）も禁止

#### 出力完結ルール（Task E 必須）:
- `最優先3施策` → `5-1. LP改善` → `5-2. 検索広告` の順で死守
- `5-2. 検索広告施策` は未完終了を絶対禁止。テーブルの最終行は `|` で閉じること
- token逼迫時は Section 4 を圧縮してでも Section 5 を完結させる

#### 5-4. KPIフレーム・測定計画
KPI測定計画テーブルを出力（フォーマットは {_KPI_FRAMEWORK_LAYER} の指示に従う）。
- token逼迫時は5-4より5-2の完結を優先してよい

## 編集ルール
- 見出しは日本語で完結に統一
- 句読点と表記を統一する
- `確認済み` / `推定` / `評価保留` の3ラベルを使い分ける
- `同列比較不可` の場合は明記する
- `説得アーキテクチャ` → 本文見出しでは使わない（ブランド別内部評価に吸収可）
- `注意` の単独大見出し → 使わない

{_EVIDENCE_TRACE_REQUIREMENTS}
{_COMPETITIVE_TIER_INSTRUCTIONS}
{_AD_OPERATIONS_LAYER}
{_MARKET_CONTEXT_LAYER}
{_COMPETITIVE_INTELLIGENCE_LAYER}
{_EVIDENCE_RIGOR_RULES}
{_CONSUMER_INSIGHTS_LAYER}
{_KPI_FRAMEWORK_LAYER}
{_CTA_EVALUATION_RULES}
{_KEYWORD_INTENT_TAXONOMY}
{_TRUST_ELEMENT_TAXONOMY}
{_MEDIA_KPI_LAYER}
{_EFFECT_RANGE_TEMPLATE}
{_INFERENCE_SUPPRESSION_RULES}
{_PRICING_UNKNOWN_RULES}
{_EVIDENCE_SEPARATION_RULES}
{_SEARCH_INTENT_SEGMENTATION_RULES if is_sports_supplement else ""}
{_IMPROVEMENT_PRIORITY_ORDER}
{_SPORTS_SUPPLEMENT_TEMPLATE if is_sports_supplement else ""}
{_build_reference_observation_section() if reference_sites else ""}

## 補足
- 冗長な説明は禁止。各根拠は1-2文、比較結論は短くまとめる
- コピー例は現状→提案の対比で書く
- 本文は簡潔に。詳細データはappendixに退避する前提で書く
- 類推表現の抑制: 「競合唯一の」「最強」「到達率低い」等の強断定は、比較対象数が限定的な場合に不適切。「今回比較した中では」「取得データ上は」等の限定句を付ける
"""


def build_wide_comparison_prompt(
    extracted_list: list[ExtractedData],
    *,
    discovery_metadata: dict | None = None,
) -> str:
    """Build a compact comparison prompt for 4+ sites."""
    # Separate main vs reference-observation sites
    main_sites = []
    reference_sites = []
    for d in extracted_list:
        if getattr(d, '_is_low_quality', False):
            reference_sites.append(d)
        else:
            main_sites.append(d)

    main_section = "\n".join(_format_site_data(d, compact=True) for d in main_sites)
    ref_section = "\n".join(_format_site_data(d, compact=True) for d in reference_sites) if reference_sites else ""

    discovery_context = _build_discovery_context_section(discovery_metadata)
    industry = (discovery_metadata or {}).get("industry", "")
    is_sports_supplement = any(
        kw in industry
        for kw in ("サプリ", "プロテイン", "健康食品", "アミノ酸", "BCAA", "supplement", "protein")
    ) if industry else False
    is_water_industry = any(
        kw in industry for kw in _WATER_INDUSTRY_KEYWORDS
    ) if industry else False

    ref_note = ""
    if reference_sites:
        ref_note = f"\n### 参考観測枠（評価保留）サイト\n以下は品質スコアが低く評価保留。主比較テーブルには含めないこと。\n{ref_section}\n"

    return f"""あなたは広告代理店のシニアストラテジストです。
4サイト以上の比較なので、出力は**高シグナル優先**で簡潔にまとめてください。

{discovery_context}
## 分析対象サイト（主比較対象）
{main_section}
{ref_note}

## 厳守ルール
- 「取得不可」を弱みの根拠にしてはならない
- 本文やメタ情報から補完した内容は `【推定】` と明記
- 画像alt・バナー・販促訴求・お問い合わせ導線を本文と同等に評価する
- 抽象論は禁止。改善案は具体的なコピーと導線変更まで書く
- モバイル最適化はデスクトップHTMLからの推定ベースで評価する
- 4サイト以上比較では、説得アーキテクチャ・ファネル分析は独立表にせず、要点を根拠へ織り込む
- 冗長な説明は禁止。1ブランドあたり最大6行、表セルは短く書く

## 不確実性ラベル（必須）
各所見・仮説には以下の3段階いずれかを付与すること:
- **【確認済み】**: 提示データから直接確認できる事実
- **【推定】**: データの一部から類推できるが、完全確認はできない内容
- **【評価保留】**: データが不足しており、判断を保留すべき項目
  - 「評価保留」の項目には数値スコアを付けない
  - 「評価保留」と「低評価」を絶対に混同しないこと
  - 品質スコアが「低信頼」のサイトは `参考観測枠` として扱い、主比較表に含めない

## 断定抑制ルール（必須）
- データ不足サイトに対する断定を厳しく制限:
  - 「信頼性ゼロ」「離脱確実」「最強」「唯一」「圧勝」「確実に改善」等の過剰断定は禁止
  - 重い提言は高信頼条件を満たす場合のみ許可
  - データ不足サイトは `参考観測枠` として扱い、主比較から除外する

## サイト種別別ルーブリック
- 正規代理店EC: 購入 / 見積り導線、正規品保証、比較検討不安の解消を重視
- 専門店EC: 割引、送料、納期、ランキング、問い合わせ導線を重視
- メーカー / ブランド: 商品探索、FAQ、カタログ、施工・品番確認導線を重視
- サポート主導: 情報アクセシビリティ、問い合わせ、資料導線を重視

## 比較対象の3区分（必須・Task A）
レポート冒頭で各サイトを以下の3区分のみで分類すること:
- **入力ブランド（control）**: ユーザーが指定した最初の1社（常に1社のみ）
- **実競合比較対象**: データが十分で主比較に含める競合サイト
- **参考観測枠**: データ不足で主比較から除外するサイト
入力ブランド数は常に1。残りの全URLは「実競合比較対象」または「参考観測枠」に振り分ける。
主比較表・主ランキングは「入力ブランド + 実競合比較対象」のみで構成すること。

{_WATER_INDUSTRY_TEMPLATE_COMPACT if is_water_industry else ""}

## 見出し固定ルール（必須）
- 本文の大見出しは以下の5セクションに固定する。追加・省略・順序変更は禁止
- 各見出しは日本語で完結に書くこと。不完全な見出し（例: `説得アー`）は絶対に禁止
- `説得アーキテクチャ` という表現は本文の大見出しに使わない
- `注記・前提条件` セクションは report_generator 側で自動挿入するため、本文には含めない

## 出力（5セクション固定）

### 1. エグゼクティブサマリー
- 今回の結論を3行で要約:
  - 検索意図別の勝ち筋（どのブランドがどの検索意図に強いか）
  - 獲得向き / 指名向き の判定
  - クライアント向け最優先1施策
- いきなり細かいスコア表から始めない
- 根拠のない断定は禁止

### 2. 分析対象と比較前提
まず比較スコープを1文で明示（例: 「本レポートは〇〇を含むNサイト比較です。競合N社のうち主比較はA/B、Cは参考観測です。」）
テーブル: `| 区分 | ブランド | URL | サイト種別 | 役割 | データ品質 | 備考 |`
- 区分: `入力ブランド（control）` / `実競合比較対象` / `参考観測枠`
- 入力ブランド数: 1（固定） / 実競合比較対象数: N / 参考観測数: N / 比較対象総数: 1+N+N を必ず明記
- 参考観測枠サイトがある場合: `| ブランド | 保留理由 | 現時点で言えること |`

### 3. 競合比較サマリー
主比較テーブル（入力ブランド + 実競合比較対象のみ。参考観測枠は含めない）:
`| ブランド | サイト種別 | 獲得対応力 | 信頼訴求強度 | 購買導線整備度 | 強い訴求 | 弱い訴求 | 判定 |`
- 獲得対応力 / 信頼訴求強度 / 購買導線整備度 は `強 / 同等 / 弱` の3段階で評価（Task C）
- 判定: `非指名獲得向き` / `指名流入向き` / `比較検討向き`
- `参考観測枠` のサイトはこの表に含めない
- `評価保留` があるブランドには `—（評価保留）` と表記
- 各競合の勝ち筋 / 負け筋を1行で明記
- **必須文言**: テーブル直後に「※今回比較したNサイト内での相対評価であり、市場全体の順位を示すものではありません」を付記

### 3-1. 市場概況（AI推定・参考値）
市場概況テーブルを出力（フォーマットは {_MARKET_CONTEXT_LAYER} の指示に従う）。

### 3-2. 競合広告投資推定（AI推定・参考値）
広告投資推定テーブルを出力（フォーマットは {_COMPETITIVE_INTELLIGENCE_LAYER} の指示に従う）。

### 3-3. 消費者インサイト（AI推定 + 抽出データ）
消費者インサイトを出力（フォーマットは {_CONSUMER_INSIGHTS_LAYER} の指示に従う）。

### 4. ブランド別評価
各ブランドを**短く・鋭く**記述。以下の構成に固定:
- **要約1文**: そのブランドの広告運用上の位置づけ
- **強み2点**: 箇条書き
- **弱み2点**: 箇条書き
- **評価テーブル**: `| 評価軸 | 判定 | 根拠 | 証拠強度 |`
  評価軸: 検索意図一致 / FV訴求 / CTA明確性 / 信頼構築 / 価格・オファー / 購買導線
  判定列: `強 / 同等 / 弱 / —（評価保留）` の4段階（Task C — 数値スコア・順位は使用禁止）
  証拠強度: `確認済み` / `推定` / `評価保留`
- `評価保留` の軸には判定を付けない — `—（評価保留）`
- `認証 / 言及 / 実績 / UGC` の違いを信頼要素階層（L1-L5）で保ったまま記述
- 長い修辞は削る。根拠の列挙は最小限に

**⚠ Section 4 トークン配分ルール（必須）:**
- 1ブランドあたり要約1文+強み2点+弱み2点+評価テーブル6行を厳守。追加解説禁止
- Section 4 全体で Section 5 より短くすること
- **全ブランドの評価を必ず完了すること。途中で切断してはならない**

### 5. 実行プラン
以下の**3レイヤーに分離**して出力。
**Section 5 は絶対に途中で終わらせない。token不足時は Section 4 を圧縮して Section 5 を完結させること（Task E）。**

#### 5-1. LP改善施策
`| ブランド | 優先度 | 改善内容 | 推奨着地先 | 根拠フィールド | 証拠強度 |`
- 推奨着地先: ブランドTOP / 商品カテゴリLP / 専用獲得LP（非指名獲得は原則 専用獲得LP or カテゴリLP）

#### 5-2. 検索広告施策（Task F: 運用粒度強化）
`| ブランド | 獲得タイプ | 優先度 | アクション | 推奨訴求 | 推奨着地先 | 主戦場クエリ | 除外クエリ例 | 初回KPI |`
- 獲得タイプは必ず3分類: **指名防衛** / **カテゴリ非指名** / **比較検討**
- 各行に推奨クエリ例（3つ以上）、除外クエリ例（2つ以上）、着地先、主KPIをセットで出す
- **5-2 は絶対に未完で終わらせない。テーブルは最後の行まで閉じること**

#### 5-3. Meta / ディスプレイ施策
`| ブランド | 獲得タイプ | 優先度 | アクション | 推奨訴求 | 推奨着地先 | 初回KPI |`
- token不足の場合、5-3は `（token制約により省略）` として5-2の完結を優先してよい

#### 施策数の上限:
- **最優先3施策**を冒頭で明示（全レイヤー横断）
- 3レイヤー合計で**最大6件**まで
- 期待効果は方向性またはレンジにとどめる

#### 出力完結ルール（Task E 必須）:
- `最優先3施策` → `5-1. LP改善` → `5-2. 検索広告` の順で死守
- `5-2. 検索広告施策` は未完終了を絶対禁止
- token逼迫時は Section 4 を圧縮してでも Section 5 を完結させる

#### 5-4. KPIフレーム・測定計画
KPI測定計画テーブルを出力（フォーマットは {_KPI_FRAMEWORK_LAYER} の指示に従う）。
- token逼迫時は5-4より5-2の完結を優先してよい

## 編集ルール
- 見出しは日本語で完結に統一
- `確認済み` / `推定` / `評価保留` の3ラベルを使い分ける
- `同列比較不可` の場合は明記する

{_EVIDENCE_TRACE_REQUIREMENTS}
{_COMPETITIVE_TIER_INSTRUCTIONS}
{_AD_OPERATIONS_LAYER}
{_MARKET_CONTEXT_LAYER}
{_COMPETITIVE_INTELLIGENCE_LAYER}
{_EVIDENCE_RIGOR_RULES}
{_CONSUMER_INSIGHTS_LAYER}
{_KPI_FRAMEWORK_LAYER}
{_CTA_EVALUATION_RULES}
{_KEYWORD_INTENT_TAXONOMY}
{_TRUST_ELEMENT_TAXONOMY}
{_MEDIA_KPI_LAYER}
{_EFFECT_RANGE_TEMPLATE}
{_INFERENCE_SUPPRESSION_RULES}
{_PRICING_UNKNOWN_RULES}
{_EVIDENCE_SEPARATION_RULES}
{_SEARCH_INTENT_SEGMENTATION_RULES if is_sports_supplement else ""}
{_IMPROVEMENT_PRIORITY_ORDER}
{_SPORTS_SUPPLEMENT_TEMPLATE if is_sports_supplement else ""}
{_build_reference_observation_section() if reference_sites else ""}

## 補足
- 全体でおおむね2200字以内
- 抽象論は禁止。広告文や見出しに転用できる表現を優先
- 4サイト以上比較では、完走と実行可能性を優先する
- 類推表現の抑制: 「競合唯一の」「最強」「到達率低い」等の強断定は、比較対象数が限定的な場合に不適切。「今回比較した中では」「取得データ上は」等の限定句を付ける
"""


def _load_screenshot(path: str | None) -> bytes | None:
    """Load screenshot bytes from path, or return None."""
    if not path:
        return None
    p = Path(path)
    if p.is_file():
        return p.read_bytes()
    return None


def _comparison_output_token_budget(site_count: int, *, compact: bool = False) -> int:
    """Scale comparison output budget to avoid truncating later sections."""
    if compact:
        # Compact mode: cap tokens to accelerate LLM response (40% reduction)
        return 3072 if site_count >= 3 else 2560
    if site_count >= 3:
        return _MULTI_URL_MAX_OUTPUT_TOKENS_4PLUS_SITES
    return _MULTI_URL_MAX_OUTPUT_TOKENS


async def analyze(
    extracted_list: list[ExtractedData],
    model: str | None = None,
    provider: str | None = None,
    api_key: str | None = None,
    *,
    discovery_metadata: dict | None = None,
    compact_output: bool = False,
) -> tuple[str, TokenUsage]:
    if len(extracted_list) == 1:
        prompt = build_competitive_lp_prompt(extracted_list[0])
    elif len(extracted_list) >= 3:
        prompt = build_wide_comparison_prompt(extracted_list, discovery_metadata=discovery_metadata)
    else:
        prompt = build_deep_comparison_prompt(extracted_list, discovery_metadata=discovery_metadata)

    if compact_output and len(extracted_list) > 1:
        prompt += """

## 品質復旧モード（最優先）
- これは通常出力が長すぎて品質基準未達になった場合の再生成です
- 大見出し5セクションは維持したまま、本文を強く圧縮してください
- ブランド別評価は各ブランドにつき「要約1文 + 強み2点 + 弱み2点 + 評価テーブル」に限定
- 広告運用アクションは最優先3件まで
- 表セルは短く、重複説明は禁止
- Appendix 前提なので、生データの長い引用は禁止
- テーブルを途中で切らないことを最優先してください
"""

    # Prompt size log for token pressure monitoring
    has_screenshot = (
        len(extracted_list) == 1
        and bool(extracted_list[0].screenshot_path)
    )
    logger.info(
        "prompt_size prompt_type=%s site_count=%d prompt_chars=%d has_screenshot=%s",
        "lp" if len(extracted_list) == 1 else "comparison",
        len(extracted_list), len(prompt), has_screenshot,
    )

    # 1URL + スクリーンショットあり → マルチモーダル
    if len(extracted_list) == 1:
        screenshot = _load_screenshot(extracted_list[0].screenshot_path)
        if screenshot:
            try:
                return await _call_multimodal_model(
                    prompt, image_data=screenshot,
                    provider=provider,
                    model=model, api_key=api_key,
                )
            except Exception:
                logger.warning(
                    "Multimodal analysis failed, falling back to text-only",
                    exc_info=True,
                )
    token_budget = (
        _SINGLE_URL_MAX_OUTPUT_TOKENS
        if len(extracted_list) == 1
        else _comparison_output_token_budget(len(extracted_list), compact=compact_output)
    )
    return await _call_text_model(prompt, provider=provider, model=model, api_key=api_key, max_output_tokens=token_budget)
