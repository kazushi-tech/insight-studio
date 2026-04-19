# Phase 5C ハンドオフプランを完全自律実行型に書き換える

## Context

`plans/2026-04-19-phase5c-handoff-v2-default-promotion.md` は元々「PR 作成後、不二樹の Preview 目視確認を待ってからマージ」という人間承認ゲートを含んどった。ユーザー（不二樹）の要望により、次セッション Claude が PR 作成 → CI/Vercel 緑確認 → マージ → 本番 deploy 確認まで**無停止で完遂**する設計に改める。承認待ちを除去するが、Gate FAIL / CI 赤 / console error 検出時は勝手に進めぬ安全網は維持する（§10 想定外ケース）。

本プランは既存ハンドオフドキュメントの編集指針を定める。§0 TL;DR はすでに自律実行型に更新済（Part 1 として本タスクの一部）、残り §6 Part D / §7 Part E / §9 遵守ルール / §12 報告フォーマット / §16 注意事項を整合させる。

## 変更対象ファイル

- [plans/2026-04-19-phase5c-handoff-v2-default-promotion.md](2026-04-19-phase5c-handoff-v2-default-promotion.md) — 既存のハンドオフドキュメント（545 行、本セッションで作成済）

## 具体的な編集内容

### 1. §6 Part D: PR → 承認 → マージ → PR → マージ（自律）

- タイトルから「不二樹承認」の文言を除去
- §6-4「不二樹への引き渡し」を削除、代わりに §6-4「CI/Vercel 緑待機 → 自動マージ条件」を新設
  - 条件: `ci=pass`、`Vercel=SUCCESS`、`Vercel Preview Comments=pass`、`post-deploy-health=skipping OR pass`
  - 全て満たせば即 `gh pr merge --squash --delete-branch`
  - いずれか失敗 → PR を OPEN のまま残し §10 エスカレーションに従う
- §6-5「マージ」から「不二樹承認後」の記述を除去

### 2. §7 Part E: 本番 deploy 確認 + 監視

- §7-2「不二樹に本番 URL を共有 → 既存レポート 1 件以上を目視してもらう」を削除
- §7-3 監視は「受動、24-48h 不二樹フィードバック受付」→「結果報告 1 メッセージで完了。監視は §12 報告後に不二樹が任意で実施」に短縮
- Playwright で本番 URL に対する軽い目視確認（`/discovery` `/compare` 到達、console error 0）を §7-2 として追加

### 3. §9 遵守すべき運用ルール

- 「**マージ前に必ず不二樹承認を取る**」行を削除
- 代わりに「**Gate FAIL / CI 赤 / console error 発生時は自動マージを中断し、PR OPEN で不二樹に報告**」を追加

### 4. §12 報告フォーマット

- Case A（成功）: マージ完了 + 本番 deploy SUCCESS + 軽い目視結果 までを 1 メッセージで報告する形に整える
- Case C「不二樹が Preview で NG 判断」を削除（承認ゲートが無いので不発動）
- Case B（Gate FAIL）は残し、Case C（新設）として「CI/Vercel 赤で自動マージ中断」を追加

### 5. §16 ハンドオフ先 Claude への注意

- 「Auto mode で自律実行可だが、Part D の『不二樹承認を待つ』だけは必ず守る」を削除
- 代わりに「**PR 作成後は CI/Vercel の緑確認を `gh pr checks <番号> --watch` で待ち、緑なら即マージ。承認ゲートは無い**」を追加
- 「console error が 1 件でも出たら勝手にマージせぬ」「destructive git 操作禁止」は維持

### 6. §10 リスクと対策

- 「不二樹が『やっぱり v1 に戻せ』と言う」行は維持（マージ後のフィードバックルート）
- 行「Gate FAIL / CI 赤 / console error 発生時は PR OPEN で報告して終了（勝手に force-merge / --no-verify せぬ）」を新規追加

## 維持する安全網（自律化しても残す）

- Gate FAIL（vitest / build / harness / dev 目視）時は PR 作成に進まぬ
- CI 赤 / Vercel FAIL 時は自動マージ禁止、PR OPEN のまま報告
- console error が Gate 段階で 1 件でも出たら自動停止
- destructive git 操作（reset --hard / push --force / branch -D）は禁止のまま
- `--no-verify` / `--no-gpg-sign` などのフック回避禁止
- `?ui=v1` ロールバック経路 / git revert / Vercel rollback の 3 段階は PR 本文に必ず記載

## Verification

編集後に以下を確認する：

1. 該当ドキュメントを `Read` で再読し、「承認」「待つ」「引き渡す」「判断待ち」の残留が Case B / §10 の想定外ケースのみに限定されとるか grep で検証
   - `grep -n "承認\|待つ\|引き渡\|判断待ち" plans/2026-04-19-phase5c-handoff-v2-default-promotion.md`
   - ヒット行を一つずつ読み、自律化と矛盾する記述が無いか確認
2. §0 TL;DR のフロー（準備 → 切替 → Gate → PR → CI 緑待機 → 自動マージ → 本番 deploy 確認 → 報告）が §3-§7 の各 Part と一致するか通読
3. §12 Case A が「マージ + 本番 deploy + 軽い目視」まで 1 報告で完結する文面になっとるか確認

## 非ゴール

- 新規 Claude セッションを起こして実行すること（本プランは編集のみ）
- §3-5 の Gate 内容（vitest / build / harness / dev 目視）の変更
- Phase 5C 実施タイミングの変更
- `useUiVersion.js` 実装方針の変更
- 新規 fixture / harness 拡張
