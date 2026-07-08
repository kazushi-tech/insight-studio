# Discovery Hub レポート品質改善プラン — レビュー＆修正版

## レビュー結果サマリー

元プラン `sharded-stargazing-journal.md` に対する徹底レビュー。
**致命的問題 2件、中程度 3件、軽微 2件**を検出し、修正済みプランを以下に記載。

---

## 検出した問題一覧

| # | 深刻度 | 問題 | 修正方針 |
|---|--------|------|----------|
| 1 | **致命的** | Phase 3 のサイト数ロジックが誤り。プランは「4+サイトでwide切替」と記載しているが、実コード(`analyzer.py:1659-1664`)は`>= 3`で切替。`DISCOVERY_MAX_COMPETITORS=3`（3サイト）にした時点で`build_wide_comparison_prompt()`が使われる | Phase 3 を分離し、wideプロンプト改善を別途設計 |
| 2 | **致命的** | Phase 2 と Phase 3 が矛盾。Phase 2 は `build_deep_comparison_prompt()` を改善するが、Phase 3 適用後は `build_wide_comparison_prompt()` に切り替わるため Phase 2 の変更が無効化される | Phase 2 を2サイトモード用として確定し、3サイトモードは独立フェーズへ |
| 3 | **中** | ローカル検証ステップが欠如。メモリルール「推測でコード変更禁止。ローカル再現→原因特定→修正→確認の順」に違反 | ローカルテストステップを追加 |
| 4 | **中** | Claude Sonnet 4.6 の `max_output_tokens` 上限16384の根拠が未検証 | デプロイ前にAPI仕様を確認するステップ追加 |
| 5 | **中** | `_comparison_output_token_budget()` の compact mode 考慮漏れ。`compact_output=True` が渡されると3072/2560に削減される | compact mode の発動条件をコード上で追跡済み → デフォルトFalseなので通常パスでは問題なし |
| 6 | **軽微** | `_MULTI_URL_MAX_OUTPUT_TOKENS_4PLUS_SITES = 7168` (行26) が未対応 | 対象ファイルまとめに追加 |
| 7 | **軽微** | Phase 実行順序。プロンプト効率化を先にやればトークン増加幅を抑えられる可能性 | Phase 順序を入れ替え |

---

## Context

Discovery Hub がレポート生成に成功したが、**トークン予算不足（`max_output_tokens=6144`）による後半セクションの切断**が最大の品質問題。Section 4（ブランド別評価）が途中で終了し、Section 5（実行プラン）が丸ごと欠落する。

エラー地獄の再発を避けるため、インフラ・ポーリング・タイムアウトのロジックには一切触れず、**プロンプトとトークン予算のみ**を調整する。

**重要な制約:**
- `analyze_timeout = 75秒`（env: `DISCOVERY_ANALYZE_TIMEOUT_SEC`）は変更しない
- ポーリング・warmup・プロキシロジックは触らない
- insight-studio（フロントエンド）のコードは変更しない
- 使用モデル: `claude-sonnet-4-6`（env `ANTHROPIC_ANALYSIS_MODEL` で上書き可能）

---

## 修正済みプラン

### Phase 1: プロンプト効率化（先にやる → トークン節約で必要な増加幅を最小化）

**対象:** `tmp_market_lens_ai_repo/web/app/analyzer.py` — `build_deep_comparison_prompt()` 内

#### 1-1. Section 4（ブランド別評価）の字数制限追加

**行 1334-1346 付近**を以下のように修正:

```
### 4. ブランド別評価
各ブランドを**短く・鋭く**記述。冗長禁止。以下の構成に固定:
- **要約1文**: そのブランドの広告運用上の位置づけ（20文字以内）
- **強み2点**: 各30文字以内の箇条書き
- **弱み2点**: 各30文字以内の箇条書き
- **評価テーブル**: 6軸（根拠列は10文字以内）
```

**理由:** 現在の指示は「短く・鋭く」とあるが字数制限がなく、モデルが冗長に書いてSection 5用のトークンを消費する。

#### 1-2. 出力優先順位の明示

**行 1416 付近**の `## 補足` セクションに追加:

```
## 出力優先順位（トークン逼迫時）
以下の順で出力を死守すること:
1. Section 1（エグゼクティブサマリー）— 必ず完結
2. Section 5（実行プラン: 5-1, 5-2）— 必ず完結（最重要）
3. Section 3（競合比較サマリー + メインテーブル）— 必ず完結
4. Section 2（分析対象）— 簡潔に
5. Section 4（ブランド別評価）— 圧縮可
6. Section 3-1, 3-3, 5-3, 5-4 — 省略可
```

**理由:** モデルはSection 1→2→3→4の順に書くためSection 4で予算を使い果たす。

---

### Phase 2: トークン予算引き上げ（Phase 1 の効果を確認後に適用）

**対象:** `tmp_market_lens_ai_repo/web/app/analyzer.py` 行 24-26

```python
# 変更前
_MULTI_URL_MAX_OUTPUT_TOKENS = 6144                   # 行24
_MULTI_URL_MAX_OUTPUT_TOKENS_3_SITES = 7168            # 行25
_MULTI_URL_MAX_OUTPUT_TOKENS_4PLUS_SITES = 7168        # 行26

# 変更後
_MULTI_URL_MAX_OUTPUT_TOKENS = 10240                   # 行24: 2サイト用
_MULTI_URL_MAX_OUTPUT_TOKENS_3_SITES = 12288           # 行25: 3サイト用
_MULTI_URL_MAX_OUTPUT_TOKENS_4PLUS_SITES = 10240       # 行26: 4+サイト用
```

**理由:**
- 2サイトdeep比較プロンプトが要求する出力量は10,000tokens級。6144では物理的に不足
- 6144→10240で約67%増。Section 5まで完走できる見込み
- **前提確認必須:** Claude Sonnet 4.6 の `max_output_tokens` 上限が10240以上であること（API仕様で確認）

**リスク:**
- 生成時間が10-15秒増加する可能性 → `analyze_timeout=75秒`の範囲内
- コスト微増（1レポートあたり数セント）

**注意: compact mode への影響はなし。**
`compact_output` パラメータはデフォルト `False`（`analyzer.py:1657`）。compact mode は明示的に `True` を渡した場合のみ発動し、通常のDiscovery Hubフローでは固定値（3072/2560）が使われるため、上記定数変更の影響を受けない。

---

### Phase 3: 比較対象数の増加（Phase 1-2 完了後に検討）

**⚠ 元プランからの重大修正:**

元プランでは `DISCOVERY_MAX_COMPETITORS=3` で deep プロンプトが使えると想定していたが、**実際は3サイト以上で `build_wide_comparison_prompt()` に切り替わる**（`analyzer.py:1661`: `elif len(extracted_list) >= 3`）。

#### 選択肢

| 方式 | 内容 | メリット | デメリット |
|------|------|----------|------------|
| **A. 閾値変更** | `analyzer.py:1661` の条件を `>= 4` に変更し、3サイトでもdeepプロンプトを使用 | Phase 1-2 の改善がそのまま適用される | ロジック変更でリスク増 |
| **B. wideプロンプト改善** | `build_wide_comparison_prompt()` にも同様の品質改善を適用 | コード変更が少ない | 2箇所メンテが必要 |
| **C. 2サイトのまま品質優先** | `DISCOVERY_MAX_COMPETITORS=2` を維持 | 最もリスクが低い | 1社比較のまま |

**推奨: Phase 1-2 を先に完了し、2サイトモードでの品質を確認してからPhase 3 の方式を決定する。**

Phase 3 は独立した判断ポイントとし、Phase 1-2 の結果を見てから着手する。

---

## 対象ファイルまとめ

| ファイル | Phase | 変更内容 | リスク |
|---------|-------|---------|--------|
| `tmp_market_lens_ai_repo/web/app/analyzer.py` 行1334-1346 | 1 | Section 4 の字数制限追加 | 低（プロンプト文言のみ） |
| `tmp_market_lens_ai_repo/web/app/analyzer.py` 行1416付近 | 1 | 出力優先順位の追加 | 低（プロンプト文言のみ） |
| `tmp_market_lens_ai_repo/web/app/analyzer.py` 行24 | 2 | `_MULTI_URL_MAX_OUTPUT_TOKENS`: 6144→10240 | 低（生成時間微増） |
| `tmp_market_lens_ai_repo/web/app/analyzer.py` 行25 | 2 | `_MULTI_URL_MAX_OUTPUT_TOKENS_3_SITES`: 7168→12288 | 低 |
| `tmp_market_lens_ai_repo/web/app/analyzer.py` 行26 | 2 | `_MULTI_URL_MAX_OUTPUT_TOKENS_4PLUS_SITES`: 7168→10240 | 低 |
| (Phase 3で決定) | 3 | サイト数増加 or wideプロンプト改善 | 要検討 |

**触らないもの（エラー地獄回避）:**
- insight-studio フロントエンドコード全般
- ポーリングロジック（Discovery.jsx）
- タイムアウト設定（marketLens.js）
- warmup/health check ロジック
- プロキシ設定（vercel.json, vite.config.js）
- reportQuality.js

---

## 検証手順（ローカルテスト追加済み）

### Step 0: 前提確認
- [ ] Claude Sonnet 4.6 の `max_output_tokens` 上限を確認（API仕様 or テストコール）
  - 10240以上であること
  - 確認方法: `_call_text_model()` に `max_output_tokens=10240` を渡してエラーにならないか

### Step 1: ローカルテスト（Phase 1 — プロンプト効率化）
```bash
cd tmp_market_lens_ai_repo
# analyzer.pyのプロンプトを修正（Phase 1のみ）
# ローカルでサーバー起動
python -m web.app.main
# テストAPI呼び出しでレポート生成
# 確認: Section 4/5 の出力比率が改善したか
```

### Step 2: ローカルテスト（Phase 2 — トークン予算引き上げ）
- Phase 1 の効果が不十分な場合のみ適用
- トークン予算変更後、同じテストを再実行
- 確認: レポートが最後まで完結するか、生成時間が75秒以内か

### Step 3: バックエンドデプロイ
```bash
cd tmp_market_lens_ai_repo
# ローカルテスト合格後にcommit/push → Renderが自動デプロイ
```

### Step 4: デプロイ後確認（Vercel + Render 両方）
```bash
# Render バックエンド稼働確認
curl https://market-lens-ai.onrender.com/api/health
```

### Step 5: 本番UI動作確認
1. Discovery Hub で SAURUS の URL を入力
2. レポート生成を待機
3. 確認ポイント:
   - [ ] Section 4（ブランド別評価）が最後まで完結しているか
   - [ ] Section 5（実行プラン）が存在し、5-1/5-2が完結しているか
   - [ ] レポートが途中で切断されていないか
   - [ ] エラーが発生しないか
   - [ ] 生成時間が極端に増加していないか（75秒以内）

### Step 6: 品質確認
- エグゼクティブサマリーの結論が具体的か
- 検索広告施策（5-2）に具体的なクエリ例があるか
- LP改善施策（5-1）に「現状→改善後」の対比があるか
