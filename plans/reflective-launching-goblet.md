# Discovery Hub タイムアウト根絶プラン

## Context

ユーザー観測: Discovery Hub (`/discovery`) で「比較分析がタイムアウトしました。軽量化再試行も完了できませんでした (stage=analyze)」が 2分26秒(≈146s) で発火。コンソールに `/api/ml/discovery/job-xxx/report.json` 409 ノイズあり。ユーザー要望は「**もう二度と起こらないように**」。

### 根本原因（調査済み）

1. **コードのフォールバック値が古い**（最大の地雷）
   - `backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py:255` `DISCOVERY_ANALYZE_TIMEOUT_SEC` fallback が **120s**（routes.py / render.yaml は 210s）
   - 同ファイル L444, L860 `DISCOVERY_OVERALL_JOB_TIMEOUT_SEC` fallback が **150s**（他は 360s）
   - → 2分26秒で死ぬのは env が何らかの理由で pipeline に伝播していない or ローカルで 150s が効いている証拠。

2. **フロントの safety net がバックエンド budget より短い**
   - [src/pages/Discovery.jsx:111](src/pages/Discovery.jsx#L111) `POLL_HARD_CEILING_MS = 180_000` (3分) ← バックエンド 360s より短い
   - [src/pages/Discovery.jsx:119](src/pages/Discovery.jsx#L119) `STAGE_TIMEOUT_MS.analyze = 120_000` ← バックエンド analyze が attempts を回る前にフロントがキル

3. **analyze ループの budget 食い潰し要因**
   - `_analysis_attempts` の `timeout_cap` が絶対値ハードコード（150/105/90/75）で overall_budget から逆算されない
   - Quality retry が attempt ごとに発動 → 2 attempt × quality retry = 4 API コールに膨張
   - Anthropic SDK 側 `max_retries=2` と 外ループ `ANTHROPIC_CONNECT_RETRIES=3` の**二重リトライ** (最悪 6 回)

4. **409 ノイズ**
   - [src/hooks/useReportEnvelope.js:48](src/hooks/useReportEnvelope.js#L48) は 404/409 を silent fallback 済み。ただし jobId がある限り呼びに行くので **failed ジョブにも fetch → ブラウザが 409 を console に出す**

---

## 対象ファイル

| # | パス | 変更概要 |
|---|------|---------|
| F1 | [backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py) | (P0) L255 120→210, L444/L860 150→360。(P1) `_analysis_attempts` timeout_cap を overall_budget から逆算、Quality retry を attempt 1 のみ。(P2) attempt 別 observability log + 部分結果 fallback (env デフォルト OFF)。 |
| F2 | [src/pages/Discovery.jsx](src/pages/Discovery.jsx) | (P0) L111 180_000→400_000、L119 120_000→240_000。(P1) L414-417 `useReportEnvelope` 呼び出し条件に `run?.status === 'completed'` ガード追加。 |
| F3 | [backends/market-lens-ai/web/app/anthropic_client.py](backends/market-lens-ai/web/app/anthropic_client.py) | (P1) L68 SDK 側 `max_retries` を固定 0 に。外ループ `_MAX_CONNECT_RETRIES` を唯一の retry 層に一元化。 |
| F4 | [backends/market-lens-ai/tests/test_discovery_pipeline.py](backends/market-lens-ai/tests/test_discovery_pipeline.py) | 新デフォルト値・`_analysis_attempts` 逆算・Quality retry attempt1 限定の回帰テスト追加。 |
| F5 | [src/hooks/__tests__/useReportEnvelope.test.jsx](src/hooks/__tests__/useReportEnvelope.test.jsx) または `Discovery.test.jsx` | failed ジョブで fetch されないことを検証（gating は Discovery.jsx 側なので後者が自然）。 |

**変更しない:** `render.yaml` (既に 210/360 で正) ・`backends/market-lens-ai/web/app/routers/discovery_routes.py` (L236/L271 既に 210/360) ・env 追加なし。

---

## 変更内容（具体）

### F1-A (P0) デフォルト値統一
`discovery_pipeline.py`:
- L255: `os.getenv("DISCOVERY_ANALYZE_TIMEOUT_SEC", "120")` → `"210"`
- L444: `os.getenv("DISCOVERY_OVERALL_JOB_TIMEOUT_SEC", "150")` → `"360"`
- L860: 同上 150 → 360

### F1-B (P1) `_analysis_attempts` の timeout_cap 逆算
L358-410 `_analysis_attempts`:
- `budget = max(120.0, remaining_overall_sec - 20.0)` (末尾処理用に 20s 確保)
- attempt ごとの `timeout_cap` を按分:
  - attempt 1 (initial 4 サイト): `max(180.0, budget * 0.45)` — **最低 180s 保証**
  - attempt 2 (3 サイト degrade): `max(105.0, budget * 0.25)`
  - attempt 3 (fallback model): `max(90.0, budget * 0.20)`
  - attempt 4 (2 サイト最小): `max(75.0, budget * 0.10)`
- 既存の `timeout_sec = min(timeout_cap, base_timeout_sec, max(45.0, remaining_overall_sec - 15.0))` 多重天井は温存。

### F1-C (P1) Quality retry を attempt 1 のみに制限
L946-998 の開始条件 `if retryable_quality and retry_remaining > 60.0:` を

```python
if retryable_quality and retry_remaining > 60.0 and attempt_index == 1:
```

に変更。attempt 2 以降で `retryable_quality` だった場合は `logger.info("discovery_quality_retry_skipped_after_first_attempt", ...)` で skip 記録。

### F1-D (P2) attempt 別 observability log
ループ変数 `attempt_timings: list[dict] = []` を追加。各 attempt 終了時に `{attempt_index, site_limit, model, elapsed_sec, effective_timeout, outcome, compact, quality_retry_used}` を追記。成功時は `PIPELINE_SUMMARY` と並記、失敗時は L1035 付近で `logger.warning("discovery_analyze_attempt_trace %s", json.dumps(attempt_timings))`。

### F1-E (P2) 部分結果 fallback (デフォルト OFF)
`analyze` ループ内で各 attempt が「部分的に成功」した候補レポート (`candidate_report_md` / 品質 warning 止まりで critical ではない) を `partial_report_md` に保持する。L1036 付近の `if not report_md:` ブロックの先頭で、

```python
partial_fallback_enabled = os.getenv("DISCOVERY_PARTIAL_REPORT_FALLBACK_ENABLED", "false").lower() == "true"
if partial_fallback_enabled and partial_report_md:
    banner = "> ⚠️ タイムアウトにより部分レポート（分析済 {n} サイト）\n\n".format(n=partial_sites_analyzed)
    report_md = banner + partial_report_md
    tracker.record("analyze_partial_fallback_used", {"sites": partial_sites_analyzed})
    # 以降は通常成功パスへ fall through
else:
    # 既存の PipelineError throw 経路
```

デフォルト env 未設定 = `false` = 現状の PipelineError throw 経路を維持。ON にしたい時だけ Render env で `DISCOVERY_PARTIAL_REPORT_FALLBACK_ENABLED=true` を設定すれば即切替可能。品質情報は `report_envelope.meta.partial_fallback` フラグに露出し、UI 側で識別できるようにする（後続改善としても可）。

### F2-A / F2-B (P0) フロント safety net 調整
`src/pages/Discovery.jsx`:
- L111 `POLL_HARD_CEILING_MS = 180_000` → `400_000` (バックエンド overall 360s + 40s 余裕)
- L119 `STAGE_TIMEOUT_MS.analyze = 120_000` → `240_000`
- コメントでバックエンド side との対応関係を明示

### F2-C (P1) `useReportEnvelope` gating
L414-417 を:
```js
const shouldFetchReportEnvelope = run?.meta?.jobId && run?.status === 'completed'
const { envelope: discoveryEnvelope } = useReportEnvelope(
  shouldFetchReportEnvelope ? 'discovery' : null,
  shouldFetchReportEnvelope ? run.meta.jobId : null,
)
```

失敗 / running 時は fetch しない → 409 コンソールノイズ消滅、無駄な request 抑制。

### F3 (P1) Anthropic 二重リトライ解消
`anthropic_client.py` L68: `max_retries = int(os.getenv("ANTHROPIC_CONNECT_RETRIES","2"))` を削除し、`max_retries=0` 固定。外ループ L30 `_MAX_CONNECT_RETRIES=int(os.getenv("ANTHROPIC_CONNECT_RETRIES","3"))` が唯一の retry 層。`_is_retryable_status_error` による細粒度分類と Retry-After 尊重は外ループが担当。

---

## 実装順序

### Phase P0（即効・低リスク地雷除去）
1. F1-A (pipeline.py 3 箇所)
2. F2-A, F2-B (Discovery.jsx 2 定数)
3. `pytest backends/market-lens-ai/tests/test_discovery_pipeline.py`
4. `npm run build` 通過確認
5. **この段階で単体リリース可能**

### Phase P1（budget 最適化）
6. F1-B `_analysis_attempts` 逆算 + 回帰テスト
7. F1-C Quality retry attempt1 限定 + テスト
8. F3 SDK max_retries=0
9. F2-C useReportEnvelope gating + F5 テスト
10. pytest 全域 + フロント test
11. webapp-testing skill で `/discovery` 手動検証
12. P1 単体リリース

### Phase P2（観測性 + fallback 保険）
13. F1-D attempt trace log (副作用なし、P1 と同梱で可)
14. F1-E 部分結果 fallback 実装（env デフォルト OFF のため既定挙動は不変）
15. F1-E 用のテスト: env=true で partial_report_md がある時に `completed` + banner 付きレポートを返し、env 未設定時は `PipelineError` が維持されることを検証

---

## 検証方法

### バックエンド
- `pytest backends/market-lens-ai/tests/test_discovery_pipeline.py -k "attempt or timeout or quality"` focus 実行
- `pytest backends/market-lens-ai/tests` 全域（既存 `test_discovery_jobs.py:223` の `DISCOVERY_OVERALL_JOB_TIMEOUT_SEC=30` 短縮テストが壊れないか）
- **env 未設定起動確認**: `cd backends/market-lens-ai && uvicorn web.app.main:app --reload` → ログで `overall_budget=360.0` / `analyze_timeout=210.0` が出ることを確認

### タイムアウト挙動の人工再現
1. **analyze_fn monkeypatch**: pytest で `analyze_fn` を `async def slow(...): await asyncio.sleep(200)` に差替え、attempts が budget 内に収まるか検証
2. **`ANTHROPIC_TIMEOUT_SEC=5`** をローカル env で設定 → SDK が必ずタイムアウトする状態で attempts の fallback chain を全部回し、`stage=analyze` の PipelineError が正しく打たれるか確認
3. **`ANTHROPIC_DISCOVERY_ANALYSIS_MODEL=nonexistent-model`** で全 attempts を非 retryable エラーで失敗させ、F1-D の attempt trace log 4 行を確認

### フロント
- `npm run build`
- `webapp-testing` skill で `/discovery` を開き competitor URL (例 `https://www.petabit.co.jp/`) を submit
- DevTools Console を開き:
  - バックエンド job が `completed` になるまで `GET /jobs/{id}/report.json` が**発火しない**ことを確認（F2-C 効果）
  - analyze stage 中に 120s 経過しても stage timeout 警告が出ないこと（F2-B 効果）
  - 3 分以上かかる job でも hard ceiling でキルされないこと（F2-A 効果、staging で人工的な長 job を流す）
- **隣接画面リグレッション**: `/compare`, `/discovery` の完了済みレポートを開き、`useReportEnvelope` gating による envelope 取得の回帰がないことを確認

### Staging E2E
Render staging に deploy し、実在 URL 5 本を 10 連続実行:
- エラー率 0 件
- `PIPELINE_SUMMARY` の analyze elapsed p50/p95/p99 取得
- `discovery_analyze_attempt_trace` で attempt 2 以降に落ちる割合が 5% 未満なら健全

---

## リスク

| リスク | 評価 | 緩和 |
|-------|------|------|
| Render plan のリクエストタイムアウト衝突 | Discovery は async job (BackgroundTasks + job_repo) なので request wall clock は無関係 | 作業不要 |
| Claude API コスト増加 | initial attempt 120→180s は 1 ジョブの成功コール数を増やさない。Quality retry attempt1 限定と SDK 重複 retry 廃止でむしろ**減る方向** | 観測のみ |
| attempt 1 で 180s 粘って失敗 → 後続 attempt の機会減 | `max(45, remaining-15)` の多重天井で残り時間不足なら自動縮退。budget=360 なら 180+105+90+75 を収める余地あり | F1-B の按分ロジックで保険 |
| Quality retry 制限 → 品質低下 | attempt 2-4 は既に degrade 状態で quality retry の改善率低い。むしろ budget 消費でタイムアウト誘発している（本問題の要因） | `omitted_candidates` で UI 露出は維持 |
| SDK max_retries=0 → 429/overloaded 耐性低下 | 外ループ `_is_retryable_status_error` が 429/500/502/503/504/529 を既にカバー + Retry-After 尊重 | PR レビュー時に cover 範囲再確認 |
| フロント 400s hard ceiling で UX 悪化 | 4 分待たせる UX は現状「2分半で失敗」より優しい。stage timeout 240s で「遅い」hint は維持 | UX 観察 |

---

## Rollback

各 Phase が独立コミット。Phase 単位で `git revert` 可能。

- **全面 revert**: `.env` / `render.yaml` は触らないので環境整合は残る
- **P0 のみコード revert**: render.yaml の 210/360 が本番に残っているので本番挙動は影響なしだがローカルが旧値に戻るため、全面 revert より P0 維持推奨
- **フロントのみ revert**: F2 2 定数を戻せば 5 分で旧挙動に戻る
- **F3 revert**: SDK max_retries を 2 に戻すだけ、カバレッジ回復

---

## Critical files

- [backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py)
- [src/pages/Discovery.jsx](src/pages/Discovery.jsx)
- [backends/market-lens-ai/web/app/anthropic_client.py](backends/market-lens-ai/web/app/anthropic_client.py)
- [backends/market-lens-ai/tests/test_discovery_pipeline.py](backends/market-lens-ai/tests/test_discovery_pipeline.py)
- [src/hooks/useReportEnvelope.js](src/hooks/useReportEnvelope.js) (変更不要、呼び出し側を修正)
