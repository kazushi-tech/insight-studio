# 🌿 Phase 5C ハンドオフ: `useUiVersion.DEFAULT` を v1 → v2 に昇格する

**作成日**: 2026-04-19
**作成者**: Claude（Opus 4.7、Phase 5B Gate PASS を受けて起草）
**プロジェクトオーナー**: 不二樹（kazushi.fujiki@marketing.petabit.co.jp）
**対象ベースコミット**: `fb8d3a8` (PR #46 squash-merge、master 上)
**担当想定**: 別セッションの Claude（Opus 4.7、自律実行、Auto mode）
**前身**: [plans/claude-html-markdown-claude-claude-jolly-kay.md](claude-html-markdown-claude-claude-jolly-kay.md)（Phase 5B 実行プラン）+ [plans/2026-04-18-phase5b-verification-result.md §8](2026-04-18-phase5b-verification-result.md)（Gate PASS 記録）

---

## 0. TL;DR（このセッションでやること — 全自動、承認待ちなし）

1. **最新 master を pull**（PR #46 反映済）
2. **`src/hooks/useUiVersion.js:13` の DEFAULT を `'v1' → 'v2'` に 1 行変更**
3. **`src/hooks/__tests__/useUiVersion.test.js` の期待値 3 箇所を更新**（`v1 → v2`）
4. **Gate 実行**: vitest / build / fixture harness L/M 再走 / dev server 目視（Playwright）
5. **Gate 全通過を自分で判定**（console error 0、all_passed: true など）
6. **PR 作成 → CI / Vercel Preview SUCCESS 待ち → 自動マージ**（`gh pr merge --squash --delete-branch`）
7. **本番 Vercel デプロイ SUCCESS を確認**
8. **結果を不二樹に報告**（§12 のテンプレで、終了後 1 メッセージ）

**判断停止点は存在しない**。Gate が全通過かつ CI/Vercel 緑ならそのままマージ・デプロイまで完遂せよ。唯一の例外は §10 の「Gate FAIL / CI 赤 / console error 発生」時のみで、その場合は PR を OPEN のまま放置して不二樹に報告して終了する（勝手に force-merge はせぬ）。

**総所要**: 能動時間 約 1 時間、コスト 0（LLM $0、Render 追加 $0）

---

## 1. Context（なぜ今やるか）

### 1-1. 直前までの経緯

| フェーズ | 成果 | 参照 |
|---|---|---|
| Phase 5A | v2 コンポ + empty-state browser verify PASS | PR #41 |
| Phase 5B 初版 | harness 実装、jobId 調達失敗で Gate FAIL | PR #42/#43、[plans/2026-04-18-phase5b-e2e-failure.md](2026-04-18-phase5b-e2e-failure.md) |
| Phase 5B debug route | `/debug/report-v2?jobId=X` を dev 限定で追加 | PR #44 |
| Phase 5B jobid 調査 | Render に永続ディスク未 attach、prod ジョブ全消滅を確定 | PR #45、[plans/2026-04-19-phase5b-jobid-hunt-result.md](2026-04-19-phase5b-jobid-hunt-result.md) |
| **Phase 5B Gate** | **fixture 戦略で PASS、コスト 0** | **PR #46**、[plans/2026-04-18-phase5b-verification-result.md §8](2026-04-18-phase5b-verification-result.md) |

### 1-2. Gate PASS 内容（抜粋）

```
L_fixture_v2_envelope: passed=true
  - ui_v2_root_count=1, 5 コンポ全描画
  - console/page/failed-request 全 0
  - --md-sys-color-primary=#003925, font-family Inter/Manrope ✅

M_fixture_v2_md_fallback: passed=true
  - 同上、brandEvalParser が 3 ブランド分離
  - envelope null → MD fallback 経路正常

all_passed: true
```

### 1-3. 昇格の根拠

- vitest 153/153 緑（v2 コンポ全単体テスト通過）
- fixture ブラウザ実描画で envelope 経路 / MD fallback 経路の両方を確認
- Phase 5A で empty-state リグレッション確認済
- `?ui=v1` による即時ロールバック経路が機能する
- 監視強化 + 不二樹フィードバック 24-48h で早期検知可能

### 1-4. 残っている空白（正直な開示）

- **prod jobId E2E（G/H/J）**: Render に永続ディスク未 attach で skipped。fixture で代替
- 実ユーザーデータの全分布（極端に長い MD、envelope フィールド欠損パターン、大量ブランド案件）は fixture では網羅しきれぬ
- 対策: 監視強化期間 + `?ui=v1` 即時ロールバック + Render disk attach 後の補強（別プラン）

---

## 2. 全体像

```
Part A: 準備（5 分）
  ├─ git pull origin master --ff-only
  └─ 差分ゼロ確認、依存 install

Part B: DEFAULT 切替（10 分）
  ├─ src/hooks/useUiVersion.js:13 → 'v2'
  └─ src/hooks/__tests__/useUiVersion.test.js 3 箇所更新

Part C: Gate 実行（20 分）
  ├─ npm test -- --run            → 153/153 緑
  ├─ npm run build                 → warning なし
  ├─ npm run dev & harness 再走    → L / M 再 PASS
  └─ dev server で Discovery v2 目視

Part D: PR → CI/Vercel 緑待機 → 自動マージ（15 分 + CI 待機）
  ├─ feature branch push
  ├─ gh pr create（本文に「監視強化」「ロールバック経路」を明記）
  └─ gh pr checks --watch で緑確認 → gh pr merge --squash --delete-branch

Part E: マージ後（15 分、1 メッセージで報告完了）
  ├─ 本番 Vercel deploy SUCCESS 確認
  ├─ Playwright で本番 URL の軽い目視（/discovery /compare 到達、console error 0）
  └─ 結果を 1 メッセージで報告、以降の監視は不二樹任意
```

---

## 3. Part A: 準備（5 分）

```bash
cd "c:/Users/PEM N-266/work/insight-studio"
git fetch origin
git checkout master
git pull origin master --ff-only  # PR #46 が先頭の `fb8d3a8` を含むことを確認
git log --oneline -3               # `fb8d3a8 Phase 5B fixture E2E — Gate PASS (LLM cost zero) (#46)` が上位にあるべし
```

**注意**: ローカル master と origin/master が diverge しとる場合（本リポジトリで頻発する）、**fast-forward 不可なら `git merge origin/master --no-edit` に切替える**。destructive な reset/force-push は使わぬ。

依存 install（以前のセッションで入っておれば skip）:
```bash
npm install
pip install playwright && python -m playwright install chromium
```

---

## 4. Part B: DEFAULT 切替（10 分）

### 4-1. [src/hooks/useUiVersion.js:13](../src/hooks/useUiVersion.js#L13)

```diff
-const DEFAULT = 'v1'
+const DEFAULT = 'v2'
```

**1 行のみ**。URL query / localStorage の優先度は不変 — `?ui=v1` で即時 v1 にロールバックできる挙動を保つ。

### 4-2. [src/hooks/__tests__/useUiVersion.test.js](../src/hooks/__tests__/useUiVersion.test.js)

現在の期待値を更新する（3 箇所）:

```diff
-  it('defaults to v1 when no query or storage set', () => {
-    expect(resolveUiVersion()).toBe('v1')
+  it('defaults to v2 when no query or storage set', () => {
+    expect(resolveUiVersion()).toBe('v2')
   })

-  it('ignores invalid ?ui values', () => {
+  it('ignores invalid ?ui values (falls back to v2 default)', () => {
     window.history.replaceState({}, '', '/?ui=v99')
-    expect(resolveUiVersion()).toBe('v1')
+    expect(resolveUiVersion()).toBe('v2')
   })
```

`query wins over localStorage` テストは意図通り `v1` を期待しとるので**変更不要**（`?ui=v1` 指定 → v1 を返す挙動）。

### 4-3. その他確認（変更なしで済む想定）

- [src/pages/Discovery.jsx:406](../src/pages/Discovery.jsx#L406) `const { isV2: isUiV2 } = useUiVersion()` — そのまま
- [src/pages/Compare.jsx:326](../src/pages/Compare.jsx#L326) 同上
- [src/components/report/v2/UiVersionToggle.jsx](../src/components/report/v2/UiVersionToggle.jsx) — そのまま（v1/v2 両方のボタンが見える UI は維持）

---

## 5. Part C: Gate 実行（20 分）

### 5-1. 単体テスト

```bash
npm test -- --run
```

**期待**: `Test Files 19 passed (19) / Tests 153 passed (153)`。
**落ちた場合**: 4-2 の更新漏れを疑う。他所の期待値固定があれば grep して探す:
```bash
# 修正が他にも要る場合のみヒットする
grep -rn "'v1'" src/hooks/ src/components/report/v2/
```

### 5-2. ビルド

```bash
npm run build
```

**期待**: warning が PR #46 時点から増えていないこと（「chunks are larger than 500 kB」は既知、OK）。

### 5-3. fixture harness 再走

```bash
npm run dev  # port 3002、別ターミナル or run_in_background
# readiness: curl -sS http://localhost:3002/ を待つ

PYTHONIOENCODING=utf-8 PHASE5B_BASE_URL="http://localhost:3002" python scripts/phase5b-verify.py
```

**期待**:
- `L_fixture_v2_envelope`: PASS
- `M_fixture_v2_md_fallback`: PASS
- `all_passed: true`
- `DISCOVERY_SEARCH_ID` は unset のまま（jobId cohort は skipped）

**落ちた場合**: DEFAULT 切替によって `?ui=v2` 明示がなくとも v2 描画されるので、URL から `&ui=v2` を削っても等価。harness は `&ui=v2` を付けたままで互換。

### 5-4. dev server で目視確認（必須）

Playwright を使う（`webapp-testing` skill 参照、または直接スクリプト）。対象画面:

| URL | 期待挙動 |
|---|---|
| `http://localhost:3002/debug/report-v2?fixture=discovery-sample` | `ui=` 未指定でも v2 描画（DEFAULT='v2' 効果） |
| `http://localhost:3002/debug/report-v2?fixture=discovery-sample&ui=v1` | v1 挙動を取るが debug route は常に v2 を mount する設計。ここは harness の Pattern G と同じく「v1 クエリでも v2 描画」で OK |
| `http://localhost:3002/discovery` | v2 ReportView が見える（ただしレポート結果が store に無い場合は入力フォーム表示） |
| `http://localhost:3002/compare` | 同上 |

**console error が 1 件でも出たら即 fail 扱い**。原因判明まで PR 作成に進まぬ。

### 5-5. Gate チェックリスト

- [ ] `npm test -- --run` → 153/153
- [ ] `npm run build` → warning 数が PR #46 時点と同等
- [ ] `python scripts/phase5b-verify.py` → L/M 両 PASS、`all_passed: true`
- [ ] dev server で `/debug/report-v2?fixture=discovery-sample` が v2 描画
- [ ] dev server で console error 0

---

## 6. Part D: PR → CI/Vercel 緑待機 → 自動マージ（15 分 + CI 待機）

### 6-1. ブランチ作成 + コミット

```bash
git checkout -b phase5c-v2-default-promotion

# 変更したファイルを個別に add（unrelated な M 状態のファイルを巻き込まぬ）
git add src/hooks/useUiVersion.js src/hooks/__tests__/useUiVersion.test.js

git commit -m "$(cat <<'EOF'
feat(phase5c): promote v2 as default report UI

- src/hooks/useUiVersion.js: DEFAULT 'v1' → 'v2'
- Update useUiVersion tests to reflect new default (3 assertions)

?ui=v1 still works as immediate user-side rollback. localStorage and query
precedence are unchanged.

Gate: vitest 153/153, npm run build clean, Phase 5B fixture harness L/M
re-run PASS, dev server browser smoke of /debug/report-v2 + /discovery +
/compare showed v2 DOM with zero console errors.

Rollback paths:
- Per-user: ?ui=v1 or localStorage.setItem('reportUiVersion', 'v1')
- Soft: git revert of this commit → Vercel auto redeploy
- Hard: Vercel Dashboard rollback to previous deploy

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"

git push -u origin phase5c-v2-default-promotion
```

### 6-2. PR 作成（本文テンプレ）

```bash
gh pr create --title "Phase 5C: promote v2 as default report UI" --body "$(cat <<'EOF'
## Summary

- `src/hooks/useUiVersion.js` の DEFAULT を v1 → v2 に昇格する 1 行変更
- useUiVersion テスト 3 箇所の期待値更新

## Gate 結果

- vitest: 153/153 ✅
- npm run build: warning 増加なし ✅
- Phase 5B fixture harness: L / M 両 PASS、all_passed: true ✅
- dev server 目視: /debug/report-v2 fixture 両種 v2 描画、console error 0 ✅

## ロールバック経路

1. **即時（ユーザー単位）**: `?ui=v1` クエリ付与、または localStorage `reportUiVersion=v1`
2. **軽度**: 本 PR の revert → Vercel 自動 redeploy
3. **重度**: Vercel Dashboard で直前デプロイに戻す

## 監視強化（マージ後 24-48h、必須）

- console error / Sentry のアラート強化
- 不二樹からの UX フィードバック直接受付
- 閾値: console error が **5 件/h 超え**でロールバック検討
- ページ render 失敗観測 → 即時ロールバック

## 限界の正直な開示

本 Gate の根拠は **fixture + vitest + Phase 5A empty-state** の三点。実ユーザーデータの全分布は網羅せぬ（Render 永続ディスク未 attach で prod jobId が調達できぬため）。Render disk attach 後に prod jobId 経路 G/H/J を別プランで再走して補強予定。

## Test plan

- [x] npm test -- --run → 153/153
- [x] npm run build → warning OK
- [x] python scripts/phase5b-verify.py → L/M PASS
- [x] /debug/report-v2?fixture=discovery-sample を dev server で目視、console error 0
- [ ] Vercel Preview SUCCESS 確認
- [ ] CI + Vercel Preview Comments が緑、承認ゲートなしで自動マージ
- [ ] マージ後、本番 Vercel deploy SUCCESS
- [ ] マージ後、Playwright で /discovery /compare を目視、console error 0

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 6-3. CI + Vercel 確認

```bash
gh pr checks <PR番号> --watch
```

**必須通過**:
- `ci` → pass
- `Vercel` → pass
- `Vercel Preview Comments` → pass
- `post-deploy-health` → skipping または pass（本 PR は deploy gate 不要）

### 6-4. CI/Vercel 緑待機 → 自動マージ条件

次の 4 条件が全て満たされた場合のみ、承認を待たず即マージする：

| チェック | 期待状態 |
| --- | --- |
| `ci` | pass |
| `Vercel` | SUCCESS |
| `Vercel Preview Comments` | pass |
| `post-deploy-health` | skipping または pass |

全緑なら即実行:

```bash
gh pr merge <PR番号> --squash --delete-branch
```

いずれか失敗した場合は **PR を OPEN のまま残し**、§10 エスカレーションに従って不二樹に報告して終了する。`--no-verify` / force-merge / force-push は禁止。

### 6-5. マージ

上記 6-4 の全緑を確認できたら即実行:
```bash
gh pr merge <PR番号> --squash --delete-branch
```

**注意**: `gh pr merge` は local branch を削除し、作業ディレクトリが master に戻る。local master が origin と diverge しとる場合は `git merge origin/master --no-edit` で同期する（PR #46 時と同じ手順）。

---

## 7. Part E: マージ後（15 分、1 メッセージで報告完了）

### 7-1. 本番デプロイ確認

```bash
gh api repos/kazushi-tech/insight-studio/deployments --jq '.[0:2] | .[] | {environment, sha, created_at}'
# 最新 Production の sha が PR #<番号> の merge commit と一致することを確認

gh api repos/kazushi-tech/insight-studio/deployments/<DEPLOYMENT_ID>/statuses --jq '.[0] | {state, target_url}'
# state: success を確認
```

### 7-2. 本番 URL の軽い目視確認（Playwright）

`webapp-testing` skill を使って本番 URL を開き、以下を確認する（新規 Discovery ジョブ実行など LLM コストは発生させぬ、到達と DOM 健全性のみ）:

- `https://insight-studio.vercel.app/discovery` に 200 で到達
- `https://insight-studio.vercel.app/compare` に 200 で到達
- `page.on('console', ...)` で console error 0 を確認
- `v2` ReportView の DOM 骨格（`data-ui-version="v2"` 相当）が mount されとるか、あるいは入力フォーム/empty-state が正常描画されとるか

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://insight-studio.vercel.app/
# 200 を確認（Playwright と並行）
```

### 7-3. 結果報告

§12 Case A のテンプレ 1 メッセージでマージ + 本番 deploy + 軽い目視結果を一括報告する。以降の 24-48h 監視は不二樹の任意で、Claude 側は受動待機しない。フィードバックが来た場合のみ §10 表に従って対応する。

---

## 8. Critical Files（このセッションで触る／参照する）

### 変更
- [src/hooks/useUiVersion.js](../src/hooks/useUiVersion.js) — DEFAULT 1 行変更
- [src/hooks/__tests__/useUiVersion.test.js](../src/hooks/__tests__/useUiVersion.test.js) — 期待値 3 箇所

### 参照のみ
- [src/pages/Discovery.jsx:406](../src/pages/Discovery.jsx#L406) — `useUiVersion()` 利用箇所
- [src/pages/Compare.jsx:326](../src/pages/Compare.jsx#L326) — 同上
- [src/components/report/v2/UiVersionToggle.jsx](../src/components/report/v2/UiVersionToggle.jsx) — UI トグル（v1/v2 両方のボタン維持）
- [src/pages/debug/ReportV2Debug.jsx](../src/pages/debug/ReportV2Debug.jsx) — debug route（常に v2 mount、変更不要）
- [scripts/phase5b-verify.py](../scripts/phase5b-verify.py) — fixture harness（変更不要、再走のみ）

### 結果記録（Gate PASS 後に追記）
- [plans/2026-04-18-phase5b-verification-result.md](2026-04-18-phase5b-verification-result.md) — §9 として Phase 5C 実施結果を追記してもよい
- または新規 `plans/2026-04-19-phase5c-promotion-result.md` を起こす

---

## 9. 遵守すべき運用ルール

- **LLM コスト発生操作禁止**（新規 Discovery ジョブ、Claude API を叩く backend test 等）
- **Render 永続ディスク attach は本プランでは扱わぬ**（別プラン、要 $0.25/GB/月 承認）
- **タイムアウト値を増やして解決しない**（`feedback_never_increase_timeouts`）
- **表面的修正で逃げない**（`feedback_no_surface_fixes`）
- **destructive git 操作禁止**: `reset --hard` / `push --force` / `branch -D` は明示承認なし禁止
- **Gemini を分析に使わない**（画像生成のみ）
- **Gate FAIL / CI 赤 / console error 発生時は自動マージを中断し、PR OPEN のまま不二樹に報告**（force-merge / `--no-verify` で押し通さぬ）
- **console error を黙って見逃さぬ**（1 件でも出たら原因特定するまで Gate を閉じる）

---

## 10. リスクと対策

| リスク | 対策 |
|---|---|
| マージ後、実ユーザーの特定レポート形式で v2 が崩れる | `?ui=v1` 即時ロールバック + 監視強化で 24-48h 以内に検知 |
| console error が散発的に出る | Sentry / Vercel Analytics で集計、5 件/h 超で即ロールバック判断 |
| localStorage 経由で v1 固定しとるユーザーが v2 に触れぬ | 意図通り（ユーザー選択を尊重）。必要なら UiVersionToggle で v2 に切替え可能 |
| Compare 側の v2 挙動が Discovery と乖離 | vitest + fixture harness で両方検証済、Compare は ReportViewV2 を Discovery と同じ方法で呼ぶ |
| fixture で網羅できぬデータ分布で崩れる | 監視強化期間で早期検知、Render disk attach 後の補強プランで prod jobId 経路再走 |
| 不二樹が「やっぱり v1 に戻せ」と言う | 選択肢 1/2/3 のどれを選ぶか確認し即実行 |
| Gate FAIL / CI 赤 / console error 発生 | PR OPEN で報告して終了（勝手に force-merge / `--no-verify` / force-push せぬ） |

---

## 11. Verification（自己検証）

```bash
# Part A 後
git log --oneline origin/master -3  # fb8d3a8 が含まれる

# Part B/C 後
npm test -- --run                   # 153/153
npm run build                        # warning OK
python scripts/phase5b-verify.py     # L/M PASS、all_passed: true

# Part D 後
gh pr view <PR番号> --json state,mergeStateStatus,statusCheckRollup
# state=OPEN, Vercel=SUCCESS, ci=pass を確認したら承認ゲート無しで即マージ

# Part E 後
gh api repos/kazushi-tech/insight-studio/deployments --jq '.[0] | {environment, sha}'
# 最新が Production で merge commit sha と一致
curl -sS -o /dev/null -w "%{http_code}\n" https://insight-studio.vercel.app/
# 200
```

---

## 12. 報告フォーマット（不二樹向け）

### Case A: 成功（想定、1 メッセージで完結）

```
## Phase 5C v2 デフォルト昇格 完了

- PR: #<番号>（squash-merge、commit <sha>）
- CI / Vercel Preview: ✅ 全緑、承認ゲート無しで自動マージ
- 本番 deploy: ✅ SUCCESS（https://insight-studio.vercel.app/）
- Gate: vitest 153/153、build clean、fixture harness L/M PASS、dev 目視 OK
- 本番軽い目視（Playwright）: /discovery /compare 共に 200 到達、console error 0
- ロールバック経路: ?ui=v1 / git revert / Vercel rollback の 3 段階準備済

以降の監視は不二樹任意。Render disk attach と prod jobId 経路再走は別プランで。
```

### Case B: Gate FAIL（想定外）

```
## Phase 5C Gate FAIL

- 失敗した Gate: <npm test / build / harness / dev 目視 のどれか>
- 詳細: plans/2026-04-19-phase5c-failure.md
- Phase 5C 実施保留、不二樹判断待ち（PR は未作成）
```

### Case C: CI / Vercel 赤で自動マージ中断（想定外）

```
## Phase 5C 自動マージ中断（CI / Vercel 赤）

- PR: #<番号>（**OPEN のまま残置**、force-merge せず）
- 赤だったチェック: <ci / Vercel / Vercel Preview Comments / post-deploy-health のどれか>
- 観測ログ: <失敗チェックの target_url、console error など>
- 対応案:
  1. 原因修正 → 同 PR に追加 commit、CI 再実行
  2. 昇格見送り → PR クローズ、fixture 拡充 + 再 Gate
  3. revert 準備して再挑戦を別ブランチで
- 不二樹判断待ち
```

---

## 13. 非ゴール（このセッションで触らない）

- 新規 Discovery ジョブ実行（コスト発生）
- Render 永続ディスク attach（別プラン、追加課金）
- backend コード変更
- v1 ReportView / v1 コンポーネントの削除（昇格後 1-2 週の観測期間を経て別 PR）
- Compare 側 debug route 対応
- モバイル対応
- Gemini 切替
- タイムアウト値増加
- `UiVersionToggle` の UI 改修
- 新規 fixture 追加
- Phase 5B harness の拡張

---

## 14. 想定所要時間

| セクション | 推定 |
|---|---|
| Part A: 準備 | 5 分 |
| Part B: DEFAULT 切替 | 10 分 |
| Part C: Gate 実行 | 20 分 |
| Part D: PR 作成 → CI/Vercel 緑待機 → 自動マージ | 15 分 + CI 待機 |
| Part E: 本番 deploy 確認 + 軽い目視 + 1 メッセージ報告 | 15 分 |
| **能動時間合計** | **〜1 時間** |
| マージ後の監視 | 不二樹任意（Claude 側は受動待機せぬ） |

---

## 15. 将来の補強（本プラン外、メモのみ）

本 Gate の根拠強化策は以下：

1. Render `render.yaml` に `disk:` ブロック追加（1GB、$0.25/月）
2. Render Dashboard で disk attach → redeploy
3. 新規 Discovery ジョブ 1 件を本番実行（不二樹判断、LLM コスト承認）
4. Phase 5B harness の Pattern G/H/J を `DISCOVERY_SEARCH_ID=<新ジョブid>` で再走
5. v2 昇格の根拠を prod jobId 経路でも裏打ちする

これらは本プランの Gate 通過要件ではない。別プランで扱う。

---

## 16. ハンドオフ先 Claude への注意

- **ローカル master が origin と diverge する現象**が本リポジトリでは頻発する。`git pull --ff-only` が失敗したら `git merge origin/master --no-edit` に切替える（destructive 操作はせぬ）
- **`gh pr merge --squash --delete-branch`** は local branch を削除して master に戻す。その後 `git merge origin/master --no-edit` で最新を取り込むのが定番動線
- **Windows 環境の Python 標準出力エンコーディング**は cp932。harness 実行時は `PYTHONIOENCODING=utf-8` を必ず付ける
- **`npm run dev` は port 3002**。backend は fixture 経路では不要
- **`verify_output/` は gitignored**。harness 結果は summary.json を plans/ にコピーするか、重要な抜粋のみ doc に転記する
- **lint-staged が commit 時に走る**。TypeScript/ESLint エラーがあれば commit が失敗するので、段階的に解消する
- **PR 作成後は CI/Vercel の緑確認を `gh pr checks <番号> --watch` で待ち、緑なら即マージ**（承認ゲートは無い）
- **console error が 1 件でも出たら勝手にマージせぬ**（Gate / Preview / 本番軽い目視いずれも同様）
- **destructive git 操作禁止**: `reset --hard` / `push --force` / `branch -D` / `--no-verify` / `--no-gpg-sign` は全面禁止

---

**本プランは Phase 5B fixture Gate PASS という実測を根拠に、1 行の DEFAULT 切替で v2 を本番デフォルトに昇格させる。`?ui=v1` 即時ロールバック + Render disk attach 後の補強で、既知の空白を補う安全網を張る。Gate 緑・CI/Vercel 緑・console error 0 の三条件が揃えば承認を待たず完遂するのじゃ。じゃが一つでも赤が出たら PR OPEN で報告して止まるのじゃぞ ♡**
