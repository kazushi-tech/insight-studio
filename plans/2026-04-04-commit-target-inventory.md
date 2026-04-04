# Commit Target Inventory — 2026-04-04

## 目的

2026-04-04 時点の `insight-studio` 作業ツリーについて、今回の安定化トラックで
「コミット候補に入れるもの」と「ローカル保持に留めるもの」を分ける。

この文書は commit 実行そのものではなく、staging 判断のための棚卸しメモ。

---

## 0. Post-Commit Update

2026-04-04 時点で、以下はすでに commit 済み。

- commit: `c593e2f`
- message: `docs: record stability validation and smoke tooling`

この commit には以下が入っている。

- `.gitignore`
- `plans/2026-04-03-baseline-smoke-scenarios.md`
- `plans/2026-04-03-stability-hardening-plan.md`
- `plans/backend-investigation-2026-04-04.md`
- `plans/handoff-2026-04-04-phase2.md`
- `plans/handoff-2026-04-04-postdeploy.md`
- `scripts/provision_smoke_profile.mjs`
- `scripts/phase2-smoke-final.mjs`

したがって、この文書の主目的は「次に残件をどう扱うか」の整理に移っている。

---

## 1. 現状サマリー

- 現在の worktree では `src/` 配下や `vite.config.js` に pending diff は見えていない
- 今回 pending として見えているのは、主に `docs / smoke tooling / generated artifact / local memo`
- したがって、次の commit は製品コード commit ではなく、`検証記録 + 再現用ツール + ignore 整備` の束として切るのが自然

---

## 2. 第一候補: 今回の安定化トラックとして commit してよいもの

以下は「あとから見返す価値があり、再現にも使える」ため、今回の commit 候補に入れてよい。

- `.gitignore`
  - local smoke artifact と local-only Claude/Codex 補助ファイルの ignore を整理
- `plans/2026-04-03-baseline-smoke-scenarios.md`
  - baseline から Phase 3-A までの smoke 実測ログ
- `plans/2026-04-03-stability-hardening-plan.md`
  - 今回トラックの上位 plan
- `plans/backend-investigation-2026-04-04.md`
  - backend 側の原因調査と patch 内容の記録
- `plans/handoff-2026-04-04-phase2.md`
  - Phase 2 frontend までの handoff
- `plans/handoff-2026-04-04-postdeploy.md`
  - post-deploy と Creative Review 正常系通過まで含む最新 handoff
- `scripts/provision_smoke_profile.mjs`
  - isolated profile へ前提状態を seed する再現用 helper
- `scripts/phase2-smoke-final.mjs`
  - 最終版の focused smoke script

推奨 commit テーマ:

- `docs: record phase2/postdeploy stability findings`
- `test: add reproducible smoke profile helper`

---

## 3. 第二候補: いったん保留でよいもの

以下は役割があるが、今回の commit に必須とは言いにくい。
必要なら別 commit か local 保持に寄せる。

- `scripts/phase2-smoke.mjs`
  - 初版。最終版があるため、履歴として残したいか次第
- `scripts/phase2-smoke-v2.mjs`
  - 中間版。最終版があるため、同上

判断基準:

- 「試行錯誤の履歴も repo に残したい」なら commit 候補
- 「再現用として最終版だけあれば十分」なら今回の commit から外してよい

---

## 4. 今回の commit から外すべきもの

以下は generated artifact、local-only file、または今回トラックの canonical record ではないため、今回の commit から外すのが妥当。

- `smoke-manifest.json`
  - redacted 済みでも generated artifact。`.gitignore` へ追加済み
- `test-results/`
  - screenshot / run artifact。`.gitignore` 済み
- `.tmp-phase-0-6/`
  - local verification artifact。`.gitignore` 済み
- `.claude/settings.local.json`
  - local settings。`.gitignore` へ追加済み
- `plans/CLAUDE.md`
  - local mem context。`.gitignore` へ追加済み
- `src/pages/CLAUDE.md`
  - local mem context。`.gitignore` へ追加済み

---

## 5. 原則として今回の commit スコープ外に置くもの

以下は「存在していてもよい」が、今回の安定化トラック commit に混ぜないほうがよい。

- `plans/` 配下の補助メモ群
  - 例: `atomic-knitting-mist.md`, `clever-napping-map.md`, `hotfix-post-review.md` など
  - 理由: canonical handoff / investigation / plan と役割が重複しやすく、ノイズになりやすい
- `stitch2/`
- `stitch2_LP/`
  - 理由: 今回の stability track と直接関係しない untracked asset/data directory に見える

ここは削除推奨ではなく、`今回の commit に混ぜない` という意味。

---

## 6. 推奨 staging セット

最小で進めるなら、次の 8 ファイルで十分。

```powershell
git add .gitignore `
  plans/2026-04-03-baseline-smoke-scenarios.md `
  plans/2026-04-03-stability-hardening-plan.md `
  plans/backend-investigation-2026-04-04.md `
  plans/handoff-2026-04-04-phase2.md `
  plans/handoff-2026-04-04-postdeploy.md `
  scripts/provision_smoke_profile.mjs `
  scripts/phase2-smoke-final.mjs
```

その後に確認するもの:

- `git diff --cached --stat`
- `git diff --cached`

---

## 7. 補足

- 現状の worktree では、今回 commit 候補の中心は `製品コード差分` ではなく `検証知見と再現用 tooling`
- backend local copy (`tmp_market_lens_ai_repo`) の dirty state は別 repo / 別 commit 単位で扱うべき
- `Discovery` の intermittent 問題は、この commit に無理に混ぜず、infra/provider track として分離したほうが判断しやすい

---

## 8. Remaining Untracked After `c593e2f`

### A. 今回 commit 候補へ格上げしてよいもの

- `plans/2026-04-04-commit-target-inventory.md`
  - この文書自身。棚卸し結果を残す用途
- `plans/2026-04-04-discovery-infra-provider-followup.md`
  - `Discovery` 残件の別トラック化

### B. そのまま未追跡でよいもの

- `plans/atomic-knitting-mist.md`
- `plans/clever-napping-map.md`
- `plans/cosmic-swinging-puffin.md`
- `plans/delightful-greeting-pearl.md`
- `plans/drifting-floating-pizza.md`
- `plans/eventual-soaring-parnas.md`
- `plans/foamy-strolling-fern.md`
- `plans/handoff-2026-03-31.md`
- `plans/handoff-2026-04-02-hibarai.md`
- `plans/handoff-2026-04-02.md`
- `plans/hazy-mixing-giraffe.md`
- `plans/hotfix-post-review.md`
- `plans/iridescent-stirring-glade.md`
- `plans/jolly-percolating-snowglobe.md`
- `plans/lexical-bouncing-quasar.md`
- `plans/modular-tickling-pumpkin.md`
- `plans/mutable-cuddling-meadow.md`
- `plans/parallel-percolating-sparkle.md`
- `plans/peppy-twirling-fairy.md`
- `plans/precious-gliding-emerson.md`
- `plans/purrfect-singing-wozniak.md`
- `plans/radiant-meandering-spindle.md`
- `plans/resilient-foraging-pony.md`
- `plans/sequential-coalescing-abelson.md`
- `plans/silly-herding-river.md`
- `plans/splendid-wobbling-peacock.md`
- `plans/swift-enchanting-haven.md`
- `plans/validated-waddling-donut.md`
- `plans/virtual-dazzling-quasar.md`
- `plans/wiggly-jingling-cherny.md`

理由:

- どれも現時点では canonical handoff / investigation / stability record ではない
- user/Claude の途中メモが混ざっている可能性が高く、勝手に削除・commit しないほうが安全

### C. 次に判断が必要なもの

- `scripts/phase2-smoke.mjs`
- `scripts/phase2-smoke-v2.mjs`

推奨:

- `phase2-smoke-final.mjs` に対する差分価値が無ければ、後で user 判断で削除または archive
- 自動では削除しない

### D. 今回の product repo commit から外すもの

- `stitch2/`
- `stitch2_LP/`

推奨:

- repo 内に置く必要がなければ、あとで repo 外へ移動
- 現時点では user asset の可能性があるため自動移動しない
