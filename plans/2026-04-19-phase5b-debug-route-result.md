# Phase 5B 選択肢 C — `/debug/report-v2` ルート追加 & harness URL 切替 実行結果

**実行日**: 2026-04-19
**実行者**: Claude (Opus 4.7, Auto mode)
**対応プラン**: [plans/claude-html-markdown-claude-claude-jolly-kay.md](claude-html-markdown-claude-claude-jolly-kay.md)
**ベースコミット**: `fb60bb9`（master、PR #43 マージ後）

---

## 1. Summary

| 項目 | 結果 |
|---|---|
| `src/pages/debug/ReportV2Debug.jsx` 新設 | ✅ 完了 |
| `src/App.jsx` に `import.meta.env.DEV` ガード付きルート追加 | ✅ 完了 |
| `scripts/phase5b-verify.py` URL を `/debug/report-v2` 系に切替、Pattern I skip | ✅ 完了 |
| `npm run build` 緑 | ✅（`ReportV2Debug` は dist に含まれず tree-shaken 確認） |
| Vitest 153/153 | ✅ 緑 |
| 実データ E2E 再実行（Pattern G/H/J） | ⏸ 有効 `jobId` 未取得のため保留 |
| Gate 判定 | ⏸ 保留 — harness 実行待ち |

静的成果物（コード変更・build・vitest）は全て緑。Playwright harness 実行は次節 §2 の通り実施できず、不二樹環境での jobId 提供待ちとしたぞよ。

---

## 2. Harness 実行保留の事由

プラン §4-2 で指定された `DISCOVERY_SEARCH_ID=a03bc0f98cfa` の疎通確認:

```
$ curl -s -o /tmp/job-check.json -w "HTTP:%{http_code}\n" \
    "https://market-lens-ai.onrender.com/api/ml/discovery/jobs/a03bc0f98cfa"
HTTP:404
```

この `jobId` は prod backend 上で既に失効（TTL 切れまたは未到達）しておる。プラン §8 のリスク対策欄の通り「新しい `jobId` を不二樹に依頼」に該当。新規 Discovery job を自律実行すると Claude API クレジットを消費するため、プラン §7「新規ジョブ実行等のコスト発生は事前確認」ルールに従い実行を保留した。

**harness 再実行手順（不二樹が完了済 jobId を提供した後）:**

```bash
cd "c:/Users/PEM N-266/work/insight-studio"
./dev.ps1  # PowerShell — dev server (3002) + backends 起動

# 別ターミナル
export DISCOVERY_SEARCH_ID=<new_valid_job_id>
export AUTH_TOKEN="<is_ads_token>"
export PHASE5B_BASE_URL=http://localhost:3002
python scripts/phase5b-verify.py
python -c "import json; d=json.load(open('verify_output/phase5b/summary.json')); print('PASS' if d['all_passed'] else 'FAIL')"
```

---

## 3. プランとの差分（実装時に調整した点）

### 3-1. Pattern G の扱い

プラン §3-1 は Pattern G の URL を `/debug/report-v2?jobId=X&ui=v1` に切り替えると明記。一方プラン §4-3 は G について「`.ui-v2` 非存在、v1 コンポーネント描画確認」を要求。

`/debug/report-v2` は常に `ReportViewV2` を mount する実装ゆえ、両方を同時に満たせぬ。本セッションでは §3-1（URL 書き換え）を優先し、Pattern G を「debug route が `ui=v1` query を受けても v2 を描画する（query は no-op）」という追加 v2 smoke として扱うことにした。v1 baseline の回帰は vitest 153 テスト（特に `src/pages/__tests__` の v1 分岐テスト）でカバーされておる。

影響範囲:
- [scripts/phase5b-verify.py](../scripts/phase5b-verify.py) の pattern 名 `G_discovery_v1` → `G_debug_v2_with_v1_query`
- Pattern G の `is_v2` flag を `True` に変更

### 3-2. Compare 側（Pattern I）は skip

プラン §3-1 記載の通り Compare debug route は未実装ゆえ Pattern I は harness 対象外に。Compare の v1/v2 分岐は Discovery と同一（`ReportViewV2` をそのまま呼ぶ）ため、G/H/J で Phase 5C 昇格判断には十分。必要になれば別プランで Compare debug route を起こす。

### 3-3. `useReportEnvelope` の `forceNullEnvelope` ガード

プラン §2-1 の実装例は `forceNullEnvelope` の時も `useReportEnvelope('discovery', jobId)` を呼び出し、戻ってきた envelope を `null` に差し替える方式。これだと hook の内部で fetch が走り、Pattern J の意図（「envelope が最初から存在しない」状態での fallback）とズレる。

実装側では hook に渡す `kind`/`id` を `forceNullEnvelope` が true のとき `null` にすることで fetch 自体を抑止。MD fallback 経路のみ通ることを保証した。

```jsx
const { envelope, loading: envLoading } = useReportEnvelope(
  jobId && !forceNullEnvelope ? 'discovery' : null,
  jobId && !forceNullEnvelope ? jobId : null,
)
```

---

## 4. 本番影響ゼロの根拠

```
$ grep -l "ReportV2Debug" dist/ -r
OK: dev-only route tree-shaken
```

`import.meta.env.DEV` は Vite の production build では `false` に置換され、ルート追加ブロックが dead code として tree-shaken される。`ReportV2Debug.jsx` の import も削除されるため、dist/ に含まれぬことを確認済。

---

## 5. 次のアクション

1. **不二樹**: 完了済みの Discovery jobId（`/api/ml/discovery/jobs/<id>` で 200 を返すもの）を環境変数経由で提供
2. **別セッション**: §2 の手順で `python scripts/phase5b-verify.py` を実行
3. **Gate PASS** の場合: [plans/2026-04-19-phase5c-v2-default-promotion-plan.md](2026-04-19-phase5c-v2-default-promotion-plan.md) を起草（本セッションではコード変更の PR 化のみに留める）
4. **Gate FAIL** の場合: 失敗パターンと推定原因を `plans/2026-04-19-phase5b-e2e-failure-v2.md` に記録

---

## 6. 変更ファイル一覧

### 新規
- [src/pages/debug/ReportV2Debug.jsx](../src/pages/debug/ReportV2Debug.jsx) — dev 限定 v2 直接 mount 用 debug page

### 変更
- [src/App.jsx](../src/App.jsx) — `import.meta.env.DEV` ガード付きで `debug/report-v2` ルート追加（import 1 行、route 3 行）
- [scripts/phase5b-verify.py](../scripts/phase5b-verify.py) — URL ビルダーを `/debug/report-v2` 系に切替、Pattern I skip、Pattern G を v2 smoke として再定義、summary key を `search_id` → `job_id` に変更

### 追記
- [plans/2026-04-19-phase5b-debug-route-result.md](2026-04-19-phase5b-debug-route-result.md) — 本ファイル
