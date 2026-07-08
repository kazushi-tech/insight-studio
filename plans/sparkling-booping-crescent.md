# Discovery Hub タイムアウト撲滅プラン — 「3分以内完走」化

**Date:** 2026-04-21  **Branch:** `chore/render-yaml-timeout-sync`  **Status:** Planning

---

## Context

2026-04-21 18:18、オペレーターが本番 [https://insight-studio-chi.vercel.app/discovery](https://insight-studio-chi.vercel.app/discovery) で `https://www.petabit.co.jp/` を競合発見にかけたところ、**4分52秒（≒292秒）で frontend が `Stage timeout (analyze)` を出して失敗**。ユーザー発言「またかよ…モノリポ化してから」。

### 直接原因
フロント／バックエンドの timeout ドリフト：
- Backend は commit `032c708`（master 済）で `DISCOVERY_ANALYZE_TIMEOUT_SEC=300`、`OVERALL=480`、`ANTHROPIC_TIMEOUT_SEC=300` に引き上げ済
- Frontend [src/pages/Discovery.jsx:112-122](src/pages/Discovery.jsx#L112-L122) は旧値のまま：
  - `STAGE_TIMEOUT_MS.analyze = 240_000` （コメント「backend analyze_timeout(210s) + 余裕」— もう 210s ではない）
  - `POLL_HARD_CEILING_MS = 400_000` （コメント「backend overall 360s + 40s」— もう 360s ではない）
- 結果、先行stageで 52s 消費後、analyze に入って 240s 経過 → job_elapsed=292s でフロントが先にキル（バックエンドはまだ動作中だった公算大）

### しかしこれは応急処置にすぎない
ユーザーの真のゴールは **「3分以内に Discovery レポートが出る」**。timeout を引き上げて 5 分まで待つのは敗北。本プランは analyze の実処理時間を短縮して **180 秒以内完走** を主目標とし、timeout 同期は下支えに回す。

### モノリポ化の利点（ユーザー発言に応える）
旧2リポ時代は frontend の Discovery.jsx と backend の render.yaml / discovery_pipeline.py を**別 PR で更新する必要があり、ドリフトが構造的に発生**していた。モノリポ化したことで、frontend・backend・render.yaml を**1 PR 原子的に同期**できるようになった。今回の修正はその恩恵を最大活用する。

---

## Goals（優先順）

1. **Primary:** Discovery の analyze を含む全stage合計が **180s (3分) 以内** で完走する状態を作る
2. **Hard upper bound:** **どんな条件でも 300s (5分) 以内**で完結（完走 or 明確な失敗）。5分超は「仕様違反」として扱う
3. **Guardrail:** backend が生きている間は frontend が先に誤検知キルしない（frontend 値 > backend 値、ただし 300s を超えない）
4. **Verification:** Playwright（ゲストモード）で実URL を走らせ、コンソールエラー0・3分以内完走を3/3で確認
5. **Structural:** 今後ドリフトを再発させないため timeout 値の single source of truth を検討

---

## 180秒予算分配案

| Stage | 目標予算 | 現 frontend STAGE_TIMEOUT_MS | 現 backend env | 備考 |
|---|---|---|---|---|
| queued | 3s | 30s | — | 負荷時の上振れ吸収 |
| brand_fetch | 10s | 60s | 30s | HTML fetch |
| classify_industry | 6s | 30s | — | LLM軽量 |
| search | 30s | 90s | 90s | grounded search |
| fetch_competitors | 20s | 60s | 20s×4 | **並列化前提** |
| analyze | **90s** | **240s** | **300s** | **最大のレバー** |
| margin | 21s | — | — | |
| **合計** | **180s** | — | **480s (OVERALL)** | |

analyze 90秒は現在体感 240〜300s の **60〜70% 削減**。本プランの成否はここで決まる。

---

## Approach: 5 Phase

### Phase 0 — 応急措置（≤15分）【必須・即実施】

**目的:** 次の再試行でユーザーを frontend 誤検知で蹴らない状態にする。ただし **5分上限ルールを破らない**。

**方針:** 闇雲にtimeoutを延ばすと5分を超えるので、frontend は backend 値より少しだけ上に揃え、hard ceiling は **5分+20秒 (320s)** で頭打ちにする。backend は Phase 2 で短縮するまで現状維持。

**変更:**
- [src/pages/Discovery.jsx:112-122](src/pages/Discovery.jsx#L112-L122)
  - `POLL_HARD_CEILING_MS`: `400_000` → **`320_000`** （5分+20秒上限。5分超えはユーザー要件違反なので打ち切る）
  - `STAGE_TIMEOUT_MS.analyze`: `240_000` → **`310_000`** （backend 300s + 10s 余裕。backend が先にエラー返せるように）
  - `POLL_SOFT_WARNING_MS`: `150_000` → **`120_000`** （2分で「遅いですが動作中」バナー。3分目標だから2分で警戒）
  - コメントを現値（backend 300s/480s、5分上限）に書き換え
  - **注意:** これは Phase 2 完了までの暫定値。Phase 2 で 180s 完走を達成したら Phase 2C で analyze=130s、hard_ceiling=220s まで絞る
- [backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py:900](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L900)
  - hardcoded fallback `"360"` → `"480"`（L484 と統一、env 設定漏れ時の latent drift を除去）
  - Phase 2 完了後に両方 `"290"` 程度に再調整

**Phase 0 だけで 5 分以内になるか？** いいえ。現状 backend analyze が実測 ~250s 必要なので、Phase 0 単体では「backend が 5分以内に終わった場合のみ」ユーザーに届く。5分を超えるケースは依然失敗。**真の解決は Phase 2 にしかない。** Phase 0 は Phase 2 実装中の転倒防止であって、完成形ではない。

### Phase 1 — 計測ベースライン取得（30〜45分）

**目的:** Phase 2 の最適化対象を数値で特定する。「憶測で短縮」を避ける。

**Agent teams（並列 2）:**
- **Agent A (Explore, very thorough):** backend の analyze stage 内訳（プロンプト組立／Claude API call／ReportEnvelope 生成／ログ書き出し）にマイクロ計測ログを差し込む実装案と、既存の `PipelineBudgetTracker` ([discovery_pipeline.py:485](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L485)) との連携点を報告
- **Agent B (general-purpose):** `./dev.ps1` でローカル起動 → webapp-testing skill で petabit.co.jp を 3 回実行 → stage ごとの実経過秒を CSV 化

**出力:** `plans/2026-04-21-discovery-baseline-measurement.md`（現状値の数値表、ボトルネック特定）

### Phase 2 — 短縮策実装（2〜3時間）

**Agent teams（並列 3）:** 各レバーを独立実装、衝突は Phase 4 レビューで解決。

#### 2A. Analyze 高速化（最大のレバー）
- **モデル切替:** Primary を `claude-haiku-4-5-20251001` に（現 fallback）、Sonnet を fallback へ。[render.yaml:57-58](render.yaml#L57-L58) で `ANTHROPIC_DISCOVERY_ANALYSIS_MODEL` と `ANTHROPIC_DISCOVERY_FALLBACK_MODEL` を入替
  - Haiku 4.5 は体感 3〜5倍速。品質は Phase 3 で petabit で A/B 評価
- **出力トークン cap:** analyze プロンプトの `max_tokens` を調査・引き下げ（[anthropic_client.py:67-72](backends/market-lens-ai/web/app/anthropic_client.py#L67-L72) 経路）
- **Prompt caching:** Anthropic prompt cache を有効化してシステムプロンプト部分を使い回し（2回目以降のレスポンス改善）

#### 2B. 並列化
- `fetch_competitors` 内の複数 URL fetch を `asyncio.gather` に（既に並列化されているか確認、逐次なら並列化）
- `classify_industry` と `brand_fetch` の直列依存を解除可能か検討（`brand_fetch` の HTML が `classify_industry` の入力なら不可だが、先行 `search` を brand URL だけで走らせて head-start も選択肢）

#### 2C. 分析対象削減（低リスク・即効）
- [render.yaml:53](render.yaml#L53) `DISCOVERY_MAX_COMPETITORS`: `4` → **`3`**
- [render.yaml:55](render.yaml#L55) `DISCOVERY_ANALYZE_SITE_LIMIT`: `4` → **`3`**
- 品質影響は Phase 3 で 4vs3 比較し、許容なら確定

#### 2D. 締め直し（Phase 2A-C 完了後、merge 前に必須）
Phase 3 ベンチで 180s 完走が安定して出たら、timeout を本来の5分上限スペックに絞り直す：
- Backend [render.yaml:47-52](render.yaml#L47-L52):
  - `DISCOVERY_ANALYZE_TIMEOUT_SEC`: `300` → **`180`**（余裕含め目標の2倍）
  - `DISCOVERY_OVERALL_JOB_TIMEOUT_SEC`: `480` → **`290`**（5分弱で backend 側も絶対切断）
  - `ANTHROPIC_TIMEOUT_SEC`: `300` → **`180`**
- Frontend [src/pages/Discovery.jsx:112-122](src/pages/Discovery.jsx#L112-L122):
  - `POLL_HARD_CEILING_MS`: **`300_000`**（ジャスト5分。これ以上待たせない）
  - `STAGE_TIMEOUT_MS.analyze`: **`190_000`**（backend 180s + 10s）
  - `POLL_SOFT_WARNING_MS`: **`90_000`**（1.5分で警戒 = 3分目標の折り返し）

これが **最終的にユーザーに届く値**。Phase 0 の緩い値はあくまで Phase 2 実装中の一時状態。

**注意:** 既存プラン `plans/2026-04-05-discovery-token-pressure-reduction-plan.md` / `plans/2026-04-05-discovery-analyzer-token-pressure-deploy-result.md` で試された策を重複実装しないこと。Phase 1 Agent A が既実施項目を棚卸する。

### Phase 3 — Playwright 検証（45〜60分）【必須】

CLAUDE.md ルール準拠：src/ 変更があるので Playwright 検証必須。ユーザー明示指示「必ず playwright で確認」。

#### 3A. 準備
```bash
npm run build
cd backends/market-lens-ai && python -m pytest
```

#### 3B. Playwright E2E（devtools-verify + webapp-testing skill 併用）

**ゲストモード必須**（devtools-verify skill のルール：`--guest` で clean localStorage）。

webapp-testing skill `scripts/with_server.py` で `npm run dev`（port 3002）起動後、Playwright sync API で：

1. **本番URLと同等の動作:** `/discovery` を開き `https://www.petabit.co.jp/` を投入 →  Discover → **180秒以内完走を3回連続**で達成
2. **コンソールエラー監視:** `page.on('console', ...)` で下記が出ないことを確認
   - `[Discovery] Stage timeout`
   - `[Discovery] Hard ceiling reached`
   - `[Discovery] Stale detection started`（短時間の一時的検出は許容、90s 継続は NG）
   - Soft warning (`150s`) は 180s 完走が前提なら **出てはならない**
3. **成果物検証:** `result.report_md` が非空、Section 1〜5 まで描画される
4. **Regression:** Layout 共通化の影響 check
   - `/compare`（LP比較分析）を開く → エラーなし
   - `/creatives`（クリエイティブ診断）を開く → エラーなし

#### 3C. Negative test
- モック backend で analyze を 320s 待機させ、frontend が 330s まで待ち、backend 完了後ちゃんと受け取れることを確認（Phase 0 の guardrail 動作確認）

#### 3D. 品質 A/B（2C / 2A の場合のみ）
- Sonnet vs Haiku、4競合 vs 3競合 で report_md を比較し、**ユーザーに承認を仰ぐ**。ここは自動判定せずに必ず人間判断を入れる。

### Phase 4 — レビュー（30〜45分）

1. **`universal-review` skill** (Mode: Diff) — 軽量レビュー
2. 指摘の Critical/Major を修正
3. **`codex-review` skill** — 重要マイルストーンレビュー（4ゲート: Plan/Diff/Runtime/Release）
4. Critical/Major が 0 になるまで修正ループ（skill 仕様）

### Phase 5 — デプロイ & 本番検証

**ユーザー明示承認が必要な操作（confirm 必須）:**
- git commit（branch: `chore/render-yaml-timeout-sync` に追加）
- git push origin
- PR 作成 / merge（master）
- Render / Vercel の自動再デプロイをトリガー

**モノリポ化の恩恵:** 本 PR は frontend + backend + render.yaml を **1コミット原子的に**含む。

**本番検証:**
1. デプロイ完了後、本番 URL [https://insight-studio-chi.vercel.app/discovery](https://insight-studio-chi.vercel.app/discovery) で petabit.co.jp を再実行
2. **ゲストモード Chrome** で DevTools Console 監視
3. 180 秒以内完走 + エラー0 を2回連続達成したら完了

---

## Critical files

| ファイル | 役割 |
|---|---|
| [src/pages/Discovery.jsx:108-184](src/pages/Discovery.jsx#L108-L184) | timeout 定数群 + 再試行判定 |
| [src/pages/Discovery.jsx:470-600](src/pages/Discovery.jsx#L470-L600) | `pollJob` tick／stale／stage timeout ロジック |
| [src/components/ui.jsx:68-95](src/components/ui.jsx#L68-L95) | `ErrorBanner`（再試行ボタン） |
| [src/utils/analysisProvider.js:25-29](src/utils/analysisProvider.js#L25-L29) | 「Claude」pill ラベル |
| [render.yaml:38-58](render.yaml#L38-L58) | Discovery 関連 env（timeout / モデル / MAX_COMPETITORS） |
| [backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py:251-259](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L251-L259) | `_resolve_timeouts` |
| [backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py:480-485](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L480-L485) | `PipelineBudgetTracker` init |
| [backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py:895-909](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L895-L909) | analysis model 選択＋attempts |
| [backends/market-lens-ai/web/app/anthropic_client.py:67-72](backends/market-lens-ai/web/app/anthropic_client.py#L67-L72) | Claude client timeout |
| [backends/market-lens-ai/web/app/routers/discovery_routes.py:320-405](backends/market-lens-ai/web/app/routers/discovery_routes.py#L320-L405) | job endpoint / overall wait_for |

## 再利用する既存資産（新規作成を避ける）

- `PipelineBudgetTracker`（discovery_pipeline.py:485）— 予算トラッキングを既に実装済。計測ログ注入に流用
- `webapp-testing` skill の `scripts/with_server.py` — npm run dev 起動＋Playwright セットアップ
- `devtools-verify` skill — ゲストモード Chrome 起動
- `universal-review` / `codex-review` skill — レビュー
- 既存プラン `plans/2026-04-05-discovery-token-pressure-reduction-plan.md` / `plans/2026-04-05-discovery-load-shaping-results.md` / `plans/2026-04-08-incident-stabilization-claude-plan.md` — 過去試行の知見

---

## Verification criteria（merge green light）

- [ ] `npm run build` 成功
- [ ] `pytest backends/market-lens-ai` 全 pass
- [ ] Playwright run × 3 回で **180s 以内完走を 3/3 達成**、中央値 ≤ 160s（Primary 目標）
- [ ] Playwright run × 10 回で **300s (5分) 超過が 0/10**（Hard upper bound、必須）
- [ ] Console errors: 0 件（Stage timeout / Hard ceiling / Stale 90s ともに発生せず）
- [ ] `/compare` と `/creatives` の regression なし
- [ ] `universal-review` Critical/Major: 0
- [ ] `codex-review` Critical/Major: 0
- [ ] ユーザー品質承認（Sonnet→Haiku 切替時のみ）
- [ ] Phase 2D 締め直し後の最終値（backend analyze=180s/overall=290s、frontend ceiling=300s）が適用済

## Risks & rollback

| リスク | 対応 |
|---|---|
| Haiku 4.5 で出力品質低下 | Phase 3 3D で人間 A/B、NG なら env 1行で Sonnet に戻す |
| fetch_competitors 並列化で rate limit | 並列度を2〜3 に上限。`httpx.Limits` で制御 |
| `DISCOVERY_MAX_COMPETITORS=3` で情報量不足 | 4 に戻して 2A/2B のみで 180s 目指す |
| デプロイ順のズレ（Vercel/Render 再ビルドタイミング差） | Phase 0 の frontend 値は旧・新 backend どちらでも安全（ゆるい方向の変更）なので問題なし |
| Phase 2 で 180s 達成できなかった場合 | Phase 0 のゆるい timeout が最終ガードレールとして残る。ユーザーに残課題として報告 |

## Non-goals（今回やらない）

- Discovery 以外（Compare, Creative Review）の timeout 見直し（regression check のみ）
- DB スキーマ変更
- UI デザイン変更
- 新機能追加

---

## 実行順サマリ

```
Phase 0 (frontend timeout drift 応急修正)
   ↓
Phase 1 (ベースライン計測: Agent A + B 並列)
   ↓
Phase 2 (短縮策: 2A + 2B + 2C 並列)
   ↓
Phase 3 (Playwright 検証 ゲストモード)
   ↓  [NG なら Phase 2 に戻る]
Phase 4 (universal-review → codex-review)
   ↓
Phase 5 (ユーザー承認 → commit → push → PR → 本番 smoke)
```
