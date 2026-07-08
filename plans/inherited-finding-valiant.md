# Discovery レポート「薄さ」と「エラー祭り」同時解消プラン

## Context

`/discovery` で生成したレポートが **(1) 冒頭に赤/黄のエラーバナー**、**(2) 8 社中 2 社しか分析されない**、**(3) Section 5（実行プラン本体）がまるごと欠損** し、クライアント提示時に信頼を著しく損なう状態になっている。

調査の結果、表層と根本が以下のように繋がっていた:

- **根本原因**: 2 サイト compact モードの出力上限が **2,560 tokens**（[analyzer.py:1755-1764](backends/market-lens-ai/web/app/analyzer.py#L1755-L1764)）。Section 1〜4 で枯渇し `stop_reason=max_tokens` で truncate → 末尾に自動注記 → Section 5 が空になる。
- **自己強化ループ**: Section 5 欠損を検知した品質ゲート（[discovery_pipeline.py:308-325](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L308-L325)）が retryable と判定 → `_analysis_attempts` チェーン（[discovery_pipeline.py:359-414](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L359-L414)）で `site_limit` を initial → 3 → 3(fallback) → 2 と段階縮小。縮退するほど compact 強制で max_tokens が更に減る逆効果。
- **引き金コミット**: `981dc1e fix(discovery): eliminate hidden two-phase LLM call ...` で (a) Section 5 部分再生成（4,096 tok 追加枠）を削除、(b) 2 サイトを compact 強制。一発出力への圧力が MAX となった。
- **表示側の過剰反応**: フロント [Discovery.jsx:990-1032](src/pages/Discovery.jsx#L990-L1032) と [Compare.jsx:738-750](src/pages/Compare.jsx#L738-L750) がバックエンドの `quality_issues` をそのまま赤/黄バナーで全面展開 → クライアントに「エラー祭り」として映る。

ゴール: **(A) 本質的にレポートが Section 5 まで完走し、最低限ブランド+2 競合の深い分析を維持**、かつ **(B) 万一欠損が出てもクライアント視界ではノイズにならず、オペレーター（admin）のみが把握できる** 状態にする。

今回の判断:

- 「表示改善 + 穴埋め強化」方針（ユーザー決定）
- 欠損はオペレーターに見せる、クライアントビューでは完全に隠す（ユーザー決定）
- 追加で **Phase 0（Token 予算再設計）** を最優先に入れる。ここを直さないと UI 改善は化粧直しにしかならない

---

## 実行戦略 — Agent Teams × Skills

タスクが 3 レイヤー（バックエンド token 予算 / バックエンド品質パイプライン / フロント UI）に跨るため、`agent-team-workflow` を用いて **3 並列 Track** で進める。各 Track はそれぞれ専門 skill を主担当に据え、最後に orchestrator + codex-review で合流させる。

```
            ┌──────────────────────────────────────────────┐
            │  market-lens-orchestrator  (全体調整)           │
            └──────┬──────────┬──────────────┬──────────────┘
                   │          │              │
         ┌─────────▼─┐  ┌─────▼──────┐  ┌────▼─────────┐
Track 1  │ Token予算  │  │ Pipeline   │  │ UI 刷新       │ Track 3
(Phase 0)│ + prompt   │  │ + stub     │  │ (badge化)     │(Phase 2)
         │            │  │ (Phase 1)  │  │                │
         │ skill:     │  │ skill:     │  │ skill:        │
         │ claude-api │  │ market-    │  │ ui-design-    │
         │ +          │  │ lens-back- │  │ review +      │
         │ market-    │  │ end-       │  │ market-lens-  │
         │ lens-back- │  │ guardrails │  │ frontend-     │
         │ end-       │  │            │  │ review        │
         │ guardrails │  │            │  │                │
         └─────┬──────┘  └─────┬──────┘  └────┬──────────┘
               │               │              │
         ┌─────▼───────────────▼──────────────▼─────┐
         │  pytest (backend) + webapp-testing        │
         │  (Playwright) + devtools-verify           │
         └──────────────────┬────────────────────────┘
                            │
                    ┌───────▼─────────┐
                    │ codex-review     │ (Critical/Major ゼロまで)
                    └───────┬──────────┘
                            │
                    ┌───────▼──────────┐
                    │ market-lens-     │
                    │ release-check    │
                    └──────────────────┘
```

---

## Phase 0 — Token 予算 & 生成戦略の再設計（最優先）

担当 Track 1 / skill: `claude-api` + `market-lens-backend-guardrails`。

### 0-1. `max_tokens` 引き上げ

- [analyzer.py:91-99](backends/market-lens-ai/web/app/analyzer.py#L91-L99) の定数を更新:
  - `_MULTI_URL_MAX_OUTPUT_TOKENS = 10240`（2 sites, 現行 6144）
  - `_MULTI_URL_MAX_OUTPUT_TOKENS_3_SITES = 14336`（現行 8192）
  - `_MULTI_URL_MAX_OUTPUT_TOKENS_4PLUS_SITES = 12288`（現行 6144）
  - `_EXECUTION_PLAN_MAX_OUTPUT_TOKENS = 6144`（現行 4096）
- [analyzer.py:1755-1764](backends/market-lens-ai/web/app/analyzer.py#L1755-L1764) `_comparison_output_token_budget` の compact 分岐を `4096 / 5120` に拡張
- 根拠: Sonnet 4.6 の output 上限 64k に対し現状は 4〜12% しか使っていない。課金は出力従量なのでコストは生成分のみ線形増

### 0-2. Timeout 整合（token 増 → 生成時間増）

- [discovery_pipeline.py](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py) `DISCOVERY_ANALYZE_TIMEOUT_SEC` と `DISCOVERY_OVERALL_JOB_TIMEOUT_SEC` の env 既定を `210 / 360` → `300 / 480` に
- feedback_never_increase_timeouts ルール（根本原因を探してから timeout を伸ばす）との整合チェックポイント: **今回の timeout 伸長は token 増の直接帰結**で、LLM 推論時間が数式的に延びるだけ。回避可能なレイテンシではないことを codex-review で明示確認

### 0-3. Section 5 部分再生成の条件付き復活

`981dc1e` で discovery 側を `two_phase=False` 固定化した [discovery_pipeline.py:928-931](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L928-L931) を条件ロジックに戻す:

```python
needs_phase2 = (
    not _section_5_looks_complete(report_md)
    and total_budget_remaining_sec >= 60
    and attempt_index == 0  # 初回試行成功時のみ
)
```

`_regenerate_execution_plan` 本体 [analyzer.py:1881-1921](backends/market-lens-ai/web/app/analyzer.py#L1881-L1921) は既存流用。これで「初回は成功したが Section 5 だけ書ききれなかった」ケースを自己強化ループに入る前に救える。

### 0-4. サイト数最小保証

- [discovery_pipeline.py:359-414](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L359-L414) `_analysis_attempts` チェーンを改修
  - initial → 3 と落とす前に、**同じ site_limit のまま compact モードへ切り替えて再試行する中間段**を挿入
  - 最終 degrade でも `site_limit >= 3` をブランド + 2 競合のハードフロアとして死守
  - 例外的に 2 にするのは `available_sites == 1`（競合候補ゼロ）のみ

### 0-5. プロンプト圧縮（副次施策、Phase 0 に含めるかは判断）

- [analyzer.py:1569](backends/market-lens-ai/web/app/analyzer.py) 周辺の comparison prompt テンプレが 400 行超。Task A v3 等の仕様を `config/prompts/*.yaml` へ外出しで 30-40% 縮減可能
- ただし Phase 0 はまず 0-1〜0-4 で挙動が直ることを確認 → 0-5 は Phase 3 へ繰り延べ候補

### 0-6. 観測性

- [anthropic_client.py:197-199](backends/market-lens-ai/web/app/anthropic_client.py#L197-L199) のログに **`stop_reason=="end_turn"` でも `output_tokens >= budget * 0.95` の場合の warning** を追加
- [discovery_pipeline.py:1028-1037](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L1028-L1037) `attempt_timings` に **`output_tokens / token_budget 比率`** を追加して degrade の予兆を観測

### Phase 0 検証

- `pytest backends/market-lens-ai/tests/test_report_generator.py` に回帰
- 新規 `test_section_5_completion_budget`: 2 サイト入力で Section 5 まで必ず出力される（モックで max_tokens を観察）
- 新規 `test_conditional_two_phase_fires_on_truncation`: Section 5 欠けかつ budget 残 60s 以上で再生成が走る
- 手動: 実際に問題再現した `https://www.petabit.co.jp/` で再生成し、Section 5 の 5 パート全てが出ること

---

## Phase 1 — 品質パイプライン整流化と stub 拡張

担当 Track 2 / skill: `market-lens-backend-guardrails`。Phase 0 が効けば stub の必要性自体が減る前提で、**フェイルセーフ** として実装。

### 1-1. `_apply_deterministic_stubs` 拡張

- [report_generator.py:526-568](backends/market-lens-ai/web/app/report_generator.py#L526-L568) に 5-1 / 5-2 の stub 注入を追加
- Stub 内容は **明示プレースホルダ**方式を採用（選択肢 A）: 「本分析ではエビデンスが不足したため詳細案を割愛、Appendix A を参照」の blockquote
- 新規ヘルパ: `web/app/stubs/lp_improvement_stub.py` / `search_ad_stub.py`。見出し「### 5-1 LP改善施策」「### 5-2 検索広告施策」を含め正規表現検出にマッチさせる
- 既存 [_inject_stub_block](backends/market-lens-ai/web/app/report_generator.py#L511-L523) を再利用

### 1-2. Severity downgrade

- [report_generator.py:587-589](backends/market-lens-ai/web/app/report_generator.py#L587-L589) 後に `_downgrade_stubbed_issues(quality_issues, is_critical, injected_stubs)` を挿入
- stub で補完済みサブセクションの issue を `"セクション欠損"` → `"本分析対象外(自動補完済)"` に文言書換
- 全 critical が stub 代替されたら `is_critical = False`
- 5-3 / 5-4 の任意 info 文言も「サブセクション欠損(任意)」→「本分析対象外」へ柔化

### 1-3. 品質ゲートの retryable 判定見直し

- [discovery_pipeline.py:308-325](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L308-L325) `_is_retryable_quality_issue`
- Phase 0-3 の条件付き two-phase で救えるケースと重複しないよう、retryable と判定しても**まず site_limit は維持して two-phase 再生成 → それでも欠けていたら degrade** の順序に整理
- 「site_limit を下げる degrade」が Section 5 を更に削る自己強化ループを断つ

### Phase 1 検証

- `pytest backends/market-lens-ai/tests/test_report_generator.py`
  - `test_apply_deterministic_stubs_covers_5_1_and_5_2`
  - `test_downgrade_stubbed_issues_rewrites_message`
- 既存 discovery_pipeline 系テストの回帰確認

---

## Phase 2 — UI 刷新（バッジ化 + クライアント視界からの撤去）

担当 Track 3 / skill: `ui-design-review` + `market-lens-frontend-review`。

### 2-1. 新規コンポーネント `<ReportQualityBadge>`

- パス: [src/components/report/ReportQualityBadge.jsx](src/components/report/ReportQualityBadge.jsx)（新規）
- Props: `issues`, `onRegenerate`, `visible`
- 状態: `critical` / `warning` / `pass` の 3 段階、小型チップ (`text-[11px] px-2 py-0.5 rounded-full`)
- ホバー/クリックで詳細ポップオーバ（issue 一覧 + 「対象を絞って再実行」 CTA）
- `print:hidden` 必須（PDF には絶対に出さない）
- `visible=false` なら即 return null

### 2-2. ロール分岐

- 既存 [src/contexts/RbacContext.jsx](src/contexts/RbacContext.jsx) の `useRbac().isAdmin` を唯一のソースに
- クライアントビュー時 (`!isAdmin`) はバッジ完全非表示
- 開発保険: URL クエリ `?viewer=client` で admin が一時的にクライアントビュー確認可能（デモ用途）
- ログインなし開発環境（`user == null`）は `import.meta.env.DEV` 時のみバッジ表示して混乱を避ける

### 2-3. Discovery.jsx 改修

- [Discovery.jsx:934-989](src/pages/Discovery.jsx#L934-L989) のヘッダー右側ボタン群に `<ReportQualityBadge>` を追加
- [Discovery.jsx:990-1035](src/pages/Discovery.jsx#L990-L1035) の赤/黄バナーブロックを完全削除
- [Discovery.jsx:961-971](src/pages/Discovery.jsx#L961-L971) `PrintButton` の `onBeforePrint` 内 `window.confirm` は admin のみに限定

### 2-4. Compare.jsx 改修

- [Compare.jsx:478-479](src/pages/Compare.jsx#L478-L479) で取得済みの `qualityIssues` を使い、[Compare.jsx:722](src/pages/Compare.jsx#L722) 付近の冒頭に同じ `<ReportQualityBadge>` を差し込む
- [Compare.jsx:738-750](src/pages/Compare.jsx#L738-L750) の黄バナーを削除

### 2-5. reportQuality.js

- [src/utils/reportQuality.js](src/utils/reportQuality.js) の `splitIssuesBySeverity` (L69-88) は流用
- `BLOCKER_TOKENS` / `WARNING_TOKENS` はバックエンドの severity downgrade (Phase 1-2) が安定するまで **1 リリース残置**、その後削除

### Phase 2 検証

- `npm run build` で型・ビルド確認
- skill: `webapp-testing` で Playwright 起動
  - admin モック時: バッジ DOM 存在、ポップオーバ開閉、CTA が `handleRetry` を呼ぶ
  - client モック時: バッジ DOM 非存在
  - `?viewer=client` 強制時: admin でもバッジ非表示
  - PDF 印刷プレビューでバッジが `print:hidden` により消えること
- skill: `devtools-verify` でゲストモード Chrome で Discovery / Compare 両画面のレイアウト regression を確認

---

## Phase 3 — 合流レビュー & リリース

担当 orchestrator / skill: `codex-review` → `market-lens-release-check` → `universal-review`。

1. **codex-review**: Plan gate → Diff gate → Runtime gate → Release gate の 4 ゲートで Critical/Major がゼロになるまで修正ループ
2. **market-lens-release-check**: Render staging デプロイ前の自動チェック
3. 本番 Vercel + Render への順次リリース。問題再現した `https://www.petabit.co.jp/` で再テストし、Section 5 の 5 パート全てが実データ+推定で埋まることを confirm

---

## Critical Files

### バックエンド
- [backends/market-lens-ai/web/app/analyzer.py](backends/market-lens-ai/web/app/analyzer.py)  L91-99, L1569 周辺, L1755-1764, L1881-1921
- [backends/market-lens-ai/web/app/anthropic_client.py](backends/market-lens-ai/web/app/anthropic_client.py)  L158-165, L187, L197-206, L270
- [backends/market-lens-ai/web/app/report_generator.py](backends/market-lens-ai/web/app/report_generator.py)  L75-106, L149-418, L511-568, L587-589
- [backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py)  L308-356, L359-414, L888-1044
- 新規: `backends/market-lens-ai/web/app/stubs/lp_improvement_stub.py`
- 新規: `backends/market-lens-ai/web/app/stubs/search_ad_stub.py`

### フロント
- [src/pages/Discovery.jsx](src/pages/Discovery.jsx)  L922-1035, L961-971
- [src/pages/Compare.jsx](src/pages/Compare.jsx)  L478-479, L722, L738-750
- [src/utils/reportQuality.js](src/utils/reportQuality.js)
- [src/contexts/RbacContext.jsx](src/contexts/RbacContext.jsx)  既存流用
- [src/components/report/PrintButton.jsx](src/components/report/PrintButton.jsx)  `onBeforePrint` 調整
- 新規: [src/components/report/ReportQualityBadge.jsx](src/components/report/ReportQualityBadge.jsx)

---

## 既存機能の再利用箇所

- `splitIssuesBySeverity` in [src/utils/reportQuality.js](src/utils/reportQuality.js)
- `useRbac().isAdmin` in [src/contexts/RbacContext.jsx](src/contexts/RbacContext.jsx)
- `_inject_stub_block` in [report_generator.py:511-523](backends/market-lens-ai/web/app/report_generator.py#L511-L523)
- `_regenerate_execution_plan` in [analyzer.py:1881-1921](backends/market-lens-ai/web/app/analyzer.py#L1881-L1921)
- `priority_action_synthesizer.py` のパターン（stub 生成時の参考）
- `PrintButton.jsx` の `onBeforePrint` フック

---

## 検証計画（エンドツーエンド）

1. **pytest**: `cd backends/market-lens-ai && python -m pytest -xvs tests/test_report_generator.py tests/services/discovery/`
2. **フロント build**: `npm run build`
3. **Playwright** via `webapp-testing` skill で `/discovery` と `/compare` 両画面を admin / client / `?viewer=client` の 3 モードで確認
4. **実データ再現**: `https://www.petabit.co.jp/` を Discovery に投入し以下を確認
   - Section 5（最優先 3 施策 / 5-1 / 5-2 / 5-3 / 5-4）がすべて出力される
   - `omitted_candidates` が 6 件でなく、最低 2 競合は analyzed
   - 赤/黄バナーがクライアントビューで出ない
   - admin ビューではバッジに品質 OK or 軽微な warning のみ
5. **PDF 出力**: バッジが印刷に出ない
6. **codex-review** gate 通過

---

## リスク・トレードオフ

| リスク | 回避策 |
|---|---|
| max_tokens 増 → 1 レポート当たりのレイテンシ +20〜40% と費用増 | 費用は出力従量なのでレポート品質向上と引き換え。タイムアウトも同時拡張。codex-review で数値確認 |
| Section 5 部分再生成の復活が `981dc1e` の意図（latency 削減）に反する | `attempt_index == 0` かつ `budget_remaining >= 60s` に限定。失敗時 degrade より軽いコストで済む前提を計測で示す |
| Stub プレースホルダがクライアント提出 PDF に残る | 本文は blockquote + 「本分析対象外」の柔らかい文言。Phase 0 が効けばそもそも stub が発火しないケースが支配的 |
| ロール未設定環境でバッジが常時消える | `import.meta.env.DEV` の場合は強制表示オプションで開発補助 |
| `quality_issues` の文言変更で既存パース箇所が壊れる | Grep で `quality_issues` 利用箇所を全列挙。Appendix A は従来通り全文列挙を残し、後方互換を確保 |
| プロンプト圧縮（0-5）を先にやると Phase 0-1〜0-4 の効果測定が混ざる | 0-5 は Phase 0 で実施せず、Phase 3 リリース後の後日タスクへ |

---

## Agent / Skill 役割サマリ

| Track | 主担当 skill | サブ |
|---|---|---|
| 0 (Token 予算) | `claude-api` | `market-lens-backend-guardrails` |
| 1 (Pipeline + stub) | `market-lens-backend-guardrails` | — |
| 2 (UI) | `ui-design-review` + `market-lens-frontend-review` | `webapp-testing`, `devtools-verify` |
| 統合 | `market-lens-orchestrator` | — |
| 最終レビュー | `codex-review` | `universal-review` |
| リリース前 | `market-lens-release-check` | — |

各 Track は独立して進行可能。Track 0 → Track 1 の順で完了後、Track 2 は並行開始可能（フロントは backend API スキーマが変わらないため依存なし）。
