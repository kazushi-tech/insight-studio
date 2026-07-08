# Discovery Hub 根本修正 — analyze ステージ時間配分バグ修正

## Context

バックエンドの degrade 逆転バグ（prompt/token budget）は前回修正済み → LP比較分析は正常動作を確認。
しかし Discovery Hub はまだタイムアウトで失敗する。

**根本原因:** `_analysis_attempts()` が analyze ステージ開始時の `remaining_overall_sec` を**1回だけスナップショット**して全 attempt のタイムアウトを事前計算する。attempt 1 が 150s 消費した後でも attempt 2 は「残り 200s あるつもり」の 105s タイムアウトで走り、実際には外側の `asyncio.wait_for(timeout=360)` に殺される。

```
例: pre-analyze = 160s, remaining = 200s

事前計算（現在の挙動）:
  Attempt 1: min(150, 210, 185) = 150s
  Attempt 2: min(105, 210, 185) = 105s
  Attempt 3: min(90,  210, 185) = 90s
  Attempt 4: min(75,  210, 185) = 75s
  合計 = 420s > 残り 200s → 外側 timeout で全パイプラインが殺される

動的再計算（修正後）:
  Attempt 1: min(150, max(45, 200-15)) = 150s → 消費 150s, 残り 50s
  Attempt 2: min(105, max(45, 50-15))  = 45s  → 現実的タイムアウト
  → 外側 timeout に頼らず自律的に制御
```

**副次的問題:**
- Quality retry（品質再試行）が実残り時間を確認せず `min(attempt.timeout_sec, 90)` で走る → 外側 timeout に殺される
- degrade attempt も `compact_output=False` で走るため出力トークンが最大 → 生成時間が長い

## 修正内容

### ファイル: `market-lens-ai/web/app/services/discovery/discovery_pipeline.py`

### Change 1: analyze ループで動的タイムアウト再計算 (L857-894)

各 attempt の直前で `actual_remaining` を再計算し、不足なら早期 break。

```python
# --- 現在 (L882-894) ---
t0 = time.monotonic()
try:
    candidate_report_md, candidate_token_usage = await asyncio.wait_for(
        analyze_fn(
            all_extracted,
            ...
            compact_output=False,
        ),
        timeout=attempt.timeout_sec,    # ← 事前計算値をそのまま使用
    )

# --- 修正後 ---
t0 = time.monotonic()
actual_remaining = max(0.0, overall_job_timeout - (time.monotonic() - pipeline_start))
if actual_remaining < 50.0:
    logger.warning(
        "discovery_analyze_budget_exhausted request_id=%s attempt=%d remaining=%.1f",
        request_id, attempt_index, actual_remaining,
    )
    break
effective_timeout = min(attempt.timeout_sec, max(45.0, actual_remaining - 15.0))
try:
    candidate_report_md, candidate_token_usage = await asyncio.wait_for(
        analyze_fn(
            all_extracted,
            ...
            compact_output=(attempt_index > 1),  # Change 3 も同時適用
        ),
        timeout=effective_timeout,               # ← 動的計算値
    )
```

### Change 2: Quality retry に残り時間ガード追加 (L911-926)

Quality retry 発火前に残り時間を確認。不足なら retry をスキップして degrade に進む。

```python
# --- 現在 (L911-926) ---
if retryable_quality:
    logger.warning(...)
    try:
        compact_report_md, compact_token_usage = await asyncio.wait_for(
            analyze_fn(..., compact_output=True),
            timeout=min(attempt.timeout_sec, 90.0),   # ← 残り時間無視
        )

# --- 修正後 ---
retry_remaining = max(0.0, overall_job_timeout - (time.monotonic() - pipeline_start))
if retryable_quality and retry_remaining > 60.0:
    retry_timeout = min(90.0, max(30.0, retry_remaining - 15.0))
    logger.warning(...)
    try:
        compact_report_md, compact_token_usage = await asyncio.wait_for(
            analyze_fn(..., compact_output=True),
            timeout=retry_timeout,                     # ← 残り時間ベース
        )
elif retryable_quality:
    logger.warning(
        "discovery_quality_retry_skipped request_id=%s remaining=%.1f",
        request_id, retry_remaining,
    )
```

### Change 3: degrade attempt で compact_output=True (L891)

```python
# --- 現在 ---
compact_output=False,

# --- 修正後 ---
compact_output=(attempt_index > 1),
```

- 初回 attempt: `compact_output=False`（フル品質）
- degrade attempt: `compact_output=True`（短縮出力 → 生成高速化）
- degrade の趣旨「軽量化再試行」に合致

## 修正しないもの

- タイムアウト値（360s, 210s, 150s 等）は一切変更しない
- `_analysis_attempts()` 関数の degrade チェーン生成ロジックはそのまま
- フロントエンド（Discovery.jsx）は変更なし
- render.yaml の環境変数は変更なし

## 効果

```
Before:
  pre-analyze 160s → remaining 200s
  Attempt 1: 150s timeout → times out at 150s → remaining 50s
  Attempt 2: 105s timeout (事前計算) → 外側 360s timeout が 50s で kill
  → パイプライン全体がキャンセル → "分析がタイムアウトしました（全体360秒超過）"

After:
  pre-analyze 160s → remaining 200s
  Attempt 1: 150s timeout → times out at 150s → remaining 50s
  Attempt 2: 45s timeout (動的計算) → 自前で timeout → 残り 5s → break
  → PipelineError "比較分析がタイムアウトしました" (stage=analyze)
  → フロントで retryable=true として表示

  OR (よりよいケース):
  Attempt 1: compact_output=False, 150s → times out
  Attempt 2: compact_output=True, 45s → 短縮出力で成功！
  → degrade が本当の「軽量化」として機能
```

## 検証

1. `pytest` — `test_discovery_pipeline.py` の既存テストが通ること
2. `npm run build` — insight-studio のビルドは影響なし（変更なし）
3. 本番検証: Discovery Hub で URL を入力 → 分析完了またはリトライ可能なエラー（外側 timeout による強制キャンセルではなく）
4. ログ確認: `discovery_analyze_budget_exhausted` / `discovery_quality_retry_skipped` が適切に出力されること
