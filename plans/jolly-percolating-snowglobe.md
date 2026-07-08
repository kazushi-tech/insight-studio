# Discovery Hub: 5件確実分析 — フェッチ失敗時の候補差し替え

## Context

Discovery Hub で5件の競合分析を実行すると、一部サイトのフェッチ失敗（HTTP 404等）により「未分析」が発生する。ユーザーは「5件と言ったら5件全部分析してほしい」と明言。

根本原因: 現在はランキング上位5件を固定で取得し、失敗しても差し替えなし。検索結果は通常7〜9件あるので、失敗分を下位候補で差し替える余地がある。

## 変更対象

| # | ファイル | 変更内容 |
|---|---------|---------|
| 1 | `web/app/routers/discovery_routes.py` | Phase 1 (並列5件) → Phase 2 (失敗分を残り候補で逐次差し替え) |
| 2 | `tests/test_discovery_analyze.py` | テストアサーション更新 |

## Task 1: discovery_routes.py — フェッチロジック変更

### 変更箇所: L730-752 (fetch_tasks〜ログ出力)

**現在:**
```python
fetch_tasks = [_fetch_one(c) for c in top_candidates]
fetch_results = await asyncio.gather(*fetch_tasks)

fetched_sites: list[FetchedSite] = []
competitor_extracted = []
for site, data in fetch_results:
    fetched_sites.append(site)
    if data is not None:
        competitor_extracted.append(data)

fetch_elapsed = ...
full_fetch_count = sum(...)
fail_count = sum(...)
_log_stage(...)
```

**変更後:**
```python
fail_count = 0

# Phase 1: 上位候補を並列フェッチ
fetch_results = await asyncio.gather(*[_fetch_one(c) for c in top_candidates])

fetched_sites: list[FetchedSite] = []
competitor_extracted = []
for site, data in fetch_results:
    if data is not None:
        fetched_sites.append(site)
        competitor_extracted.append(data)
    else:
        fail_count += 1

# Phase 2: 不足分を残りの候補で逐次補充
for cand in ranked[MAX_COMPETITORS:]:
    if len(competitor_extracted) >= MAX_COMPETITORS:
        break
    site, data = await _fetch_one(cand)
    if data is not None:
        fetched_sites.append(site)
        competitor_extracted.append(data)
    else:
        fail_count += 1

fetch_elapsed = (time.monotonic() - t0) * 1000
analyzed_competitor_count = len(competitor_extracted)
full_fetch_count = len(fetched_sites)
_log_stage(
    request_id, req.brand_url, "fetch_competitors", fetch_elapsed,
    "ok" if analyzed_competitor_count > 0 else "error",
    f"full={full_fetch_count},fail={fail_count}",
)
```

**ポイント:**
- `fetched_sites` には成功分のみ追加 → フロントの「未分析」表示が自動的に消える
- Phase 2 は逐次実行（セマフォ内なので問題なし）
- 全候補を使い果たしても足りない場合は、そのまま進行（既存の502ガードが機能）

## Task 2: テスト更新

- `test_partial_competitor_fail`: 1件失敗 → 残り候補で差し替え → `fetched_sites` に `failed` エントリなし
- `test_all_competitors_fetch_fail_returns_502`: 全候補失敗 → 502（変更なし）
- `test_dns_blocked_candidate_marked_as_failed`: DNS失敗 → 差し替え候補で補充 → `failed` エントリなし

## 検証

1. `python -m pytest tests/test_discovery_analyze.py tests/test_extractor.py -v` — 全テスト通過
2. git commit & push → Render デプロイ
3. Discovery Hub で再実行 → 5件全て分析完了、「未分析」表示なし
