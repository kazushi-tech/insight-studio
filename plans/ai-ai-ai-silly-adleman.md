# AI考察 / Discovery Hub 改修 — Agent Team 並列実行プラン

## Context

ユーザーフィードバックで浮上した3課題を、独立タスクとして **Agent Team で並列実行** する計画じゃ:

1. **【バグ】AI考察が画面遷移から戻るとフリーズ** — `setTimeout` cleanup漏れ（フロント）
2. **【品質バグ】Discoveryレポートが途中で途切れる** — `max_tokens` 不足＋`stop_reason` 握りつぶし（バックエンド）
3. **【UX要望】AI考察バックグラウンド処理化** — Discoveryと同じジョブポーリング方式導入（フロント+バックエンド）

3課題は **技術領域が異なり依存関係もない** ため、Agent Team で分担して並列に進めるのが効率的じゃ。

---

## 全体フロー

```
[Phase 0] agent-team-workflow で tmux セッション構築
         ↓
[Phase 1] Track A / B / C を並列実行（3 worker agent）
         ├─ Track A: AI考察フリーズ修正（小・即対応）
         ├─ Track B: Discoveryレポート途切れ修正（小・即対応）
         └─ Track C: AI考察バックグラウンド化（大・設計→実装）
         ↓
[Phase 2] 各トラックで skill ベース検証
         ├─ フロント: devtools-verify / webapp-testing
         └─ バック: market-lens-backend-guardrails / ads-test相当
         ↓
[Phase 3] codex-review で品質ゲート通過確認
         ↓
[Phase 4] market-lens-release-check → quick-git → デプロイ
```

---

## Phase 0: Agent Team 構築

`/agent-team-workflow` skill を起動し、以下3トラック分の worker を準備する:

| Worker | 役割 | 作業領域 | 主要 skill |
|--------|------|---------|------------|
| **worker-a** | AI考察フリーズ修正 | `src/pages/AiExplorer.jsx` | devtools-verify, webapp-testing |
| **worker-b** | Discoveryレポート途切れ修正 | `backends/market-lens-ai/web/app/` | market-lens-backend-guardrails |
| **worker-c** | AI考察バックグラウンド化 | フロント+バック両方 | market-lens-orchestrator |

orchestrator（親セッション）が進捗を集約し、Phase 2 以降のゲート通過を判定する。

---

## Track A: AI考察フリーズ修正（worker-a）

### 担当 skill
- **実装中:** 直接編集（小規模のため skill 不要）
- **検証:** `/devtools-verify` で Chrome DevTools 確認、`/webapp-testing` で Playwright 自動テスト
- **レビュー:** `/universal-review` (diff モード)

### 根本原因

[src/pages/AiExplorer.jsx:169-222](src/pages/AiExplorer.jsx#L169-L222) の `contextMode` useEffect で、cold_start リトライの `setTimeout(..., 5000)` が cleanup されずアンマウント後も残存。戻り際に stale state を触ってフリーズ。

### 実装手順

1. worker-a が [src/pages/AiExplorer.jsx:169-222](src/pages/AiExplorer.jsx#L169-L222) を編集:
   - `let retryTimer = null` / `let cancelled = false` を導入
   - Promise チェーン内で `if (cancelled) return` ガード
   - `return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer) }` を返す
2. 並走で AbortController 残存パス（[src/pages/AiExplorer.jsx:112](src/pages/AiExplorer.jsx#L112) 付近）を再点検し、handleSend 内の setTimeout リトライにも同じ防御を入れる

### 検証（skillベース）

- **`/devtools-verify`** (ゲストモードで起動):
  1. `/ads/ai` を開く → 質問送信 → ネットワーク切断
  2. 5秒以内に `/discovery` へ遷移、さらに `/ads/ai` へ戻る
  3. Console タブに "Can't perform a React state update on an unmounted component" Warning が出ないことを確認
  4. 入力欄に文字入力できる＝UIが反応することを確認
- **`/webapp-testing`** で上記手順を Playwright スクリプト化して回帰テストに残す

---

## Track B: Discoveryレポート途切れ修正（worker-b）

### 担当 skill
- **実装中:** 直接編集
- **バックエンド検証:** `/market-lens-backend-guardrails` (pytest・型・lint)
- **リリース前:** `/market-lens-release-check`

### 根本原因

- [backends/market-lens-ai/web/app/analyzer.py:51-53](backends/market-lens-ai/web/app/analyzer.py#L51-L53) で `_MULTI_URL_MAX_OUTPUT_TOKENS = 4096` が2社比較に不足
- [backends/market-lens-ai/web/app/anthropic_client.py:186-198](backends/market-lens-ai/web/app/anthropic_client.py#L186-L198) で `stop_reason="max_tokens"` を warning ログするだけで握りつぶし

### 実装手順

1. worker-b が [backends/market-lens-ai/web/app/analyzer.py:51-53](backends/market-lens-ai/web/app/analyzer.py#L51-L53) の定数を引き上げ:
   - `_MULTI_URL_MAX_OUTPUT_TOKENS`: 4096 → 6144
   - 3社: 6144 → 7168
   - 4+社: 5120 → 6144
2. [backends/market-lens-ai/web/app/anthropic_client.py:186-198](backends/market-lens-ai/web/app/anthropic_client.py#L186-L198) で、`stop_reason=="max_tokens"` 時にレスポンス末尾へ警告文を追記＋呼び出し元へ `truncated=True` フラグを返す
3. [backends/market-lens-ai/web/app/analyzer.py:1805-1811](backends/market-lens-ai/web/app/analyzer.py#L1805-L1811) の呼び出し元で `truncated` を拾い、ログへ構造化出力

### 検証（skillベース）

- **`/market-lens-backend-guardrails`**:
  - pytest (`cd backends/market-lens-ai && python -m pytest`)
  - 型チェック・lint
  - 2社比較ジョブのスナップショットテスト更新
- 実走確認: ローカル（または staging）で 2社比較を1件実行し、「ブランド別評価」が全社分末尾まで出力されることを目視
- `stop_reason=max_tokens` ログが出ないことを確認

---

## Track C: AI考察バックグラウンド化（worker-c）

### 担当 skill
- **設計:** `/market-lens-orchestrator` (フロント+バック横断の設計支援)
- **計画書レビュー:** `/codex-review` （Plan ゲート）
- **バックエンド実装:** `/market-lens-backend-guardrails`
- **フロント実装後検証:** `/devtools-verify` + `/webapp-testing`
- **リリース前:** `/market-lens-release-check`

### スコープ判断

課題2は **即時PRに含めず、別PRで段階実装** する。Track C の Phase 1 ではまず **詳細計画書を作成** してレビューを通し、Phase 2 以降で実装に入る二段構え。

### Track C 詳細ステップ

**C-1. 設計フェーズ（worker-c のみ、今週着手）**

1. `/market-lens-orchestrator` を起動し、Discoveryのジョブアーキテクチャ（`POST /api/discovery/jobs` + ポーリング）を AI考察へ転用する設計書を起こす
2. 新規計画書: `plans/2026-04-20-ai-explorer-background-job-design.md`
   - バックエンド新エンドポイント: `POST /api/ml/ai-insights/jobs`, `GET /api/ml/ai-insights/jobs/{jobId}`
   - ストレージ: Discoveryが使う file-backed repository を再利用 or 共通化
   - フロント: [src/pages/Discovery.jsx:714-736](src/pages/Discovery.jsx#L714-L736) のポーリング復帰ロジック踏襲
   - sessionStorage キー: `AI_EXPLORER_ACTIVE_JOB_KEY`
3. 計画書へ `/codex-review` を実行し、Plan ゲートを通す（反復修正）

**C-2. 実装フェーズ（別PR）**

- バックエンド worker が `/market-lens-backend-guardrails` 併走で新エンドポイント実装
- フロント worker が `/devtools-verify` 併走でポーリング・復帰UI実装
- 統合後 `/webapp-testing` で E2E 回帰、`/market-lens-release-check` で出荷判定

今回のPRには C-1 の設計書のみコミットし、実装は後続PR。

---

## Phase 2: 統合検証ゲート

Track A / B が揃った時点で orchestrator が以下を実行:

1. **`/project-health`** — 全体のビルド・型・lint・テスト一括チェック
2. **`/webapp-testing`** — フロントE2E（AI考察フリーズ再現テスト）
3. **`/market-lens-backend-guardrails`** — バックエンド統合テスト

いずれかが赤なら該当 worker へ差し戻す。

---

## Phase 3: 品質レビューゲート

**`/codex-review`** を Diff モードで実行:
- Track A のフロント差分
- Track B のバックエンド差分
- Track C-1 の新規計画書

Critical 指摘ゼロで通過、Major は原則解消、Minor は受容可とする。

---

## Phase 4: リリース

1. **`/market-lens-release-check`** — 出荷前最終チェック
2. **`/quick-git`** — ステータス確認 → コミット → プッシュ
3. PR作成 → Vercel + Render 両方の稼働確認（`feedback_verify_full_deploy` 準拠）

---

## 成果物

| 種別 | パス | 担当 |
|------|------|------|
| コード修正 | [src/pages/AiExplorer.jsx](src/pages/AiExplorer.jsx) | worker-a |
| コード修正 | [backends/market-lens-ai/web/app/analyzer.py](backends/market-lens-ai/web/app/analyzer.py) | worker-b |
| コード修正 | [backends/market-lens-ai/web/app/anthropic_client.py](backends/market-lens-ai/web/app/anthropic_client.py) | worker-b |
| 新規計画書 | `plans/2026-04-20-ai-explorer-background-job-design.md` | worker-c |
| 回帰テスト | Playwrightスクリプト（`/webapp-testing` 配下） | worker-a |

---

## リスクと注意

- **タイムアウト値は上げない**（`feedback_never_increase_timeouts` 準拠）— `max_tokens` 引き上げはタイムアウトではなく生成長の話。根本原因対応として正当。
- **Render は有料プラン**（`project_market_lens_render_free` 参照）— コールドスタート仮定の誤診断に注意。Track A の cold_start リトライ修正は「遅延しない」のではなく「クリーンアップする」方向で行う。
- **推測禁止**（`feedback_test_before_fix` 準拠）— Track B は必ず実ジョブで再現させ、修正後も実ジョブで検証する。
