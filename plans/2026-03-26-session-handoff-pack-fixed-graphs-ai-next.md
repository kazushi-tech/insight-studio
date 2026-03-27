# Insight Studio Session Handoff (Pack Fixed, Graphs + AI Next)

**作成日:** 2026-03-26  
**対象リポジトリ:** `c:\Users\PEM N-266\work\insight-studio`  
**対象ブランチ:** `master`  
**現時点 HEAD:** `a644dfc` (`Fix Essential Pack table overflow and TOC scroll`)  
**目的:** 次チャットで、`/ads/pack` 完了済みの状態から、`/ads/graphs` と `/ads/ai` を `ads-insights` 本家に寄せて正しく動かす作業を正確に再開できるようにする

---

## 1. 結論

2026-03-26 時点で、`Insight Studio` の Ads downstream のうち:

- `/ads/pack`
  - **live で見やすく表示される状態まで到達**
  - user 確認で「完璧」「テーブルも見やすいし、見切れてない」と評価済み
- `/ads/graphs`
  - **まだ本家の graph 項目表示に寄せ切れていない**
  - `chart_data.groups` は持っているが、表示が簡易 table dump 寄りで、本家ほど反映されていない
- `/ads/ai`
  - **ガワはあるが、本家のように実用的に動いているとは言えない**
  - user の認識でも「本家では動くのに、Insight Studio 側は何とかしてほしい」状態

一言で言うと:

**`pack` は完了。次チャットの本丸は `graphs` と `ai` を `ads-insights` repo を source of truth として実装し直すこと。**

---

## 2. このチャットで完了したこと

### 2.1 contract 修正の土台

既存 handoff の通り、`ads-insights` の実 flow に合わせて以下へ揃えた。

- `pack`
  - `POST /api/bq/generate_batch` の `report_md` を表示
- `ai`
  - `POST /api/neon/generate`
  - `point_pack_md`, `conversation_history`, `ai_chart_context` を送る方向へ変更
- Wizard
  - `bq/generate_batch` の結果を `reportBundle` として保持

基礎 commit:

- `8b5848d` `Align ads flow to ads-insights point-pack pipeline`

### 2.2 `/ads/pack` UX parity 修正

`ads-insights` 本家の point-pack UI を reference にして、`Essential Pack` を実用レベルまで改善した。

関連 commit:

- `b9d6b51` `feat: Essential Pack UX parity — accordion・period dropdown・scrollable table`
- `191dca8` `fix: Essential Pack regressions — page横スクロール・TOC横飛び・列幅過大を修正`
- `a644dfc` `Fix Essential Pack table overflow and TOC scroll`

最終的にやったこと:

- top-level section 分割を reference に寄せた
- TOC click scroll を main scroll container 基準に修正
- markdown table parser を escaped pipe (`\|`) 対応に修正
- URL cell を短縮表示に寄せた
- table の列崩れ・page 全体の横スクロール・見切れを修正
- lint/build を通した

### 2.3 user 確認

user から最終確認として:

- 「完璧だわ。」
- 「テーブルも見やすいし、見切れてないし。」

が返っている。

したがって、**少なくとも `pack` についてはこのチャット時点で acceptance 済み**。

---

## 3. source of truth

次チャットでも推測ではなく、以下を一次情報として扱うこと。

### 3.1 Insight Studio 側 code

- `src/pages/EssentialPack.jsx`
- `src/pages/AnalysisGraphs.jsx`
- `src/pages/AiExplorer.jsx`
- `src/pages/SetupWizard.jsx`
- `src/utils/adsReports.js`
- `src/components/MarkdownRenderer.jsx`
- `src/contexts/AdsSetupContext.jsx`
- `src/api/adsInsights.js`

### 3.2 ads-insights reference

- GitHub:
  - `https://github.com/kazushi-tech/ads-insights`
- local clone:
  - `tmp_ads_insights_repo/`

特に見るべき reference file:

- `tmp_ads_insights_repo/index.html`
- `tmp_ads_insights_repo/web/app/backend_api.py`

---

## 4. 現在の code 状態

### 4.1 `src/api/adsInsights.js`

現状:

- `DEFAULT_ADS_DATASET_ID` を export 済み
- `bqGenerateBatch(payload)` あり
- `neonGenerate(payload, apiKey)` あり

意味:

- `graphs` と `ai` の backend 呼び出しの土台はすでにある

### 4.2 `src/contexts/AdsSetupContext.jsx`

現状:

- `setupState` に `queryTypes`, `periods`, `granularity`, `datasetId`
- `reportBundle` / `setReportBundle`
- `completeSetup(payload, nextReportBundle)`

意味:

- Wizard 完了時に downstream 用 bundle を保持できる

### 4.3 `src/utils/adsReports.js`

現状:

- `bqGenerateBatch` の結果から
  - `reportMd`
  - `chartGroups`
  - `periodReports`
  を bundle 化

重要:

- `pickChartGroups(result, periodTag)` で `chart_data.groups` を `_periodTag` 付きで保持している
- `graphs` と `ai` はこの `chartGroups` を正しく使えばよい

### 4.4 `src/pages/AnalysisGraphs.jsx`

現状:

- `reportBundle.chartGroups` を読む
- period filter はある
- ただし表示はまだ
  - group title
  - dataset/label を table 的に並べるだけ
  の簡易版

問題:

- user 期待の「graph 項目が一切反映されていない」に対応できていない
- `ads-insights` 本家の `ChartGridView` / `ChartGroupComponent` / `KPICharts` 相当にはなっていない

### 4.5 `src/pages/AiExplorer.jsx`

現状:

- UI shell はある
- `neonGenerate()` を呼ぶ
- payload に
  - `point_pack_md`
  - `bq_query_types`
  - `conversation_history`
  - `ai_chart_context`
  を付与している

問題:

- user 感覚では「本家ほど実際に動いていない」
- つまり
  - request shape がまだ足りない
  - auth / key / status handling
  - response parsing
  - prompt context
  - chart context shape
  のどこかに差分が残っている可能性が高い

---

## 5. reference で確認済みの重要箇所

### 5.1 graphs

`tmp_ads_insights_repo/index.html`

- `KPICharts`
  - around `3374`
- `ChartGridView`
  - around `3433`
- graph period filter state
  - around `4565`
- filtered chart data logic
  - around `5771`

重要な認識:

- 本家は `chartData.groups` をただ dump していない
- `ChartGroupComponent` を通して graph / card として表示している
- `period filter` も `all/latest/period_tag` を意識している

### 5.2 AI考察

`tmp_ads_insights_repo/index.html`

- `sendChat()`
  - around `5383`
- `/api/neon/generate` 実 call
  - around `5419`
- request payload
  - around `5434` - `5440`

重要な認識:

- 本家は `sendChat` 内で
  - `recentHistory`
  - `aiChartContext`
  - `pointPack`
  - `bqSelectedQueryTypes`
  を整理して送っている
- `ai_chart_context` は単なる雑な raw dump ではなく、軽量な shape に整形している

---

## 6. 今回 user が明示した次タスク

次チャットでは、以下を **明示要求** として扱うこと。

### 6.1 ① `/ads/graphs` を本当に反映させる

user 要求:

- 「グラフの項目が一切反映されていないので、こちら反映してほしい。」
- 「分からなければリポジトリを見てほしい。」
- repo:
  - `https://github.com/kazushi-tech/ads-insights`

解釈:

- いまの `AnalysisGraphs.jsx` の簡易表示では不足
- `ads-insights` 本家の graph 表示ロジックを source of truth にして寄せる必要がある

### 6.2 ② `/ads/ai` を本家のように動かす

user 要求:

- 「どうせAI考察もガワしか動かないので、そこも対応してほしい」
- 「というか考察スタジオの本家の方では動くので何とかしてほしい」

解釈:

- 単に UI を整えるだけではなく
- **本当に回答が返り、使える考察体験になっていること**
  が必要

---

## 7. 次チャットでやるべきこと

優先順位は以下。

### P0. `/ads/graphs` の reference parity

やること:

1. `tmp_ads_insights_repo/index.html` の
   - `ChartGridView`
   - `KPICharts`
   - `ChartGroupComponent`
   - period filter logic
   を読む
2. `src/pages/AnalysisGraphs.jsx` を
   - graph/card 表示
   - period filter
   - group ごとの見せ方
   を reference 寄せで作り直す
3. 今の simple table dump を卒業する

受け入れ条件:

- user が「グラフ項目が反映されていない」と感じない
- `chart_data.groups` が本家同様の価値ある見え方になる

### P0. `/ads/ai` の実動作回復

やること:

1. `tmp_ads_insights_repo/index.html` の `sendChat()` を一次情報として読む
2. `src/pages/AiExplorer.jsx` の request payload を突き合わせる
3. 必要なら以下を修正
   - auth header
   - Gemini key の渡し方
   - `conversation_history`
   - `ai_chart_context` の shape
   - response body の取り出し
   - loading / error / empty handling
4. live で実際に質問して、本家同様に返答できるところまで持っていく

受け入れ条件:

- 本当に質問に回答できる
- 本家では動くのに Insight Studio 側だけ動かない、という状態を解消する

### P1. 必要なら graphs / ai の UX parity

候補:

- graphs 内の filter / latest/all 仕様
- ai 画面で graph context を見せるかどうか
- markdown 表示品質
- quick prompts

---

## 8. 重要な注意

1. `ads-insights` repo を読み、そこから逆算すること
2. `pack` はもう壊さないこと
3. placeholder / fake UI に戻さないこと
4. 「本家っぽい見た目」ではなく、「本家と同じ data flow / request shape / rendering idea」に寄せること
5. `graphs` と `ai` はどちらも `reportBundle` を使う前提を守ること

---

## 9. 現在の未コミット補助ファイル

この handoff 作成時点の `git status --short` では以下が untracked。

- `.claude/`
- `plans/2026-03-26-ads-insights-repo-grounded-generate-recovery-plan.md`
- `plans/2026-03-26-essential-pack-live-contract-recovery-plan.md`
- `plans/2026-03-26-essential-pack-ux-parity-claude-plan.md`
- `plans/2026-03-26-session-handoff-ads-insights-aligned.md`
- `plans/2026-03-26-session-handoff.md`
- `plans/2026-03-26-setup-wizard-and-ads-ux-parity-recovery-plan.md`
- `plans/2026-03-26-setup-wizard-bq-only-plan.md`
- `plans/rustling-dancing-frog.md`
- `src/utils/adsResponse.js`
- `tmp_ads_insights_repo/`
- `tmp_deploy_bundle.js`

重要:

- 今回 push した `a644dfc` には含めていない
- `tmp_ads_insights_repo/` は reference 調査の source of truth として今は有用
- `tmp_deploy_bundle.js` は lint 対象から除外したが、検証残骸である点は変わらない

---

## 10. 次チャットで最優先で読むべきファイル

Insight Studio 側:

- `src/pages/AnalysisGraphs.jsx`
- `src/pages/AiExplorer.jsx`
- `src/pages/EssentialPack.jsx`
- `src/utils/adsReports.js`
- `src/api/adsInsights.js`
- `src/contexts/AdsSetupContext.jsx`

reference 側:

- `tmp_ads_insights_repo/index.html`
- `tmp_ads_insights_repo/web/app/backend_api.py`

特に reference の line:

- graphs:
  - `3374`
  - `3433`
  - `4565`
  - `5771`
- ai:
  - `5383`
  - `5419`
  - `5434-5440`

---

## 11. 推奨プロンプト

```md
`plans/2026-03-26-session-handoff-pack-fixed-graphs-ai-next.md` を読んで、続きから対応してください。

現在の状態:
- `/ads/pack` は user 確認で完成扱い
- latest HEAD は `a644dfc`
- 次の本丸は `/ads/graphs` と `/ads/ai`

絶対条件:
- `ads-insights` repo を source of truth とする
- local clone `tmp_ads_insights_repo/index.html` を必ず読む
- `pack` は壊さない

次にやること:
1. `AnalysisGraphs.jsx` を reference の `ChartGridView` / `KPICharts` / `ChartGroupComponent` に寄せて改善
2. `chart_data.groups` が本当に反映されたと user が感じる状態にする
3. `AiExplorer.jsx` を reference の `sendChat()` に寄せて実動作を回復
4. `point_pack_md`, `conversation_history`, `ai_chart_context`, auth, response parsing を本家と突き合わせる
5. local lint/build を通す
6. 必要なら deploy と live retest まで行う

user の明示要求:
- グラフの項目が一切反映されていないので反映してほしい
- AI考察もガワしか動かないので、本家のように動かしてほしい

注意:
- 見た目だけ寄せない
- repo 実装を読んでから決める
- fake UI に戻さない
```

---

## 12. 一言まとめ

この handoff 時点で、**`pack` は完成している。次チャットの仕事は、`ads-insights` 本家を見ながら `graphs` と `ai` を本当に使える状態へ持っていくこと**。
