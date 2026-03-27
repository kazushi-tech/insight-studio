# Insight Studio — Ads Insights Repo Grounded Generate Recovery Plan

**作成日:** 2026-03-26  
**対象リポジトリ:** `c:\Users\PEM N-266\work\insight-studio`  
**前提 repo:** `https://github.com/kazushi-tech/ads-insights`  
**現在の HEAD:** `fb4b363bb1fff2dc80ef7d4e9e36e991a7f4b44a`  
**目的:** `ads-insights` の実コードを一次情報として読み、`Setup Wizard` の `POST /api/ads/bq/generate` 400 を根本解消する

---

## 1. この plan の位置づけ

現状の Insight Studio はここまで進んでいる。

- `bq/periods` は通る
- `monthly / weekly / daily` は出る
- 複数期間選択 UI はある
- `dataset_id` と `X-Client-ID` も client 側には入っている

しかし本番ではまだ壊れている。

- Step 2 までは進める
- Step 2 -> Step 3 の `POST /api/ads/bq/generate` が `400`

したがって、今やるべきことは UI 追加ではなく、**`ads-insights` repo を実際に読み、その実装に合わせて contract を是正すること**。

---

## 2. 絶対条件

1. `https://github.com/kazushi-tech/ads-insights` を実際に読むこと
2. route / schema / handler の file path と line を根拠として出すこと
3. OpenAPI / bundle 解析 / 推測だけで contract を決めないこと
4. reference app と deployed Insight Studio の network を比較すること
5. fix 後は live retest まで行うこと

---

## 3. いま分かっている事実

### Insight Studio 現状

`src/pages/SetupWizard.jsx`

```js
bqGenerate({
  query_types: queryTypeIds,
  periods: periodsArray,
})
```

`src/api/adsInsights.js`

```js
body: JSON.stringify({
  dataset_id: DEFAULT_DATASET_ID,
  ...payload,
})
```

現 client の特徴:

- endpoint は `/api/ads/bq/generate`
- body は `query_types + periods + dataset_id`
- header は `Authorization: Bearer ...` と `X-Client-ID`

### 本番 failure

- `GET /api/ads/bq/periods` は成功
- `POST /api/ads/bq/generate` は `400`

ここから言えること:

- auth 完全不通ではない
- dataset 側だけは通っている
- `generate` の endpoint / body / header のどれかがズレている可能性が高い

---

## 4. 調査の中心課題

Claude は以下を repo 実装ベースで確定すること。

1. 実際に正しい endpoint はどれか
   - `/api/bq/generate`
   - `/api/bq/generate_batch`
   - 別 route
2. request body の真 shape
   - `period` or `periods`
   - `query_type` or `query_types`
   - `dataset_id` required / optional / default
3. required header
   - `Authorization`
   - `X-Client-ID`
   - その他
4. response body / error body
5. reference app が実際に何を送っているか

---

## 5. Workstream A: `ads-insights` Repo Contract Audit

最優先。

### A-1. 必ず探す対象

- BQ periods route
- BQ generate route
- BQ generate_batch route
- auth middleware / dependency
- request schema / pydantic model / validator
- dataset default 値の定義箇所
- reference frontend の generate 呼び出し箇所

### A-2. 必ず報告すること

各項目について以下を出すこと。

- file path
- line number
- そのコードが何を要求しているか

最低限の報告テンプレート:

- `backend/app/.../bq.py:xx`
  - `/api/bq/generate` は `query_types: list[str]` と `periods: list[str]` を受ける
- `frontend/src/...:yy`
  - reference app は `generateBatch(...)` を呼んでいる

### A-3. 必須の結論

以下を Yes/No/実値で明示すること。

- `generate` と `generate_batch` のどちらが正規 route か
- `dataset_id` は必須か
- default dataset の実値
- `periods` は配列か
- `query_types` は配列か
- `X-Client-ID` は必須か

---

## 6. Workstream B: Reference App / Insight Studio Network Diff

repo 読解だけで終わらせない。

### B-1. reference app

対象:

- `ads-insights-eight.vercel.app`

最低限取得する証跡:

- `GET /api/bq/periods` の URL / query string / headers / response
- `POST generate` の URL / body / headers / response
- 複数期間選択時の payload

### B-2. Insight Studio

対象:

- deployed Insight Studio

最低限取得する証跡:

- 同じ操作時の network
- `400` response body
- request payload

### B-3. diff table

必ず table 化すること。

列:

- item
- reference app
- insight studio
- mismatch
- required fix

---

## 7. Workstream C: Minimal Fix Implementation

repo と network で契約が確定したら、必要最小限で修正する。

### 対象ファイル

- `src/pages/SetupWizard.jsx`
- `src/api/adsInsights.js`
- 必要なら `src/contexts/AdsSetupContext.jsx`

### 想定される修正候補

以下は候補であり、証跡で確定すること。

1. endpoint を `bqGenerateBatch()` に切り替える
2. body を `period` 単数に戻す
3. body を `query_type` 単数に戻す
4. `dataset_id` の渡し方を変える
5. header を追加 / 削除する
6. granularity や selection order を含める

### 非交渉

- `400` を握りつぶすだけの実装にしない
- fallback 的に複数 endpoint を順番に叩くような曖昧な対処にしない
- contract を確定したうえで一本化する

---

## 8. Workstream D: Validation

### D-1. local

- `npm run lint`
- `npm run build`

### D-2. live

最低限ここまで確認:

1. Step 1 で query type を複数選択
2. Step 2 で期間を複数選択
3. Step 3 へ進める
4. `/ads/pack` に遷移できる

### D-3. 可能なら確認

- `/ads/graphs`
- `/ads/ai`
- downstream request に setup state が反映されるか

---

## 9. Agent Team 推奨分担

Claude 側で agent team が使えるなら分担推奨。

### Lead

- 全体統合
- acceptance 判断
- final diff / final explanation

### Agent 1: Repo Contract Reader

責務:

- `ads-insights` repo の backend / frontend 実装を読む
- route / schema / handler / reference frontend callsite を特定

成果物:

- file/line 付き contract report

### Agent 2: Network Verifier

責務:

- reference app と Insight Studio の DevTools capture
- `400` error body の取得
- diff table 作成

### Agent 3: Frontend Fix Worker

責務:

- `SetupWizard.jsx`
- `adsInsights.js`
- 必要なら state wiring

### Agent 4: QA / Release Worker

責務:

- lint/build
- deploy
- live retest

---

## 10. 完了条件

以下が全部そろって初めて完了。

- `ads-insights` repo の file/line 根拠が出ている
- reference app と Insight Studio の request diff が出ている
- `400` の原因が説明できる
- `Setup Wizard` で Step 3 に進める
- lint/build が通る
- 「なぜ直ったか」が contract ベースで説明できる

---

## 11. 禁止事項

- OpenAPI だけで終わること
- bundle 解析だけで終わること
- `repo を読んだ` と言いながら file/line を出さないこと
- `200 になったので OK` だけで終えること
- fix 後の live retest を省くこと

---

## 12. Claude にそのまま渡す推奨プロンプト

```md
`plans/2026-03-26-session-handoff-latest.md` と `plans/2026-03-26-ads-insights-repo-grounded-generate-recovery-plan.md` を読んで、続きから対応してください。

最優先は Setup Wizard の `POST /api/ads/bq/generate` 400 解消です。

今回は必ず `https://github.com/kazushi-tech/ads-insights` を一次情報として読んでください。
OpenAPI や bundle 解析だけではなく、backend / frontend の実装 file path と line number を根拠として出してください。

やること:
1. `ads-insights` repo の backend / frontend 実装を読み、`bq/periods`, `bq/generate`, `bq/generate_batch`, auth, request schema を file/line 付きで確定
2. reference app と deployed Insight Studio の network を比較
3. `400` response body を取得し、mismatch を table で説明
4. `src/pages/SetupWizard.jsx` と `src/api/adsInsights.js` を必要最小限で修正
5. lint/build/deploy/live retest まで行う

必ず報告すること:
- 正規 endpoint は `generate` か `generate_batch` か
- `query_type(s)` と `period(s)` の真 shape
- `dataset_id` の必須性と実値
- `X-Client-ID` の必須性
- 400 の真因
- どの file をどう直したか

可能なら agent team で進めてください。
推奨:
- repo contract reader
- network verifier
- frontend fix worker
- qa/release worker

禁止:
- file/line 根拠なしの断定
- OpenAPI だけで contract を決めること
- fix 後に live retest せず完了扱いすること
```

---

## 13. 一言で言うと

今回の仕事は「推測で Wizard をいじること」ではない。  
**`ads-insights` repo の実装を根拠に、`generate` contract を確定し、その差分だけを正確に直して 400 を潰すこと**。
