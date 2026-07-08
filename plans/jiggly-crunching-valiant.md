# Discovery Hub CRO分析レポート品質改善プラン

## Context

広告運用プロフェッショナル視点で現在のDiscovery Hubレポートをレビューした結果、**分析の深度・差別化・実行可能性**の3軸で大幅な改善が必要と判断。

### 現在のレポートの問題点（広告運用者視点）

| 問題 | 具体例 |
|------|--------|
| **スコアの差別化ゼロ** | 全サイト「B」評価。比較分析として成立していない |
| **推定頼み** | ほぼ全項目が「(本文推定)」で、抽出データの信頼性が低い |
| **アクションが浅い** | 「CTA変えろ」「アスリートの声を上に」は小学生でも言える |
| **説得心理学ゼロ** | Cialdiniの原理、感情的フック、Before/After等のCRO基本が無視 |
| **ファネル分析なし** | Attention→Interest→Desire→Conviction→Actionの評価が不在 |
| **価格心理学不在** | 定期購入のアンカリング、チャームプライシング、バリュースタック等の分析なし |
| **業界特化ゼロ** | サプリメント業界のCROベストプラクティスとのギャップ分析なし |
| **定量インパクトなし** | 「期待CV向上率」が一切ないため、クライアントに投資対効果を示せない |
| **緊急性/希少性の評価なし** | カウントダウン、限定在庫、期間限定等のCRO要素の検出・評価が不在 |

---

## 修正対象ファイル

| ファイル | 役割 | 変更規模 |
|----------|------|----------|
| `web/app/analyzer.py` | 分析プロンプト構築 | **大**（プロンプト全面改修） |
| `web/app/extractor.py` | HTML構造化抽出 | **中**（新規抽出3関数 + 既存改善） |
| `web/app/models.py` | データモデル | **小**（フィールド3つ追加） |
| `web/app/report_generator.py` | レポート整形 | **小**（新規フィールド表示追加） |
| `tests/test_analyzer.py` | テスト | **中**（アサーション更新 + 新規テスト） |
| `tests/test_extractor.py` | テスト | **中**（新規抽出関数テスト） |

> 全ファイルのベースパス: `tmp_market_lens_ai_repo/`

---

## Phase 1: データモデル拡張（後方互換）

### models.py — ExtractedData に3フィールド追加

[models.py:36](tmp_market_lens_ai_repo/web/app/models.py#L36) の `testimonials` の後に追加:

```python
urgency_elements: list[str] = Field(default_factory=list)
trust_badges: list[str] = Field(default_factory=list)
guarantees: list[str] = Field(default_factory=list)
```

全て `default_factory=list` なので既存コードへの影響なし。

---

## Phase 2: データ抽出力強化

### 2A. extractor.py — body text snippet上限を 800→2000 文字に拡大

[extractor.py:224](tmp_market_lens_ai_repo/web/app/extractor.py#L224) と [extractor.py:240](tmp_market_lens_ai_repo/web/app/extractor.py#L240) の `text[:800]` を `text[:2000]` に変更。

本文抜粋は分析の最も豊富な信号源。800文字では重要なセクション（価格詳細、保証コピー、ベネフィット説明）が頻繁に欠落。

### 2B. extractor.py — 新規抽出関数3つを追加

**`_extract_urgency_elements(soup)`**
- カウントダウンタイマー: `class*="countdown"`, `class*="timer"`
- 限定数量: `残りX個`, `在庫わずか`, `limited`, `only X left`
- 期間限定: `期間限定`, `本日限り`, `ends`, `expires`
- 先着順: `先着X名`, `先着順`

**`_extract_trust_badges(soup)`**
- class/alt内: `badge`, `certified`, `verified`, `secure`, `ssl`, `trusted`
- img src内: `badge`, `trust`, `secure`, `verisign`, `norton`, `mcafee`
- テキスト: `ISO`, `SSL`, `個人情報保護`, `返金保証`, `満足保証`, `認定`, `認証`

**`_extract_guarantees(soup)`**
- `返金`, `保証`, `全額返金`, `満足度保証`, `返品`, `risk-free`, `money-back`, `guarantee`
- `class*="guarantee"`, `class*="warranty"`, `class*="refund"`

### 2C. extractor.py — CTA検出キーワード拡張

[extractor.py:109-113](tmp_market_lens_ai_repo/web/app/extractor.py#L109-L113) の `_CTA_KEYWORDS` に追加:

```python
"今すぐ申し込む", "無料体験", "無料トライアル", "お試し",
"資料ダウンロード", "無料で見る", "購入する", "定期便を始める",
"初回限定", "会員登録", "無料登録", "見積もりを取る",
"相談する", "話を聞く",
# English
"Start Free Trial", "Try Free", "Get Your Quote", "Book a Call",
"Schedule Demo", "See Plans", "Claim Offer",
```

### 2D. extractor.py — hero copy抽出の改善

`_HERO_GARBAGE` 正規表現（[extractor.py:66-70](tmp_market_lens_ai_repo/web/app/extractor.py#L66-L70)）に追加:
```
トップページ|ホーム|home|top|戻る|back|en|ja|english|日本語
```

---

## Phase 3: 分析プロンプト全面改修（最重要）

### analyzer.py — build_deep_comparison_prompt の改修

#### 3A. スコアリングルーブリックの具体化

現在の曖昧な A-D 評価を、6軸×10点満点の100点スケールに変更:

| 軸 | 1-2 | 5-6 | 9-10 |
|----|-----|-----|------|
| **FV訴求力** | 価値提案が最初のスクロールに見えない | ベネフィット見出し+補足テキストあり | 独自価値を瞬時に伝え、スクロール意欲を喚起 |
| **CTA設計** | CTAなし/「送信」のみ | 動詞CTA+コントラスト色 | 複数CTA+反論解消マイクロコピー |
| **信頼構築** | 信頼信号ゼロ | 口コミ/レビューあり | 定量ソーシャルプルーフ+認証+返金保証 |
| **ベネフィット訴求** | 機能列挙のみ | ベネフィット先行+機能裏付け | Before/After、結果駆動ナラティブ |
| **価格心理学** | 価格表示なし | 価格アンカリングあり | アンカリング+チャーム+バリュースタック+リスク反転 |
| **CV導線設計** | ページ下部にCTA1つのみ | 複数CTA+論理フロー | 認識/検討/決定ステージマップ+緊急性 |

総合グレード: **A = 85+, B+ = 70-84, B = 55-69, C = 40-54, D = 40未満**

→ 全サイト「B」だったのが自然にスコア分散する。

#### 3B. 説得アーキテクチャ評価を追加

Cialdiniの6原理でクロス評価テーブルを要求:
```
| 説得原理 | サイトA | サイトB | サイトC |
| Authority | O (具体証拠) / X |
| Social Proof | O (具体証拠) / X |
| Scarcity | O (具体証拠) / X |
| Reciprocity | O (具体証拠) / X |
| Commitment | O (具体証拠) / X |
| Liking | O (具体証拠) / X |
```

#### 3C. コンバージョンファネル分析を追加

AIDCAモデルで各サイトの導線を5段階評価:
```
| ファネル段階 | サイトA 評価 | サイトA 根拠 | ...
Attention: FVで注意を引けているか
Interest: ベネフィット・機能で関心を維持できているか
Desire: 感情・欲求を刺激しているか
Conviction: 信頼・不安解消で確信を与えられているか
Action: CTA・フォームで行動を促せているか
評価: O (明確) / P (部分的) / X (欠落)
```

#### 3D. アクション提案フォーマットの強化

現在の浅い `| # | 優先度 | 提案 | 具体的コピー/施策例 |` を以下に変更:

```
| # | 優先度 | 改善領域 | 現状の問題 | 改善後のコピー例 | 期待CV向上率 | 実装難易度 |
```

必須ルール:
- **コピー例**は現状→提案の対比形式（例: `"お問合せはこちら"` → `"今すぐ試す（¥4,280〜・初回20%OFF）"`）
- **期待CV向上率**は業界ベンチマークに基づく推定（例: `推定15-25%向上 / CTA具体化ベンチマーク: Unbounce LP Report`）
- **実装難易度**: Low / Medium / High

#### 3E. 業界特化分析を追加

抽出データから業界を自動推定し、業界別CROパターンを適用:
- **サプリメント/健康食品**: 定期購入導線、成分表示、Before/After、医師監修、解約ハードル
- **SaaS**: フリーミアム、ROI計算機、統合API、エンタープライズ実績
- **EC/D2C**: 送料閻値、レビュー質量、返品保証、カート投入導線
- **B2B**: ホワイトペーパー、導入事例具体性、ROI試算、無料相談

#### 3F. build_competitive_lp_prompt（単体分析）も同様に改修

単体分析プロンプト（[analyzer.py:84-126](tmp_market_lens_ai_repo/web/app/analyzer.py#L84-L126)）にも同じスコアリング・説得分析・ファネル分析を適用。

### 3G. Token budget引き上げ

[analyzer.py:233](tmp_market_lens_ai_repo/web/app/analyzer.py#L233) の `4096` を `8192` に変更。
コスト増: 約2倍（$0.05→$0.10/分析）だが品質向上が圧倒的に上回る。

### 3H. _format_site_data に新規フィールド追加

[analyzer.py:31-81](tmp_market_lens_ai_repo/web/app/analyzer.py#L31-L81) に3新規フィールドの表示を追加:
```
- **緊急性要素**: {urgency_display}
- **信頼バッジ**: {trust_display}
- **保証・リスク反転**: {guarantee_display}
```

---

## Phase 4: レポート整形の更新

### report_generator.py — 新規フィールド表示

[report_generator.py:49-50](tmp_market_lens_ai_repo/web/app/report_generator.py#L49-L50) の後に追加:
```python
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
```

フロントエンド（MarkdownRenderer）は標準Markdownテーブルをレンダリング可能なため変更不要。

---

## Phase 5: テスト更新

### test_analyzer.py

| 変更箇所 | 内容 |
|----------|------|
| [L283, L292](tmp_market_lens_ai_repo/tests/test_analyzer.py#L283) | `4096` → `8192` にアサーション更新 |
| 新規テスト追加 | `test_deep_comparison_has_persuasion_framework` |
| 新規テスト追加 | `test_deep_comparison_has_funnel_analysis` |
| 新規テスト追加 | `test_deep_comparison_has_numeric_rubric` |
| 新規テスト追加 | `test_deep_comparison_has_industry_patterns` |
| 新規テスト追加 | `test_deep_comparison_has_copy_examples_format` |
| 新規テスト追加 | `test_deep_comparison_has_cv_improvement_estimate` |

### test_extractor.py

| 変更箇所 | 内容 |
|----------|------|
| [L126](tmp_market_lens_ai_repo/tests/test_extractor.py#L126) | `test_body_text_snippet_truncated_to_800` を `2000` に更新 |
| 新規テスト追加 | `_extract_urgency_elements` のテスト |
| 新規テスト追加 | `_extract_trust_badges` のテスト |
| 新規テスト追加 | `_extract_guarantees` のテスト |
| 新規テスト追加 | 拡張CTAキーワード検出テスト |

---

## 実装順序

```
Phase 1 (models.py) ─────────┐
                             ├─> Phase 2 (extractor.py) ──┐
Phase 3H (data format) ─────┤                            │
                             ├─> Phase 3A-G (prompt) ────┤
Phase 4 (report_gen.py) ────┤                            │
                             └────────────────────────────┴─> Phase 5 (tests)
```

---

## 検証方法

1. **単体テスト**: `python -m pytest tests/test_analyzer.py tests/test_extractor.py -v`
2. **実際のDiscovery実行**: 既存のスポーツサプリメント3サイトで再実行し、以下を確認:
   - スコアが分散しているか（全Bでないか）
   - (本文推定)タグが減っているか（抽出データの質向上による）
   - アクション提案に具体的コピー例とCV向上率が含まれているか
   - 説得原理・ファネル分析セクションが存在するか
   - 業界特化分析が含まれているか
3. **全文テスト**: `python -m pytest` で704テスト全通過確認

---

## リスク評価

| リスク | 緩和策 |
|--------|--------|
| API コスト増（8192 tokens） | 約2倍だが$0.10/分析。品質向上が優先 |
| プロンプト肥大化でClaudeが切り詰める | テーブル形式で出力をコンパクトに指示 |
| 新規抽出フィールドの互換性 | `default_factory=list` で完全後方互換 |
| body text 2000文字で入力トークン増 | Claude Sonnet 200K contextで余裕あり |
