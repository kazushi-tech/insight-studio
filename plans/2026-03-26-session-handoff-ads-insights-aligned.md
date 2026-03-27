# Insight Studio Session Handoff (ads-insights aligned)

**作成日:** 2026-03-26  
**対象リポジトリ:** `c:\Users\PEM N-266\work\insight-studio`  
**対象ブランチ:** `master`  
**最新反映 commit:** `8b5848d` (`Align ads flow to ads-insights point-pack pipeline`)  
**目的:** 次チャットで、`ads-insights` 実装に合わせた contract 修正、deploy、live 反映確認まで完了した状態から正確に再開できるようにする

---

## 1. 結論

- 今回の本丸は、`Insight Studio` 側が `ads-insights` の実 contract とズレた endpoint / response shape を前提にしていたことだった。
- `ads-insights` の GitHub repo を実読して、frontend を reference 実装に合わせて修正した。
- 修正後のコードは commit / push 済み。
- user 確認ベースで、`https://insight-studio-chi.vercel.app/ads/pack` まで反映済み。
- 少なくとも 2026-03-26 時点では「何も表示されない」「placeholder だけ見えている」という状態は脱した。

一言で言うと:

**推測ベースの fix をやめて、`ads-insights` repo の実装に合わせて flow を組み直した。deploy 後、user 側でも live 反映を確認済み。**

---

## 2. 何が問題だったか

ユーザーの違和感は正しかった。

当初の `Insight Studio` は、`/ads/pack` や `/ads/ai` で `ads-insights` 本体とは異なる前提を置いていた。

主なズレ:

- `pack` 表示を `generate_insights()` 側のレスポンスで組もうとしていた
- `ai` も `generate_insights()` に寄せていた
- frontend が勝手に想定した shape
  - `sections[]`
  - `metrics[]`
  - `devices[]`
  - `table[]`
  - `report / analysis / content / response`
  などに依存していた

しかし `ads-insights` 実装を確認すると、本流は別だった。

---

## 3. ads-insights repo で確認した事実

調査対象:

- GitHub: `https://github.com/kazushi-tech/ads-insights`
- ローカル取得先: `tmp_ads_insights_repo/`

### 3.1 `pack` の本流

`ads-insights` では BQ ベースのレポート生成本流は:

- `POST /api/bq/generate_batch`

根拠:

- `tmp_ads_insights_repo/web/app/backend_api.py`
  - `generate_batch` 実装が存在
  - `report_md`
  - `chart_data`
  を返している

reference frontend でも:

- `tmp_ads_insights_repo/index.html`
  - `/api/bq/generate_batch` を呼んでいる
  - 返却された `report_md` を表示している

### 3.2 `generate_insights` の役割

`POST /api/generate_insights` は、今回の `pack` 表示本流ではない。

確認できたこと:

- `point_pack_path` 前提の処理だった
- `text` を返す用途
- BQ point-pack 画面そのものの primary source ではなかった

つまり:

- `pack = generate_insights` という前提は誤り

### 3.3 `AI考察` の本流

chat/AI 側は:

- `POST /api/neon/generate`

reference frontend はここに:

- `point_pack_md`
- 会話履歴
- chart context

を渡していた。

つまり:

- `ai = generate_insights` でもない
- `ai = neon/generate + point_pack_md` が reference flow

---

## 4. 今回の修正方針

`Insight Studio` 側でも、Wizard の `bq/generate_batch` 結果を downstream で再利用する flow に寄せた。

修正の柱は 3 つ:

1. `Setup Wizard` で得た `report_md / chart_data` を bundle 化して保持
2. `/ads/pack` はその `report_md` を描画
3. `/ads/graphs` と `/ads/ai` も同 bundle を元に描画・送信

これにより:

- `ads-insights` 本体と同じ発想でデータが流れる
- 画面ごとに勝手な downstream fetch shape を仮定しなくて済む

---

## 5. 実施したコード修正

### 5.1 `src/api/adsInsights.js`

主な修正:

- `DEFAULT_ADS_DATASET_ID` を export
- dataset defaulting を整理
- `neonGenerate(payload, apiKey)` を追加
  - endpoint: `/api/neon/generate`

意図:

- setup から downstream まで dataset と AI endpoint を一貫させる

### 5.2 `src/contexts/AdsSetupContext.jsx`

主な修正:

- `STORAGE_VERSION` を `3` に更新
- `setupState` に `datasetId` を保持
- context 内に `reportBundle` / `setReportBundle` を追加
- `completeSetup(payload, nextReportBundle)` に変更

意図:

- Wizard 実行結果を pack / graphs / ai へ流せるようにする

### 5.3 `src/utils/adsReports.js` を新規追加

追加した責務:

- `generateBatchWithRetry`
- `buildAdsReportBundle`
- `regenerateAdsReportBundle`
- `extractMarkdownSummary`
- `extractMarkdownHeadings`

意図:

- `bq/generate_batch` の実行・整形・再生成ロジックを共有化

### 5.4 `src/components/MarkdownRenderer.jsx` を新規追加

追加した内容:

- `report_md` を軽量に描画する markdown renderer
- 見出し、リスト、コードブロック、表、段落、inline code/strong などに対応

意図:

- `ads-insights` 由来の markdown をそのまま pack / ai で表示する

### 5.5 `src/pages/SetupWizard.jsx`

主な修正:

- shared util の `generateBatchWithRetry` を使用
- `bqGenerateBatch` の結果から `reportBundle` を構築
- `completeSetup(...)` 時に bundle を保存

意図:

- Wizard 完了時に downstream 表示の元データを確定させる

### 5.6 `src/pages/EssentialPack.jsx`

ここが最重要修正。

変更点:

- `generate_insights` 依存をやめた
- `reportBundle.reportMd` を主表示データに変更
- bundle が無ければ `setupState` から `regenerateAdsReportBundle(...)`
- markdown 本文を表示
- markdown 見出しを抽出して左 nav として表示
- 期間複数時は period filter を表示

結果:

- `/ads/pack` は `ads-insights` の `report_md` を描画する画面になった

### 5.7 `src/pages/AnalysisGraphs.jsx`

変更点:

- 旧 `loadData()` ベースの曖昧な flow をやめた
- `reportBundle.chartGroups` を表示元に変更
- bundle 不在時は regenerate
- period filter を追加
- `chart_data.groups` を card / table 風に表示

結果:

- `/ads/graphs` も `bq/generate_batch` 由来データに寄った

### 5.8 `src/pages/AiExplorer.jsx`

変更点:

- `generateInsights()` をやめた
- `neonGenerate()` を使用
- request payload に以下を付与
  - `point_pack_md: reportBundle.reportMd`
  - `bq_query_types`
  - `conversation_history`
  - `ai_chart_context`
- markdown 描画対応

結果:

- `/ads/ai` も reference app に近い経路へ移行した

---

## 6. ローカル検証

実施済み:

- `npm run lint`
  - 成功
- `npm run build`
  - 成功

この時点で、ローカル codebase の整合性は最低限確認済み。

---

## 7. commit / deploy

実施済み:

- commit:
  - `8b5848d`
- message:
  - `Align ads flow to ads-insights point-pack pipeline`
- push:
  - `origin/master`

補足:

- Vercel CLI で完全な inspect まではできなかった
- ただし公開 bundle を取得して、中に今回の変更が含まれることは確認した

確認した文字列例:

- `/api/neon/generate`
- `point_pack_md`
- `ads-insights の /api/bq/generate_batch が返した report_md`

---

## 8. live 反映確認

最終的に user から以下の確認が返ってきた。

- 「全部反映されました、ありがとう！」

添付スクリーンショットから読み取れる live 状態:

- URL:
  - `https://insight-studio-chi.vercel.app/ads/pack`
- 画面上部に
  - `ads-insights の /api/bq/generate_batch が返した report_md を表示しています。`
  が見える
- 本文には `2026-03-23 レポート`
- 左の `レポート構成` に markdown 見出し由来の nav が出ている
- `dataset: analytics_311324674`
  が表示されている

したがって、少なくとも 2026-03-26 時点では:

- deploy は live に反映済み
- `/ads/pack` は以前の空表示から改善済み
- `report_md` ベースの実表示に切り替わっている

---

## 9. この handoff 時点の重要な認識

### 9.1 Claude 用の推測プランは主役ではない

途中で `plans/rustling-dancing-frog.md` のような Claude 作成プランも話題に出たが、最終的には repo 実装を直接確認できた。

そのため次チャットでは:

- 推測ベースの plan を増やすより
- `ads-insights` repo を source of truth として扱う

のが正しい。

### 9.2 以前の handoff は一部古くなっている

特に以下の認識は更新された:

- 「`pack/graphs` は truthful preview にした段階」
- 「`generate_insights` / `load` の live response を見て次を決める」

これは途中段階の話で、最終的には

- `pack` は `generate_insights` ではなく `bq/generate_batch -> report_md`
- `ai` は `neon/generate + point_pack_md`

へ切り替わった。

つまり、古い handoff を読む場合は

- **この handoff を優先**

とすること。

---

## 10. 現在の未コミット補助ファイル

この handoff 作成時点の `git status --short` では、以下が untracked。

- `.claude/`
- `plans/2026-03-26-ads-insights-repo-grounded-generate-recovery-plan.md`
- `plans/2026-03-26-essential-pack-live-contract-recovery-plan.md`
- `plans/2026-03-26-session-handoff.md`
- `plans/2026-03-26-setup-wizard-and-ads-ux-parity-recovery-plan.md`
- `plans/2026-03-26-setup-wizard-bq-only-plan.md`
- `plans/rustling-dancing-frog.md`
- `src/utils/adsResponse.js`
- `tmp_ads_insights_repo/`
- `tmp_deploy_bundle.js`

重要:

- これらは今回の本番反映 commit には含めていない
- 特に `src/utils/adsResponse.js` は途中検証の名残で、最終 flow の本筋ではない
- `tmp_ads_insights_repo/` と `tmp_deploy_bundle.js` は検証用の一時物

次チャットで commit 整理をするなら、まずこれらの必要性を再判断すること。

---

## 11. 次チャットで見るべき場所

最優先で読むとよいファイル:

- `src/pages/EssentialPack.jsx`
- `src/pages/AnalysisGraphs.jsx`
- `src/pages/AiExplorer.jsx`
- `src/pages/SetupWizard.jsx`
- `src/utils/adsReports.js`
- `src/components/MarkdownRenderer.jsx`
- `src/contexts/AdsSetupContext.jsx`
- `src/api/adsInsights.js`

contract の根拠確認先:

- `tmp_ads_insights_repo/web/app/backend_api.py`
- `tmp_ads_insights_repo/index.html`

---

## 12. 残タスク候補

今回の主目的は達成済みだが、次にやるなら候補は以下。

### P1. `/ads/graphs` の見せ方改善

現状は `chart_data.groups` をベースにした表示へ寄せた段階。

次は:

- 実レスポンスのパターン整理
- 価値の高い可視化だけ chart 化

を行うとよい。

### P1. `/ads/ai` の UX 調整

flow 自体は reference 寄せ済み。
次は:

- chat prompt の質
- chart context の整形
- markdown 表示品質

を調整できる。

### P2. 検証用ファイルの掃除

必要なら以下を整理する。

- `tmp_ads_insights_repo/`
- `tmp_deploy_bundle.js`
- 途中 plan 群
- `src/utils/adsResponse.js`

---

## 13. 次チャットへの推奨プロンプト

```md
`plans/2026-03-26-session-handoff-ads-insights-aligned.md` を読んで、現在の ads-insights 連携状態を把握したうえで続きから対応してください。

前提:
- 2026-03-26 時点で `ads-insights` repo を source of truth として Insight Studio 側を修正済み
- `pack` は `/api/bq/generate_batch -> report_md` 表示へ切替済み
- `ai` は `/api/neon/generate + point_pack_md` へ切替済み
- commit `8b5848d` は push 済み
- user 確認で live 反映済み

次にやること:
1. 現在の downstream UX と code を確認
2. 必要なら `/ads/graphs` の可視化品質を改善
3. 必要なら `/ads/ai` の prompt / context / rendering を改善
4. 検証用の untracked ファイルを整理する場合は、本当に不要か確認してから扱う

注意:
- 古い推測ベースの plan より、この handoff と `ads-insights` repo 実装を優先
- placeholder UI には戻さない
```

---

## 14. 一言まとめ

今回のチャットで重要だったのは、**Insight Studio を `ads-insights` の実装に接続し直し、live deploy まで通して user 確認で反映済みにしたこと**。  
次チャットは、もはや「なぜ何も出ないのか」を追う段階ではなく、**今つながっている実 flow を前提に UX / 可視化 / 後片付けを詰める段階**。
