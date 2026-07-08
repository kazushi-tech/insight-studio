# Plan: クリエイティブ診断の品質徹底改善

## Context

クリエイティブ診断機能が初めてバナー生成まで完走したが、スクリーンショットのレビューで以下の品質問題を発見:
1. **PerformanceRadar が ad-lp レビューのスコアの半分を無視している（致命バグ）**
2. スコアが 1-2/5 に偏りすぎて改善ポイントが不明瞭
3. 生成バナーが元の商品写真を変えてしまう
4. バナーサイズ制約を考慮しない画一的な評価
5. 改善バナーが本当に良くなったか定量比較できない

本プランは `hotfix-post-review.md`（既存バグ修正6件）とは **別物** — 品質底上げに特化。

---

## Phase A: [CRITICAL] PerformanceRadar 軸マッピング修正

### 問題

`src/components/PerformanceRadar.jsx` の `AXIS_GROUPS` は banner_review (5 rubric) 専用設計。
ad-lp review (8 rubric) だと **4/8 スコアがマッピングされず消失**:

| ad-lp rubric_id | マッピング先 | 状態 |
|---|---|---|
| first_view_clarity | composition | OK |
| ad_to_lp_message_match | — | **消失** |
| benefit_clarity | — | **消失** |
| trust_elements | trust | OK |
| cta_placement | cta | OK |
| drop_off_risk | trust | OK |
| input_friction | — | **消失** |
| story_consistency | — | **消失** |

結果: デザイン軸が常に 0.0、Total Score が 4 スコアのみで計算（40/100 は不正確）。

### 修正内容

**ファイル:** `src/components/PerformanceRadar.jsx`

1. review type別の `AXIS_GROUPS` を定義:

```javascript
const AXIS_GROUPS_BY_TYPE = {
  banner_review: {
    composition: { label: '構成', ids: ['visual_flow', 'information_balance', 'information_density', 'first_view_clarity'] },
    design:      { label: 'デザイン', ids: ['visual_impact', 'brand_consistency', 'competitive_edge'] },
    cta:         { label: 'CTA', ids: ['cta_effectiveness', 'cta_clarity', 'cta_placement', 'offer_clarity'] },
    trust:       { label: '信頼性', ids: ['credibility', 'trust_elements', 'drop_off_risk'] },
  },
  ad_lp_review: {
    composition: { label: '構成', ids: ['first_view_clarity', 'story_consistency'] },
    message:     { label: 'メッセージ', ids: ['ad_to_lp_message_match', 'benefit_clarity'] },
    cta:         { label: 'CTA', ids: ['cta_placement', 'input_friction'] },
    trust:       { label: '信頼性', ids: ['trust_elements', 'drop_off_risk'] },
  },
}
```

2. rubric_id から review type を自動検出:
```javascript
const AD_LP_IDS = new Set(['ad_to_lp_message_match', 'benefit_clarity', 'input_friction', 'story_consistency'])
function detectReviewType(rubricScores) {
  return rubricScores.some(s => AD_LP_IDS.has(s.rubric_id)) ? 'ad_lp_review' : 'banner_review'
}
```

3. `AXIS_META` に `message` エントリ追加（design と同じ位置 vector `[1, 0]`）
4. `AXIS_ORDER` を review type で切替
5. `computeAxes` を review type 対応に修正
6. 親コンポーネントからオプショナル `reviewType` prop を受け付け（自動検出のフォールバック付き）

**ファイル:** `src/pages/CreativeReview.jsx`
- `<PerformanceRadar>` に `reviewType={reviewResult.review_type}` を渡す

### 期待結果
- ad-lp: 全8スコアが4軸に均等分配（各2つ）、デザイン→メッセージ軸に変更
- banner: 既存動作と完全互換
- Total Score が全rubricを反映した正確な値に

---

## Phase B: [HIGH] スコアリング基準のキャリブレーション

### 問題

LLM がほぼ全項目で 1-2/5 を返す。ユーザーにとってはどれも「悪い」にしか見えず、改善優先度がつけられない。

### 修正内容

**ファイル:** `market-lens-ai/web/app/services/review/review_prompt_builder.py`

両プロンプト（banner_review / ad_lp_review）の rubric リスト直後に挿入:

```python
_SCORING_SCALE = """\
## スコアリング基準（1-5 の定義）
- 5: 業界トップクラス。即座に運用可能。改善の余地がほとんどない
- 4: 良好。標準以上の品質。軽微な調整で優秀になる
- 3: 標準的。業界平均レベル。明確な改善余地がある
- 2: 改善が必要。重要な問題があるが基本的な方向性は正しい
- 1: 根本的な見直しが必要。致命的な問題がある

重要: プロフェッショナルなバナーは通常 2-4 のレンジに収まります。
1 は「致命的欠陥」、5 は「業界最高水準」を意味します。
全項目が 1-2 に集中する場合、採点が厳しすぎる可能性があります。
各項目を独立して評価し、強い点には 3-4 を、弱い点には 1-2 を付けてください。"""
```

### 期待結果
スコア分布が 1-2 集中 → 2-4 に広がり、強み/弱みの差が明確に

---

## Phase C: [HIGH] バナー生成品質の向上

### 問題 1: 商品写真が変わる
生成プロンプトに「写真を維持」はあるが弱い。Gemini が商品を再生成してしまう。

### 問題 2: サイズ指定なし
250x250 のバナーに対して、Gemini がデフォルト解像度で生成。

### 修正内容

**ファイル:** `market-lens-ai/web/app/services/generation/gen_prompt_builder.py`

プロンプト冒頭を強化:
```
## 最重要ルール: 元画像の写真素材を一切変更しない
- 元バナーに含まれる商品写真・人物写真・ロゴは絶対に再生成しないこと
- 改善対象はテキスト要素（コピー・CTA）、背景色、レイアウト構成のみ
- 製品の形状・色・角度・照明を元画像と完全に一致させること
```

サイズ指定を追加:
```
## 出力サイズ
生成画像は {width}x{height}px にしてください。元バナーと同じサイズ・アスペクト比を厳守すること。
```

**ファイル:** `market-lens-ai/web/app/services/generation/banner_gen_service.py`
- `generate()` に `original_width`, `original_height` パラメータ追加
- `build_banner_gen_prompt()` に渡す

**ファイル:** `market-lens-ai/web/app/routers/generation_routes.py`
- asset metadata から width/height を取得して service に渡す

### 期待結果
- 商品写真が元画像と同一に保たれる（テキスト/レイアウトのみ変更）
- 出力サイズが入力と一致

---

## Phase D: [MEDIUM] サイズ考慮型レビュー

### 問題

250x250 の超小型バナーに 728x90 と同じ基準で評価。「情報不足」で低スコアになるが、小型では当然。

### 修正内容

**ファイル:** `market-lens-ai/web/app/services/review/review_prompt_builder.py`

バナーメタデータ（width, height）が利用可能な場合、サイズカテゴリに応じたガイダンスを注入:

| カテゴリ | 面積 | ガイダンス |
|---|---|---|
| micro | <50,000px² | 情報量最小限で良い。1メッセージ+CTAで十分 |
| small | <100,000px² | 主要メッセージ1-2点+CTAに絞るのが適切 |
| medium | <250,000px² | ビジュアルとテキストのバランスが重要 |
| large | ≥250,000px² | 詳細情報やビジュアルストーリーが期待される |

250x250 = 62,500px² → small カテゴリ → 「1-2メッセージ+CTAで十分」の基準で評価

### 期待結果
小型バナーが「情報不足」で不当に減点されなくなる

---

## Phase E: [LOW] 改善バナーの比較スコアリング

### 問題

Before/After を視覚比較できるが、定量的にどれだけ良くなったか不明。

### 修正内容

**ファイル:** `src/pages/CreativeReview.jsx`

1. Step 4 に「改善バナーをスコアリング」ボタン追加
2. クリック時: 生成画像をダウンロード → 新 asset として upload → `reviewBanner` で再レビュー
3. Before/After のレーダーチャートを横並び表示
4. Total Score の差分を表示（例: 40 → 72 (+32)）

**注意:** After は常に `banner_review` (5 rubric)。Before が `ad_lp_review` (8 rubric) の場合、rubric 体系が異なるため Total Score のみ比較し、軸別比較は参考値と注記。

---

## 実装順序と依存関係

```
Phase A (Radar修正)  ─── 独立 ─── 最優先
Phase B (スコア基準)  ─── 独立 ─── A と並行可
Phase C (生成品質)   ─── 独立 ─── A,B と並行可
Phase D (サイズ考慮)  ─── B に依存（同ファイル）
Phase E (比較スコア)  ─── A に依存（修正済みRadar必要）
```

推奨: A → B+C 並行 → D → E

---

## 対象ファイル一覧

### Frontend (insight-studio)
| ファイル | Phase | 変更内容 |
|---|---|---|
| `src/components/PerformanceRadar.jsx` | A | 軸マッピングを review type 対応に |
| `src/pages/CreativeReview.jsx` | A, E | reviewType prop 追加、比較スコアUI |

### Backend (market-lens-ai)
| ファイル | Phase | 変更内容 |
|---|---|---|
| `web/app/services/review/review_prompt_builder.py` | B, D | スコア基準追加、サイズガイダンス |
| `web/app/services/generation/gen_prompt_builder.py` | C | 写真維持強化、サイズ指定 |
| `web/app/services/generation/banner_gen_service.py` | C | width/height パラメータ追加 |
| `web/app/routers/generation_routes.py` | C | metadata から寸法取得 |

---

## 検証方法

1. **Phase A**: 同じ ad-lp レビュー結果で Radar 表示 → 全8スコアが4軸に分配、デザイン軸が 0.0 でないこと
2. **Phase B**: 同じバナーでレビュー実行 → スコアが 2-4 に分布すること
3. **Phase C**: 同じバナーで生成 → 商品写真が保持されていること、出力サイズが元と一致すること
4. **Phase D**: 250x250 バナーで「小型」ガイダンスが注入されていること（ログ確認）
5. **Phase E**: 生成後「スコアリング」ボタン → Before/After レーダー並列表示
6. **全体**: `npm run build` 成功 + backend `pytest tests/ -v` 全通過
