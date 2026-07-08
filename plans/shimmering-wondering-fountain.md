# Compare/Scan 分析レポート品質改善プラン

## Context

本番環境の Compare 分析レポート（hits-online.jp vs cera.co.jp）を広告運用プロフェッショナルの視点でレビューした結果、以下の品質問題を確認:

1. **Completion Tokens = 4096（max到達）でレポートが途中で切れている** — アクション提案 #3 が途中で切断
2. **Hero Copy が "ようこそ ゲスト 様"**（ログインシステム出力）— マーケティングコピーではない
3. **Main CTA が "取得不可"** — ECサイトに明らかにCTAがあるのに抽出できていない
4. **分析の深さが CRO コンサルタントレベルに達していない** — スコアリング基準不明確、モバイル評価なし、価格戦略分析なし
5. **ステータスが "running" のまま** — "completed" に更新される前にレポートが生成されている

**既存テストが 13個 fail しており、改善のターゲット状態を正確に定義している。**

## 変更対象ファイル（market-lens-ai リポ）

| ファイル | 変更内容 |
|---------|---------|
| `web/app/analyzer.py` | トークン予算増加 + プロンプト強化 + データ切り詰め緩和 |
| `web/app/extractor.py` | Hero Copy/CTA/Pricing 抽出ロジック改善 |
| `web/app/services/scan_service.py` | ステータス更新順序修正（1行） |

---

## Phase 1: トークン予算 + データ切り詰め修正（CRITICAL）

**問題**: Completion Tokens が 4096 の上限に到達し、レポートが物理的に切断されている。

### 1a. トークン予算の増加

**ファイル**: `web/app/analyzer.py` line 210

```python
# Before
token_budget = 3072 if len(extracted_list) == 1 else 4096

# After
token_budget = 5120 if len(extracted_list) == 1 else 12288
```

**コスト影響**: Multi-URL で最大 +$0.12/回（Sonnet $15/M output tokens）。切断されて使い物にならないレポートを出すよりはるかに合理的。

**レイテンシ影響**: 出力トークン増でanalyze時間が伸びるが、現在 ~77s → ~90-100s 程度の見込み。120s analyze timeout 以内。

### 1b. 入力データ切り詰め緩和

**ファイル**: `web/app/analyzer.py` `_format_site_data()` lines 16-24

| フィールド | Before | After |
|-----------|--------|-------|
| `feature_bullets` | `[:3]` | `[:5]` |
| `body_text_snippet` | `[:400]` | `[:800]` |
| `faq_items` | `[:2]` | `[:3]` |
| `testimonials` | `[:1]` | `[:2]` |

**検証**: 7 個のテストが PASS に変わる
```
TestFormatSiteDataTruncation::test_body_text_snippet_truncated_to_800
TestFormatSiteDataTruncation::test_feature_bullets_limited_to_5
TestFormatSiteDataTruncation::test_faq_items_limited_to_3
TestFormatSiteDataTruncation::test_testimonials_limited_to_2
TestAnalyzeBranching::test_multi_url_passes_12288_max_tokens
TestAnalyzeBranching::test_single_url_passes_5120_max_tokens
(+ test_secondary_ctas_limited_to_3 は既にPASS)
```

---

## Phase 2: 比較プロンプト強化（HIGH）

**問題**: プロンプトにモバイル評価、価格戦略分析、スコアキャリブレーション指示が欠けている。

**ファイル**: `web/app/analyzer.py` `build_deep_comparison_prompt()` lines 111-160

### 2a. ロール説明にコンバージョン設計分析を追加（line 114）

```python
# Before
あなたは広告LP最適化と競合分析の実務経験を持つCROコンサルタントです。

# After  
あなたは広告LP最適化とコンバージョン設計分析の実務経験を持つCROコンサルタントです。
```

### 2b. 取得不可ルールの文言修正（line 121）

```python
# Before
- 「取得不可」はHTML抽出の技術的制限であり、弱みの根拠にしない。本文推定可能なら【本文推定】ラベル付きで言及

# After
- 「取得不可」はHTML抽出の技術的制限であり、「取得不可」を弱みの根拠にしてはならない。本文推定可能なら【本文推定】ラベル付きで言及
```

### 2c. 評価軸にモバイル最適化 + 価格戦略を追加（line 143）

```python
# Before
  FV訴求力 / CTA設計 / ベネフィット訴求 / 信頼要素 / 情報設計

# After
  FV訴求力 / CTA設計 / ベネフィット訴求 / 信頼要素 / 情報設計 / モバイル最適化（推定ベース） / 価格戦略（定期購入・初回割引・送料等）
```

### 2d. 比較テーブル観点に価格戦略追加（line 148）

```python
# Before
FV訴求 / CTA戦略 / 信頼構築手法 / 価格提示 / CV導線設計

# After
FV訴求 / CTA戦略 / 信頼構築手法 / 価格提示 / CV導線設計 / 価格戦略（定期購入・送料・初回割引）
```

### 2e. LP評価基準にスコアキャリブレーション追加（line 127-128 の後）

既存:
```
## LP評価基準
A: 業界トップ水準のCRO施策 / B: 基本要素あり改善余地 / C: 大きな欠落 / D: 要全面改修
※ コーポレートサイト/商品ポータルはB以下が妥当
```

追加:
```
## LP評価の基準
A: 業界トップ水準のCRO施策 / B: 基本要素あり改善余地 / C: 大きな欠落 / D: 要全面改修
※ コーポレートサイト/商品ポータルはB以下が妥当
- LP種別が異なるサイト間ではスコアの直接比較不可。各スコアに基準タグを付与（例: (D2C基準), (EC基準), (コーポレート基準)）
- モバイル最適化スコアはデスクトップHTMLからの推定ベースであることを明記
```

**検証**: 6 個のテストが PASS に変わる
```
TestBuildDeepComparisonPrompt::test_contains_comparison_table_header
TestBuildDeepComparisonPrompt::test_deep_comparison_has_partial_data_rules
TestBuildDeepComparisonPrompt::test_deep_comparison_has_mobile_evaluation
TestBuildDeepComparisonPrompt::test_deep_comparison_has_pricing_analysis
TestBuildDeepComparisonPrompt::test_deep_comparison_has_scoring_calibration
TestBuildDeepComparisonPrompt::test_deep_comparison_has_score_basis_tags
TestBuildDeepComparisonPrompt::test_deep_comparison_has_mobile_estimation_note
```

---

## Phase 3: データ抽出改善（HIGH）

**問題**: Hero Copy にログイン文言が混入、CTA が Japanese EC パターンを検出できない。

**ファイル**: `web/app/extractor.py`

### 3a. Hero Copy 抽出改善（lines 66-85）

改善点:
1. `p` タグだけでなく `h2`, `h3`, `span`, `div` も検索対象に追加
2. ゴミフィルター追加: "ようこそ", "ゲスト", "ログイン", "カート", "cookie", "検索" 等
3. 最低文字数フィルター（8文字以上）

```python
import re

_HERO_GARBAGE = re.compile(
    r"ようこそ|ゲスト|ログイン|ログアウト|カート|cookie|"
    r"toggle|menu|search|検索|閉じる|開く|マイページ",
    re.IGNORECASE,
)

_HERO_CONTAINERS = [
    "[class*='hero']", "[class*='Hero']", "[id*='hero']",
    "[class*='mv']", "[class*='mainvisual']", "[class*='kv']",
    "[class^='visual']", "[class*='-visual']", "[class*='_visual']",
    "[class*='banner']", "[class*='intro']", "[role='banner']",
    "header", "main > section:first-child", "section:first-of-type",
]

_HERO_TEXT_TAGS = ["h2", "h3", "p", "span", "div"]

def _extract_hero_copy(soup):
    for container_sel in _HERO_CONTAINERS:
        for tag_name in _HERO_TEXT_TAGS:
            sel = f"{container_sel} {tag_name}"
            for tag in soup.select(sel):
                text = tag.get_text(strip=True)
                if text and len(text) >= 8 and not _HERO_GARBAGE.search(text):
                    return text
    return ""
```

### 3b. Main CTA 抽出改善（lines 88-107）

改善点:
1. href ベースのセレクター追加（cart, contact, inquiry, toiawase 等）
2. キーワードベースのフォールバック追加

```python
_CTA_KEYWORDS = [
    "カートに入れる", "今すぐ購入", "お問い合わせ", "資料請求",
    "無料で始める", "申し込む", "見積もり", "予約する", "お客様窓口",
    "Add to Cart", "Buy Now", "Get Started", "Contact Us",
]

def _extract_main_cta(soup):
    # Phase 1: 既存 CSS セレクター（拡張版）
    for selector in [
        # ... 既存セレクター ...
        "a[href*='cart']", "a[href*='basket']",
        "a[href*='contact']", "a[href*='inquiry']", "a[href*='toiawase']",
        "a[href*='order']", "a[href*='request']",
    ]:
        tag = soup.select_one(selector)
        if tag and tag.get_text(strip=True):
            return tag.get_text(strip=True)
    
    # Phase 2: キーワードベースフォールバック
    for el in soup.find_all(["a", "button"], limit=100):
        text = el.get_text(strip=True)
        if any(kw in text for kw in _CTA_KEYWORDS):
            return text
    return ""
```

### 3c. Pricing 抽出改善（lines 110-121）

改善点:
1. `price`, `kakaku`, `nedan`, `plan` セレクター追加
2. 正規表現ベースの価格検出（¥, 円, 税込 等）フォールバック

```python
_PRICE_PATTERN = re.compile(
    r'(?:¥|￥)\s*[\d,]+|[\d,]+\s*円|税込[\d,]+|'
    r'\$[\d,.]+|[\d,]+\s*/\s*(?:月|年|month)',
    re.IGNORECASE,
)
```

### 3d. 新規テスト追加（`tests/test_extractor.py`）

- `TestHeroCopyGarbageFiltering` — ログイン文言除外、マーケティングコピー優先
- `TestMainCtaJapaneseEC` — cart/inquiry リンク検出
- `TestPricingJapaneseFormats` — 円建て価格検出

---

## Phase 4: ステータス表示修正（LOW）

**問題**: レポートメタデータに `status: running` と表示される。

**ファイル**: `web/app/services/scan_service.py` lines 109-111

```python
# Before (line 109-111)
result.total_time_sec = round(time.time() - start, 1)
result.report_md = generate_report(result, analysis_md)    # ← statusがまだ "running"
result.status = "error" if llm_failed else "completed"

# After
result.total_time_sec = round(time.time() - start, 1)
result.status = "error" if llm_failed else "completed"      # ← 先にstatus更新
result.report_md = generate_report(result, analysis_md)
```

---

## 実装順序

```
Phase 1 (トークン予算) → Phase 2 (プロンプト) → Phase 3 (抽出) → Phase 4 (ステータス)
```

- Phase 1 が最優先: トークン上限のせいでプロンプト改善しても効果が出ない
- Phase 2 は Phase 1 と同時実装可能（同じファイル）
- Phase 3 は独立して実装可能
- Phase 4 は独立・1行変更のみ

## 検証手順

### 1. ユニットテスト
```bash
cd "c:/Users/PEM N-266/work/market-lens-ai"
.venv/Scripts/python.exe -m pytest tests/test_analyzer.py -v
# → 13 failing tests が全て PASS に変わること
```

### 2. ローカル E2E テスト（Chrome DevTools ゲストモード）
1. バックエンド起動（port 8002）
2. フロントエンド起動（port 3002, vite proxy → localhost:8002）
3. Compare で hits-online.jp + cera.co.jp を実行
4. 確認項目:
   - レポートが途中で切れていないこと
   - アクション提案が3つ全て表示されること
   - Hero Copy に "ようこそ ゲスト 様" が含まれないこと
   - モバイル最適化スコアが含まれること
   - 価格戦略分析が含まれること
   - ステータスが "completed" と表示されること
5. バックエンドログで `model=claude-sonnet-4-6` を確認

### 3. コミット & デプロイ
```bash
cd "c:/Users/PEM N-266/work/market-lens-ai"
git add web/app/analyzer.py web/app/extractor.py web/app/services/scan_service.py
git commit -m "fix: Compare analysis quality — token budget + prompt + extraction + status"
git push origin main
```
