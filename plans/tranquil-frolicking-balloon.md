# Discovery Hub 分析品質 総合改善プラン

## Context

Discovery Hub の出力レポートを広告運用プロフェッショナルがレビューした結果、以下の重大な問題が判明:

1. **競合が少なすぎる** — `MAX_COMPETITORS=2`（ブランド含め3サイト）。SAURUSの分析でWINZONE/DNS/SAVASなど直接競合が全て欠落
2. **出力が途中で切れる** — `max_output_tokens=3072` でセクション4「コンバージョン設計分析」・セクション5「アクション提案」が丸ごと消失
3. **検索クエリが貧弱** — 2-3個の汎用クエリでニッチD2Cの直接競合を見つけられない
4. **LP種別の区別なし** — コーポレートサイト（アミノバイタル）に広告LP基準でA評価を付けてしまう
5. **分析視点の不足** — モバイルLP評価、価格/定期購入戦略、スコアリング基準が欠如

目標: 競合4-5社を正しく発見し、LP種別を踏まえた精密なスコアリングと具体的アクション提案を全セクション出力すること。

---

## 変更一覧（5ワークストリーム）

### WS-A: 競合数拡大（discovery_pipeline.py + anthropic_search_client.py）

#### A1. MAX_COMPETITORS 2→4
- **File**: `market-lens-ai/web/app/services/discovery/discovery_pipeline.py:420`
- `MAX_COMPETITORS = 2` → `MAX_COMPETITORS = 4`
- ブランド + 4競合 = 5サイト分析

#### A2. 検索候補プール 7→12
- **File**: `discovery_pipeline.py:384`
- `num=7` → `num=12`

#### A3. 検索クライアントのnum上限 10→12
- **File**: `market-lens-ai/web/app/services/discovery/anthropic_search_client.py:181`
- `num = min(num, 10)` → `num = min(num, 12)`

#### A4. 並列フェッチSemaphore 3→5
- **File**: `discovery_pipeline.py:428`
- `asyncio.Semaphore(3)` → `asyncio.Semaphore(5)`
- 4競合 + backfill余裕

#### A5. タイムアウト調整
出力トークン増（5120）× 5サイト = 分析時間が伸びる。タイムバジェット:

| 設定 | 現在値 | 新値 | ファイル:行 |
|------|-------|------|-----------|
| `DISCOVERY_ANALYZE_TIMEOUT_SEC` (pipeline) | 90s | 120s | `discovery_pipeline.py:229` |
| `_analyze_timeout` (routes) | 150s | 180s | `discovery_routes.py:233` |
| `_overall_job_timeout` (routes) | 150s | 210s | `discovery_routes.py:263` |

フロントエンド `POLL_MAX_DURATION_MS` は現在180秒（3分）→ 変更なし（210s以内にパイプライン完了想定。stale detection 30sで検出）。ただし安全マージンとして **240秒（4分）** に変更。

- **File**: `insight-studio/src/pages/Discovery.jsx:13`
- `POLL_MAX_DURATION_MS = 180_000` → `POLL_MAX_DURATION_MS = 240_000`

---

### WS-B: 検索クエリ品質改善（keyword_extractor.py）

#### B1. D2C/商品カテゴリ向けクエリパターン追加
- **File**: `market-lens-ai/web/app/services/discovery/keyword_extractor.py:71-102`
- `_content_aware_queries()` を拡張:

**現在（最大3クエリ）:**
1. `{industry} 競合サイト 比較`
2. `{keywords} competitors`
3. `{brand_name} competitors`

**改修後（最大5クエリ）:**
1. `{industry} 競合サイト 比較` （既存）
2. `{industry} おすすめ ランキング` （**新規**: 日本語ランキング記事がD2C競合を網羅）
3. `{keywords} competitors` （既存）
4. `{keywords} 比較 口コミ` （**新規**: 日本語比較レビューから直接競合を発見）
5. `{brand_name} competitors` （既存フォールバック）

- Line 102: `unique[:3]` → `unique[:5]`

---

### WS-C: 分析プロンプト強化 + トークン増（analyzer.py）

#### C1. max_output_tokens 3072→5120
- **File**: `market-lens-ai/web/app/analyzer.py:216`
- `max_output_tokens=3072` → `max_output_tokens=5120`
- 5サイト × 全5セクション + テーブル = ~4500トークン必要
- Claude Sonnet 4.6は200kまで対応、コスト影響は軽微

#### C2. build_deep_comparison_prompt() プロンプト改修
- **File**: `analyzer.py:111-166`

**追加項目:**

**(a) 「重要な注意事項」セクションに追加:**
```
- 各サイトのLP種別を識別すること（広告LP / コーポレートサイト / ECサイト / 商品ポータル）
- コーポレートサイトや商品ポータルは広告LPとは異なるCRO基準で評価すること
- コーポレートサイトにLP最適化基準で高評価を付けないこと（性質が異なるため）
```

**(b) 「LP評価の基準」新セクション追加:**
```
## LP評価の基準
- A: 広告LP専用設計で業界トップ水準のCRO施策
- B: 基本的なLP要素は揃っているが改善余地あり
- C: LP要素に大きな欠落、改善が急務
- D: LPとしての基本設計ができておらず全面改修が必要
- コーポレートサイト/商品ポータルはLP基準ではB以下が妥当
```

**(c) 「総合サマリー」テーブルにLP種別カラム追加:**
```
| ブランド名 | LP種別 | LP評価 | ポジション | 一言要約 | 最優先改善 |
```

**(d) 「個別プロファイリング」に3項目追加:**
```
- **LP種別**: 広告LP / コーポレートサイト / ECサイト / 商品ポータル（判定根拠つき）
- **価格戦略**: 初回価格 / 定期購入割引 / 送料 / 返金保証の有無【本文推定】
- **モバイル最適化仮説**: スマホUI/UX要素の有無を推定
```

**(e) LP効果スコアに「モバイル最適化」軸追加:**
```
FV訴求力 / CTA設計 / ベネフィット訴求 / 信頼要素 / 情報設計 / モバイル最適化
```

**(f) 「競合比較テーブル」に「価格・定期購入モデル」行追加:**
```
FV訴求 / CTA戦略 / 信頼構築手法 / 価格提示 / CV導線設計 / 価格・定期購入モデル
```

---

### WS-D: 候補ランキング改善（candidate_ranker.py）

#### D1. ドメイン重複排除
- **File**: `market-lens-ai/web/app/services/discovery/candidate_ranker.py`
- `rank_candidates()` 末尾（line 101後）にドメインレベルの重複排除を追加
- 同一ドメインから複数ページがヒットした場合、最高スコアのURLのみ残す

```python
# Deduplicate by domain — keep highest-scoring URL per domain
seen_domains: set[str] = set()
deduped: list[RankedCandidate] = []
for c in candidates:
    d = c.domain.lower()
    if d not in seen_domains:
        seen_domains.add(d)
        deduped.append(c)
return deduped
```

#### D2. マーケットプレイス/メディアサイトのペナルティ
- スコアリングに非競合ドメインへのペナルティ追加（line 89付近）

```python
_NON_COMPETITOR_DOMAINS = {
    "amazon.co.jp", "amazon.com", "rakuten.co.jp", "yahoo.co.jp",
    "kakaku.com", "cosme.net", "mybest.com", "wikipedia.org",
    "youtube.com", "twitter.com", "instagram.com", "facebook.com",
    "note.com", "ameblo.jp", "lohaco.yahoo.co.jp",
}
if domain.lower() in _NON_COMPETITOR_DOMAINS:
    score -= 30
```

#### D3. D2C/公式サイト信号ボーナス
- 公式サイト・通販サイトらしき結果にスコアボーナス

```python
_LP_SIGNAL_KEYWORDS = [
    "公式", "official", "通販", "ショップ", "shop", "store",
    "定期", "初回", "お試し", "送料無料",
]
text_lower = f"{result.title} {result.snippet}".lower()
if any(kw in text_lower for kw in _LP_SIGNAL_KEYWORDS):
    score += 10
```

---

### WS-E: テスト更新

#### E1. test_analyzer.py 更新
- **File**: `market-lens-ai/tests/test_analyzer.py`
- 新プロンプト内容に合わせたアサーション更新
- 新規テスト追加:
  - `test_contains_lp_type_classification` — LP種別がプロンプトに含まれる
  - `test_contains_mobile_evaluation` — モバイル最適化が含まれる
  - `test_contains_pricing_analysis` — 価格戦略・定期購入が含まれる
  - `test_contains_scoring_calibration` — スコアリング基準が含まれる
  - `test_multi_url_passes_5120_max_tokens` — max_output_tokens=5120の確認

#### E2. test_candidate_ranker.py 新規作成
- **File**: `market-lens-ai/tests/test_candidate_ranker.py`（新規）
- テスト:
  - `test_domain_deduplication` — 同一ドメインが1つに統合される
  - `test_marketplace_domain_penalty` — Amazon等が下位になる
  - `test_lp_keyword_bonus` — 公式サイト信号でスコアアップ
  - `test_brand_domain_excluded` — ブランド自身のドメインが除外される

#### E3. test_keyword_extractor.py 新規作成
- **File**: `market-lens-ai/tests/test_keyword_extractor.py`（新規）
- テスト:
  - `test_generates_ranking_query` — 「おすすめ ランキング」パターン
  - `test_generates_review_query` — 「比較 口コミ」パターン
  - `test_max_5_queries` — 最大5クエリ上限
  - `test_deduplication` — 重複排除

---

## tmp_market_lens_ai_repo 同期

`market-lens-ai` リポへの変更を `insight-studio/tmp_market_lens_ai_repo` にも同期する（以下のファイル）:
- `web/app/analyzer.py`
- `web/app/services/discovery/discovery_pipeline.py`
- `web/app/services/discovery/keyword_extractor.py`
- `web/app/services/discovery/candidate_ranker.py`
- `web/app/services/discovery/anthropic_search_client.py`

---

## 実行戦略: Agent Teams 並列実行

タスクの独立性が高いため、Agent Teamsで3ワーカーを並列実行:

| Agent | 担当ワークストリーム | 対象ファイル |
|-------|-------------------|------------|
| **Agent 1** | WS-A + WS-B | discovery_pipeline.py, anthropic_search_client.py, keyword_extractor.py |
| **Agent 2** | WS-C + WS-D | analyzer.py, candidate_ranker.py |
| **Agent 3** | WS-E + フロントエンド | tests/*, Discovery.jsx |

Agent 3 はAgent 1/2の完了後に実行（テストは実装後でないと書けない）。

---

## 変更対象ファイル一覧

| # | ファイル | 変更内容 | WS |
|---|---------|---------|-----|
| 1 | `market-lens-ai/web/app/services/discovery/discovery_pipeline.py` | MAX_COMPETITORS=4, num=12, Semaphore(5), timeout調整 | A |
| 2 | `market-lens-ai/web/app/services/discovery/anthropic_search_client.py` | num上限10→12 | A |
| 3 | `market-lens-ai/web/app/routers/discovery_routes.py` | analyze_timeout, overall_timeout増 | A |
| 4 | `market-lens-ai/web/app/services/discovery/keyword_extractor.py` | 5クエリ化, ランキング/口コミパターン追加 | B |
| 5 | `market-lens-ai/web/app/analyzer.py` | プロンプト全面強化, max_output_tokens=5120 | C |
| 6 | `market-lens-ai/web/app/services/discovery/candidate_ranker.py` | 重複排除, ペナルティ, D2Cボーナス | D |
| 7 | `market-lens-ai/tests/test_analyzer.py` | アサーション更新 + 新テスト追加 | E |
| 8 | `market-lens-ai/tests/test_candidate_ranker.py` | 新規テストファイル | E |
| 9 | `market-lens-ai/tests/test_keyword_extractor.py` | 新規テストファイル | E |
| 10 | `insight-studio/src/pages/Discovery.jsx` | POLL_MAX_DURATION_MS 180s→240s | A |
| 11 | `insight-studio/tmp_market_lens_ai_repo/...` | 上記1-6の同期 | — |

---

## 検証手順

### Step 1: コンパイル確認
```bash
cd market-lens-ai
python -m py_compile web/app/analyzer.py
python -m py_compile web/app/services/discovery/discovery_pipeline.py
python -m py_compile web/app/services/discovery/keyword_extractor.py
python -m py_compile web/app/services/discovery/candidate_ranker.py
```

### Step 2: テスト実行
```bash
.venv/Scripts/python -m pytest tests/test_analyzer.py tests/test_candidate_ranker.py tests/test_keyword_extractor.py -v
```

### Step 3: 全テストスイート
```bash
.venv/Scripts/python -m pytest -v
```

### Step 4: コミット & デプロイ
```bash
git add -A && git commit && git push origin main
```
→ Render自動デプロイ

### Step 5: 本番検証（saurusjapan.com）
- [ ] 競合が4社以上表示されるか
- [ ] WINZONE/DNS/SAVAS等の直接競合が含まれるか
- [ ] 総合サマリーにLP種別カラムがあるか
- [ ] 各サイトにLP効果スコア（6軸）が出力されるか
- [ ] コンバージョン設計分析セクション（Section 4）が存在するか
- [ ] アクション提案セクション（Section 5）が存在するか
- [ ] アクション提案に具体的コピー例があるか
- [ ] コーポレートサイトにA評価が付かないか
- [ ] 分析が4分以内に完了するか
