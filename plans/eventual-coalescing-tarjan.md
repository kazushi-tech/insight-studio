# Discovery Hub stale検知の偽陽性修正

## Context

Discovery Hub で「競合を発見」を実行すると、search ステージ中に「サーバーが応答しなくなりました（ステージ: 競合検索中...）」エラーが ~28秒で発火する。これは f5865da で追加された stale detection ロジックの閾値が低すぎることによる **偽陽性** である。

## 根本原因

### stale detection のタイミング問題

`POLL_STALE_THRESHOLD = 4`（連続4回の unchanged `updated_at`）で stale 判定するが、backend の `updated_at` は **ステージ遷移時のみ** 更新される（ステージ内では更新されない）。

**タイムライン:**
```
t=0s:  Job開始
t=2s:  poll → queued (updated_at=A)
t=4s:  poll → brand_fetch (updated_at=B) → staleCount reset
t=6s:  poll → brand_fetch (updated_at=B) → staleCount=1
t=8s:  poll → classify_industry (updated_at=C) → staleCount reset
t=10s: poll → classify_industry (updated_at=C) → staleCount=1
t=12s: poll → search (updated_at=D) → staleCount reset
t=14s: poll → search (updated_at=D) → staleCount=1
t=16s: poll → search (updated_at=D) → staleCount=2
t=18s: poll → search (updated_at=D) → staleCount=3
t=20s: poll → search (updated_at=D) → staleCount=4 → ★STALE判定！
```

search ステージは通常 20〜90秒かかるが、**わずか8秒で偽陽性** が発火する。

### Backend のタイムアウト設定との不整合

| 項目 | Backend timeout | Frontend stale発火 |
|------|----------------|-------------------|
| search | 90s | ~8s (4 polls x 2s) |
| analyze | 150s | ~8s (4 polls x 2s) |
| fetch_competitors | 25s | ~8s (4 polls x 2s) |

**すべてのステージで偽陽性のリスクがある** が、search と analyze が最も深刻。

## Rollback 判定

**Rollback 不要。** 理由:

1. stale detection は `f5865da` で追加されたもので、`e24c9ac` の optimistic strategy とは無関係
2. `e24c9ac` の direct backend 最適化自体は正しく動作している（health=200、poll レスポンスは返ってくる）
3. 問題は stale 閾値が低すぎるだけで、ロジック自体は正しい方向性

## 修正方針

**カウントベース → 時間ベースの stale 検知に変更する。**

### 変更ファイル

- [Discovery.jsx](src/pages/Discovery.jsx)

### 修正内容

1. `POLL_STALE_THRESHOLD = 4` (回数) → `POLL_STALE_TIMEOUT_MS = 120_000` (2分) に変更
2. `staleCountRef` → `staleStartRef` (stale 状態が始まったタイムスタンプ) に変更
3. stale 判定ロジック:
   - `updated_at` が変わらない場合: `staleStartRef` を初回のみセット、経過時間が閾値超過で fail
   - `updated_at` が変わった場合: `staleStartRef` をリセット

```javascript
// Before (count-based, fires after ~8s)
const POLL_STALE_THRESHOLD = 4

// After (time-based, fires after 120s)
const POLL_STALE_TIMEOUT_MS = 120_000
```

### 閾値 120秒 の根拠

- search stage max timeout: 90s → 120s で十分カバー
- analyze stage max timeout: 150s → analyze 中に 120s 経過で stale 判定されるリスクあり。ただし analyze は `progress_pct` が動く（90%→）ため `updated_at` 以外の情報がある。かつ backend は analyze timeout 後に即座に failed + `updated_at` 更新するため、実際には 150s 丸々 stale にはならない
- 5分の absolute timeout との整合: 120s stale + 次の poll で fail = ~122s。5分タイムアウトより十分早く検知できる
- Backend stale threshold (300s) との整合: frontend 側で先に検知する

## 検証

1. `npm run build` — ビルド成功確認
2. ローカルで Discovery 実行 → search ステージが 8秒で落ちないことを確認
3. stale 検知が 120秒後に正しく発火することを確認（テスト困難だが、ロジックの正しさはコードレビューで担保）
