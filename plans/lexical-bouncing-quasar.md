# 修正レビュー結果: visible_text_elements品質強化 + フロントエンドリファクタ

## Context

前回レビュー（C1/C2/I1-I6/M1）で指摘した全項目の修正実装を再レビュー。
コミット: `de6919f`(market-lens-ai) / `e030204`(insight-studio)。

---

## 総合評価

**前回指摘の全項目が適切に修正されている。1件のバグを新たに発見。**

| カテゴリ | 評価 | 詳細 |
|----------|------|------|
| C1: Literal型バリデーション | ✅ Pass | 正確に実装 |
| C2: テスト追加 | ✅ Pass | 7+4件、カバレッジ十分 |
| I1: スコア計算DRY化 | ✅ Pass | 3箇所すべて置換 |
| I2: IIFE→サブコンポーネント | ✅ Pass | クリーンな抽出 |
| I3: マジックナンバー定数化 | ✅ Pass | 両ファイルで適用 |
| I4: 空文字ガード | ✅ Pass | テスト付きで実装 |
| I5: コメント修正 | ✅ Pass | 実態と一致 |
| I6: getattr除去 | ✅ Pass | 直接アクセスに変更 |
| M1: 再生成ガード | ⚠️ バグあり | カウンターリセット漏れ |

---

## 🔴 新規発見: `regenerationCount` が `resetAll()` でリセットされない

**ファイル:** [CreativeReview.jsx:516-529](src/pages/CreativeReview.jsx#L516-L529)

```javascript
const resetAll = useCallback(() => {
  setPhase('idle')
  setErrorMessage('')
  setPreviewUrl(null)
  setFileName('')
  setAssetId(null)
  setAssetMeta(null)
  setBrandInfo('')
  setOperatorMemo('')
  setLpUrl('')
  clearRun('creative-review')
  clearRun('banner-generation')
  if (fileInputRef.current) fileInputRef.current.value = ''
  // ❌ setRegenerationCount(0) が欠落
}, [clearRun])
```

**再現シナリオ:**
1. バナーAをアップロード → レビュー → 生成 → スコア低い
2. 再生成を3回実行（上限到達）
3. 「最初からやり直す」ボタンで `resetAll()` を呼ぶ
4. バナーBをアップロード → レビュー → 生成 → スコア低い
5. **再生成ボタンが出ない** — `regenerationCount` が3のまま

**修正:** `resetAll()` に `setRegenerationCount(0)` を追加

---

## 🟡 軽微な指摘

### N1. SCORE_THRESHOLD定数が2ファイルに重複定義

- [CreativeReview.jsx:20-22](src/pages/CreativeReview.jsx#L20-L22): `SCORE_THRESHOLD_EXCELLENT/GOOD/FAIR`
- [PerformanceRadar.jsx:28-30](src/components/PerformanceRadar.jsx#L28-L30): 同一の3定数

片方を変更した場合に不整合が起きるリスク。共有の `constants.js` に切り出すか、少なくとも「PerformanceRadar.jsx と同期すること」のコメントを付けるのが望ましい。ただし現時点では実害なし。

### N2. `handleRegenerate` が `handleGenerate` を await していない

[CreativeReview.jsx:669-674](src/pages/CreativeReview.jsx#L669-L674):
```javascript
const handleRegenerate = useCallback(() => {
  setRegenerationCount((c) => c + 1)
  setAfterReviewResult(null)
  setAfterError('')
  handleGenerate()  // async だが await なし
}, [handleGenerate])
```

`handleGenerate` は async 関数。Reactイベントハンドラ内なので動作上の問題はないが、エラーが unhandled promise rejection になる可能性がある。`handleGenerate` 内で try-catch しているなら実害なし（確認済み: line 637で try-catch あり）。

---

## 各修正の詳細確認

### C1: Literal型 ✅

[review_result.py:153](../market-lens-ai/web/app/schemas/review_result.py)
```python
role: Literal["headline", "sub_copy", "cta", "price", "note", "brand_name"] = Field(...)
```
- `Literal` は `typing` から正しくインポート済み（line 7）
- JSON Schema の enum と完全一致
- `Field(...)` で必須フィールドとして明示

### C2: テスト ✅

**[test_visible_text_element.py](../market-lens-ai/tests/test_visible_text_element.py)** — 7テスト
| テスト | 検証内容 |
|--------|----------|
| `test_valid_roles` | 6つの有効なrole値すべて受け入れ |
| `test_invalid_role_rejected` | "caption" → ValidationError |
| `test_empty_role_rejected` | 空文字 → ValidationError |
| `test_text_required` | 空text → ValidationError |
| `test_approximate_position_defaults_to_empty` | デフォルト値 "" |
| `test_approximate_position_set` | 指定値 "top-left" |
| `test_extra_fields_forbidden` | 未知フィールド → ValidationError |

**test_gen_prompt_builder.py** — 4テスト追加
| テスト | 検証内容 |
|--------|----------|
| `test_text_elements_included_in_prompt` | テキスト要素がプロンプトに含まれる |
| `test_text_elements_empty_uses_fallback` | 空配列時にフォールバックセクション |
| `test_text_elements_empty_position_no_parens` | 空positionで `（）` が出ない（I4検証） |
| `test_text_elements_with_position_has_parens` | position指定時に `（center）` が出る |

テストのモックデータも `rubric_id: "visual_impact"` に修正されており、以前の無効値 `"hook_strength"` は解消済み。

### I1: calcAvgScore100 ✅

[CreativeReview.jsx:26-27](src/pages/CreativeReview.jsx#L26-L27) に定義。使用箇所3つ:
- Line 64: `BeforeAfterRadarComparison` 内（Before平均）
- Line 65: 同上（After平均）
- Line 106: `LowScoreRegenerationPrompt` 内

### I2: サブコンポーネント ✅

- `BeforeAfterRadarComparison` ([line 61-103](src/pages/CreativeReview.jsx#L61-L103)) — props: `beforeReview`, `afterReview`
- `LowScoreRegenerationPrompt` ([line 105-131](src/pages/CreativeReview.jsx#L105-L131)) — props: `scores`, `onRegenerate`, `regenerationCount`
- 呼び出し側 ([line 1012-1022](src/pages/CreativeReview.jsx#L1012-L1022)) は宣言的でクリーン
- IIFE パターンは完全に除去済み

### I3: 定数化 ✅

定義: [CreativeReview.jsx:20-24](src/pages/CreativeReview.jsx#L20-L24), [PerformanceRadar.jsx:28-30](src/components/PerformanceRadar.jsx#L28-L30)

使用確認:
- `PerformanceRadar.jsx:145` — `SCORE_THRESHOLD_EXCELLENT/GOOD/FAIR` で色分け
- `LowScoreRegenerationPrompt:107` — `REGENERATION_THRESHOLD` で閾値判定
- 生のリテラル `80/60/40` はスコア閾値文脈で残存なし

### M1: 再生成ガード ⚠️（リセット漏れ以外は✅）

- `regenerationCount` state ([line 494](src/pages/CreativeReview.jsx#L494))
- インクリメント: `setRegenerationCount((c) => c + 1)` ([line 670](src/pages/CreativeReview.jsx#L670))
- 残回数表示: `再生成する (2/3)` 形式 ([line 124](src/pages/CreativeReview.jsx#L124))
- 上限到達時: ボタン非表示 + 「上限 3 回」テキスト ([line 127](src/pages/CreativeReview.jsx#L127))

---

## 修正アクション

| 優先度 | ID | 内容 | ファイル |
|--------|-----|------|----------|
| 🔴 P0 | Bug | `resetAll()` に `setRegenerationCount(0)` 追加 | CreativeReview.jsx:529 |
| 🔵 任意 | N1 | SCORE_THRESHOLD定数の共有化 or 同期コメント | 両ファイル |

## 検証方法

1. `resetAll()` 修正後、`npm run build` でビルド確認
2. 手動テスト: バナーA → 3回再生成 → リセット → バナーB → 再生成ボタン表示を確認
