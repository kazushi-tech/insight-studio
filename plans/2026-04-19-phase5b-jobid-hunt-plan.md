# 🌿 Phase 5B: 有効 jobId 調達（永続ディスク・ログ調査）ハンドオフ

**作成日**: 2026-04-19
**作成者**: Claude（Opus 4.7、ハンドオフ元セッション）
**プロジェクトオーナー**: 不二樹（kazushi.fujiki@marketing.petabit.co.jp）
**対象ベースコミット**: `21bb7e5` (PR #44 マージ済、master 上)
**担当想定**: 別セッションの Claude（Opus 4.7、自律実行）
**前身**: `plans/claude-html-markdown-claude-claude-jolly-kay.md`（Phase 5B 選択肢 C）、`plans/2026-04-19-phase5b-debug-route-result.md`

---

## 0. TL;DR（このセッションでやること）

1. **Render 永続ディスク上の完了済 Discovery ジョブ ID を探索**（コストゼロ）
2. 候補 ID を `curl` で **prod backend 疎通確認**（`GET /api/ml/discovery/jobs/<id>`）
3. `result.report_md` が非 null かつ `status='completed'` な ID を 1 件確定
4. その ID を環境変数セットで harness 再実行 → Gate 判定
5. **Gate PASS** → Phase 5C プラン起草
6. **有効 ID が見つからない場合** → 不二樹に状況報告、新規ジョブ実行承認リクエストを草案

---

## 1. Context（なぜこの調査が必要か）

### 1-1. 直前までの流れ
| PR | 内容 | commit |
|---|---|---|
| #42 | Phase 5B harness + landing.css @theme cleanup | 4143319 |
| #43 | harness path/auth fix + Gate FAIL 報告 | 7a971a7 |
| #44 | dev-only `/debug/report-v2` ルート + harness URL 切替 | 21bb7e5 |

PR #44 で debug route は配備・デプロイ済。しかし、プラン §4-2 で指定していた `DISCOVERY_SEARCH_ID=a03bc0f98cfa`（カメラの大林）は prod backend で **404** じゃった。永続ディスクから消えた可能性が高い。

### 1-2. ローカル調査で判明した事実
- [backends/market-lens-ai/data/](backends/market-lens-ai/data/) にローカル `discovery_jobs/` は **存在せず**（ローカル開発で Discovery を走らせとらんため）
- `data/scans/` には **204 件**の Compare スキャン履歴あり（本プラン対象外、参考情報）
- 永続ディスクは Render 側で管理、ローカルから直接触れない
- Discovery job の list 取得 API は未実装（[backends/market-lens-ai/web/app/routers/discovery_routes.py](backends/market-lens-ai/web/app/routers/discovery_routes.py) に `GET /jobs/{id}` のみ）

### 1-3. 想定される成果
- 有効 jobId 1 件確定 → harness 再実行 → Phase 5B Gate 通過 → Phase 5C プラン起草
- ゼロ件の場合でも、調査結果を docs 化して不二樹の次手判断材料にする

### 1-4. userルール制約
- **新規 Discovery ジョブ実行は LLM コスト発生** → 不二樹の明示承認なしに実行禁止（`feedback_no_confirmation` の例外）
- 本プランは**コストゼロの調査のみ**で進める。ゼロ件なら報告で終わる

---

## 2. 調査戦略（優先順）

### 2-1. 戦略 A: Render Dashboard 経由で永続ディスクを閲覧（推奨）
Render の `market-lens-ai` サービスには永続ディスクがアタッチされとる（ [project_market_lens_render_free.md](C:\Users\PEM N-266\.claude\projects\c--Users-PEM-N-266-work-insight-studio\memory\project_market_lens_render_free.md) memory 参照、Starter プラン課金済）。

**手順**:
1. `reference_render_service.md` の手順で Render API キーを取得
2. Render Shell API または Dashboard で `/opt/render/project/data/discovery_jobs/` を `ls -la --sort=time`
3. 最新の完了済ディレクトリを 3-5 件候補抽出
4. 各ディレクトリ内に `job.json` と `result.json` が揃っとるもの（= 完了済）を優先

**メモ参照**: [reference_render_service.md](C:\Users\PEM N-266\.claude\projects\c--Users-PEM-N-266-work-insight-studio\memory\reference_render_service.md)

### 2-2. 戦略 B: Render ログから完了 jobId を抽出（バックアップ）
Render `market-lens-ai` のログに `section_audit issues=0` や `job_complete job_id=<id>` 系の出力が残っとる可能性：

```bash
# Render CLI が使えるなら
render logs --service market-lens-ai --tail 1000 | grep -E "discovery.*job_id|completed"

# もしくは Render Dashboard の Logs タブから過去 7 日分をエクスポート
```

ログから抽出した ID を次節で疎通確認。

### 2-3. 戦略 C: 本番 UI から拾う（補助）
本番 Vercel の Discovery 画面には過去実行の履歴 UI が存在する（[src/pages/Discovery.jsx](src/pages/Discovery.jsx) 参照）。不二樹のブラウザで `localStorage` または履歴 API を確認してもらう。

**ただし**: 履歴が表示されとる時点でブラウザ側に `run.result` があるということ。その場で `?ui=v2` を付けて開いてもらえば Gate の視認は画面越しに即座に可能。ただし Playwright 自動検証には URL 経由で store 復元が効かぬため、debug route 経由がやはり必要。

### 2-4. 戦略 D: 過去プラン文書から ID 発掘（最低限チェック）
```bash
grep -rohE "[0-9a-f]{12}" plans/ --include="*.md" 2>/dev/null | sort -u | head -30
```
→ わらわ側で実行済。ヒットは `a03bc0f98cfa` のみ（既知 404）。**この戦略は空振り確定**。

---

## 3. 候補 ID の疎通確認手順

### 3-1. 必要な環境変数
```bash
export AUTH_TOKEN="<不二樹の is_ads_token>"
export BACKEND_URL="https://market-lens-ai.onrender.com/api/ml"
```

### 3-2. 各候補 ID に対する 2 段階疎通

```bash
CANDIDATE="<12桁hex>"

# (1) ジョブ本体の存在・完了確認
curl -sS -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BACKEND_URL/discovery/jobs/$CANDIDATE" \
  | python -m json.tool | head -30

# 期待: status="completed" かつ result.report_md が非空文字列

# (2) envelope 側の疎通（200 or 404/409 なら OK、500 は NG）
curl -sS -o /tmp/env.json -w "%{http_code}\n" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BACKEND_URL/discovery/jobs/$CANDIDATE/report.json"

# 期待 http_code: 200（envelope 有り）/ 404 (REPORT_ENVELOPE_V0 flag off) / 409 (未完了)
# → 200 または 404 なら採用可（Pattern J は envelope=null 強制で動くため）
```

### 3-3. 採用判定

| (1) status | (1) report_md | (2) http_code | 採用 |
|---|---|---|---|
| completed | 非空 | 200 | ✅ 最良（Pattern H + J 両方検証可） |
| completed | 非空 | 404 | ✅ 可（Pattern H は MD fallback 経由、J は想定通り） |
| completed | 非空 | 409/500 | ⚠ 保留（他候補優先） |
| completed | null | — | ❌ skip |
| それ以外 | — | — | ❌ skip |

---

## 4. harness 再実行（Gate 判定）

### 4-1. 環境セット
```bash
cd "c:/Users/PEM N-266/work/insight-studio"
git fetch origin && git log --oneline origin/master -1  # 21bb7e5 以降

./dev.ps1  # PowerShell（dev server + backends）

export DISCOVERY_SEARCH_ID="<採用 ID>"
export AUTH_TOKEN="<is_ads_token>"
export PHASE5B_BASE_URL="http://localhost:3002"
```

### 4-2. 実行
```bash
python scripts/phase5b-verify.py
cat verify_output/phase5b/summary.json | python -m json.tool | head -50
```

### 4-3. Gate 条件（PR #44 harness、Pattern I skip 済）
- [ ] G: v1 baseline PASS（`.ui-v2` 非存在 or v1 相当要素が描画されとる）
- [ ] H: v2 実データ PASS（`<div class="ui-v2">` + v2 5 コンポーネント描画）
- [ ] J: MD fallback PASS（`envelope=null` クエリでも v2 5 コンポーネント描画）
- [ ] console_errors / page_errors ゼロ（全パターン）
- [ ] `all_passed: true`

---

## 5. Gate 判定後の動き

### 5-1. Gate PASS 時
`plans/2026-04-19-phase5c-v2-default-promotion-plan.md` を新規作成。含むべきセクション：

1. **Context**: Phase 5B Gate 通過の根拠（summary.json 抜粋、採用 jobId、harness スクリーンショット参照）
2. **変更**: [src/hooks/useUiVersion.js](src/hooks/useUiVersion.js) の `DEFAULT = 'v1'` → `'v2'`（1 行）
3. **テスト更新**: [src/hooks/__tests__/useUiVersion.test.js](src/hooks/__tests__/useUiVersion.test.js) に DEFAULT 期待値切替（存在する場合）
4. **ロールバック**: `?ui=v1` で即時復帰 / `git revert <sha>` / Vercel rollback
5. **リリース Gate**: vitest 緑 / Playwright G/H 再実行 / Vercel deploy SUCCESS / 本番目視
6. **監視項目**（昇格後 24-48h）: console error / Sentry / 不二樹からのフィードバック
7. **周知**: 不二樹、社内ステークホルダー

実 PR 実施は不二樹承認後の別セッション。本プランでは起草止まり。

### 5-2. Gate FAIL 時
`plans/2026-04-19-phase5b-e2e-failure-v3.md` に失敗分析（PR #43 の failure doc と同フォーマット）。不二樹判断待ち。

### 5-3. **有効 jobId が 1 件も見つからない時**
`plans/2026-04-19-phase5b-jobid-hunt-result.md` に以下を記録：

1. 戦略 A/B/C/D の結果（どこまで調べた、何件 404/500 が出たか）
2. 永続ディスクの ls 結果（取得できれば）
3. 不二樹への提案：
   - 新規 Discovery ジョブ実行の承認（コスト想定: Anthropic API 1 回分、~$0.5〜$1）
   - 実行候補 URL: [過去プラン履歴](plans/2026-04-05-discovery-claude-only-rollout-smoke-results.md) 等から軽量なものを 1 件選定
   - 承認後は別セッションで新規実行 → jobId 採取 → harness 再実行

**Phase 5C プラン起草は保留**。

---

## 6. Critical Files（このセッションで触る／参照する）

### 新規作成（条件付き）
- `plans/2026-04-19-phase5c-v2-default-promotion-plan.md`（Gate PASS 時のみ）
- `plans/2026-04-19-phase5b-e2e-failure-v3.md`（Gate FAIL 時のみ）
- `plans/2026-04-19-phase5b-jobid-hunt-result.md`（jobId ゼロ件 時のみ）

### 追記
- `plans/2026-04-18-phase5b-verification-result.md` — 再実行結果を第 N 節として追記

### 参照（読み取り）
- [scripts/phase5b-verify.py](scripts/phase5b-verify.py) — 既存 harness（変更不要）
- [backends/market-lens-ai/web/app/routers/discovery_routes.py](backends/market-lens-ai/web/app/routers/discovery_routes.py) — `GET /jobs/{id}` 仕様
- [backends/market-lens-ai/web/app/repositories/file_discovery_job_repository.py](backends/market-lens-ai/web/app/repositories/file_discovery_job_repository.py) — ディスクレイアウト（`data/discovery_jobs/<id>/job.json|result.json`）
- [reference_render_service.md](C:\Users\PEM N-266\.claude\projects\c--Users-PEM-N-266-work-insight-studio\memory\reference_render_service.md) — Render API キーと service ID

### 変更
- **なし**（本プランはコードに触らぬ、調査＋harness 実行のみ）

---

## 7. 遵守すべき運用ルール

- **新規 Discovery ジョブ実行は禁止**（本プラン内では）。必要になったら §5-3 で不二樹承認リクエストを起票
- **タイムアウト値を増やして解決しない**（`feedback_never_increase_timeouts`）
- **表面的修正で逃げない**（`feedback_no_surface_fixes`）
- **destructive git 操作禁止**: `reset --hard` / `push --force` / `branch -D` は明示承認なし禁止
- **Render env-var 変更は不二樹依頼**
- **Gemini を分析に使わない**（画像生成のみ）
- **Render 側で destructive なコマンドを打たない**（`rm -rf data/` 等絶対禁止、読み取り専用で調査）

---

## 8. リスクと対策

| リスク | 対策 |
|---|---|
| Render Shell アクセス権限がない | Dashboard の Disks タブから GUI で ls 可能（読み取りのみ）。それでも無理なら戦略 B/C へ |
| ログが 7 日より古く消えとる | Render の retention 設定次第。見つからなければ戦略 C か不二樹依頼 |
| 候補 ID は見つかったが `report_md` が空 | Phase 1/2 で失敗したジョブの可能性。`status` 別に filter し `completed` のみ採用 |
| envelope 404 が続出する | `REPORT_ENVELOPE_V0` flag off の時代のジョブ。`useReportEnvelope` は 404 silent fallback するので Pattern H は動く、J は forced null で OK |
| すべての候補が 404 | 不二樹に新規実行承認を依頼（§5-3） |
| 本番への curl が認証拒否 | `AUTH_TOKEN` の有効性を `/api/ml/health` で先に確認 |

---

## 9. Verification（自己検証）

```bash
# 有効 ID 確定後
curl -sS -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BACKEND_URL/discovery/jobs/$DISCOVERY_SEARCH_ID" \
  | python -c "import sys,json; d=json.load(sys.stdin); print('status:', d.get('status')); print('has_report_md:', bool(d.get('result',{}).get('report_md')))"

# harness 実行後
python -c "import json; d=json.load(open('verify_output/phase5b/summary.json')); print('PASS' if d['all_passed'] else 'FAIL')"

# 回帰
npm run build   # warning なし
npm test        # 153/153 緑
```

---

## 10. 報告フォーマット（不二樹向け）

### Case A: Gate PASS
```
## Phase 5B Gate 通過

- 採用 jobId: <id>（Render 永続ディスクから発見 / Render Log から抽出 / etc）
- G / H / J: 全 PASS（all_passed: true）
- Phase 5C プラン起草済: plans/2026-04-19-phase5c-v2-default-promotion-plan.md
- 次: v2 デフォルト昇格 PR（不二樹承認待ち）
```

### Case B: jobId ゼロ件（承認リクエスト）
```
## Phase 5B Gate — jobId 調達できず

- 調査結果: 戦略 A/B/C で発見できず、Render 永続ディスクには <件数> 件の discovery job が残存（いずれも `status != completed` or `report_md` 空）
- 提案: 新規 Discovery ジョブ 1 件の本番実行承認を依頼
  - 実行候補 URL: <過去プランから選定>
  - 想定コスト: Anthropic API 1 回分（概算 $0.5〜$1）
  - 承認後は別セッションで実行 → 即 harness 再実行へ
- 詳細: plans/2026-04-19-phase5b-jobid-hunt-result.md
```

### Case C: Gate FAIL
```
## Phase 5B Gate FAIL

- 採用 jobId: <id>
- 失敗 Pattern: <G/H/J>
- 推定原因: <v2 側 / MD fallback 側 / debug route 側 / envelope スキーマ不整合>
- 詳細: plans/2026-04-19-phase5b-e2e-failure-v3.md
- Phase 5C プラン起草は保留、不二樹判断待ち
```

---

## 11. 非ゴール（このセッションで触らない）

- 新規 Discovery ジョブの実行（§5-3 の承認リクエスト起票までが本プラン射程）
- `/debug/report-v2` ルート／harness の改修（PR #44 配備物で十分）
- Compare 側 debug route 対応
- URL→store hydrate 機能追加（選択肢 B、スコープ外）
- Phase 5C の PR 実施（起草止まり）
- backend 変更
- モバイル対応
- ads-insights 側への影響

---

## 12. 想定所要時間

| セクション | 推定 |
|---|---|
| 戦略 A/B/C 調査 | 20-40 分 |
| 候補疎通確認（curl） | 10-15 分 |
| harness 実行 + Gate 判定 | 15-20 分 |
| Phase 5C プラン起草（PASS 時） | 30-45 分 |
| jobId ゼロ件時の報告ドキュメント | 15-20 分 |
| **合計** | **1-2 時間** |

---

**本プランはコストゼロの調査のみで Phase 5B Gate を通すことを狙う。新規ジョブ実行は必要になったら次セッションに持ち越し、判断は不二樹に委ねる。焦って LLM コストを発生させるのは愚策じゃぞよ♡**
