# Phase 5C 本実行 — `useUiVersion.DEFAULT` を v1 → v2 に昇格

## Context

PR #47（`docs(phase5c): rewrite handoff plan to full-autonomous flow`）で Phase 5C ハンドオフドキュメントを「人間承認ゲート無し、CI/Vercel 緑確認 → 自動マージ → 本番 deploy 目視まで無停止」に書き換え済。本プランはその書き換え済ハンドオフ [plans/2026-04-19-phase5c-handoff-v2-default-promotion.md](2026-04-19-phase5c-handoff-v2-default-promotion.md) に従って **Phase 5C 本体を実行**する。

コード変更は実質 2 ファイル・1 行 + テスト期待値。`?ui=v1` クエリ / localStorage 経由のユーザー側ロールバックは不変で維持する。Gate（vitest / build / fixture harness / dev 目視）で console error 0 を確認した上で PR → CI 緑待機 → 自動マージ → 本番 deploy → Playwright 軽い目視を 1 セッションで完遂する。

**安全網**: Gate FAIL / CI 赤 / console error 1 件以上検出時は PR を OPEN のまま放置して報告して停止する（force-merge / `--no-verify` / destructive git 操作は禁止）。

**重点**: 本リリースの眼目は **Compare（比較分析）の v2 動作**。Discovery と同じ ReportView を呼び出す構造ゆえ vitest と fixture harness で骨格は検証できとるが、dev + 本番の **Playwright 目視は Compare を最優先**で通し、envelope / MD fallback 双方で比較チャート・ブランド分離・テーブル表示に欠損が無いかを確認する。console error は Discovery 側同等の閾値（1 件で停止）じゃ。

**並列化戦略**: Gate は可能な限り並列で回す。agent-team-workflow skill または複数 Agent 同時起動で、(a) vitest + build 並列、(b) dev server background 起動中に harness + Playwright を並行、(c) Playwright の dev 4 ページも `run_in_background` + concurrent タブで短縮する。能動時間を 60 分 → 30-40 分程度に圧縮するのが目標じゃ。

## 書き換え済ハンドオフからの差分（本日時点の注記）

- **ベースコミット**: ハンドオフ §3 は `fb8d3a8` を起点と記すが、PR #47 マージで master は現在 `56b6ded`（merge）/ `f3dfdea`（PR #47 squash）を含む。本プランのベースは `56b6ded`。`git pull --ff-only` 不可の diverge はこの repo で頻発するため、その場合は `git merge origin/master --no-edit` に切替える。
- **テスト更新箇所**: ハンドオフ §4-2 は「期待値 3 箇所」と記すが、実際は `it('defaults to v1 …')` の test 名 + assertion、`it('ignores invalid ?ui values')` の test 名 + assertion の計 **4 変更**じゃ。`query wins over localStorage`（L34-37）は意図通り v1 期待のまま変更不要。

## 変更対象ファイル

- [src/hooks/useUiVersion.js:13](../src/hooks/useUiVersion.js#L13) — `const DEFAULT = 'v1'` → `'v2'`（1 行）
- [src/hooks/__tests__/useUiVersion.test.js](../src/hooks/__tests__/useUiVersion.test.js) — L15, L16, L24, L26 の 4 箇所を v1 → v2 に更新（test 名 2 + assertion 2）

## 参照（変更なし、動作確認用）

- [src/pages/Discovery.jsx:406](../src/pages/Discovery.jsx#L406) — `useUiVersion()` 利用箇所
- [src/pages/Compare.jsx:326](../src/pages/Compare.jsx#L326) — 同上
- [src/components/report/v2/UiVersionToggle.jsx](../src/components/report/v2/UiVersionToggle.jsx) — v1/v2 トグル UI は昇格後も維持
- [src/pages/debug/ReportV2Debug.jsx](../src/pages/debug/ReportV2Debug.jsx) — debug route、常に v2 mount（変更不要）
- [scripts/phase5b-verify.py](../scripts/phase5b-verify.py) — fixture harness、Gate で L/M 再走

## 実行手順（ハンドオフ §3-§7 の再掲 + 本日時点への置換）

### Part A: 準備（5 分）

```bash
cd "c:/Users/PEM N-266/work/insight-studio"
git fetch origin
git checkout master
git pull origin master --ff-only   # diverge したら git merge origin/master --no-edit に切替
git log --oneline -5                # 56b6ded / f3dfdea / 1b1fdec / fb8d3a8 / cdc8243 が並ぶ想定
git checkout -b phase5c-v2-default-promotion
```

依存は前セッションで install 済。

### Part B: DEFAULT 切替（10 分）

- `src/hooks/useUiVersion.js:13` を `const DEFAULT = 'v2'` に変更
- `src/hooks/__tests__/useUiVersion.test.js` の以下 4 箇所を更新：
  - L15 `'defaults to v1 when no query or storage set'` → `'defaults to v2 when no query or storage set'`
  - L16 `expect(…).toBe('v1')` → `.toBe('v2')`
  - L24 `'ignores invalid ?ui values'` → `'ignores invalid ?ui values (falls back to v2 default)'`
  - L26 `expect(…).toBe('v1')` → `.toBe('v2')`
- L34-38 `'query wins over localStorage'` は **変更不要**（v1 クエリ → v1 の挙動を保つテスト）

### Part C: Gate 実行（20 分）

| Gate | コマンド | 期待 |
| --- | --- | --- |
| vitest | `npm test -- --run` | 153/153 passed |
| build | `npm run build` | warning が PR #46 時点から増えない |
| fixture harness | `npm run dev &` + `PYTHONIOENCODING=utf-8 PHASE5B_BASE_URL="http://localhost:3002" python scripts/phase5b-verify.py` | `L_fixture_v2_envelope` / `M_fixture_v2_md_fallback` PASS、`all_passed: true` |
| dev 目視（Playwright） | `webapp-testing` skill で `/debug/report-v2?fixture=discovery-sample`（ui 未指定で v2）、`/debug/report-v2?fixture=discovery-sample&ui=v1`、`/discovery`、`/compare` | 全ページで v2 DOM mount または空入力フォーム、**console error 0** |

**console error が 1 件でも出たら PR 作成に進まぬ。** 原因特定まで Gate を閉じる。

### Part D: PR → CI/Vercel 緑待機 → 自動マージ（15 分 + CI 待機）

```bash
git add src/hooks/useUiVersion.js src/hooks/__tests__/useUiVersion.test.js
git commit -m "feat(phase5c): promote v2 as default report UI" -m "...（ハンドオフ §6-1 本文テンプレに準拠）"
git push -u origin phase5c-v2-default-promotion
gh pr create --title "Phase 5C: promote v2 as default report UI" --body "（ハンドオフ §6-2 本文テンプレ）"
gh pr checks <PR番号> --watch
```

自動マージ 4 条件（ハンドオフ §6-4）：

| チェック | 期待状態 |
| --- | --- |
| `ci` | pass |
| `Vercel` | SUCCESS |
| `Vercel Preview Comments` | pass |
| `post-deploy-health` | skipping または pass |

全緑 → 即 `gh pr merge <PR番号> --squash --delete-branch`。いずれか赤 → PR OPEN のまま §12 Case C のテンプレで停止報告。

マージ後は local master が diverge する可能性が高いので `git checkout master && git merge origin/master --no-edit` で同期する。

### Part E: 本番 deploy 確認 + Playwright 軽い目視 + 1 報告（15 分）

```bash
gh api repos/kazushi-tech/insight-studio/deployments --jq '.[0:2] | .[] | {environment, sha, created_at, id}'
gh api repos/kazushi-tech/insight-studio/deployments/<DEPLOYMENT_ID>/statuses --jq '.[0] | {state, target_url}'
# state: success を確認、sha が merge commit と一致
```

`webapp-testing` skill で本番 URL を開く（LLM コスト発生ゼロ、DOM 到達と console error 観測のみ）：

- `https://insight-studio.vercel.app/discovery` → 200、v2 ReportView または空入力フォーム、console error 0
- `https://insight-studio.vercel.app/compare` → 200、同上

curl での 200 確認も並行。ハンドオフ §12 Case A テンプレで 1 メッセージ報告して完了。

## 並列実行タイムライン（目標 30-40 分）

```text
T+0   ── Part A: master 同期 + feature branch 作成（メインスレッド、5 分）
T+5   ── Part B: useUiVersion.js + test.js 編集（メインスレッド、5 分）
T+10  ── Part C 並列ブロック 開始
         ├─ [Agent #1 / Bash 並列] npm test -- --run
         ├─ [Agent #2 / Bash 並列] npm run build
         └─ [Bash run_in_background] npm run dev  ← port 3002 起動待ち
T+13  ── vitest / build の結果合流、dev server readiness 確認
         └─ [Bash] scripts/phase5b-verify.py（fixture harness L/M）
T+17  ── Playwright 目視ブロック（webapp-testing skill、並列 page）
         ├─ 【Compare 最優先】/compare で v2 ReportView / 比較チャート / ブランド分離 / テーブル確認
         ├─ /discovery で v2 / 空入力フォーム確認
         ├─ /debug/report-v2?fixture=discovery-sample（ui 未指定で v2）
         └─ /debug/report-v2?fixture=discovery-sample&ui=v1（ロールバック経路）
T+27  ── Gate 集約判定、console error 0 確認。NG なら停止
T+28  ── Part D: commit → push → gh pr create → gh pr checks --watch
T+35  ── 4 条件全緑 → gh pr merge --squash --delete-branch
T+37  ── Part E: 本番 deployment status / curl / Playwright 軽い目視（/compare を先）
T+40  ── §12 Case A テンプレで 1 メッセージ報告
```

## Agent / skill 役割分担

| 役割 | 使用 skill / tool | 責務 |
| --- | --- | --- |
| メインスレッド（このセッション） | Bash, Edit, Read | Part A/B/D/E 実行、判定と報告 |
| Gate 並列担当 A | Bash `run_in_background` | `npm test -- --run` |
| Gate 並列担当 B | Bash `run_in_background` | `npm run build` |
| dev server | Bash `run_in_background` | `npm run dev`（port 3002 常駐、Gate 完了まで） |
| harness | Bash | `python scripts/phase5b-verify.py`（dev server readiness 後） |
| ブラウザ目視 | `devtools-verify` or `webapp-testing` skill | **Compare を最優先**に 4 ページ検証、console error 捕捉 |
| 本番目視 | `devtools-verify` or `webapp-testing` skill | `/compare` `/discovery` の 200 + console error 0 |
| 複雑局面の探索 | Explore subagent | Compare v2 で崩れ観測時に原因箇所を grep/Read で高速特定 |
| プラン品質検証 | `codex-review` skill | Gate 完了後に本計画と実装 diff のレビューゲート（任意） |

`agent-team-workflow` skill はブロック内の 2 つ以上の tmux 並列作業（例: dev server + harness + Playwright）をまとめて立てる際の選択肢じゃ。今回は Bash の `run_in_background` で十分並列化できるため、必要性を感じたときのみ起用する。

## Compare 重点チェック項目（Playwright で必ず踏む）

| 観点 | 期待 | 失敗時の挙動 |
| --- | --- | --- |
| 比較対象ブランド分離 | 3 ブランド以上のケースで `brandEvalParser` が各ブランドを分けて render | ブランド混線 → 即 `?ui=v1`、PR OPEN で停止 |
| envelope 経路 | `envelope` フィールド正常な fixture / 本番レポートで v2 ReportView が mount | mount 失敗 → Gate 閉じる |
| MD fallback 経路 | envelope null レポートでも Markdown パース描画 | fallback 不発 → Gate 閉じる |
| 比較チャート / テーブル | 描画に欠損なし、数値表示崩れなし | 崩れ観測 → Explore agent で原因箇所特定、判断を仰ぐ |
| console error | 0 件 | 1 件でも Gate FAIL 扱い |
| ロールバック経路 | `?ui=v1` 付与で v1 ReportView に即切替 | 切替不可 → リリース中止 |

Discovery 側も同検証を踏むが、Compare を**最初**にチェックして早期 NG 検知を狙う。

## Verification（Gate 完了判定）

- [ ] `git log --oneline -3` に `56b6ded` 先頭、`f3dfdea` 含む
- [ ] `npm test -- --run` → `Test Files 19 passed (19) / Tests 153 passed (153)`
- [ ] `npm run build` → warning が PR #46 時点と同等（chunks > 500 kB は既知）
- [ ] `python scripts/phase5b-verify.py` → `all_passed: true`、`L_fixture_v2_envelope` / `M_fixture_v2_md_fallback` 共に PASS
- [ ] dev server で `/debug/report-v2?fixture=discovery-sample` が `ui=` 未指定で v2 DOM を mount
- [ ] Playwright で dev 4 ページ、本番 2 ページ（/discovery /compare）すべて **console error 0**
- [ ] `gh pr checks` が 4 条件全緑
- [ ] 最新 Production deployment の sha が merge commit と一致、state=success
- [ ] 本番 curl 3 ルート 200、Playwright で console error 0

## 非ゴール（本プラン外）

- Render 永続ディスク attach（別プラン、$0.25/GB/月 承認要）
- prod jobId E2E（Pattern G/H/J、disk attach 後の別プラン）
- v1 ReportView / v1 コンポーネントの削除（昇格 1-2 週観測後の別 PR）
- backend コード変更 / Gemini 切替 / モバイル対応
- 新規 Discovery ジョブ実行（LLM コスト発生）
- `UiVersionToggle` の UI 改修
- 新規 fixture / harness 拡張

## 想定外ケースの扱い（ハンドオフ §10・§12 準拠）

| ケース | 対応 |
| --- | --- |
| Gate FAIL（vitest / build / harness / dev 目視） | PR 作成に進まず、`plans/2026-04-19-phase5c-failure.md` を起こして §12 Case B で報告 |
| CI 赤 / Vercel FAIL | PR を OPEN のまま残置、§12 Case C で報告。force-merge / `--no-verify` / force-push は禁止 |
| 本番 Playwright で console error | 即 `?ui=v1` 周知、必要なら `git revert` または Vercel Dashboard rollback |
| ローカル master の diverge | `git merge origin/master --no-edit` に切替（destructive 操作は使わぬ） |

## 成功時の最終報告テンプレ（ハンドオフ §12 Case A）

```text
## Phase 5C v2 デフォルト昇格 完了

- PR: #<番号>（squash-merge、commit <sha>）
- CI / Vercel Preview: ✅ 全緑、承認ゲート無しで自動マージ
- 本番 deploy: ✅ SUCCESS（https://insight-studio.vercel.app/）
- Gate: vitest 153/153、build clean、fixture harness L/M PASS、dev 目視 OK
- 本番軽い目視（Playwright）: /discovery /compare 共に 200 到達、console error 0
- ロールバック経路: ?ui=v1 / git revert / Vercel rollback の 3 段階準備済

以降の監視は不二樹任意。Render disk attach と prod jobId 経路再走は別プランで。
```
