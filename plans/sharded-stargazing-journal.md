# Discovery Hub レポート品質改善プラン v4 — compact プロンプト構造最適化

## Context

### これまでの経緯

| Phase | 内容 | 状態 | 効果 |
|-------|------|------|------|
| Phase 1 | プロンプト効率化（Section 4 字数制限 + 出力優先順位） | **完了** (commit 6e42768) | Section 4 評価テーブルが完結 |
| Phase 2 | トークン予算引き上げ（定数変更） | **完了** (commit 6e42768) | Discover では効果なし（Compare のみ有効） |
| Phase 3 | compact 予算引き上げ（2560→5120 / 3072→6144） | **完了**（別セッション実装済み） | **Section 5 が完走するようになった（B+ 評価）** |
| **Phase 4** | **compact プロンプト構造最適化（本プラン）** | 未着手 | トークン配分の最適化で A 評価を目指す |

### Phase 3 実装後のレビュー結果（広告運用プロの視点）

Section 5 完走は大きな進歩だが、以下の品質問題が残存:

| 問題 | 影響 | 根本原因 |
|------|------|----------|
| **3-1/3-2/3-3 が出力される** | ~1,200 tokens を低信頼推定に浪費 | compact mode で「省略」指示を出しているが、テンプレート本体に 3-1/3-2/3-3 のセクション定義が残っているためモデルが無視する |
| **参考観測枠（グリコ）が Section 4 で個別評価される** | ~400 tokens をデータ不足サイトに浪費 | compact mode にも参考観測枠の Section 4 省略指示がない |
| **Section 5-3（Meta/ディスプレイ施策）が欠落** | SNS/ディスプレイ施策がゼロ | compact mode で 5-3b（予算フレーム）を省略するつもりが、5-3 全体が消失 |
| **評価テーブルの「同等」が曖昧** | 2 社比較で何と「同等」か不明 | プロンプトに「vs [相手ブランド名]」の明示指示がない |
| **KPI 評価タイミングが一律「4 週後」** | 指名防衛は 1-2 週で評価可能、非指名は 8 週見るべき | プロンプトに獲得タイプ別のタイミングガイダンスがない |

### トークン配分の現状と最適化余地

```
現在の compact 出力 (~4,800 tokens 使用 / 5,120 予算):
  Section 1 (サマリー):     ~300 tokens  ← 必須
  Section 2 (分析対象):     ~500 tokens  ← 必須
  Section 3 (比較サマリー): ~400 tokens  ← 必須
  Section 3-1 (市場概況):   ~350 tokens  ← 低信頼推定 → 削除対象
  Section 3-2 (広告投資):   ~250 tokens  ← 低信頼推定 → 削除対象
  Section 3-3 (消費者):     ~500 tokens  ← 低信頼推定 → 削除対象
  Section 4 (ブランド別):  ~1,200 tokens  ← うち参考観測枠 ~400 → 削除対象
  Section 5-0 (データ課題): ~200 tokens  ← 有用
  Section 5-1 (LP改善):     ~400 tokens  ← 有用
  Section 5-2 (検索広告):   ~700 tokens  ← 有用

最適化後の配分見込み (~5,120 tokens):
  Section 1:    ~300 tokens
  Section 2:    ~500 tokens
  Section 3:    ~400 tokens
  Section 4:    ~800 tokens  (参考観測枠省略で -400)
  Section 5-0:  ~200 tokens
  Section 5-1:  ~600 tokens  (LP改善の拡充 +200)
  Section 5-2:  ~700 tokens
  Section 5-3:  ~400 tokens  ← NEW: Meta/ディスプレイ
  余裕:         ~220 tokens

節約: 3-1/3-2/3-3 削除で ~1,100 tokens + 参考観測枠 Section 4 削除で ~400 tokens = ~1,500 tokens
追加: 5-3 (~400) + 5-1 拡充 (~200) = ~600 tokens
純余裕: ~900 tokens（品質向上バッファ）
```

---

## 修正方針

**compact mode のプロンプトテンプレートから低信頼セクションを構造的に除外し、浮いたトークンを実務価値の高い Section 5-3 に回す。**

ポイント:
- 「省略してください」という**指示ベース**の除外は LLM が無視するリスクがある → **テンプレート自体から除外**する構造的アプローチ
- トークン予算（5120/6144）やタイムアウト（75 秒）は変更しない
- `discovery_pipeline.py` は変更しない
- フロントエンドは変更しない

---

## 変更内容

### 修正ファイル: `tmp_market_lens_ai_repo/web/app/analyzer.py` のみ

---

### 変更 1: `build_deep_comparison_prompt()` に `compact` パラメータ追加

**場所:** 行 1189（関数シグネチャ）

```python
# 変更前
def build_deep_comparison_prompt(
    extracted_list: list[ExtractedData],
    *,
    discovery_metadata: dict | None = None,
) -> str:

# 変更後
def build_deep_comparison_prompt(
    extracted_list: list[ExtractedData],
    *,
    discovery_metadata: dict | None = None,
    compact: bool = False,
) -> str:
```

**場所:** 行 1325-1332（Section 3-1/3-2/3-3 テンプレート部分）

```python
# 変更前（常に出力）
### 3-1. 市場概況（AI推定・参考値）
市場概況テーブルを出力（フォーマットは {_MARKET_CONTEXT_LAYER} の指示に従う）。

### 3-2. 競合広告投資推定（AI推定・参考値）
広告投資推定テーブルを出力（フォーマットは {_COMPETITIVE_INTELLIGENCE_LAYER} の指示に従う）。

### 3-3. 消費者インサイト（AI推定 + 抽出データ）
消費者インサイトを出力（フォーマットは {_CONSUMER_INSIGHTS_LAYER} の指示に従う）。

# 変更後（compact 時は除外）
{"" if compact else f"""### 3-1. 市場概況（AI推定・参考値）
市場概況テーブルを出力（フォーマットは {_MARKET_CONTEXT_LAYER} の指示に従う）。

### 3-2. 競合広告投資推定（AI推定・参考値）
広告投資推定テーブルを出力（フォーマットは {_COMPETITIVE_INTELLIGENCE_LAYER} の指示に従う）。

### 3-3. 消費者インサイト（AI推定 + 抽出データ）
消費者インサイトを出力（フォーマットは {_CONSUMER_INSIGHTS_LAYER} の指示に従う）。"""}
```

**同様に:** テンプレート末尾のレイヤー定数参照（行 1405-1410 付近）からも compact 時に除外:

```python
# 変更前
{_MARKET_CONTEXT_LAYER}
{_AD_OPERATIONS_LAYER}
{_COMPETITIVE_INTELLIGENCE_LAYER}
{_CONSUMER_INSIGHTS_LAYER}
{_KPI_FRAMEWORK_LAYER}

# 変更後
{_AD_OPERATIONS_LAYER}
{"" if compact else _MARKET_CONTEXT_LAYER}
{"" if compact else _COMPETITIVE_INTELLIGENCE_LAYER}
{"" if compact else _CONSUMER_INSIGHTS_LAYER}
{"" if compact else _KPI_FRAMEWORK_LAYER}
```

---

### 変更 2: `build_wide_comparison_prompt()` に同じ `compact` パラメータ追加

**場所:** 行 1433（関数シグネチャ）

```python
# 変更前
def build_wide_comparison_prompt(
    extracted_list: list[ExtractedData],
    *,
    discovery_metadata: dict | None = None,
) -> str:

# 変更後
def build_wide_comparison_prompt(
    extracted_list: list[ExtractedData],
    *,
    discovery_metadata: dict | None = None,
    compact: bool = False,
) -> str:
```

**場所:** 行 1546-1553 および行 1605-1611（deep と同じパターンで条件分岐）

---

### 変更 3: `analyze()` から compact パラメータを転送

**場所:** 行 1668-1673

```python
# 変更前
if len(extracted_list) == 1:
    prompt = build_competitive_lp_prompt(extracted_list[0])
elif len(extracted_list) >= 3:
    prompt = build_wide_comparison_prompt(extracted_list, discovery_metadata=discovery_metadata)
else:
    prompt = build_deep_comparison_prompt(extracted_list, discovery_metadata=discovery_metadata)

# 変更後
if len(extracted_list) == 1:
    prompt = build_competitive_lp_prompt(extracted_list[0])
elif len(extracted_list) >= 3:
    prompt = build_wide_comparison_prompt(extracted_list, discovery_metadata=discovery_metadata, compact=compact_output)
else:
    prompt = build_deep_comparison_prompt(extracted_list, discovery_metadata=discovery_metadata, compact=compact_output)
```

---

### 変更 4: compact mode 品質復旧モード指示を更新

**場所:** 行 1675-1689

```python
# 変更前
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
- セクション 3-1（市場概況）、3-2（競合広告投資推定）、3-3（消費者インサイト）は省略
- セクション 5-3b（予算フレーム）、5-4（KPIフレーム）は省略
- メイン比較テーブル（セクション3）と実行プラン（セクション5-1, 5-2）の完結を最優先
"""

# 変更後
if compact_output and len(extracted_list) > 1:
    prompt += """

## 品質復旧モード（最優先）
- 大見出し5セクションは維持したまま、本文を強く圧縮してください
- ブランド別評価は各ブランドにつき「要約1文 + 強み2点 + 弱み2点 + 評価テーブル」に限定
- **参考観測枠のブランドは Section 4 個別評価を省略**。Section 2 の参考観測枠テーブルのみで扱う
- 広告運用アクションは最優先3件まで
- 表セルは短く、重複説明は禁止
- Appendix 前提なので、生データの長い引用は禁止
- テーブルを途中で切らないことを最優先してください
- セクション 5-4（KPIフレーム）は省略
- 完結優先順: 5-1（LP改善）→ 5-2（検索広告）→ 5-3（Meta/ディスプレイ）
- **5-3（Meta/ディスプレイ施策）は必ず出力すること。最低2施策**
- 評価テーブルの「同等」判定には必ず比較先を明示（例: 「同等 vs フィットネスショップ」）
"""
```

**変更理由:**
- `セクション 3-1/3-2/3-3 は省略` → 削除（変更 1-2 でテンプレートから構造的に除外済み）
- `参考観測枠の Section 4 省略` → 追加（トークン ~400 節約）
- `5-3b（予算フレーム）省略` → `5-4（KPIフレーム）は省略` に変更（5-3 と 5-3b を混同していた指示を修正）
- `5-3 は必ず出力` → 追加（浮いたトークンで Meta/ディスプレイ施策を出力）
- `「同等」に比較先明示` → 追加（曖昧さ解消）

---

### 変更 5: KPI 評価タイミングのガイダンス追加（プロンプトテンプレート）

**場所:** `build_deep_comparison_prompt` 内 Section 5-2 定義部（行 1361-1369 付近）

```python
# 変更前
- 初回KPI: LP-CVR / CPA / Impression Share 等（検索広告のKPIテンプレートから選ぶ）

# 変更後
- 初回KPI: LP-CVR / CPA / Impression Share 等（検索広告のKPIテンプレートから選ぶ）
- 評価タイミングの目安: 指名防衛=1-2週（ImS確認）、カテゴリ非指名=4-8週（学習期間含む）、比較検討=4-8週
```

**場所:** `build_wide_comparison_prompt` 内 Section 5-2 定義部（行 1577 付近）にも同様追加。

---

### 変更 6: Section 5-1 LP改善テーブルの列拡張

**場所:** `build_deep_comparison_prompt` 内 Section 5-1 定義部（行 1352-1359 付近）

```python
# 変更前
#### 5-1. LP改善施策
`| ブランド | 優先度 | 改善内容 | 推奨着地先 | 根拠フィールド | 証拠強度 |`

# 変更後
#### 5-1. LP改善施策
`| # | ブランド | 優先度 | 改善箇所 | 現状の状態 | 改善後の具体案 | 推奨着地先 | 工数 | 根拠フィールド | 証拠強度 | ファネル | 期待効果 |`
- 工数: 小 / 中 / 大
- ファネル: 認知 / 興味 / 確信 / 行動
- 期待効果: 方向性のみ（例: CVR改善余地: 中）
```

**場所:** `build_wide_comparison_prompt` 内にも同様追加。

---

## テスト方針

### 既存テストへの影響

- `build_deep_comparison_prompt()` / `build_wide_comparison_prompt()` のテストは全て `compact` パラメータなしで呼んでおり、デフォルト `compact=False` のため **既存テストは全て通過する**
- `analyze()` 経由のテスト（`test_api.py`, `test_discovery_pipeline.py`）はモック化されており影響なし

### 追加テスト（3 件）

1. **`test_deep_comparison_compact_excludes_market_sections`**: `build_deep_comparison_prompt(data, compact=True)` の出力に `3-1. 市場概況` / `3-2. 競合広告投資推定` / `3-3. 消費者インサイト` が含まれないことを確認
2. **`test_wide_comparison_compact_excludes_market_sections`**: 同上（wide 版）
3. **`test_compact_prompt_includes_meta_display_instruction`**: compact mode の品質復旧モードに `5-3（Meta/ディスプレイ施策）は必ず出力` が含まれることを確認

---

## 触らないもの

- `discovery_pipeline.py`（compact_output=True のまま維持）
- `_comparison_output_token_budget()`（5120/6144 のまま維持）
- タイムアウト設定（75 秒のまま）
- insight-studio フロントエンド全般
- ポーリング / warmup / プロキシ設定

---

## 検証手順

### Step 1: ローカルテスト実行

```bash
cd tmp_market_lens_ai_repo
python -m pytest tests/test_analyzer.py tests/test_discovery_pipeline.py -v
```

全テスト通過を確認（既存 + 新規 3 件）。

### Step 2: プロンプトサイズ確認

compact=True 時と False 時のプロンプト文字数を比較ログで確認。compact 時に ~2,000 文字以上の縮小を期待。

### Step 3: デプロイ

```bash
cd tmp_market_lens_ai_repo
git add web/app/analyzer.py tests/test_analyzer.py
git commit -m "improve: Discovery compact プロンプト構造最適化 — 低信頼セクション除外+5-3復活+参考観測枠圧縮"
git push origin main
```

Render で自動デプロイ → health check 確認。

### Step 4: 本番 UI 動作確認

Discovery Hub で SAURUS URL を入力してレポート生成。

確認ポイント:
- [ ] Section 3-1 / 3-2 / 3-3 が **出力されていない** こと
- [ ] 参考観測枠（グリコ）が Section 4 で **個別評価されていない** こと
- [ ] Section 5-3（Meta/ディスプレイ施策）が **存在し、2施策以上** あること
- [ ] Section 5-1 LP改善テーブルに **工数・ファネル・期待効果** 列があること
- [ ] 評価テーブルの「同等」に **比較先が明示** されていること
- [ ] Section 5-2 の KPI に **獲得タイプ別の評価タイミング** が記載されていること
- [ ] エラーやタイムアウトが発生しないこと
- [ ] 生成時間が 75 秒以内であること
