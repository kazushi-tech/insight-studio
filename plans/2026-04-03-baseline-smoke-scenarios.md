# Insight Studio Baseline Smoke Scenarios

**作成日:** 2026-04-03  
**対象フェーズ:** `Phase 0` / `Phase 1`  
**目的:** `Claude First` を前提に、毎回同じ条件で core flow を確認できる baseline を固定する  
**補足:** この文書は smoke の固定が目的。`point_pack` / `validator` / `mock provider` の本格導入はこのセッションの対象外

---

## 1. この baseline の前提

- core flow は `Claude API キー` を唯一の AI 前提とする
- `Gemini API キー` は `Creative Generation` のみで使用する optional addon とする
- `Ads AI` は `Claude API キー + Ads 認証 + Ads セットアップ完了` を前提とする
- `Compare / Discovery / Creative Review(review only)` は Gemini 未設定でも smoke 対象として成立する
- backend や provider の不安定さを隠さず、失敗時は必ず failure category を記録する

---

## 2. 共通 failure category

この分類を全シナリオで使う。

| Category | 判定基準 |
| --- | --- |
| `config missing` | Claude/Gemini 未設定、Ads セットアップ未完了、必要 URL や asset が未入力 |
| `auth error` | Ads 認証切れ、401/403、認証情報不一致 |
| `timeout` | 規定時間を超えて待機し、ユーザーが再試行判断を要する |
| `cold start` | 初回起動で明らかな立ち上がり待ちが発生し、再試行で改善する |
| `CORS / network` | fetch 失敗、接続拒否、DNS/CORS、オフライン相当 |
| `upstream provider` | Claude/Gemini、検索 provider、外部 AI 由来の失敗 |
| `invalid input` | URL 形式不正、画像形式不正、必須入力不足 |
| `schema / response mismatch` | `report_md` / `review` / `run_id` など期待 shape 不一致 |

---

## 3. 10分 smoke の回し方

1. `Settings` で Claude key の有無を確認する
2. Ads 認証済み環境なら `Ads AI` を確認する
3. `Compare`
4. `Discovery`
5. `Creative Review` の review only
6. Gemini がある環境だけ `Creative Generation`

順番を固定する理由:

- まず Claude only の core flow を確認する
- optional addon である Gemini 生成は最後に切り離して確認する
- Ads AI だけ前提条件が多いため、最初に blocked / unblocked を見極める

---

## 4. Scenario A: Ads AI

**前提条件**

- `Claude API キー` が設定済み
- Ads 認証済み
- Ads セットアップ完了
- `point_pack_md` を含む要点パックが生成済み

**手順**

1. `/ads/ai` を開く
2. 要点パックが読み込まれていることを確認する
3. 固定質問を 1 つ送る  
   例: `今月の主要なリスクと、最優先で見るべき指標を3点に絞ってください`
4. 回答が返るまで待つ

**成功条件**

- チャット応答が返る
- 応答が空欄や provider 生エラーではない
- 送信後に入力や会話履歴が不必要に消えない

**主な failure category**

- `config missing`
- `auth error`
- `timeout`
- `cold start`
- `CORS / network`
- `upstream provider`
- `schema / response mismatch`

---

## 5. Scenario B: Compare

**前提条件**

- `Claude API キー` が設定済み
- 比較対象 URL を 2〜3 件用意している

**手順**

1. `/compare` を開く
2. 自社 URL と競合 URL を入力する
3. `分析開始` を押す
4. main area に分析レポートが表示されるまで待つ

**成功条件**

- `report_md` 由来の main result が表示される
- 実行メタデータまたは run 情報が表示される
- score が無くても broken impression にならない

**主な failure category**

- `config missing`
- `timeout`
- `cold start`
- `CORS / network`
- `upstream provider`
- `invalid input`
- `schema / response mismatch`

---

## 6. Scenario C: Discovery

**前提条件**

- `Claude API キー` が設定済み
- 入力元となるブランド URL を 1 件用意している

**手順**

1. `/discovery` を開く
2. ブランド URL を入力する
3. `競合を発見` を押す
4. レポートまたは partial success/error を確認する

**成功条件**

- 成功時は `report_md` か competitor list が表示される
- 失敗時は stage が分かる明示的エラーになる
- 一部取得失敗でも partial success が分かる

**主な failure category**

- `config missing`
- `timeout`
- `cold start`
- `CORS / network`
- `upstream provider`
- `invalid input`
- `schema / response mismatch`

---

## 7. Scenario D: Creative Review

**前提条件**

- `Claude API キー` が設定済み
- バナー画像 1 枚を用意している
- `Gemini API キー` は未設定でもよい

**手順**

1. `/creative-review` を開く
2. PNG/JPG/WebP のバナーを 1 枚アップロードする
3. 必要ならブランド情報、LP URL、運用メモを入れる
4. `バナーレビューを実行` または `広告+LP統合レビューを実行` を押す

**成功条件**

- レビュー結果が返る
- `Gemini` 未設定でも review only は blocked に見えない
- 改善バナー生成は optional step として分離されて見える

**主な failure category**

- `config missing`
- `timeout`
- `cold start`
- `CORS / network`
- `upstream provider`
- `invalid input`
- `schema / response mismatch`

---

## 8. Scenario E: Creative Generation

**前提条件**

- `Creative Review` が完了している
- `Gemini API キー` が設定済み

**手順**

1. `Creative Review` 実行後の結果画面を開く
2. optional の生成アクションを実行する
3. 改善バナーの生成結果またはエラーを確認する

**成功条件**

- 生成結果が表示される、または失敗理由が明示される
- 生成失敗でも review result は残る
- core flow の review only を壊さない

**主な failure category**

- `config missing`
- `timeout`
- `cold start`
- `CORS / network`
- `upstream provider`
- `schema / response mismatch`

---

## 9. 実施ログ

### 9.1 実施環境メモ

- `2026-04-03` に `npm run build` は成功した
- build 時に `@theme` の warning と chunk size warning は出たが、build 自体は通過した
- live smoke は `http://127.0.0.1:3002` の local `vite` dev server で実施した
- browser は `Chrome headless via CDP` の isolated profile を使用した
- 既存起動中 Chrome には remote debugging を付与できなかったため、browser-local の `Claude/Gemini key`、`Ads auth`、`Ads setup state` は今回の automation profile に引き継がれていない
- isolated profile の初期状態は `Claude key なし`、`Gemini key なし`、`Ads token なし`、`case auth なし`、`Ads setup state なし` だった

### 9.2 2026-04-03 live smoke サマリー

| Date | Scenario | 実施可否 | 前提 | Result | Time | Failure Category | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-04-03 | Ads AI | 実施 | `Claude key` / `Ads auth` / `case auth` / `Ads setup` いずれも未充足 | `blocked` | 約1.1秒 | `auth error` | `/ads/ai` から `/ads/wizard` へ redirect。ログイン必須 banner を確認 |
| 2026-04-03 | Compare | 実施 | `Claude key` 未設定 | `blocked` | 約1.3秒 | `config missing` | 3 URL 入力後も `分析開始` ボタン disabled |
| 2026-04-03 | Discovery | 実施 | `Claude key` 未設定 | `blocked` | 約1.1秒 | `config missing` | URL 入力後も `競合を発見` ボタン disabled |
| 2026-04-03 | Creative Review | 実施 | sample PNG は用意済み、`Claude key` / `Gemini key` は未設定 | `blocked` | 約53.3秒 | `config missing` | `dist/guide/page5-creative.png` の upload は成功し `asset_id` を確認。レビュー CTA は disabled |
| 2026-04-03 | Creative Generation | 実施 | `Creative Review` 未完了、`Gemini key` 未設定 | `blocked` | 約0.0秒 | `config missing` | generation CTA 自体が描画されず、review result も未取得 |

### 9.3 シナリオ別実測メモ

#### Scenario A: Ads AI

- 実施可否: 実施
- 前提が揃っていたか: 揃っていない。`Claude key`、`Ads auth`、`case auth`、`Ads setup` が automation profile 上で未設定
- 実行手順の実績: `/ads/ai` を開いた。route guard により `/ads/wizard` へ redirect された。wizard 上で「考察スタジオへのログインが必要です」を確認した
- 結果: `blocked`
- 処理時間の概算: 約1.1秒
- failure category: `auth error`
- 補足メモ: Ads AI 本体の chat UI までは到達していない

#### Scenario B: Compare

- 実施可否: 実施
- 前提が揃っていたか: 揃っていない。`Claude key` 未設定
- 実行手順の実績: `/compare` を開き、`https://www.openai.com`、`https://www.anthropic.com`、`https://www.notion.so` を入力した
- 結果: `blocked`
- 処理時間の概算: 約1.3秒
- failure category: `config missing`
- 補足メモ: `分析開始` ボタンは最後まで disabled で、network request は発火していない

#### Scenario C: Discovery

- 実施可否: 実施
- 前提が揃っていたか: 揃っていない。`Claude key` 未設定
- 実行手順の実績: `/discovery` を開き、`https://www.openai.com` を入力した
- 結果: `blocked`
- 処理時間の概算: 約1.1秒
- failure category: `config missing`
- 補足メモ: `競合を発見` ボタンは disabled のままで、search/analyze request は発火していない

#### Scenario D: Creative Review

- 実施可否: 実施
- 前提が揃っていたか: sample banner は揃っていたが、`Claude key` と `Gemini key` は未設定
- 実行手順の実績: `/creative-review` を開き、`dist/guide/page5-creative.png` を upload した。upload 完了後に `asset_id` 表示を確認した
- 結果: `blocked`
- 処理時間の概算: 約53.3秒
- failure category: `config missing`
- 補足メモ: upload 導線は live で通ったが、`バナーレビューを実行` ボタンは disabled のままで review request までは進めなかった

#### Scenario E: Creative Generation

- 実施可否: 実施
- 前提が揃っていたか: 揃っていない。`Creative Review` 未完了かつ `Gemini key` 未設定
- 実行手順の実績: Scenario D 継続状態で review result と generation CTA の有無を確認した
- 結果: `blocked`
- 処理時間の概算: 即時
- failure category: `config missing`
- 補足メモ: optional generation step に入る前提が満たされず、`改善バナーを試作` CTA は描画されなかった

### 9.4 2026-04-03 provisioned happy-path smoke

#### provisioning 方針

- isolated `Chrome headless via CDP` を前提にした test profile を使用
- 常用ブラウザ profile には依存しない
- local dev server は `http://127.0.0.1:3002` で起動
- provision helper として `scripts/provision_smoke_profile.mjs` を追加した
- helper は以下を local proxy 経由で実行する
  1. `/api/ads/auth/login`
  2. `/api/ads/cases/login`
  3. `/api/ads/bq/periods`
  4. `/api/ads/bq/generate_batch`
- helper は isolated profile に投入する localStorage manifest を生成する
- 今回 helper が投入できた前提:
  - `Ads auth token`
  - `case auth`
  - `Ads setup state`
  - `Gemini API key` (`GEMINI_API_KEY` 環境変数)
- 今回 helper が投入できなかった前提:
  - `Claude API key` (`CLAUDE_API_KEY` / `ANTHROPIC_API_KEY` は local env で未発見)

#### provisioning 実測

- `scripts/provision_smoke_profile.mjs` 実行: `1/1` 成功
- `POST /api/ads/auth/login`: `200`
- `POST /api/ads/cases/login` (`petabit`): `200`
- `GET /api/ads/bq/periods?granularity=monthly&dataset_id=analytics_311324674`: `200`
- `POST /api/ads/bq/generate_batch` (`query_types=["pv"]`, `period="2026-04"`): `200`
- 生成した setup state:
  - `queryTypes=["pv"]`
  - `periods=["2026-04"]`
  - `granularity="monthly"`
  - `datasetId="analytics_311324674"`
- isolated profile の settings 実測状態:
  - `Ads token: present`
  - `case auth: true`
  - `Ads setup entries: 1`
  - `Gemini key: present`
  - `Claude key: absent`

#### provisioned smoke サマリー

| Date | Scenario | 実施可否 | 前提投入方法 | Result | Time | Failure Category | Repro | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-04-03 | Ads AI | 実施 | helper で `Ads auth + case auth + setup + Gemini` を seed。`Claude` は未投入 | `blocked` | 約4.0秒 | `config missing` | `0/1` | `/ads/ai` 自体は到達。`promptDisabled=true`。`reportBundleMissing=false` で setup guard は突破 |
| 2026-04-03 | Compare | 実施 | helper で test profile seed。`Claude` は未投入 | `blocked` | 約0.8秒 | `config missing` | `0/1` | URL 入力後も `分析開始` disabled |
| 2026-04-03 | Discovery | 実施 | helper で test profile seed。`Claude` は未投入 | `blocked` | 約0.7秒 | `config missing` | `0/1` | URL 入力後も `競合を発見` disabled |
| 2026-04-03 | Creative Review | 実施 | helper で `Gemini` まで seed。sample banner を upload | `blocked` | 約2.5秒 | `config missing` | `0/1` | upload 成功後も `バナーレビューを実行` disabled |
| 2026-04-03 | Creative Generation | 実施 | helper で `Gemini` は seed 済み。review result は未取得 | `blocked` | 約0.0秒 | `config missing` | `0/1` | generation CTA 未描画。Gemini blocker ではなく review 前提 blocker |

#### シナリオ別メモ

##### Scenario A: Ads AI

- 実施可否: 実施
- 前提投入方法: helper で `is_ads_token`, `insight-studio-current-case`, `insight-studio-case-authenticated`, `insight-studio-ads-setup:petabit`, `is_gemini_key` を seed
- 実行手順: provisioned profile で `/ads/ai` を開いた
- 結果: `blocked`
- 所要時間: 約4.0秒
- failure category: `config missing`
- 補足: route guard は通過し、`AI 考察エンジン` UI まで到達した。`promptDisabled=true`、`reportBundleMissing=false` を確認したため、Ads auth/setup provisioning 自体は成立した
- 再現性: `0/1` success

##### Scenario B: Compare

- 実施可否: 実施
- 前提投入方法: helper で Ads/Gemini/test profile を seed。Claude は未投入
- 実行手順: `/compare` を開き、`https://www.petabit.co.jp`, `https://www.openai.com`, `https://www.anthropic.com` を入力した
- 結果: `blocked`
- 所要時間: 約0.8秒
- failure category: `config missing`
- 補足: `分析開始` CTA は disabled のままで、network request は発火していない
- 再現性: `0/1` success

##### Scenario C: Discovery

- 実施可否: 実施
- 前提投入方法: helper で Ads/Gemini/test profile を seed。Claude は未投入
- 実行手順: `/discovery` を開き、`https://www.petabit.co.jp` を入力した
- 結果: `blocked`
- 所要時間: 約0.7秒
- failure category: `config missing`
- 補足: `競合を発見` CTA は disabled のままで、discovery request は発火していない
- 再現性: `0/1` success

##### Scenario D: Creative Review

- 実施可否: 実施
- 前提投入方法: helper で Ads/Gemini/test profile を seed。banner sample は `dist/guide/page5-creative.png`
- 実行手順: `/creative-review` を開き、sample banner を upload した
- 結果: `blocked`
- 所要時間: 約2.5秒
- failure category: `config missing`
- 補足: `Gemini 未設定` banner は出ず、Gemini seed は反映された。upload 成功後も `バナーレビューを実行` は disabled
- 再現性: `0/1` success

##### Scenario E: Creative Generation

- 実施可否: 実施
- 前提投入方法: helper で `Gemini` は seed 済み
- 実行手順: Scenario D 継続状態で generation CTA の有無を確認した
- 結果: `blocked`
- 所要時間: 即時
- failure category: `config missing`
- 補足: `Gemini` 自体は blocker ではない。review result が作れないため generation CTA が出ない
- 再現性: `0/1` success

#### blocker 切り分け

- 技術的 blocker
  - local env に `Claude API key` が無く、frontend gating を満たせない
  - `Market Lens` backend に対して `api_key` なしで直接 probe しても、`/scan` は `Claude API キーが無効か、権限が不足しています` を返したため、server-side fallback は happy path の代替として確認できなかった
- 認証情報 / API key blocker
  - `CLAUDE_API_KEY` / `ANTHROPIC_API_KEY` が未提供
- profile provisioning blocker
  - `Ads auth`, `case auth`, `Ads setup`, `Gemini` は provisioning できたため blocker ではない
- Ads setup blocker
  - なし。helper で再現可能に setup state を作成できた
- automation blocker
  - なし。sandbox 外の headless Chrome/CDP で live smoke を回せた

### 9.5 2026-04-04 Claude key injected Phase 0.6 smoke

#### provisioning 方針

- local browser smoke は `http://127.0.0.1:3004` の `vite preview` を使用
- browser は isolated `Chrome headless` を Playwright `channel=chrome` で起動した
- `Claude` / `Gemini` / `Ads auth` / `case auth` / `Ads setup` は `scripts/provision_smoke_profile.mjs` を `node --env-file=.env` で実行して localStorage manifest を生成し、isolated profile に `add_init_script` で投入した
- provision helper の raw manifest は一時ファイルとしてのみ使用し、結果記録後に削除した
- `Creative Review` の fixture は valid PNG を使用した。`public/guide/page5-creative.png` / `dist/guide/page5-creative.png` は拡張子が `.png` だが実体は JPEG bytes で、direct probe では `422` の原因になった

#### provisioning 実測

- `.env` 実測:
  - `CLAUDE_API_KEY` or `ANTHROPIC_API_KEY`: present
  - `GEMINI_API_KEY`: present
- helper 実測:
  - `POST /api/ads/auth/login`: `200`
  - `POST /api/ads/cases/login` (`petabit`): `200`
  - `GET /api/ads/bq/periods`: `200`
  - `POST /api/ads/bq/generate_batch` (`query_types=["pv"]`, `period="2026-04"`): `200`
- isolated profile runtime flags:
  - `Claude key: present`
  - `Gemini key: present`
  - `Ads token: present`
  - `case auth: true`
  - `Ads setup entries: 1`

#### Phase 0.6 live smoke サマリー

| Date | Scenario | 実施可否 | 前提投入方法 | Result | Time | Failure Category | Repro | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-04-04 | Ads AI | 実施 | helper manifest で `Claude + Gemini + Ads auth + case auth + setup` を seed | `success` | 約16.1秒 | - | `1/1` | `/ads/ai` で quick prompt `リスクを要約して` を実行し、`✓ 考察生成完了` を確認 |
| 2026-04-04 | Compare | 実施 | helper manifest で同条件を seed | `failed` | 約32.1秒 | `backend connection error` | `0/1` | CTA は enable。実行後に UI が `Market Lens backend に接続できませんでした。しばらく待って再試行してください。` を表示 |
| 2026-04-04 | Discovery | 実施 | helper manifest で同条件を seed | `failed` | 約31.6秒 | `backend connection error` | `0/1` | CTA は enable。実行後に UI が `Market Lens backend に接続できませんでした。しばらく待って再試行してください。` を表示 |
| 2026-04-04 | Creative Review | 実施 | helper manifest で同条件を seed。valid PNG fixture を upload | `failed` | 約31.5秒 | `backend connection error` | `0/1` | upload は `201` 成功し `asset_id` 表示まで到達。review 実行後に UI が `レビュー失敗: Market Lens backend に接続できませんでした。しばらく待って再試行してください。` を表示 |
| 2026-04-04 | Creative Generation | 実施 | `Gemini` は seed 済みだが D 成功が前提 | `blocked` | 約0.0秒 | `review prerequisite missing` | `0/1` | D が review result まで到達しなかったため generation step は未実施 |

#### Phase 0.6 シナリオ別メモ

##### Scenario A: Ads AI

- 実施可否: 実施
- 前提投入方法: helper manifest で `is_claude_key`, `is_gemini_key`, `is_ads_token`, `insight-studio-current-case`, `insight-studio-case-authenticated`, `insight-studio-ads-setup:petabit` を投入
- 実行手順: `/ads/ai` を開き、quick prompt `リスクを要約して` をクリック
- 結果: `success`
- 所要時間: 約16.1秒
- failure category: `-`
- 補足: `Claude API 設定済`, `考察スタジオ 接続済`, `Ads AI Claude で利用可` を確認したうえで、assistant response と `✓ 考察生成完了` を確認
- 再現性: `1/1` success

##### Scenario B: Compare

- 実施可否: 実施
- 前提投入方法: helper manifest で同条件を投入
- 実行手順: `/compare` で `https://www.petabit.co.jp`, `https://www.openai.com`, `https://www.anthropic.com` を入力して `分析開始`
- 結果: `failed`
- 所要時間: 約32.1秒
- failure category: `backend connection error`
- 補足: browser UI は `Market Lens backend に接続できませんでした。しばらく待って再試行してください。` を表示した。別途 Node direct probe では `/api/ml/scan` が `200` を返したため、missing key ではなく browser から direct backend に到達できない問題が主 blocker と判断した
- 再現性: `0/1` success

##### Scenario C: Discovery

- 実施可否: 実施
- 前提投入方法: helper manifest で同条件を投入
- 実行手順: `/discovery` で `https://www.petabit.co.jp` を入力して `競合を発見`
- 結果: `failed`
- 所要時間: 約31.6秒
- failure category: `backend connection error`
- 補足: browser UI は `Market Lens backend に接続できませんでした。しばらく待って再試行してください。` を表示した。別途 Node direct probe では `/api/ml/discovery/analyze` が `502` `競合検索がタイムアウト` を返しており、少なくとも key gating は解消済み
- 再現性: `0/1` success

##### Scenario D: Creative Review

- 実施可否: 実施
- 前提投入方法: helper manifest で同条件を投入し、valid PNG fixture を upload
- 実行手順: `/creative-review` で PNG を upload し、`バナーレビューを実行`
- 結果: `failed`
- 所要時間: 約31.5秒
- failure category: `backend connection error`
- 補足: upload は `201` で成功し `asset_id` 表示まで到達した。review 実行後は browser UI が `レビュー失敗: Market Lens backend に接続できませんでした。しばらく待って再試行してください。` を表示した。別途 Node direct probe では same machine から valid PNG review が `200` を返したため、Compare / Discovery と同系統の browser-side direct backend blocker と判断した
- 再現性: `0/1` success

##### Scenario E: Creative Generation

- 実施可否: 実施
- 前提投入方法: helper manifest で `Gemini` まで投入済み
- 実行手順: D 成功時のみ generation へ進む条件を確認した
- 結果: `blocked`
- 所要時間: 即時
- failure category: `review prerequisite missing`
- 補足: `Gemini` 自体は blocker ではない。D が review result を返せず generation CTA まで進めなかった
- 再現性: `0/1` success

#### Phase 0.6 blocker 切り分け

- 技術的 blocker
  - `Claude key` 注入自体は解消した。frontend gating は `A success` で通過を確認した
  - core 4 のうち `B / C / D` は、long-running endpoint が proxy を bypass して direct backend へ接続する箇所で browser UI が `Market Lens backend に接続できませんでした。しばらく待って再試行してください。` を返した
- 認証情報 / API key blocker
  - `Claude` / `Gemini` ともに local env から取得でき、isolated profile に投入できたため blocker ではない
- profile provisioning blocker
  - helper manifest による `Ads auth`, `case auth`, `Ads setup`, `Claude`, `Gemini` の投入は再現できたため blocker ではない
- Ads setup blocker
  - なし。`Ads AI` success で実運用相当の setup state を確認した
- automation blocker
  - なし。isolated `Chrome headless` で browser smoke 自体は再現できた
- 補足 inference
  - Node direct probe では `Compare scan=200`, `Discovery analyze=502(search timeout)`, `Creative Review(valid PNG)=200` を確認した。これと browser 実測との差分から、主 blocker は key 不足ではなく `browser -> direct Market Lens backend` の接続層と推定する

---

## 10. この baseline で固定する判断

- `Gemini 未設定` は `Creative Generation unavailable` を意味するだけで、core flow の失敗ではない
- `Creative Review` の baseline は review only を core として扱う
- `Ads AI` は `Claude key + Ads auth + setup` が揃って初めて ready とみなす
- Phase 2 以降の state/error 再設計は、この baseline を起点に評価する

### 9.6 2026-04-04 Phase 3-A transport follow-up

#### 追加で確認したこと

- `Playwright` で `http://127.0.0.1:3004` (`vite preview`) と `http://127.0.0.1:3002` (`vite dev`) から browser-side request を直接計測した
- direct probe 対象:
  - `GET https://market-lens-ai.onrender.com/api/health`
  - `POST https://market-lens-ai.onrender.com/api/scan`
  - `POST https://market-lens-ai.onrender.com/api/discovery/analyze`
  - `POST https://market-lens-ai.onrender.com/api/reviews/banner`
- proxy probe 対象:
  - `/api/ml/health`
  - `/api/ml/scan`
  - `/api/ml/discovery/analyze`
  - `/api/ml/reviews/banner`

#### transport 実測

- direct `GET /health`:
  - browser console: `No 'Access-Control-Allow-Origin' header is present`
  - browser result: `TypeError: Failed to fetch`
- direct `POST /scan`, `/discovery/analyze`, `/reviews/banner`:
  - browser console: `Response to preflight request doesn't pass access control check`
  - raw `OPTIONS` probe:
    - `Origin: http://127.0.0.1:3002` → `400 Disallowed CORS origin`
    - `Origin: http://127.0.0.1:3004` → `400 Disallowed CORS origin`
    - `Origin: http://localhost:3002` → `200` + `Access-Control-Allow-Origin: http://localhost:3002`
- local copy `tmp_market_lens_ai_repo/web/app/main.py` では default CORS origin が以下だった
  - `http://localhost:3001`
  - `http://localhost:3002`
  - `https://insight-studio-chi.vercel.app`
- したがって、Phase 0.6 smoke で使っていた実 origin `127.0.0.1:3002` / `127.0.0.1:3004` は backend CORS allowlist に含まれていない

#### direct / proxy 差分の確定

- Node probe は CORS を受けないため direct backend に到達できた
- browser direct path は CORS/preflight で `TypeError` に丸まり、frontend では `Market Lens backend に接続できませんでした。しばらく待って再試行してください。` に見えていた
- same-origin proxy `/api/ml` を使うと browser でも実レスポンスが取得できた
  - preview probe:
    - `/api/ml/scan` → `200`
    - `/api/ml/discovery/analyze` → `200` または backend error JSON
    - `/api/ml/reviews/banner` → `422` backend/provider error
  - dev probe:
    - `/api/ml/scan` → `200`
    - `/api/ml/discovery/analyze` → `500` `Internal server error (SSLError)` 実測あり
    - `/api/ml/reviews/banner` → `422` backend/provider error

#### frontend 側の最小修正

- `src/api/marketLens.js`
  - local browser (`localhost` / `127.0.0.1`) では long-running endpoint でも direct を強制せず `/api/ml` proxy を使うよう変更
- `vite.config.js`
  - `server.proxy` と同じ設定を `preview.proxy` にも明示

#### 修正後の browser UI smoke

| Date | Mode | Scenario | Result | Notes |
| --- | --- | --- | --- | --- |
| 2026-04-04 | `preview` (`127.0.0.1:3004`) | Compare | `improved` | UI request は `/api/ml/scan` に出て `200`。`backend connection error` は再現せず |
| 2026-04-04 | `preview` (`127.0.0.1:3004`) | Discovery | `improved` | UI request は `/api/ml/discovery/analyze` に出て `200`。`backend connection error` は再現せず |
| 2026-04-04 | `preview` (`127.0.0.1:3004`) | Creative Review | `improved but backend/provider blocker remains` | UI request は `/api/ml/reviews/banner` に出て `422`。`レビュー失敗: ...Could not process image` を表示 |
| 2026-04-04 | `dev` (`127.0.0.1:3002`) | Compare | `improved` | UI request は `/api/ml/scan` に出て `200`。`backend connection error` は再現せず |
| 2026-04-04 | `dev` (`127.0.0.1:3002`) | Discovery | `improved but backend error remains` | UI request は `/api/ml/discovery/analyze` に出て `500` `Internal server error (SSLError)` 実測 |
| 2026-04-04 | `dev` (`127.0.0.1:3002`) | Creative Review | `improved but backend/provider blocker remains` | UI request は `/api/ml/reviews/banner` に出て `422`。`backend connection error` は再現せず |
