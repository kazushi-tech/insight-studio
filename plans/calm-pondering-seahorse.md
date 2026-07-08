# Discovery analyze タイムアウト修正 — 第2弾（残存問題解消）

## Context

前回修正（commit `da93e86`）で system/user prompt 重複4レイヤーの除去 + トークン予算微増は完了。
しかし **user prompt 内部の重複・肥大化が5箇所残存** しており、依然としてタイムアウトリスクがある。

### 前回修正済み（触らない）
- `_EVIDENCE_TRACE_REQUIREMENTS`, `_TRUST_AND_ASSERTION_RULES`, `_EVIDENCE_RIGOR_RULES`, `_DATA_LIMITATION_RULES` → system message に集約済み
- トークン予算: 9216 / 11264 / 12288 に増加済み

---

## 残存問題 5件（全て `analyzer.py` on `origin/main`）

### 問題A: `_MARKET_CONTEXT_LAYER` 二重定義

| 行 | 内容 |
|----|------|
| **640** | PR#1で追加。詳細版（市場規模テーブル形式、~25行） |
| **1064** | 元々あった簡易版（エグゼクティブサマリー内、~13行） |

Python は後勝ち → **line 1064 が有効、line 640 はデッドコード**。
しかし line 640 の方がPR#1の意図に合った詳細版。

### 問題B: `_EVIDENCE_RIGOR_RULES` 二重定義

| 行 | 内容 |
|----|------|
| **691** | PR#1で追加。カバレッジベース結論制限（~25行） |
| **1100** | 元々あった f-string 合成版（`_INFERENCE_SUPPRESSION_RULES` + `_EVIDENCE_SEPARATION_RULES`） |

Python は後勝ち → **line 1100 が有効、line 691 はデッドコード**。
さらに line 1100 版は `_SYSTEM_CONSTRAINT_RULES` にも展開されているので system message にも入っている。

### 問題C: 末尾レイヤーブロックで `_MARKET_CONTEXT_LAYER` が2回

**`build_deep_comparison_prompt()`** (lines 1420-1427):
```
{_MARKET_CONTEXT_LAYER}            ← line 1421（元）
{_AD_OPERATIONS_LAYER}
{_MARKET_CONTEXT_LAYER}            ← line 1423（PR#1追加、重複!）
{_COMPETITIVE_INTELLIGENCE_LAYER}
{_EVIDENCE_RIGOR_RULES}            ← line 1425（system msgと重複!）
{_CONSUMER_INSIGHTS_LAYER}
{_KPI_FRAMEWORK_LAYER}
```

**`build_wide_comparison_prompt()`** (lines 1618-1624): 同一パターン。

### 問題D: セクション 5-0 命名衝突

| 行 | 定数 | セクション名 |
|----|------|-------------|
| **848** | `_AD_OPERATIONS_LAYER` | `#### 5-0. 予算フレーム（AI推定・参考値）` |
| **1083** | `_ENHANCED_ACTION_PLAN_TEMPLATE` | `#### 5-0. データ取得課題（施策ではなく前提の制約）` |

LLMが混乱する。

### 問題E: compact mode に新セクション省略指示なし

compact mode の品質復旧プロンプト（line 1691-1698）に新セクション（3-1, 3-2, 3-3, 5-4, 予算フレーム）をスキップする指示がない。compact でも全セクション生成を試みるため、2560-3072 トークンに収まらない。

---

## 修正プラン

### Fix 1: デッドコード削除 + 正しい定義の採用

**`_MARKET_CONTEXT_LAYER`**:
- line 640 の詳細版を**残す**（PR#1の意図通り）
- line 1064 の簡易版を**削除**
- これにより line 640 が唯一の定義になる

**`_EVIDENCE_RIGOR_RULES`**:
- line 691 のカバレッジベース版を**残す**（PR#1の意図通り）
- line 1100 の合成版を**更新**: 既存の `_INFERENCE_SUPPRESSION_RULES` + `_EVIDENCE_SEPARATION_RULES` に加えて、line 691 のカバレッジ制限を統合
- もしくは line 691 をそのまま使い、line 1100 の合成版はカバレッジ制限を含む形に修正

### Fix 2: 末尾レイヤーブロックから重複参照を削除

**`build_deep_comparison_prompt()`** (line 1423付近):
- 2つ目の `{_MARKET_CONTEXT_LAYER}` を削除
- `{_EVIDENCE_RIGOR_RULES}` を削除（system message に既にある）

**`build_wide_comparison_prompt()`** (line 1620付近):
- 同じく2つ目の `{_MARKET_CONTEXT_LAYER}` と `{_EVIDENCE_RIGOR_RULES}` を削除

### Fix 3: 5-0 命名衝突の解消

`_AD_OPERATIONS_LAYER` 内の `#### 5-0. 予算フレーム` → `#### 5-3b. 予算フレーム（AI推定・参考値）` にリネーム。
これにより `_ENHANCED_ACTION_PLAN_TEMPLATE` の `5-0. データ取得課題` と衝突しない。

### Fix 4: compact mode に新セクション省略指示を追加

line 1691-1698 の品質復旧モードプロンプトに追加:
```
- セクション 3-1（市場概況）、3-2（競合広告投資推定）、3-3（消費者インサイト）は省略
- セクション 5-3b（予算フレーム）、5-4（KPIフレーム）は省略
- メイン比較テーブル（セクション3）と実行プラン（セクション5-1, 5-2）の完結を最優先
```

---

## 修正対象ファイル

| ファイル | Fix | 変更内容 |
|---------|-----|---------|
| `web/app/analyzer.py` | Fix 1 | line 1064 の `_MARKET_CONTEXT_LAYER` 削除、line 1100 の `_EVIDENCE_RIGOR_RULES` 修正 |
| `web/app/analyzer.py` | Fix 2 | 2つのプロンプト関数の末尾ブロックから重複参照削除 |
| `web/app/analyzer.py` | Fix 3 | `_AD_OPERATIONS_LAYER` 内の `5-0` → `5-3b` リネーム |
| `web/app/analyzer.py` | Fix 4 | compact mode プロンプトに省略指示追加 |
| `tests/test_analyzer.py` | — | プロンプトサイズアサーション調整（必要なら） |

## 影響見積もり

| 項目 | Before (現状) | After |
|------|--------------|-------|
| `_MARKET_CONTEXT_LAYER` 展開回数 (deep/wide各) | 2回 + インライン1回 = 3回 | 1回 + インライン1回 = 2回 |
| `_EVIDENCE_RIGOR_RULES` 展開回数 | user prompt 1回 + system 1回 = 2回 | system のみ 1回 |
| 5-0 セクション衝突 | あり | なし |
| compact mode 新セクション | 全生成 | 省略 |
| 推定入力トークン追加削減 | — | ~1,500 tokens |

## 検証方法

1. `pytest` 全通過
2. プロンプトサイズをログ出力で確認（前回比で削減されていること）
3. Render デプロイ後、`sauceapper.com` で Discovery 実行 → 75秒以内に完了
4. compact mode フォールバック時に新セクションが省略されることを確認
