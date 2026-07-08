# Performance Radar 視認性改善 + バナー生成品質向上

## Context

クリエイティブ診断ページで2つの問題が発生している:
1. **Performance Radar が見づらい** — フォントサイズが小さすぎ、Before/After比較が窮屈
2. **生成バナーが55点止まり** — 生成プロンプトが抽象的すぎて、Geminiが高品質な改善を行えない

---

## Part 1: Performance Radar 視認性改善

### 対象ファイル
- `src/components/PerformanceRadar.jsx`
- `src/pages/CreativeReview.jsx` (Before/Afterレイアウト)

### 変更内容

#### 1-A. フォントサイズ拡大 (PerformanceRadar.jsx)

| 箇所 | 現在 | 変更後 |
|------|------|--------|
| 軸ラベル (L288) | `text-[10px]` | `text-xs` (12px) |
| 軸スコア (L291) | `text-2xl md:text-[2rem]` | `text-[1.75rem] md:text-4xl` |
| Total Score "Total Score" (L160) | `text-[10px]` | `text-xs` |
| Total Score "out of 100" (L162) | `text-[10px]` | `text-xs` |
| パーセンテージ (L314) | `text-[11px]` | `text-sm` (14px) |
| Strongest/Needs ラベル (L327, L340) | `text-[10px]` | `text-xs` |

#### 1-B. レーダーチャート拡大 (PerformanceRadar.jsx)

- `RADAR_GEOMETRY.size`: 320 → 380
- `RADAR_GEOMETRY.center`: 160 → 190
- `RADAR_GEOMETRY.radius`: 118 → 140
- SVGコンテナ `max-w-[28rem]` → `max-w-[32rem]`

#### 1-C. Before/After レイアウト改善 (CreativeReview.jsx L952)

- `gap-4` → `gap-6` (余白拡大)
- Before/After ラベル `text-xs` → `text-sm` + `mb-3`

---

## Part 2: バナー生成プロンプト品質向上

### 対象ファイル
- `market-lens-ai/web/app/services/generation/gen_prompt_builder.py`

### 変更内容

現在のプロンプトは改善点をリスト化しているだけで、デザイン原則・具体的な実装指示が欠けている。以下のセクションを追加:

#### 2-A. デザイン原則セクション追加

```
## デザイン原則（必ず遵守）
1. **視覚ヒエラルキー**: メインコピー > サブコピー > CTA > 補足テキストの順で視覚的重みを付ける
2. **コントラスト**: テキストと背景のコントラスト比4.5:1以上を確保。CTAボタンは最も目立つ配色にする
3. **余白**: テキスト周囲に十分な余白を確保し、要素の密集を避ける
4. **フォントサイズ**: メインコピーは画像高さの8-12%、CTAテキストは5-8%を目安にする
5. **CTA配置**: 視線の流れの終点（右下または中央下）に配置し、十分なサイズのボタン形状で囲む
6. **色数制限**: 使用色は3-4色以内に抑え、アクセントカラーはCTAにのみ使用する
```

#### 2-B. 改善アクションの具体性向上

現在の `{imp.point}: {imp.action}` を、スコアに基づく優先度付きに変更:

```python
# rubric_scoresからスコア情報を抽出して改善指示を強化
for imp in review_result.improvements:
    improvements_text += f"- 【優先】{imp.point}: {imp.action}\n"
```

#### 2-C. 品質チェックリスト追加（プロンプト末尾）

```
## 生成前チェックリスト
生成する画像が以下を全て満たすことを確認してください:
□ メインコピーが3秒以内に読み取れる大きさか
□ CTAが明確に視認でき、クリックしたくなるデザインか
□ 情報が整理され、視線の流れが自然か
□ 元画像の商品写真・ロゴが完全に維持されているか
□ テキストの可読性（コントラスト・サイズ・フォント）は十分か
□ 全体のデザインにプロフェッショナル感があるか
```

---

## 実装順序

1. **Part 1** (フロントエンド) — Radar UI改善 → ビルド確認
2. **Part 2** (バックエンド) — プロンプト改善 → 手動テスト

## 検証方法

1. `npm run dev` で開発サーバー起動、クリエイティブ診断ページでRadarの視認性を目視確認
2. `npm run build` でビルドエラーがないことを確認
3. バックエンドは市場レンズAIリポでローカルテスト、またはデプロイ後にInsight Studioから生成して点数を確認
