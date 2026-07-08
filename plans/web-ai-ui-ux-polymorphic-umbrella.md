# Discovery Hub 品質改善プラン — AI分析精度 × UI/UX

## Context

ユーザーが insight-studio 本番環境（https://insight-studio-chi.vercel.app/discovery）で「ペタビット株式会社（BtoB ITコンサルティング）」の競合発見分析を実行したところ、以下の問題が一斉に発生した。UI/UX レビュー（Stitch 2.0 で別途修正予定）とは別に、**AI 分析ロジック側にも構造的な欠陥がある**ため、両面から改善が必要。

### 実行結果で観測された 5 つの致命的症状（2026-04-21 09:13 実行・ジョブ cc2b88b344f4）

1. **実行プラン全欠損**: 品質チェックが「最優先3施策 / 5-1 LP改善施策 / 5-2 検索広告施策 / 5-3 Meta/ディスプレイ施策 / 5-4 KPI測定計画」の 5 セクション欠損を報告。本来プロンプト契約で [MUST] とされている 3 施策が本文に存在しない。
2. **業界priors 欠落によるダミー市場データ**: ITコンサルティング業界のpriorsが [industry_priors.yaml](backends/market-lens-ai/web/app/market_estimator/industry_priors.yaml) に未定義で、`fallback_general` にフォールバック。市場規模 1,000〜5,000億円、CPC 80〜400円 など意思決定に使えないワイドレンジが表示されている。
3. **データ抽出の壊滅的失敗**: 辻・本郷IT / 東芝 / アルハ / タナベの 4 サイト全てで `Main CTA 未取得` / `Pricing 未取得`、12フィールド中 1/12 のみ取得。平均取得率 0.8/10 の低信頼状態。
4. **レポート末尾切断**: `_MULTI_URL_MAX_OUTPUT_TOKENS_3_SITES = 7168` の上限に達し、`ブランド別評価`の途中でハードカット。自動注記は付与されているが、本文の肝である「実行プラン」全体が output buffer からあふれている。
5. **UIバッジ・件数の不整合**: ヘッダーに「8件候補 3サイト分析」と表示、本文には参考観測枠含め 3 サイトの分析、一方「発見されたLP一覧」には 4 件（ペタビット + 3 社）、未分析候補が 5 件列挙。ユーザーが何件分析されたか混乱する。

### 背景 — なぜ今この課題が表面化したか

- 直近のコミット `dec2bd1 feat(ai-explorer): add report history drawer` でレポート閲覧導線が整備され、ユーザーが**過去レポートを開き直す頻度が増加**。分析精度の低さが繰り返し目に入るようになった。
- BtoB ITコンサルティング業界は、既存テスト対象（カメラ中古・スポーツサプリ・水道CRO等）と異なり**検討期間3〜6ヶ月・少数意思決定者**が特徴の領域で、既存 CRO 6 軸（FV訴求・CTA明確性）では捕捉しきれない。新業界での失敗パターンが可視化された形。
- UI/UX は Stitch 2.0 で刷新予定だが、「見た目は綺麗だが中身が空っぽ」のまま出すとクライアント提出時に信頼を損ねるため、AI 分析品質の先行改善が不可欠。

### 本プランの想定読者

本プランは**別セッションの Claude 向けの実行指示書**として作成。実装担当 Claude は次の 3 ロール想定で章立てを分離：

- **Backend Claude** — `backends/market-lens-ai/` 配下の Python を触る。Section A / B / C。
- **Frontend Claude** — `src/` 配下の React を触る。Section D / E。
- **Stitch 2.0 デザイナー（人間）** — UI ビジュアルの刷新担当。Section F にデザイン要件を列挙（実装指示ではなくデザインブリーフ）。

---

## 現状の詳細レビュー（一次情報）

### 1. AI 分析レポートの内容精度レビュー

#### 1-1. 高く評価できる点

- **役割分離**（入力ブランド / 実競合比較対象 / 参考観測枠）が明示され、スコア 40 以下を「参考観測」にダウングレードする設計は妥当。
- **勝ち筋・負け筋**の 1 行要約（「ペタビット: 実績の豊富さと事例の具体性で非指名獲得に強い」等）は鋭い洞察で、エグゼクティブサマリーとして機能する水準。
- **【確認済み】/【推定】/【市場推定】バッジ**で証拠強度を明示する設計は良い。BtoB SaaS 提案書に求められる透明性を満たす。
- **主比較テーブル**の「強い訴求 / 弱い訴求 / 判定（非指名獲得向き/指名流入向き）」は、戦略的な差別化軸を正しく整理している。

#### 1-2. 致命的欠陥（Critical）

##### C-1. 実行プラン全セクション欠損（最重要）

品質警告 5 件：
```
セクション欠損: 「最優先3施策」が見つかりません
セクション欠損: 「5-1 LP改善施策」が見つかりません
セクション欠損: 「5-2 検索広告施策」が見つかりません
サブセクション欠損(任意): 「5-3 Meta/ディスプレイ施策」
サブセクション欠損(任意): 「5-4 KPI測定計画」
```

- [analyzer.py:1158-1167](backends/market-lens-ai/web/app/analyzer.py#L1158-L1167) の `_OUTPUT_SCHEMA_CONTRACT` では Section 5（実行プラン）を [MUST] としているが、**実際の出力ではエグゼクティブサマリー冒頭に「①ペタビット専用獲得LP…②指名防衛…③辻・本郷との比較検討層向けコンテンツLP」と施策が書かれているのみで、本文には詳細展開が無い**。
- これは `compact_output=True` モードで Section 4（ブランド別評価）が圧縮されずにフル展開され、Section 5 が token buffer からあふれた結果。圧縮方針（[analyzer.py:1765-1776](backends/market-lens-ai/web/app/analyzer.py#L1765-L1776)）が**プロンプト上の指示のみで、出力強制力が無い**。

##### C-2. レポート末尾の不完全切断

```
FV訴求 | 強 | 無印良品・リビンズ等  ← ここで切れている
```

- `max_tokens` 到達で `_TRUNCATION_NOTICE` ([anthropic_client.py:163-166](backends/market-lens-ai/web/app/anthropic_client.py#L163-L166)) は付与されているが、UI 上ではレポート末尾（スクロール下端）に埋もれており、**ユーザーが警告を見る前にコピー / PDF 出力してしまうリスク**がある。

##### C-3. ITコンサルティング業界の prior 未定義

- [industry_priors.yaml](backends/market-lens-ai/web/app/market_estimator/industry_priors.yaml) に `it_consulting` / `btob_consulting` / `dx_consulting` いずれも未定義。
- `classify_industry()` ([estimator.py:94-122](backends/market-lens-ai/web/app/market_estimator/estimator.py#L94-L122)) が `fallback_general` にフォールバックし、市場規模 1,000〜5,000億円、成長率 1〜6%、月間検索 5〜30 万、CPC 80〜400 円、CVR 1〜3% を返している。
- **BtoB ITコンサル実態**: 市場規模 6,000〜9,000 億円、年率 7〜10% 成長、検討期間 3〜6ヶ月、CPC 300〜1,200 円、CVR 0.3〜1.5%（問い合わせベース）。フォールバック値と実態が**桁違い**。

##### C-4. スクレイピング失敗（main_cta / pricing_snippet）

- 競合 4 サイト全てで `1/12 取得成功`、全サイト `Main CTA 未取得` + `Pricing 未取得`。
- BtoB サイトは `/contact`、`/inquiry`、`/consultation`、`/download` などセカンダリ CTA 中心で、[extractor.py](backends/market-lens-ai/web/app/extractor.py) のセレクタが **BtoC EC 向けチューニング**のため BtoB 構造に合わない。
- pricing_snippet も BtoB は「要問い合わせ」「個別見積」が通常で、表形式価格ページが存在しない前提の fallback が必要。

#### 1-3. 中程度の問題（Major）

##### M-1. CRO 6 軸が BtoB に不適合

[analyzer.py:1128-1131](backends/market-lens-ai/web/app/analyzer.py#L1128-L1131) の 6 軸：
- 検索意図一致 / FV訴求 / CTA明確性 / 信頼構築 / 価格・オファー / 購買導線

BtoB で評価すべき軸：
- **事例・実績訴求強度** （ペタビットが強いのはここ）
- **専門性・権威性**（セミナー、執筆、認定資格）
- **ホワイトペーパー / 事例集 DL 導線**
- **初回商談のハードル** （問い合わせ・資料請求フォームの手数）
- **ABM ターゲット設計** （ICP の明示性）

結果、COMPETITOR MATRIX の「CTA明確性・信頼構築・価格・オファー・購買導線」が軒並み「・-」（評価不能）になり、**レーダーチャートが 2 軸しか点灯せず歪な形**に。

##### M-2. 消費者インサイトが一般論

```
検討期間: 3〜6ヶ月（複数部門の合意形成が必要）
情報収集チャネル: Google検索 → 企業サイト訪問 → 事例・セミナー確認 → 問い合わせ
意思決定者: 経営層 + 担当部門長（複数決裁者）
```

これはどの BtoB 業界にも当てはまる一般論。ITコンサル特有の：
- DX推進部・情シスの稟議プロセス
- RFP / 提案コンペを経るか否か
- PoC → 本番導入の 2 段階契約

などが織り込まれていない。業界特化の `industry_prior.buying_behavior_template` を定義すべき。

##### M-3. 参考観測枠の扱いが不明瞭

- 東芝デジタルマーケティングイニシアティブ（スコア 63）は参考観測枠扱いで主比較テーブルから除外されている。
- しかし COMPETITOR MATRIX 上では**そもそも競合列が表示されていない**（ペタビット 1 列のみ）。参考観測枠を薄色（例: opacity 0.5）で表示するなど、情報量の差を可視化する工夫が必要。

##### M-4. 未分析候補の情報価値が低い

```
株式会社才流（sairu.co.jp）— BtoBマーケティング特化。今回未分析
...（5 社列挙）
```
- 「スコア 40 以下」「分析上限」の除外理由のみで、**なぜ候補に挙がったか**（どのキーワード検索で何位、どんなシグナル一致）が書かれていない。
- ユーザーが「次はこの 5 社から深掘りすべきか？」を判断する材料になっていない。

#### 1-4. 軽微な問題（Minor）

- m-1. 「エグゼクティブサマリー」末尾と「分析対象と比較前提」冒頭で「本レポートは、ペタビット株式会社を含む 3 サイト比較です」が**2 回繰り返されている**。冗長。
- m-2. 広告費推定「ペタビット: 80〜200万円 / 辻・本郷IT: 100〜240万円」の**信頼度が low で並んでおり、ユーザーが額面通り受け取るリスク**。推定手法の詳細リンク / 免責が必要。
- m-3. 「弱い訴求 / 価格・契約条件の透明性」と書かれているが、そもそも pricing_snippet 取得不可のため**「弱い」と判定できる根拠データが無い**。データ不足時は「評価保留」が正しい。

---

### 2. UI/UX レビュー（Stitch 2.0 修正対象）

#### 2-1. 情報アーキテクチャの問題

**I-1. ヘッダー情報の優先順位が混沌**
```
[完了] search: cc2b88b344f4 [ITコンサルティング] 8件候補 3サイト分析 [Claude] 2分28秒
```
- ジョブID、業界、候補数、分析数、モデル、実行時間が**等価で並ぶ**ため、重要度が伝わらない。
- **ユーザーが本当に知りたい情報**: 「分析は成功したか」「何社比較したか」「データ信頼度はどれくらいか」。
- 改善: プライマリ指標を大きく（例: `3 sites / 信頼度 62%`）、メタ情報（ジョブID・実行時間）を subtle に折りたたむ。

**I-2. 品質警告バナーの情報設計が不適切**
```
⚠ 品質チェックで注意事項があります
・セクション欠損: 「最優先3施策」が見つかりません
・セクション欠損: 「5-1 LP改善施策」が見つかりません
...
```
- amber（注意）カラーだが、実際は**レポートの肝である実行プランが全欠損**しており、本来は critical（赤）レベル。
- 「再生成」「対象を絞って再実行」のアクションボタンが無く、ユーザーに次の一手が提示されていない。
- 5 件の箇条書きが縦に伸び、視線誘導が弱い。

**I-3. COMPETITOR MATRIX の機能不全**
- ペタビット 1 列のみ表示で、比較ツールとして機能していない。競合列がない。
- 6 軸のうち 4 軸が `・-`（評価不能）で、**欠損セル視覚化が弱い**（単なる中黒）。「データ不足」とテキストで明示すべき。
- 評価セル `▲ 強` の矢印記号が意味不明（「上向き=強い」の既知パターン薄い）。

**I-4. BRAND RADAR の描画崩壊**
- 6 軸のうち 2 軸（検索意図一致・FV訴求）のみ点灯で、**レーダーチャートが三角形ではなく線分**に見える。
- 他社（辻・本郷IT）のポリゴンが重ね描きされていない → 競合比較レーダーとしての役割を果たしていない。

#### 2-2. ビジュアルデザインの問題

**V-1. テーブル幅が画面幅を活かしきれていない**
- MarkdownRenderer のテーブルが `.prose max-w-5xl` 相当で固定され、**ワイドモニターでも左右に大きな余白**が生じる。レポート本文の可読性 > 余白美観。

**V-2. 固定ヘッダー / セクションジャンプ欠如**
- スクロール距離が長い（推定 8〜10 画面分）のに、**アンカーリンク / サイドTOC が無い**。
- 読み手がセクション間を行き来するたびに全スクロール → 離脱リスク。

**V-3. TRACKING（KPI 目標値）セクションが空**
- 見出しと 3 列（入力ブランド / 実競合 / 参考観測枠）のみで、**肝心の KPI 行が描画されていない**。セクション 5-4 欠損の直接的な被害。

**V-4. 発見された LP カードの不統一**
- ペタビット以外の 3 社のサムネイルが表示されているが、**辻・本郷は OGP 欠損で背景ピンクの placeholder**、東芝は正常、アルハは正常、タナベは「TCG」ロゴのみ。見栄えがチグハグ。
- 「分析する」ボタンのクリック先（個別深掘り？比較画面？）が不明瞭。

#### 2-3. インタラクションの問題

**X-1. レポートをコピー / PDF 印刷のフィードバック欠如**
- コピーボタン押下後の toast / visual feedback を確認できず（要調査）。
- PDF 印刷時に**品質警告バナーも一緒に印刷される**とクライアント提出で問題になる。`@media print` で警告を非表示にするか、編集モード切替が必要。

**X-2. v1 / v2 切替の差分が見えない**
- `v2 NEW` バッジはあるが、「どこが変わったか」のツアー / tooltip が無い。
- 初見ユーザーは v2 を選ぶ動機が薄い。

**X-3. フォントサイズ S/M/L の影響範囲が限定的**
- 本文 body は大きくなるが、**テーブル・カード内テキストは変化しない**（推定。要検証）。視覚的メリハリが中途半端。

---

## 改善プラン

### Section A — 業界 Prior の拡充（Backend Claude）

**目的**: `fallback_general` によるダミー値表示を撲滅し、BtoB IT コンサル業界の意思決定に使える範囲データを提供する。

**対象ファイル**:
- [backends/market-lens-ai/web/app/market_estimator/industry_priors.yaml](backends/market-lens-ai/web/app/market_estimator/industry_priors.yaml)

**追加する priors**（最低 3 つ）:

```yaml
- key: it_consulting
  label: ITコンサルティング・DX支援
  match_keywords: [ITコンサル, ITコンサルティング, DXコンサル, DX支援, DX推進, システム導入, ITストラテジー]
  market_size_jpy: {min: 600_000_000_000, max: 900_000_000_000}
  annual_growth_pct: {min: 7, max: 12}
  monthly_search_volume: {min: 80_000, max: 200_000}
  cpc_jpy: {min: 300, max: 1200}
  avg_cvr_pct: {min: 0.3, max: 1.5}
  confidence: medium
  source_note: "IDC Japan / 矢野経済研究所 ITコンサル・DX市場予測, BtoB検索広告CPC帯"
  buying_behavior_template: |
    検討期間: 6〜12ヶ月（RFP → 提案コンペ → PoC → 本番）。
    意思決定者: CIO・情報システム部長 + 事業部長（最終承認は役員会）。
    情報収集: 業界ウェビナー / 導入事例レポート DL / アナリストレビュー。

- key: btob_marketing_consulting
  label: BtoBマーケティング支援・コンサルティング
  match_keywords: [BtoB, BtoBマーケティング, マーケティング支援, マーケティングコンサル, リード獲得, ABM, コンテンツマーケティング]
  market_size_jpy: {min: 200_000_000_000, max: 350_000_000_000}
  annual_growth_pct: {min: 8, max: 14}
  monthly_search_volume: {min: 40_000, max: 100_000}
  cpc_jpy: {min: 400, max: 1500}
  avg_cvr_pct: {min: 0.5, max: 2.0}
  confidence: medium
  source_note: "MMRI BtoB支援サービス市場調査 / JMRA調査"
  buying_behavior_template: |
    検討期間: 3〜6ヶ月。意思決定者: マーケティング責任者 + 事業責任者。
    情報収集: 事例集 DL / 無料診断 / セミナー。PoC 契約は半年単位が多い。

- key: strategy_consulting
  label: 経営戦略コンサルティング
  match_keywords: [経営コンサル, 戦略コンサル, 経営戦略, マネジメントコンサル, 中期経営計画]
  market_size_jpy: {min: 800_000_000_000, max: 1_200_000_000_000}
  annual_growth_pct: {min: 5, max: 9}
  monthly_search_volume: {min: 60_000, max: 150_000}
  cpc_jpy: {min: 500, max: 2000}
  avg_cvr_pct: {min: 0.2, max: 1.0}
  confidence: medium
  source_note: "IT+経営コンサル統合市場推計 / JMRA"
```

**検収**: `python -m pytest backends/market-lens-ai/tests/test_market_estimator.py -v` でハマり判定が意図通り。

---

### Section B — プロンプト & Token Budget の構造的見直し（Backend Claude）

**目的**: Section 5（実行プラン）が確実に出力されるようにする。

**対象ファイル**:
- [backends/market-lens-ai/web/app/analyzer.py](backends/market-lens-ai/web/app/analyzer.py)（行 50-53 の token 定数、行 1128-1167 のプロンプト）

**変更内容**:

#### B-1. Token Budget の再配分（最優先）

現状 `_MULTI_URL_MAX_OUTPUT_TOKENS_3_SITES = 7168` は 3 サイト分の Section 4（ブランド別評価）を詳細に書こうとすると足りない。

**方針 A: 単純増枠（短期）**
```python
_MULTI_URL_MAX_OUTPUT_TOKENS_3_SITES = 8192  # 7168 → 8192
```
※ Claude Sonnet 4.6 の max_tokens 上限を超えないか要確認。

**方針 B: セクション別 2 段階生成（中期・推奨）**
1. 第 1 コール: Section 1-4（エグサマ〜ブランド別評価）を生成、max_tokens=5120
2. 第 2 コール: Section 5（実行プラン）のみを Section 1-4 を context に渡して生成、max_tokens=4096
3. フロント側で結合して 1 本のレポートにする

利点: 実行プラン欠損が構造的に発生しない。デメリット: Claude API 課金 1.5 倍、レイテンシ 1.5 倍。

**推奨**: 方針 B を採用し、`two_phase=True` フラグでフィーチャーフラグ化。A/B で品質比較。

#### B-2. プロンプトの Section 5 強制力を上げる

現状 [analyzer.py:1160-1165](backends/market-lens-ai/web/app/analyzer.py#L1160-L1165) の `[MUST]` マーカーはプロンプト上の指示のみ。以下を追加：

```
絶対ルール（違反時は再試行対象）:
- Section 5 の「### 最優先3施策」「### 5-1. LP改善施策」「### 5-2. 検索広告施策」
  が本文に存在しない場合、そのレスポンスは無効です。
- Section 4（ブランド別評価）は必要最小限（各社 3〜5 行）に抑え、
  Section 5 に最低 1,500 tokens を確保してください。
- 各施策は「施策名 / 期待効果 / 工数 / 優先度 (P0/P1/P2)」の 4 点を明記。
```

#### B-3. `compact_output` の動的判定

入力 URL 数と業界複雑度で自動切替：

```python
if len(extracted_list) >= 3:
    compact_output = True
if industry_prior.key in ["it_consulting", "strategy_consulting"]:
    compact_output = True  # 高付加価値業界は内容を絞って Section 5 を確保
```

#### B-4. 業界特化プロンプト差し込み

`industry_prior.buying_behavior_template` をプロンプトに差し込む処理を追加：

```python
if prior := industry_prior.buying_behavior_template:
    prompt += f"\n\n## 業界特性（必ずSection 3-3に反映）\n{prior}\n"
```

**検収**: `tests/test_analyzer_prompt.py` に ITコンサル業界の URL 3 本で `output.count("### 最優先3施策") == 1` を assert するテストを追加。

---

### Section C — BtoB 向けスクレイピング拡張（Backend Claude）

**目的**: `Main CTA 未取得` / `Pricing 未取得` の撲滅。

**対象ファイル**:
- [backends/market-lens-ai/web/app/extractor.py](backends/market-lens-ai/web/app/extractor.py)

#### C-1. BtoB 向け CTA セレクタ追加

現状の main_cta 抽出（推定: EC の「購入」「カートに追加」中心）を拡張：

```python
BTOB_CTA_PATTERNS = [
    # テキストマッチ
    r"(?:お問い?合わせ|無料相談|無料診断|資料請求|資料ダウンロード)",
    r"(?:資料DL|資料を見る|事例を見る|導入事例を見る)",
    r"(?:見積り?|見積依頼|見積もり|お見積)",
    r"(?:個別相談|オンライン相談|オンライン面談)",
    r"(?:ウェビナー申込|セミナー申込|無料ウェビナー)",
    # 英語 UI
    r"(?:Contact\s*Us|Request\s*Demo|Book\s*a\s*Demo|Get\s*a\s*Quote)",
]

BTOB_CTA_SELECTORS = [
    'a[href*="/contact"]',
    'a[href*="/inquiry"]',
    'a[href*="/consultation"]',
    'a[href*="/download"]',
    'a[href*="/whitepaper"]',
    'a[href*="/request"]',
    'button[class*="cta"]',
]
```

#### C-2. Pricing 取得の BtoB フォールバック

BtoB では「価格表」ページが無く「お問い合わせ」で代替されるケースが通常。

```python
def extract_pricing_snippet(soup, url):
    # 1. 既存の price 抽出
    price = _extract_structured_price(soup)
    if price:
        return price

    # 2. BtoB フォールバック
    pricing_page_link = soup.select_one('a[href*="price"], a[href*="plan"], a[href*="fee"]')
    if pricing_page_link:
        return f"【価格ページあり】{pricing_page_link.get('href')}"

    # 3. 見積導線あり判定
    inquiry_link = soup.select_one('a[href*="inquiry"], a[href*="quote"]')
    if inquiry_link:
        return "【要問い合わせ】個別見積（BtoB 標準）"

    return None  # 従来の「取得不可」
```

#### C-3. `pricing_status` フィールド追加

「取得不可」と「BtoB 特性により存在しない」を区別：

```python
class LPData:
    pricing_snippet: str | None
    pricing_status: Literal["available", "inquiry_only", "not_found", "error"]
```

`pricing_status=inquiry_only` の場合、レポートで「弱い訴求」判定を下さない（BtoB として妥当なため）。

**検収**: `python -m pytest backends/market-lens-ai/tests/test_extractor.py::test_btob_cta -v`。手動で ht-itc.jp と toshiba-dmi.co.jp のスクレイピング結果を取得率 6/12 以上に引き上げる。

---

### Section D — UI ロジック層の改善（Frontend Claude）

**目的**: Stitch 2.0 の見た目刷新と並行して、ロジック層（データ構造・状態遷移）を正しくする。

**対象ファイル**:
- [src/utils/reportQuality.js](src/utils/reportQuality.js)
- [src/pages/Discovery.jsx](src/pages/Discovery.jsx)
- [src/components/report/CompetitorMatrix.jsx](src/components/report/CompetitorMatrix.jsx)
- [src/components/report/BrandRadarChart.jsx](src/components/report/BrandRadarChart.jsx)

#### D-1. 品質警告の severity 分離

[reportQuality.js:16-30](src/utils/reportQuality.js#L16-L30) の critical tokens を 2 段階に分離：

```js
const BLOCKER_TOKENS = [
  "最優先3施策",          // これ欠損 → レポート使用不可
  "5-1 LP改善施策",
  "5-2 検索広告施策",
  "末尾欠け",
  "Section 5",
];

const WARNING_TOKENS = [
  "5-3 Meta/ディスプレイ施策",  // 任意セクション
  "5-4 KPI測定計画",
  "評価保留密度",
];
```

フロント側で `blockerIssues` と `warningIssues` を別配列で返し、UI で**赤バナー**と**黄バナー**に描き分ける。

#### D-2. Section 5 欠損時の「再生成」CTA

[Discovery.jsx:957-969](src/pages/Discovery.jsx#L957-L969) のバナー直下に、blocker issues がある場合のみ表示：

```jsx
{hasBlockerIssues && (
  <button onClick={() => handleRegenerate({ focus: "execution_plan" })}>
    実行プランを再生成（対象を絞って再実行）
  </button>
)}
```

API 側は `/api/discovery/jobs/{id}/regenerate` で `target_sections=["execution_plan"]` を受けて Section 5 のみ生成。

#### D-3. 参考観測枠の視覚降格

COMPETITOR MATRIX / BRAND RADAR で、`role=reference` のブランドは：
- マトリクス列は opacity 0.5、ツールチップで「参考観測枠: 分析精度 low」
- レーダーは破線ストローク

#### D-4. データ欠損セルの明示

現状 `・-` 表示を `評価保留（データ不足）` バッジに変更。クリックで根拠モーダル（何のフィールドが不足して評価保留か）を開く。

#### D-5. ヘッダー数値の正規化

現状:
```
8件候補 3サイト分析
```

変更：
```
分析: 3 サイト / 候補: 8 サイト中 5 サイト未分析（理由: スコア閾値 / 分析上限）
```

数字の不整合を情報として取り込む。

#### D-6. 固定 TOC サイドバー（v2 のみ）

[src/components/report/v2/ReportViewV2.jsx](src/components/report/v2/ReportViewV2.jsx) の `.ui-v2` グリッドに 3 列目追加：

```css
.ui-v2-grid {
  grid-template-columns: 220px 1fr;  /* 左: TOC, 右: 本文 */
}
```

TOC はスクロール連動（IntersectionObserver で現在位置ハイライト）。

**検収**: `npm run build` → `webapp-testing` skill で品質警告の severity 分離と「再生成」ボタンの動作、TOC のスクロール連動を検証。

---

### Section E — PDF / コピー出力の品質保証（Frontend Claude）

**目的**: クライアント提出時に品質警告が混入したり、ヘッダー数値が誤って出力されたりする事故を防ぐ。

**対象ファイル**:
- [src/components/report/PrintButton.jsx](src/components/report/PrintButton.jsx)
- [src/utils/reportExport.js](src/utils/reportExport.js)
- [src/pages/Discovery.jsx](src/pages/Discovery.jsx)（@media print CSS）

#### E-1. 印刷時の警告バナー非表示

```css
@media print {
  .quality-warning-banner,
  .regenerate-cta,
  .ui-version-toggle,
  .font-size-controls {
    display: none !important;
  }
}
```

#### E-2. PDF エクスポート前のプリフライト確認

PDF ボタン押下時、blocker issues がある場合は confirm：

```jsx
if (hasBlockerIssues) {
  const ok = confirm(
    "このレポートには欠損セクションがあります。クライアント提出用PDFを作成しますか？\n" +
    "（推奨: 先に「実行プランを再生成」）"
  );
  if (!ok) return;
}
```

#### E-3. コピー時の toast フィードバック

[reportExport.js](src/utils/reportExport.js) の `copyReportToClipboard()` 成功後、React 側に toast 表示（既存の toast コンポーネントがあれば流用、無ければ 2 秒で消える inline banner）。

**検収**: Chrome DevTools で印刷プレビューを開き、`.quality-warning-banner` が非表示になることを目視確認。

---

### Section F — Stitch 2.0 デザイナー向けブリーフ（人間向け）

**目的**: Stitch 2.0 改修時に、上記のロジック改善を踏まえたビジュアル設計を行う。以下はデザイン要件のみ（実装指示ではない）。

#### F-1. ヘッダー領域

- **大見出し**: 分析対象数 / データ信頼度（Data Coverage %）を primary に。
  - 例: `ペタビット株式会社 vs 3 社 · 信頼度 62%`
- **サブ情報**: ジョブ ID / 実行時間 / モデルは secondary text で 1 行に統合し、hover で詳細展開。
- **業界タグ**: `ITコンサルティング` は tertiary container (#f5ecd4) の pill で。

#### F-2. 品質警告バナー

- **Blocker 用（赤）**: MD3 `error-container` (#f9dedc) + アイコン🚨 + 大見出し「実行プランが欠損しています」+ 主 CTA「再生成する」
- **Warning 用（黄）**: 従来 amber (#fef3c7) + 副次 CTA「対象を絞って再実行」
- 2 層ある場合は縦スタック、間に 12px spacing。

#### F-3. COMPETITOR MATRIX

- **多列対応**: ブランド数 × 評価軸の本格的マトリクス。ブランド列はスクロール可能。
- **セルカラー**:
  - 強: #0f5238 (primary dark)
  - 同等: #c4e8d1 (primary container)
  - 弱: #fee2e2 (error container light)
  - 評価保留: ハッチング or diagonal stripes で「データ不足」
- **参考観測枠**: 列ヘッダーを italic + opacity 0.65、下に「(参考)」ラベル。

#### F-4. BRAND RADAR

- 複数ブランドの重ね描き対応（最大 4 社）。
- 参考観測枠は破線 + opacity 0.5。
- 軸が 3 軸未満で点灯している場合は、チャートの代わりに「**データ不足: 6 軸中 N 軸のみ評価可能**」というプレースホルダを表示。

#### F-5. 発見された LP カード

- OGP 欠損時の fallback: URL 文字列 + ファビコンの placeholder card（統一感のある無地カード）。現在のピンク placeholder はブランド色と乖離。
- 「分析する」ボタンの遷移先を明示: `→ このサイトの深掘り分析`（LP 比較分析ページへ）。

#### F-6. Section 目次（固定 TOC）

- 左固定 220px、モバイルでは上部から折りたたみ。
- 現在位置ハイライトは primary color で下線。

#### F-7. TRACKING (KPI) カード

- KPI 空欄時の fallback: `KPI 測定計画は再生成で取得可能` の CTA カード 1 枚に置き換え。

---

## 実装優先順位と工数見積

| 優先度 | Section | タイトル | 工数目安 | 担当 |
|-------|---------|---------|---------|------|
| **P0** | A | ITコンサル業界 priors 追加 | 0.5h | Backend |
| **P0** | B-1 | Token 単純増枠 8192 | 0.5h | Backend |
| **P0** | B-2 | Section 5 強制プロンプト | 1h | Backend |
| **P0** | D-1,D-2 | 品質警告 severity 分離 + 再生成CTA | 2h | Frontend |
| **P0** | E-1 | 印刷時の警告非表示 | 0.5h | Frontend |
| **P1** | B-3,B-4 | compact_output 自動化 + 業界テンプレ | 2h | Backend |
| **P1** | C-1,C-2 | BtoB CTA / pricing 抽出 | 3h | Backend |
| **P1** | D-3,D-4,D-5 | 参考観測枠降格・欠損セル明示・ヘッダー正規化 | 3h | Frontend |
| **P2** | B-2段階生成 | Two-phase 生成（フィーチャーフラグ） | 5h | Backend |
| **P2** | C-3 | pricing_status フィールド | 1h | Backend |
| **P2** | D-6 | 固定TOC | 2h | Frontend |
| **P2** | E-2,E-3 | PDF プリフライト / コピー toast | 1h | Frontend |
| **Design** | F | Stitch 2.0 ブリーフ | — | デザイナー |

**P0 合計**: 4.5h（即日対応可能）
**P0+P1 合計**: 14.5h（2 営業日）

---

## 検証プラン（完了条件）

### E2E シナリオ

同じペタビット URL（https://www.petabit.co.jp/）で再実行し、以下を満たすこと：

1. ✅ 市場規模が「600〜900 億円」相当の IT コンサル業界 prior を使用（`low` → `medium` 信頼度）
2. ✅ 実行プラン（Section 5-1, 5-2）が本文に展開され、各 3 施策以上
3. ✅ 品質警告が 0 件、または任意セクション（5-3, 5-4）の warning のみ
4. ✅ 辻・本郷IT の Main CTA / Pricing が取得成功（取得率 6/12 以上）
5. ✅ COMPETITOR MATRIX に辻・本郷IT 列が描画される（参考観測枠は opacity 0.5 で東芝）
6. ✅ BRAND RADAR が 6 軸中 4 軸以上点灯、複数社のポリゴン重ね描き
7. ✅ PDF 出力に品質警告・UIトグル・フォントサイズコントロールが含まれない
8. ✅ 「実行プラン再生成」ボタンで Section 5 のみを再取得できる

### 自動テスト

```bash
# Backend
cd backends/market-lens-ai
python -m pytest tests/test_market_estimator.py -v
python -m pytest tests/test_analyzer_prompt.py::test_it_consulting_section_5 -v
python -m pytest tests/test_extractor.py::test_btob_cta -v

# Frontend
npm run build
```

### 手動回帰テスト（webapp-testing skill で Claude 自身が実行）

- `/discovery` ページで IT コンサル系 URL（petabit.co.jp）を実行
- 完了後のレポート全セクションが展開されているか目視
- 隣接画面（LP比較分析、クリエイティブ診断）で regression が無いか確認

---

## 参考：現状コード位置早見表

| 概念 | ファイル:行 |
|-----|-----------|
| Discovery エンドポイント | [discovery_routes.py:185,321,492](backends/market-lens-ai/web/app/routers/discovery_routes.py) |
| Claude 呼び出し | [anthropic_client.py:169,252](backends/market-lens-ai/web/app/anthropic_client.py) |
| Token Budget 定数 | [analyzer.py:50-53](backends/market-lens-ai/web/app/analyzer.py#L50-L53) |
| 出力スキーマ契約 | [analyzer.py:1158-1167](backends/market-lens-ai/web/app/analyzer.py#L1158-L1167) |
| compact_output 圧縮方針 | [analyzer.py:1765-1776](backends/market-lens-ai/web/app/analyzer.py#L1765-L1776) |
| 業界分類 | [estimator.py:94-122](backends/market-lens-ai/web/app/market_estimator/estimator.py#L94-L122) |
| industry priors | [industry_priors.yaml](backends/market-lens-ai/web/app/market_estimator/industry_priors.yaml) |
| 抽出フィールド | [analyzer.py:97-102](backends/market-lens-ai/web/app/analyzer.py#L97-L102) |
| Truncation Notice | [anthropic_client.py:163-207](backends/market-lens-ai/web/app/anthropic_client.py#L163-L207) |
| Discovery ページ本体 | [Discovery.jsx:1-1163](src/pages/Discovery.jsx) |
| 品質警告バナー | [Discovery.jsx:957-969](src/pages/Discovery.jsx#L957-L969) |
| 品質検証ロジック | [reportQuality.js:16-248](src/utils/reportQuality.js) |
| V2 レポート | [ReportViewV2.jsx](src/components/report/v2/ReportViewV2.jsx) |
| MD3 トークン | [tokens.css](src/components/report/v2/tokens.css) |
