# Discovery Hub 1分以内完了 & stale検知の根本修正

## Context

Discovery Hub の実行が遅く（2〜5分）、stale検知の偽陽性回避として `POLL_STALE_TIMEOUT_MS = 120_000`（2分）に変更したが、これはタイムアウトを伸ばすだけの対症療法であり根本解決ではない。

**正しいアプローチ**: バックエンドを高速化して1分以内に完了させ、かつバックエンドにheartbeatを追加してstale検知を正確かつ短時間で動作させる。

## 変更概要

| # | 対象 | 変更 | 目的 |
|---|------|------|------|
| A | Backend routes | heartbeat追加 + 全体タイムアウト90s | stale検知を正確にする |
| B | Backend pipeline | タイムアウト削減 + 競合数削減 | 1分以内完了 |
| C | Backend search client | リトライ・max_uses削減 | 検索を高速化 |
| D | Frontend Discovery.jsx | stale 30s + absolute 90s + UXテキスト | 高速化に合わせた調整 |

---

## A. Backend heartbeat追加

**ファイル**: `market-lens-ai/web/app/routers/discovery_routes.py` (line 284 `_run_job`)

パイプライン実行中に10秒ごとに `updated_at` を更新するheartbeatタスクを追加。これにより、フロントエンドは30秒間更新がなければ「本当にstale」と正確に判定できる。

```python
async def _run_job():
    nonlocal record
    heartbeat_task = None
    try:
        record.status = DiscoveryJobStatus.running
        record.started_at = _now()
        record.updated_at = _now()
        job_repo.save_job(record)

        async def _heartbeat():
            while True:
                await asyncio.sleep(10)
                record.updated_at = _now()
                job_repo.save_job(record)

        heartbeat_task = asyncio.create_task(_heartbeat())

        async def _on_stage(...):  # 既存のまま

        result = await asyncio.wait_for(
            run_discovery_pipeline(...),
            timeout=float(os.getenv("DISCOVERY_OVERALL_JOB_TIMEOUT_SEC", "90")),
        )
        # ... 既存の成功処理 ...

    except asyncio.TimeoutError:
        record.status = DiscoveryJobStatus.failed
        record.stage = DiscoveryJobStage.failed
        record.message = STAGE_MESSAGES["failed"]
        record.updated_at = _now()
        record.error = DiscoveryJobError(
            status_code=504,
            detail=f"分析がタイムアウトしました（全体90秒超過、最終ステージ: {record.stage.value}）",
            retryable=True,
        )
        job_repo.save_job(record)

    except PipelineError as exc:
        # ... 既存のまま ...
    except Exception as exc:
        # ... 既存のまま ...
    finally:
        if heartbeat_task and not heartbeat_task.done():
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
        _running_tasks.pop(job_id, None)
```

---

## B. Backend パイプライン高速化

**ファイル**: `market-lens-ai/web/app/services/discovery/discovery_pipeline.py`

### B1. タイムアウトデフォルト削減 (line 212-219 `_resolve_timeouts`)

| パラメータ | 現在 | 変更後 | 理由 |
|-----------|------|--------|------|
| brand_fetch | 15s | 10s | 単純なHTTP GET |
| competitor_fetch | 25s | 12s | 2社並列で十分 |
| classify | 8s | 6s | 短いLLMコール |
| search | 90s | 45s | 検索スコープ縮小に合わせる |
| analyze | 90s | 30s | 2社比較で十分速い |

### B2. MAX_COMPETITORS削減 (line 409)

`MAX_COMPETITORS = 3` → `MAX_COMPETITORS = 2`

3社→2社に減らすことで fetch_competitors + analyze の時間を大幅短縮。品質は2社比較でも十分。

### B3. 検索結果数削減 (line 373)

`num=10` → `num=7`

Claude web_searchの返却数を減らし検索レスポンスを高速化。

---

## C. Backend 検索クライアント高速化

**ファイル**: `market-lens-ai/web/app/services/discovery/anthropic_search_client.py`

| パラメータ | 現在 | 変更後 | 理由 |
|-----------|------|--------|------|
| `ANTHROPIC_DISCOVERY_SEARCH_MAX_USES` (line 57) | 4 | 3 | ツール呼び出し回数を削減 |
| `DISCOVERY_SEARCH_MAX_RETRIES` (line 58) | 3 | 1 | 45s予算内に収める |
| `DISCOVERY_GROUNDED_SEARCH_TIMEOUT_SEC` (line 63) | 45 | 30 | 1リクエストあたりの上限を削減 |

---

## D. Frontend stale検知修正 & UX更新

**ファイル**: `insight-studio/src/pages/Discovery.jsx`

### D1. stale検知を30秒に (line 14)
`POLL_STALE_TIMEOUT_MS = 120_000` → `POLL_STALE_TIMEOUT_MS = 30_000`

heartbeatが10秒ごとなので、30秒 = 3回ミス = 本当のstale。

### D2. absolute timeoutを90秒に (line 13)
`POLL_MAX_DURATION_MS = 5 * 60 * 1000` → `POLL_MAX_DURATION_MS = 90_000`

### D3. エラーメッセージ更新 (line 266)
`分析がタイムアウトしました（5分）` → `分析がタイムアウトしました`

### D4. STAGE_TYPICAL_SEC更新 (line 27-34)
```javascript
const STAGE_TYPICAL_SEC = {
  queued: 2,
  brand_fetch: 4,
  classify_industry: 4,
  search: 20,
  fetch_competitors: 8,
  analyze: 15,
}
```

### D5. UXコピー更新 (line 458)
`30〜90 秒ほどかかることがあります` → `30〜60 秒ほどかかります`

### D6. analyze疑似プログレス速度上げ (line 303)
`analyzeElapsed / 5` → `analyzeElapsed / 2`

---

## 期待されるタイムライン

| ステージ | 典型値 | 最大値 |
|---------|--------|--------|
| queued | 1-2s | 2s |
| brand_fetch | 3-5s | 10s |
| classify_industry | 3-5s | 6s |
| search | 15-25s | 45s |
| fetch_competitors | 5-10s | 12s |
| analyze | 10-20s | 30s |
| **合計** | **~40-65s** | **~105s (全体90sでカット)** |

---

## 検証

1. Backend: `pytest` でパイプラインテストが通ることを確認
2. Backend: Render にデプロイ後、手動で Discovery ジョブを実行して1分以内に完了することを確認
3. Frontend: `npm run build` でビルド成功確認
4. Frontend: Discovery 実行時に stale 偽陽性が出ないことを確認
5. Frontend: 30秒以内に完了しない場合でもプログレスバーが正常に動くことを確認
