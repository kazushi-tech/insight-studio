# Discovery 実行プランセクション欠損 根絶プラン（P1 フォロー拡張版）

**作成日**: 2026-04-18
**起票元**: `2026-04-18-discovery-action-plan-section-missing-followup.md`（PR #37 で起票された初版）を本プランで置換・拡張
**オーナー**: 不二樹 / 次セッション担当 Claude
**優先度**: P1（実害あり／ユーザーに品質警告が常時表示される）
**対象**: `backends/market-lens-ai/` 全般（プロンプト／LLM クライアント／品質ゲート／テスト）
**スコープ外**: `src/` フロント改修（Phase B で完結済み）、`ads-insights`、モバイル対応

---

## 1. Context（なぜ本プランが必要か）

### 1-1. 観測された症状
本番 `https://insight-studio-chi.vercel.app/discovery` のカメラの大林レポート（search_id `0cf86273b3f3`）で、画面上部に常時：

> 品質チェックで注意事項があります
> ・セクション欠損: アクションプランが見つかりません

### 1-2. PR #36（Phase A/B）との関係
- PR #36 で Phase B の `PriorityActionHero` コンポーネントを追加
- PR #37 でフロント検出キーワードをバックエンド品質ゲートに整合（対症療法）
- **しかし根本原因は LLM 出力側でセクション自体が生成されていないこと**であり、PR #37 では治療できない
- 本プランは**バックエンド側の根絶**を目的とする

### 1-3. 事前調査で判明した根本原因（5 層）

| 層 | 問題 | 証拠 |
|---|---|---|
| **L1 可観測性不足** | `stop_reason` / `finish_reason` を一切キャプチャしていない | [llm_client.py](backends/market-lens-ai/web/app/llm_client.py) / [anthropic_client.py](backends/market-lens-ai/web/app/anthropic_client.py) にログ実装なし |
| **L2 プロンプト差分** | Discovery (wide) のセクション 5 指示が Compare (deep) より省略版。加えて「全体でおおむね 2200 字以内」の強制があり token 圧迫時に切断される | [analyzer.py:1550-1580](backends/market-lens-ai/web/app/analyzer.py#L1550-L1580) vs [analyzer.py:1325-1370](backends/market-lens-ai/web/app/analyzer.py#L1325-L1370)、2200字制約は [analyzer.py:1609](backends/market-lens-ai/web/app/analyzer.py#L1609) |
| **L3 品質ゲートの網羅不足** | `_quality_gate_check` は「実行プラン」見出しと「5-2 検索広告」欠損しか検出せず、「最優先 3 施策」「5-0 予算フレーム」「5-1」「5-3」「5-4」は未検証 | [report_generator.py:233-275](backends/market-lens-ai/web/app/report_generator.py#L233-L275) |
| **L4 決定論的補完の欠如** | Phase A で `deterministic_evaluator` / `market_estimator` は判定・市場数値のみ注入。**本文セクション欠損時のスタブ注入ロジックは不在** | [report_generator.py](backends/market-lens-ai/web/app/report_generator.py) 全体、注入箇所なし |
| **L5 テストの盲点** | `test_cross_report_consistency.py` は「判定ブロック」「市場ブロック」の一致のみ検証。本文 5 セクションの網羅性は未テスト | [test_cross_report_consistency.py](backends/market-lens-ai/tests/test_cross_report_consistency.py) の 6 テストすべて |

### 1-4. 既存のリトライ挙動
[discovery_pipeline.py:941-989](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L941-L989) に品質リトライが存在するが、`_is_retryable_quality_issue()` はトップレベル見出しのみ判定ゆえ、**サブセクション欠損ではリトライしない**。かつリトライ時に Compact モード（`compact_output=True` → 出力 token 予算が 5120 → 3072 に削減）に入るため、**リトライが状況を悪化させる逆効果**の可能性あり。

---

## 2. 前提確認チェックリスト（次セッション着手時）

- [ ] `git pull origin master` で `3b17158` が HEAD にあるか確認
- [ ] `cd backends/market-lens-ai && python -m pytest tests/ -q` が全緑（35/35 PASS）か確認
- [ ] Render dashboard で `market-lens-ai` サービスの env-var に `REPORT_ENVELOPE_V0=true` と `SHARED_EVAL_ENABLED=true` が揃っているか
- [ ] `plans/2026-04-18-discovery-action-plan-section-missing-followup.md` の初版が git に存在するか（本プランはその拡張版）

1 つでも NG なら作業着手せず不二樹に確認すること。

---

## 3. 実行フェーズ（5 段階）

### Phase P1-A: 可観測性の土台（所要 1〜2 時間 / 破壊的変更なし）

**目的**: 修正前に「何が起きているか」を測定可能にする。計測なしで対症療法を打つのは禁じ手じゃ（`feedback_no_surface_fixes` 遵守）。

#### P1-A-1: `stop_reason` キャプチャ
- [backends/market-lens-ai/web/app/anthropic_client.py](backends/market-lens-ai/web/app/anthropic_client.py) にて Anthropic SDK のレスポンスから `stop_reason` を取得、`logger.info("llm_response stop_reason=%s input_tokens=%d output_tokens=%d", ...)` で構造化ログ出力
- [backends/market-lens-ai/web/app/llm_client.py](backends/market-lens-ai/web/app/llm_client.py) の戻り値型を `dict[str, Any] | str` ではなく `LLMResponse` dataclass に格上げし、`text / stop_reason / input_tokens / output_tokens` を内包
- 呼び出し側（`analyzer.analyze()`、`discovery_pipeline.analyze()`）を dataclass 受け取りに更新
- **重要**: LLM のプロバイダ切替（Claude/Gemini 等）があるなら共通インタフェース化

#### P1-A-2: セクション構造ログ
- [report_generator.py](backends/market-lens-ai/web/app/report_generator.py) の `_quality_gate_check` 呼び出し直後で、**検出されたセクション見出し一覧**と**サブセクション検出結果**（最優先3、5-0、5-1、5-2、5-3、5-4 の有無）を INFO レベルでログ
- ログ形式例: `section_audit scan_id=... sections=[ES, AP, CS, BE, EP] subsections_5={0:true, 1:true, 2:false, 3:false, 4:false}`

#### P1-A-3: Render 実ログ収集
- Render dashboard → `market-lens-ai` → Logs で、直近 10 件の Discovery job のログを検索し `stop_reason` と `section_audit` を抽出
- **観察結果を調査ログとして `plans/2026-04-18-discovery-llm-observation-log.md` に記録**（別ファイル新規作成、本プラン参照元）
- 観察項目：
  - `stop_reason == "max_tokens"` の発生頻度
  - 欠損しているサブセクションの分布
  - 欠損時の input_tokens / output_tokens 比率
  - Compact モード発動頻度と発動後の欠損率

**Gate（次フェーズに進む条件）**:
- `stop_reason` が実ログで確認できる
- 欠損パターンが 3 分類以上に整理できている（token 切断 / 指示不明瞭 / プロバイダ側バグの別を切り分け）

---

### Phase P1-B: プロンプト是正（所要 2〜3 時間 / 破壊的変更：プロンプト文言）

**目的**: P1-A で判明した欠損パターンに基づき、Discovery (wide) プロンプトを Compare (deep) 相当まで強化する。

#### P1-B-1: セクション 5 指示の詳細化
- [analyzer.py:1550-1580](backends/market-lens-ai/web/app/analyzer.py#L1550-L1580) を [analyzer.py:1325-1370](backends/market-lens-ai/web/app/analyzer.py#L1325-L1370) と指示レベルを揃える
- 特に以下を明示：
  - **最優先 3 施策は必ず冒頭に配置し、 `### 最優先3施策` 見出しをつけること**
  - セクション 5 の 6 サブセクション（最優先3／5-0／5-1／5-2／5-3／5-4）の**絶対必須 vs 任意**を明記
  - 「token 逼迫時は 4→3→5-3→5-4 の順で圧縮してよいが、**最優先3／5-0／5-1／5-2 は死守**」

#### P1-B-2: 2200 字制約の見直し
- [analyzer.py:1609](backends/market-lens-ai/web/app/analyzer.py#L1609) の「全体でおおむね 2200 字以内」指示は本問題の主犯候補の一つ
- P1-A の実測で「2200 字近辺で切断」が多数なら、**3200〜3800 字に緩和**（または削除して `output_tokens` 上限のみに委ねる）
- 緩和する場合、[analyzer.py](backends/market-lens-ai/web/app/analyzer.py) の `_MULTI_URL_MAX_OUTPUT_TOKENS_4PLUS_SITES = 5120` との整合を取る

#### P1-B-3: セクション固定ヘッダ宣言の強化
- [analyzer.py:1490-1494](backends/market-lens-ai/web/app/analyzer.py#L1490-L1494) の「5 セクション固定・追加省略順序変更禁止」指示を、JSON スキーマ風の厳格ブロックに書き換え：
  ```
  ## セクション契約（MUST）
  1. ## エグゼクティブサマリー
  2. ## 分析対象と比較前提
  3. ## 競合比較サマリー
  4. ## ブランド別評価
  5. ## 実行プラン
     ### 最優先3施策 [MUST]
     ### 5-0 予算フレーム [MUST]
     ### 5-1 LP改善施策 [MUST]
     ### 5-2 検索広告施策 [MUST]
     ### 5-3 Meta/ディスプレイ施策 [OPTIONAL: token逼迫時省略可]
     ### 5-4 KPI測定計画 [OPTIONAL: token逼迫時省略可]
  ```

#### P1-B-4: Compact モード改善
- [analyzer.py:1652-1663](backends/market-lens-ai/web/app/analyzer.py#L1652-L1663) の Compact 指示に「最優先3／5-0／5-1／5-2 は削らない」を明示
- Compact モード時のトークン予算 3072 が本当に適切か、P1-A の観測結果で再評価

**Gate**:
- プロンプト diff を codex-review skill に通し Critical ゼロ
- Fixture ブランド（カメラ3社）で手元 LLM 呼び出しテストを実施し、**6 サブセクションすべて出力されることを目視確認**

---

### Phase P1-C: 品質ゲート拡張（所要 2 時間 / 破壊的変更なし・検出強化のみ）

**目的**: LLM がたまたま欠損させた場合でも確実に検知・リトライできるようにする。

#### P1-C-1: サブセクション検出ロジック
- [report_generator.py:92-320](backends/market-lens-ai/web/app/report_generator.py#L92-L320) の `_quality_gate_check` を拡張
- 新規検出項目（警告レベル区分付き）：

| 欠損項目 | 警告レベル | 理由 |
|---|---|---|
| 「最優先3施策」見出し | **CRITICAL** | ビジネス価値の中核 |
| 「5-0 予算フレーム」 | **CRITICAL** | 予算なしは提案不成立 |
| 「5-1 LP改善」 | **CRITICAL** | LP 比較レポートの主眼 |
| 「5-2 検索広告」 | **CRITICAL** | 既存検出あり、維持 |
| 「5-3 Meta/ディスプレイ」 | **INFO** | 任意扱い |
| 「5-4 KPI測定」 | **INFO** | 任意扱い |

#### P1-C-2: `_HEADING_ALIASES` 拡張
- [report_generator.py:55-57](backends/market-lens-ai/web/app/report_generator.py#L55-L57) に以下を追加：
  ```python
  _HEADING_ALIASES = {
      "広告運用アクションプラン": "実行プラン",
      "アクションプラン": "実行プラン",
      "改善提案": "実行プラン",
      "最優先施策": "実行プラン",  # 冒頭だけ抽出された場合の救済
  }
  ```

#### P1-C-3: リトライ判定の拡張
- [discovery_pipeline.py:941-989](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L941-L989) の `_is_retryable_quality_issue()` を拡張
- CRITICAL レベル欠損は**必ずリトライ対象**にする
- リトライ時の Compact モード発動条件を厳格化：`stop_reason == "max_tokens"` かつ 2 回目以降のリトライに限定

#### P1-C-4: フロント警告の分類表示
- 既存 [src/utils/reportQuality.js](src/utils/reportQuality.js) の警告タイプを `critical` / `warning` / `info` に分類（enum 化）
- **※フロント改修は最小限**（Phase B で完結済みの方針維持）、クラス追加のみで配色は既存を流用

**Gate**:
- `pytest backends/market-lens-ai/tests/` で全緑
- 拡張された検出項目それぞれに対して境界値単体テスト追加（後述 P1-E）

---

### Phase P1-D: 決定論的スタブ注入（所要 3〜4 時間 / 慎重に）

**目的**: LLM 出力が不安定な限界下でも、「最優先3施策」と「5-0 予算フレーム」は**コード側で決定論的に生成**する。

#### 設計方針
- Phase A で整備済みの `deterministic_evaluator.py` と `market_estimator/` の出力を活用
- LLM 出力**本文**と決定論的生成**スタブ**をハイブリッド：
  - LLM が生成していれば LLM 版を優先
  - 欠損していればコード側スタブを注入
- スタブには必ず「【自動生成】」マークと「根拠」を明示し、ユーザーに判別可能に

#### P1-D-1: `priority_action_synthesizer.py` 新規
- 新規: [backends/market-lens-ai/web/app/priority_action_synthesizer.py](backends/market-lens-ai/web/app/priority_action_synthesizer.py)
- 入力: `deterministic_evaluator` の判定結果 × `market_estimator` の市場数値 × `ExtractedData`
- 出力: Markdown 文字列（`### 最優先3施策` セクション相当）
- ロジック：評価軸で「弱」と判定された項目の上位 3 件を施策化
  - 例: FV訴求=弱 → 「FV訴求を購買意図ベースのコピーに変更（期待効果：CTR+X%）」

#### P1-D-2: `budget_frame_synthesizer.py` 新規
- 新規: [backends/market-lens-ai/web/app/budget_frame_synthesizer.py](backends/market-lens-ai/web/app/budget_frame_synthesizer.py)
- 入力: `market_estimator` の出力（CPC 帯・CVR・推定月間検索 Vol）
- 出力: Markdown 文字列（`### 5-0 予算フレーム` セクション相当、月額予算帯・CPA ガイドライン・想定 CV）

#### P1-D-3: `report_generator.py` への接続
- [report_generator.py](backends/market-lens-ai/web/app/report_generator.py) の品質ゲート直後に、CRITICAL 欠損があれば P1-D-1 / P1-D-2 の合成器を呼び出し、**該当セクションを差し込む**（LLM 本文の直後に挿入）
- feature flag `DETERMINISTIC_STUB_ENABLED` で段階リリース制御

#### P1-D-4: 注意書き自動挿入
- スタブ注入時は Appendix A に「自動生成ブロック一覧」を記載（監査証跡）

**Gate**:
- 注入前後で `test_cross_report_consistency.py` が緑維持
- 新規単体テストで「欠損シナリオ → スタブ注入」が決定論的に動作
- codex-review で Critical ゼロ

---

### Phase P1-E: テスト拡張（所要 2 時間）

**目的**: 本問題を将来的にリグレッションさせない。

#### P1-E-1: セクション網羅性テスト
- 新規: `backends/market-lens-ai/tests/test_discovery_section_coverage.py`
- 目的: Discovery レポート本文が 6 サブセクションすべてを含むことを assert
- fixture: カメラ3社 / スポーツサプリ3社 / 水回り3社（既存）
- LLM 呼び出しはスタブ（決定論的擬似応答）で固定化

#### P1-E-2: 品質ゲート単体テスト拡張
- [backends/market-lens-ai/tests/test_quality_gate.py](backends/market-lens-ai/tests/test_quality_gate.py)（なければ新規）
- 各 CRITICAL / INFO 欠損パターンの検出を確認
- `_HEADING_ALIASES` 経由の救済も確認

#### P1-E-3: Stub 合成器のテスト
- 新規: `backends/market-lens-ai/tests/test_priority_action_synthesizer.py`
- 新規: `backends/market-lens-ai/tests/test_budget_frame_synthesizer.py`
- 決定論性（同じ入力 → 同じ出力）を assert

#### P1-E-4: E2E ゴールデンテスト拡張
- [test_cross_report_consistency.py](backends/market-lens-ai/tests/test_cross_report_consistency.py) に本文セクション構造の一致テストを追加
- Discovery / Compare で**同じ 6 サブセクション**が出力されることを assert

**Gate**:
- `pytest backends/market-lens-ai/tests/ -q` で全緑
- カバレッジが `_quality_gate_check` 全分岐を網羅

---

## 4. コミット計画（PR 分割方針）

| PR | 内容 | フラグ | 推定 LoC |
|---|---|---|---|
| PR-A | Phase P1-A: `stop_reason` / section_audit ログ | なし（観測のみ） | ~150 |
| PR-B | Phase P1-B: プロンプト是正 + 2200 字制約見直し | なし（本番即適用、A/B の必要なし） | ~80 |
| PR-C | Phase P1-C: 品質ゲート＋リトライ拡張 + `_HEADING_ALIASES` | なし | ~120 |
| PR-D | Phase P1-D: 合成器追加＋接続 | `DETERMINISTIC_STUB_ENABLED`（初期 OFF） | ~350 |
| PR-E | Phase P1-E: テスト拡張 | なし | ~200 |
| PR-F | 本番観測 2 週間後、PR-D フラグ ON | なし | ~5 |

**マージ順**: PR-A → PR-B → 1 日観測 → PR-C → PR-E → PR-D（flag OFF）→ 観測 → PR-F

---

## 5. 検証（完了判定）

### 必須（🔴）
- [ ] Discovery レポート 10 件連続で「セクション欠損: アクションプランが見つかりません」警告なし
- [ ] Discovery / Compare 両方で 6 サブセクション（最優先3 / 5-0 / 5-1 / 5-2 / 5-3 / 5-4）が出力
- [ ] `pytest backends/market-lens-ai/tests/ -q` 全緑（拡張含む）
- [ ] `stop_reason` が Render ログで常時観測可能

### 推奨（🟡）
- [ ] `stop_reason == "max_tokens"` の発生率が 5% 未満
- [ ] Compact モード発動率が 10% 未満
- [ ] フロント `PriorityActionHero` が実本番で 3 枚のゴールドカードとして正しく描画
- [ ] 品質警告の分類（critical/warning/info）がフロント側で視覚的に区別される

### 任意（🟢）
- [ ] スタブ注入の発生率が 1% 未満（= LLM が概ね正しく出力している）
- [ ] Appendix A の「自動生成ブロック一覧」が空で終わる（監査上の理想形）

---

## 6. Skill / Agent 活用

| フェーズ | 使用 Skill / Agent |
|---|---|
| P1-A 観測実装 | `agent-team-workflow`（ログ追加＋型安全化を並列実装） |
| P1-A 観測結果分析 | Bash で Render CLI 経由ログ取得（不二樹に認証確認） |
| P1-B プロンプト是正 | **codex-review 必須**（プロンプト変更は即本番影響） |
| P1-C 品質ゲート | `market-lens-backend-guardrails`（既存ルールとの整合チェック） |
| P1-D 合成器実装 | `agent-team-workflow`（合成器 2 種を並列実装）+ `codex-review` 必須 |
| P1-E テスト | `webapp-testing` は不要（pytest のみ） |
| 各 PR マージ前 | `codex-review` Critical 判定ゲート |
| リリース前最終 | `market-lens-release-check` |

---

## 7. 重要ファイル一覧

### 改修対象
- [backends/market-lens-ai/web/app/analyzer.py](backends/market-lens-ai/web/app/analyzer.py)（L1490-1700 周辺：Discovery プロンプト＋2200字制約）
- [backends/market-lens-ai/web/app/anthropic_client.py](backends/market-lens-ai/web/app/anthropic_client.py)（stop_reason 取得）
- [backends/market-lens-ai/web/app/llm_client.py](backends/market-lens-ai/web/app/llm_client.py)（LLMResponse dataclass 化）
- [backends/market-lens-ai/web/app/report_generator.py](backends/market-lens-ai/web/app/report_generator.py)（L55-57 aliases / L92-320 quality gate / スタブ注入接続）
- [backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py)（L941-989 リトライ拡張）
- [src/utils/reportQuality.js](src/utils/reportQuality.js)（警告分類、最小限）

### 新規追加
- `backends/market-lens-ai/web/app/priority_action_synthesizer.py`
- `backends/market-lens-ai/web/app/budget_frame_synthesizer.py`
- `backends/market-lens-ai/tests/test_discovery_section_coverage.py`
- `backends/market-lens-ai/tests/test_quality_gate.py`（不在時のみ）
- `backends/market-lens-ai/tests/test_priority_action_synthesizer.py`
- `backends/market-lens-ai/tests/test_budget_frame_synthesizer.py`
- `plans/2026-04-18-discovery-llm-observation-log.md`（P1-A 観測ログ専用）

---

## 8. リスクと緩和策

| リスク | 緩和策 |
|---|---|
| P1-B プロンプト変更で LLM 応答が別の項目を犠牲にする | PR-B マージ後 1 日の観測期間を必須化、[P1-A の section_audit ログで全セクション有無を監視](backends/market-lens-ai/web/app/report_generator.py) |
| P1-D スタブが「LLM 版と重複」を生成（両方が残る） | `_quality_gate_check` で「既に存在する場合は注入しない」ガードを必ず実装、単体テストで被覆 |
| 2200 字制約緩和で情報過多＋可読性低下 | フロント [src/components/MarkdownRenderer.jsx](src/components/MarkdownRenderer.jsx) の「折りたたみ表示」既存実装が機能するか確認、必要なら Phase C に視覚化タスク起票 |
| `_HEADING_ALIASES` 追加で本来別セクションが誤統合 | 追加エイリアスごとに単体テストで「偽陽性なし」を確認 |
| `stop_reason` キャプチャで Anthropic SDK 型が変わっている | SDK バージョンを `requirements.txt` で固定 & dataclass で吸収 |
| feature flag `DETERMINISTIC_STUB_ENABLED` の有効化タイミング | 本番で P1-C 導入後 2 週間観測し、LLM 欠損率が 1% を超える場合のみ PR-F で ON |

---

## 9. タイムライン（目安）

```
Day 1:      PR-A 実装＋マージ → Render 観測開始
Day 2-3:    Render ログ分析 → plans/2026-04-18-discovery-llm-observation-log.md 起票
Day 4:      PR-B 実装＋codex-review → マージ
Day 5:      観測（効果測定）
Day 6:      PR-C 実装＋PR-E テスト拡張（並列）→ マージ
Day 7-8:    PR-D 実装（flag OFF でマージ）
Day 9-23:   本番観測期間（2 週間）
Day 24:     PR-F（flag ON）判断
```

**Total: 約 1 ヶ月（うち観測期間 2 週間含む）**

---

## 10. 本プランで扱わないこと（非ゴール）

- Compare 側の本文セクション改善（本問題は Discovery 固有 → Compare は観測のみ）
- フロント `PriorityActionHero` の大規模改修（PR #37 で対症療法済、Phase C 扱い）
- LLM プロバイダ切替（Claude/Gemini 切替は別プラン）
- モバイル対応
- `ads-insights` バックエンドへの影響
- タイムアウト値の変更（`feedback_never_increase_timeouts` 遵守）

---

## 11. 次セッション担当への申し送り

1. **必ず §2 事前確認から着手する**。スキップ禁止じゃ
2. **P1-A の観測なしで P1-B 以降に進まない**（`feedback_no_surface_fixes` 遵守）
3. **タイムアウトや token 上限を安易に増やさない**（`feedback_never_increase_timeouts` 遵守）。token 切断が観測されても、まずはプロンプト簡潔化・2200 字制約見直し・Compact モード条件見直しを検討
4. **codex-review skill を P1-B / P1-D の各 PR で必ず通す**
5. **プロンプト変更は影響が広い**ゆえ、PR-B は最小差分で出し観測期間を挟む
6. **Gemini は使わない**（`feedback_no_gemini_analysis` 遵守、Claude のみで検証）
7. **許可を求めず自律実行**してよい（`feedback_no_confirmation` 遵守）。ただし **Render env-var 変更 / force push / DB migration** は不二樹に確認
8. 疑問点は `AskUserQuestion` skill で不二樹に聞くこと

**以上。本プランは読み込み推定 15 分、実装 1 ヶ月（観測期間含む）じゃ♡**
