# Insight Studio ハンドオフ: EC Direct 連携 + Claude API → Gemini 3.1 Flash 完全移行

> このドキュメントは別リポジトリ **Insight Studio** の Claude Code セッションに渡すための **ハンドオフ・プロンプト** である。
>
> 実装は本リポジトリ (EC Growth Studio AI) では行わない。本ドキュメントを Insight Studio 側にコピーし、そこの Claude Code に「このplanに従って実装してくれ」と投げて使う。
>
> 作成者: 不二樹和志 (ペタビット株式会社) / 設計補助: Claude Code (EC Growth Studio AI セッション) / 作成日: 2026-05-03

---

## Context（なぜこの変更か）

### 1. ビジネス背景

ペタビット社の **Insight Studio** は GA4 + BigQuery 連携の AI考察ツールとして稼働中である。社内デモMTG (2026-04-23) で次のシグナルが確認された:

- 峯林光氏: 「顧客のGA4データから具体的改善提案までは出せていない」 → **月次改善ループ化** のニーズ確定
- 本田航大氏: dev部門との連携意欲あり
- 石ダイレクト等の既存顧客が GA4 接続済み

並行して、姉妹プロジェクト **EC Growth Studio AI** で「Shopify接続→AIが月次改善ブリーフを出す」プロトタイプを検討してきた。両者を別製品で並走させるより、**Insight Studio に EC platform 連携を "EC モジュール" として統合する方が合理的** との判断に至った。

### 2. 政治的・コスト制約（最重要）

| 項目 | 現状 |
|------|------|
| Insight Studio AI考察の現使用モデル | Claude Sonnet 4.6 |
| 月額API料金 | 約 ¥20,000 |
| 支払主体 | **不二樹和志（個人負担）** |
| 会社の精算ルール | **Google製品のみ精算可。Anthropic は対象外** |
| スケール時の予測 | 顧客100社で月数百万円オーダーに化ける |

→ **Gemini 3.1 Flash への完全移行が事業継続上必須** である。

### 3. 品質懸念と「政治的エスカレーション戦略」

一般論として Claude > Gemini Flash の精度は事実。じゃが本案件では下記の戦略を取る:

1. **Gemini 3.1 Flash でまず運用開始**
2. **品質課題を構造的にログ化** （感覚論ではなく定量・定性の証拠として蓄積）
3. **そのログを上司への交渉材料** に使い、「Claude API を精算対象に追加すべき」と提案する

→ つまり **品質ログ機構** はオプションではなく Phase 1 と同列の Hard Requirement である。後付けにしてはならぬ。

---

## Goals（3つのゴール）

| # | ゴール | 成功指標 |
|---|------|---------|
| **G1** | Claude API → Gemini 3.1 Flash への完全移行 | 月額APIコストが Sonnet比 **1/3以下**、Vertex AI経由でGCP請求一本化 |
| **G2** | EC Direct 連携機能の追加 | EC Direct 経由で products/orders/customers/inventory を取得、GA4 × EC Direct 横断のAI考察が動く |
| **G3** | 品質ログ機構の組込 | 月次品質レポートが自動生成され、上司提出可能な体裁である |

---

## 実装フェーズ

### Phase 0: 現状調査（必須・他より先行）

Insight Studio リポジトリを Claude Code が調査し、下記を `plans/insight-studio-current-state.md` に記録する。

#### 調査項目

1. **現 Claude API 利用箇所の洗い出し**
   - import 箇所一覧
   - 機能別の呼び出しパターン（AI考察 / 競合発見レポート / バナーレビュー / その他）
   - プロンプト構造（単一? 複数? prompt caching 利用状況）
   - 入出力スキーマ（Markdown? JSON? structured output?）

2. **既存 connector / data ingestion パターン**
   - GA4 Data API 連携の構造
   - BigQuery 連携の構造
   - 認証方式（OAuth / service account / API key）
   - 顧客データ分離（マルチテナント実装）

3. **現在のレポート生成パイプライン**
   - データ取得 → 集計 → AI narrative の流れ
   - 出力フォーマット
   - 既存テスト基盤の有無

#### Phase 0 完了条件

`plans/insight-studio-current-state.md` に上記が記載され、Phase 1 以降の優先順位を **同ファイル末尾に再提案** していること。

---

### Phase 1: LLM Provider 抽象層の導入

#### 目的

モデル切替を「設定変更」だけで完結するアーキにする。エスカレーション成功時に即 Claude へ戻せる状態を維持する。

#### 要件

- `LLMProvider` interface を定義
  - `generate(purpose, structuredInput, schema, options) → Output`
  - `purpose` の例: `"narrative"` / `"classification"` / `"multimodal"` / `"competitor_research"` / `"banner_review"`
- 実装クラス
  - `ClaudeProvider`（既存呼び出しをラップ。**削除しない**）
  - `GeminiProvider`（新規、Vertex AI経由、Gemini 3.1 Flash デフォルト、Pro も呼べる構成）
- 切替方式
  - 環境変数 `LLM_PROVIDER`（`claude` / `gemini`）
  - 環境変数 `LLM_MODEL`（`gemini-3.1-flash` / `gemini-3.1-pro` / `claude-sonnet-4-6` 等）
  - 機能別オーバーライドも可能にする（例: `LLM_MODEL_BANNER_REVIEW=gemini-3.1-pro`）
- 既存の Claude 直接呼び出しを **全て抽象層経由にリプレース**

#### 設計原則（Insight Studio 側で既に実践されている方針を踏襲）

- **構造先行・LLMは語り部** パターンを徹底
  - 数値計算・集計・絞り込みは Python / SQL で完結
  - LLM には「構造化済みの発見」だけを渡し、narrative 生成のみ委譲
- Function calling / structured output で **型安全** に出力
  - 自由記述に依存させない
  - JSON schema を強制してパース失敗を減らす

---

### Phase 2: Gemini 3.1 Flash への完全移行

#### 要件

- **Vertex AI 経由** で Gemini 3.1 Flash を呼び出す（素の Generative Language API は使わない。GCP請求一本化のため）
- **Context Caching を有効化**（プロンプトの安定部分を75%オフで運用）
- `LLM_PROVIDER=gemini` をデフォルトに
- マルチモーダル機能（バナーレビュー等）は **Phase 0 の調査結果で Pro が必要と判明したらそのまま Pro に切替** ／ Flash で十分なら Flash 維持

#### 移行検証手順（Hard Requirement）

1. 移行前に **「現在のClaude出力サンプル 10件以上」** を凍結保存
   - `quality-comparison/baseline-claude-{YYYY-MM-DD}/*.md` に保存
2. 移行後、同じ入力で Gemini 3.1 Flash 出力を取得
   - `quality-comparison/baseline-gemini-{YYYY-MM-DD}/*.md` に保存
3. **ブラインドA/B評価**（峯林氏 + user）
   - 評価軸: 数値正確性 / 因果説明の妥当性 / 改善案の具体性 / 文章品質
   - 評価結果を `quality-comparison/ab-result-{YYYY-MM-DD}.md` に保存
4. 重大な品質低下が出た機能だけ **個別に Pro 昇格 or Claude 残留** の判断をする

---

### Phase 3: EC Direct コネクタの追加

#### EC Direct とは

ペタビット社の自社サービス **「EC Direct」**: EC構築・運用代行サービス。Shopify / 楽天 / 自社カートを束ねる窓口で、複数顧客のEC運用データを蓄積している。Insight Studio がここから読み取り専用で連携することで、GA4 だけでは見えない **商品・受注・在庫・顧客LTV** にアクセスできるようになる。

#### 要件

- EC Direct 側の API / DB から下記を取得
  - `products`（商品マスタ）
  - `orders`（受注）
  - `customers`（顧客）
  - `inventory`（在庫）
  - 将来拡張: `shipments` / `returns` / `reviews`
- 認証方式は EC Direct チームと協議
  - 内製APIの想定 → token / service account / 顧客スコープの権限境界を確認
- データ正規化は既存 GA4/BQ 連携と同じパイプライン構造に揃える
  - `COLUMN_SYNONYMS` 的な多言語フィールド検出
  - 数値・日付・通貨の正規化
  - 集計層を経由して KPI 化

#### 横断分析の追加

- **GA4 (流入・行動) × EC Direct (受注・在庫・顧客LTV) の融合指標**
- 売上要因分解: `売上 = セッション × CVR × AOV`
  - セッション・CVR は GA4
  - AOV は EC Direct
- **クロス検出**:
  - 在庫切れ × PDP流入 = 機会損失商品
  - 高LTV顧客 × 流入元チャネル = 投資すべき獲得経路
  - 利益率高 × 流入低 = 押すべき商品

UIは Insight Studio の既存パターンに従う。本リポジトリ (EC Growth Studio AI) のUIに無理に揃えなくてよい。

---

### Phase 4: 品質ログ機構（政治的本命）

#### 目的

Gemini 出力の品質課題を構造的にログ化し、Claude API 精算化の交渉材料として蓄積する。

#### 要件

##### 4.1 自動品質メトリクス

LLM 出力に対して以下を自動チェックし、issue として記録:

- **数値ハルシネーション検出**: narrative 中の数字を parse → 構造化済み集計値と一致するか自動照合
- **出力 schema 違反検出**: 期待 JSON schema からの逸脱
- **空欄・短すぎる出力の検出**: 最低文字数 / 必須セクション欠落
- **既知の誤りパターン**: 「次月予測」が前月実績と一致 / 通貨単位混在 / etc.

##### 4.2 手動品質フラグ UI

- 峯林氏 / user が出力レポートを開いた状態から **「これはダメ」フラグを立てる** UI を用意
- 理由カテゴリを選択
  - `factual_error`（事実誤認）
  - `weak_recommendation`（提案が弱い）
  - `missing_context`（文脈不足）
  - `wrong_priority`（優先順位がおかしい）
  - `language_quality`（日本語が不自然）
  - `other`
- 自由記述メモ欄

##### 4.3 品質ログストア

- テーブル / ファイル: `quality_log`
- 各エントリのフィールド
  - `timestamp` / `customer_id` / `function_name` / `model_used` / `input_summary` / `output` / `issue_type` / `severity` / `reviewer` / `notes`

##### 4.4 月次品質レポート（自動生成）

- ファイル名: `quality-monthly-{YYYY-MM}.md`
- 内容
  - 総生成数 / フラグ数 / 重大issue件数
  - issue カテゴリ別内訳
  - Claude (Sonnet 4.6) ベースライン比較（Phase 2 で取得した A/B結果との突合）
  - 「Claude精算化を提案する根拠データ」セクション
- これを **上司への定期提出資料** として使う

→ **Phase 4 は Phase 1 と同時実装する**。後回しにしてはならぬ。本案件の最重要成果物である。

---

## Acceptance Criteria（受け入れ条件）

- [ ] 既存の Claude API 呼び出しが全て LLM Provider 抽象層経由になっている
- [ ] `LLM_PROVIDER=gemini` で Gemini 3.1 Flash 呼び出しが動作する
- [ ] `LLM_PROVIDER=claude` で旧 Claude 呼び出しが動作する（戻せる状態）
- [ ] Vertex AI 経由で GCP 請求に乗っている
- [ ] EC Direct から products / orders / customers / inventory が取得できる
- [ ] GA4 × EC Direct 横断の月次ブリーフが生成される
- [ ] 品質ログ機構（自動 + 手動）が動作する
- [ ] 月次品質レポートが自動生成される
- [ ] 移行前後の品質比較レポートが `quality-comparison/` 配下に存在する
- [ ] 月額APIコストが Sonnet 4.6 比で **1/3 以下** に減っている（実測値）
- [ ] Claude Provider のコードは残されており、環境変数1つで戻せる

---

## Verification（検証手順）

| 観点 | 手順 |
|------|------|
| ユニット | `LLMProvider` 抽象層の双方向テスト（同一 input で claude/gemini の output が共通 schema を満たす） |
| 統合 | EC Direct mock データで月次ブリーフ生成 → Markdown を目視確認 |
| 品質 | ブラインドA/B 10件評価（峯林氏 + user）、結果を quality-comparison に保存 |
| コスト | 1ヶ月運用後の Vertex AI 請求と Anthropic 請求 (¥0想定) を比較し、Acceptance Criteria の 1/3 以下を満たすか確認 |
| エスカレーション | Phase 4 の月次品質レポートが提出可能体裁で生成されているか確認 |

---

## Reference: EC Growth Studio AI 側で検討済みの設計パターン

別リポジトリ (EC Growth Studio AI / `c:\Users\PEM N-266\work\ec-growth-studio-ai`) で既に詰めたパターンを、必要に応じて Insight Studio に持ち込む。**「Insight Studio 既存パターンと食い違う場合は既存に合わせる」** 方針で、強制移植はしない。

### Growth Brief 構造（参考: `src/data/sample.ts` L1380–1488）

```
GrowthBrief {
  month                  // "2026-04" 等
  source                 // "shopify" | "csv" | "demo" | "ec_direct" 等
  headline               // 1行サマリー
  revenueChange          // 金額・% 差分
  primaryDriver          // 主因
  findings[]             // 発見事項
  topActions[]           // 今月の3施策
  neededData[]           // 不足データ
  safetyChecks[]         // 実行前確認事項
}
```

UIで `source` を切り替えると同じレイアウトで EC Direct / GA4 / 横断 のいずれにも適用可。

### RecommendedAction 構造（参考: 同上 L1367–1378）

```
RecommendedAction {
  rank          // 1-3
  title
  area          // "流入" | "PDP" | "在庫" | "AOV" 等
  expectedImpact
  effort        // "低" | "中" | "高"
  confidence    // "高" | "中" | "低"
  reason
  beforeApproval  // 実行前の確認事項
  writeStatus     // "反映案" | "実行指示案" | "承認待ち"
}
```

優先度は `rank + confidence` の多軸ソート。書き込みは初期しない。

### Agent Handoff 構造（参考: 同上 L1490–1523）

actionId → Claude/Codex への instruction (Markdown プロンプト) のマッピング。LLM Provider 抽象層経由で実行する想定。Gemini に渡しても同構造で動作する前提。

### CSV / API 正規化パイプライン（参考: `src/lib/csv/parse*.ts`）

`COLUMN_SYNONYMS`（多言語カラム検出） → `parseNumber`（¥ / カンマ除去） → `parseDate`（複数フォーマット対応） → `aggregate*`（KPI化）。EC Direct API レスポンス正規化に同じ枠で適用可能。

### 売上要因分解（参考: 同上 L712–961）

`売上 = セッション × CVR × AOV` の連鎖法分解 + `factors[]` / `causes[]` で構造化。`driverNote` フィールドが AI考察のトリガーになる粒度設計。

---

## Open Questions（Phase 0 の現状調査で Claude Code が解明すべき事項）

1. EC Direct 側の API / DB 仕様: 公開ドキュメントある? 認証方式? 顧客データ分離方式?
2. 現 Claude API 利用箇所の数と粒度: 1モジュール集約? 散在?
3. Prompt caching 現状: 利用しているか? 効率化余地は?
4. 既存テスト基盤: A/B検証フレームワークが既にあるか?
5. 認証 / マルチテナント: 顧客プロジェクトごとの分離はどう実装されておるか?
6. 競合発見レポート / バナーレビュー の実装場所: 移行時のリスクヘッジ要件
7. Gemini Pro の併用方針: マルチモーダル（バナーレビュー）は Pro が必要かもしれない
8. 月次レポート出力フォーマット: PDF? Markdown? Web UI? → EC Direct 連携後の出力体裁に影響

これらは Phase 0 完了時点で `plans/insight-studio-current-state.md` に **回答が書かれていること** を期待する。

---

## Hard Constraints（破ってはいけない制約）

- **Claude Provider のコードは削除しない**。エスカレーション成功時に即戻せる状態を維持。
- **Vertex AI 経由必須**。素の Gemini API は使わない（GCP請求一本化のため）。
- **品質ログ機構は事後追加でなく Phase 1 と同時実装**。後回しにすると政治的勝利が遠のく。
- **既存 Insight Studio 機能の互換性は維持**。既存顧客の月次レポート生成が止まらないこと。
- **段階的移行**。big-bang ではなく `LLM_PROVIDER` フラグで切替可能な状態を保つ。
- **個人情報 / 顧客データの取扱に注意**。EC Direct 経由で受注・顧客データに触れるため、ログや A/B サンプルに個人情報が混入しないこと。

---

## このハンドオフを Insight Studio で使う手順

不二樹氏が Insight Studio リポジトリに移動した後、以下の手順で進める。

1. 本ファイルを Insight Studio リポジトリの `plans/insight-studio-handoff.md` にコピーする
2. Insight Studio で Claude Code セッションを起動する
3. 最初の指示として下記を投げる:

> 「`plans/insight-studio-handoff.md` を読み込み、まず **Phase 0 の現状調査** を実行してくれ。調査結果を `plans/insight-studio-current-state.md` に書き出した上で、Phase 1 以降の優先順位とリスクを提案してほしい。実装は段階的に進める。各フェーズの開始前に必ず確認を求めること。」

4. Phase 0 完了後、Claude Code の調査結果を確認し、Phase 1 以降を承認する。

---

## このハンドオフを書いた経緯

- 2026-04-23 デモMTGの議事録から、ペタビット社内に EC Growth Studio AI のニーズがあることを確認
- 2026-05-03 検討の結果、別製品ではなく Insight Studio への統合（選択肢B）が最適と判断
- 同日、API料金が個人負担で月¥20,000かかっておる事実が判明 → Gemini 3.1 Flash 移行が必須
- 同日、品質低下リスクへの対処として「品質ログ→上司エスカレーション」戦略を決定
- 本ハンドオフを EC Growth Studio AI セッションで作成し、Insight Studio セッションへ受け渡す
