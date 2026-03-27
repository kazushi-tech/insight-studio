# Claude実行プラン: CreativeReview 復旧 + Nano Banana2 3.1 統一

## 0. 結論

今回のゴールは、`CreativeReview` を「停止中の説明ページ」から、**画像アップロード -> Geminiレビュー -> 改善バナー生成** まで一気通貫で動く機能に戻すことです。

このタスクで絶対にぶらしてはいけない前提は 4 つです。

1. `asset_id` は user が手入力するものではなく、**画像アップロード後に backend が返す内部 ID** である
2. レビューと生成はどちらも **同じ Gemini API キー（BYOK）** を使う
3. バナー生成の Vision モデルは **必ず `gemini-3.1-flash-image-preview`** を使う
4. `gemini-2.0-flash-preview-image-generation` は今回の用途では採用しない

つまり、実装すべき正しいフローはこれです。

1. user がバナー画像を upload
2. Market Lens backend が `asset_id` を返す
3. `asset_id` + `api_key` で banner review を実行
4. review の `run_id` を受け取る
5. `review_run_id` + `api_key` で Nano Banana2 による改善バナー生成を実行
6. generation を poll し、生成画像を表示・ダウンロード可能にする

---

## 1. すでに確定した事実

### 1.1 upload -> asset_id の契約

Market Lens AI repo には creative asset upload の正式 router があり、`POST /api/assets` で multipart upload を受けています。

根拠:

- `tmp_market_lens_ai_repo/web/app/routers/creative_asset_routes.py:19`
- `tmp_market_lens_ai_repo/web/app/routers/creative_asset_routes.py:21`

参考実装:

- `tmp_market_lens_ai_repo/src/pages/creative-review-page.js:62`
- `tmp_market_lens_ai_repo/src/pages/creative-review-page.js:68`
- `tmp_market_lens_ai_repo/src/pages/creative-review-page.js:77`

意味:

- `asset_id` はアップロード結果として backend が返す ID
- user に asset_id 入力フォームを見せる設計は不要
- frontend は upload 成功後にこの ID を state として持てばよい

### 1.2 banner review の契約

banner review は `POST /api/reviews/banner` で、`asset_id` と optional な `api_key` を受ける JSON 契約です。

根拠:

- `tmp_market_lens_ai_repo/web/app/schemas/review_request.py:29`
- `tmp_market_lens_ai_repo/web/app/schemas/review_request.py:32`
- `tmp_market_lens_ai_repo/web/app/schemas/review_request.py:36`
- `tmp_market_lens_ai_repo/web/app/routers/review_routes.py:103`
- `tmp_market_lens_ai_repo/web/app/routers/review_routes.py:118`

banner review request:

```json
{
  "asset_id": "12桁hex",
  "brand_info": "",
  "operator_memo": "",
  "model": null,
  "api_key": "BYOK"
}
```

### 1.3 ad-lp review の契約

LP URL がある場合は `POST /api/reviews/ad-lp` に切り替わり、`landing_page` が追加されます。

根拠:

- `tmp_market_lens_ai_repo/web/app/schemas/review_request.py:39`
- `tmp_market_lens_ai_repo/web/app/schemas/review_request.py:42`
- `tmp_market_lens_ai_repo/web/app/schemas/review_request.py:43`
- `tmp_market_lens_ai_repo/web/app/routers/review_routes.py:136`
- `tmp_market_lens_ai_repo/src/pages/creative-review-page.js:127`

### 1.4 generation の契約

改善バナー生成は review 結果の `run_id` を使って `POST /api/generation/banner` を叩きます。

根拠:

- `tmp_market_lens_ai_repo/web/app/schemas/banner_generation.py:19`
- `tmp_market_lens_ai_repo/web/app/schemas/banner_generation.py:22`
- `tmp_market_lens_ai_repo/web/app/schemas/banner_generation.py:25`
- `tmp_market_lens_ai_repo/web/app/routers/generation_routes.py:29`
- `tmp_market_lens_ai_repo/web/app/routers/generation_routes.py:32`
- `tmp_market_lens_ai_repo/web/app/routers/generation_routes.py:58`
- `tmp_market_lens_ai_repo/src/pages/creative-review-page.js:198`
- `tmp_market_lens_ai_repo/src/pages/creative-review-page.js:204`

generation request:

```json
{
  "review_run_id": "review run id",
  "style_guidance": "",
  "model": null,
  "api_key": "BYOK"
}
```

取得系:

- `GET /api/generation/{gen_id}`
- `GET /api/generation/{gen_id}/image`

根拠:

- `tmp_market_lens_ai_repo/web/app/routers/generation_routes.py:68`
- `tmp_market_lens_ai_repo/web/app/routers/generation_routes.py:77`

### 1.5 Nano Banana2 モデル設定に不整合が残っている

README は 3.1 を示している一方、実装 fallback と deploy 設定には 2.0 が残っています。

根拠:

- `tmp_market_lens_ai_repo/README.md:70`
- `tmp_market_lens_ai_repo/web/app/gemini_vision_client.py:39`
- `tmp_market_lens_ai_repo/web/app/gemini_vision_client.py:40`
- `tmp_market_lens_ai_repo/render.yaml:12`
- `tmp_market_lens_ai_repo/render.yaml:13`

重要判断:

- 今回は user 要件を優先し、**Vision モデルは `gemini-3.1-flash-image-preview` に統一する**
- 2.0 を温存しない
- fallback でも 2.0 を使わない

### 1.6 現在の Insight Studio 側の状態

現状の frontend はまだ Creative Review を unavailable 扱いしており、`/api/assets` に対応する helper もありません。

根拠:

- `src/pages/CreativeReview.jsx:21`
- `src/pages/CreativeReview.jsx:27`
- `src/api/marketLens.js:17`
- `src/api/marketLens.js:25`
- `src/api/marketLens.js:72`

意味:

- `reviewByType()` だけでは足りない
- `multipart/form-data` upload helper が必要
- unavailable page を本物の workflow UI に置き換える必要がある

---

## 2. 今回の Claude タスクの主目的

### 2.1 Primary Goal

`CreativeReview` を次の実運用 UX に変える。

1. 画像を upload
2. upload preview を表示
3. `asset_id` を内部 state に保持
4. Gemini API キーでレビュー
5. 改善提案を表示
6. 同じ API キーで Nano Banana2 生成
7. 生成画像を preview / download

### 2.2 Secondary Goal

Vision モデルの設定を `gemini-3.1-flash-image-preview` に揃え、**docs / code / deploy config の不整合をなくす**。

### 2.3 Non-goals

今回は以下は優先しない。

- compare review の本実装
- 高度な asset library 管理 UI
- 複数画像一括 upload
- export PDF / PPTX 連携

---

## 3. 実装方針

### 方針 A: asset_id は内部状態として扱う

user 向け UI には `asset_id` 入力欄を作らない。

理由:

- `asset_id` は upload 済み asset の主キーであり、operator が覚えて入力するものではない
- clone した Market Lens 側の reference UI も upload 成功後に内部で `crAssetId` として保持している

根拠:

- `tmp_market_lens_ai_repo/src/pages/creative-review-page.js:77`

### 方針 B: 同一 API キーを review / generation の両方に渡す

理由:

- review request も generation request も `api_key` を受ける契約
- user の BYOK 運用と一致

根拠:

- `tmp_market_lens_ai_repo/web/app/schemas/review_request.py:36`
- `tmp_market_lens_ai_repo/web/app/schemas/banner_generation.py:25`

### 方針 C: Vision モデルは 3.1 に固定

採用モデル:

- `gemini-3.1-flash-image-preview`

やること:

- local fallback を 3.1 に変更
- deploy config も 3.1 に変更
- docs / comments / test expectation の 2.0 記述を洗う

---

## 4. Workstream A: Market Lens API helper の拡張

### 目的

`src/api/marketLens.js` を、CreativeReview の本物の workflow を扱える helper 群に拡張する。

### 現状の問題

- `request()` は JSON 専用前提
- `Content-Type: application/json` を常に付けるため multipart upload に不向き
- `reviewByType()` だけでは upload / generation / polling を扱えない

根拠:

- `src/api/marketLens.js:17`
- `src/api/marketLens.js:25`
- `src/api/marketLens.js:72`

### 実装タスク

1. `requestJson()` と `requestRaw()` を分離する
   - multipart upload で `Content-Type` を手動付与しない

2. `uploadCreativeAsset(file)` を追加
   - `POST /assets`
   - `FormData` を使う
   - 返却の `asset_id`, `file_name`, `mime_type`, `size_bytes`, `width`, `height` を保持できるようにする

3. `reviewBanner(payload, apiKey)` を追加
   - `POST /reviews/banner`

4. `reviewAdLp(payload, apiKey)` を追加
   - `POST /reviews/ad-lp`

5. `generateBanner(payload, apiKey)` を追加
   - `POST /generation/banner`

6. `getGeneration(genId)` を追加
   - `GET /generation/{gen_id}`

7. `getGenerationImageUrl(genId)` helper を追加
   - image URL を組み立てるだけでもよい

8. error message を route ごとに調整
   - 404 asset not found
   - 409 image not ready
   - 422 invalid asset_id / review failed / generation failed

### 対象ファイル

- `src/api/marketLens.js`

### 受け入れ条件

- file upload が API helper 経由で可能
- review と generation を helper だけで呼べる
- polling 実装に必要な API が揃う

---

## 5. Workstream B: CreativeReview UI を本実装へ置換

### 目的

`src/pages/CreativeReview.jsx` の unavailable page を、最小だが実用的な 1 画面 workflow に置き換える。

### UI 要件

1. Upload Area
   - file input
   - drag & drop は optional
   - preview 表示
   - upload status 表示

2. Review Input Area
   - `brand_info`
   - `operator_memo`
   - optional `LP URL`

3. Review Result Area
   - review summary
   - score / sections / markdown が返るなら読みやすく表示
   - `run_id` は debug text として小さく表示してよい

4. Banner Generation Area
   - 「改善バナーを生成」ボタン
   - generation 中 spinner
   - 生成画像 preview
   - download button

### 状態遷移

- `idle`
- `uploading`
- `uploaded`
- `reviewing`
- `reviewed`
- `generating`
- `generated`
- `error`

### 実装タスク

1. unavailable notice を削除
2. file upload UI を追加
3. upload 成功で preview + internal `assetId` を保存
4. `LP URL` が空なら banner review
5. `LP URL` があるなら ad-lp review
6. review 成功時に `run_id` を保存
7. generation button は `run_id` があるときだけ有効化
8. generation 開始後に poll
9. completed で image preview 表示
10. retry / clear / re-upload 導線を用意

### 重要 UX 判断

- `asset_id` は default で UI に大きく見せない
- ただし debug 用に小さく表示するのは可
- user の mental model は「画像をアップロードした」だけで十分

### 対象ファイル

- `src/pages/CreativeReview.jsx`
- 必要なら `src/components/ui/*`

### 参考実装

- `tmp_market_lens_ai_repo/src/pages/creative-review-page.js:62`
- `tmp_market_lens_ai_repo/src/pages/creative-review-page.js:104`
- `tmp_market_lens_ai_repo/src/pages/creative-review-page.js:179`

### 受け入れ条件

- 画像 upload ができる
- upload 成功後に review 実行できる
- review 後に generation 実行できる
- 生成画像を確認・保存できる

---

## 6. Workstream C: Nano Banana2 モデル設定の統一

### 目的

`gemini-3.1-flash-image-preview` を唯一の正解として code / deploy config を揃える。

### 実装タスク

1. `tmp_market_lens_ai_repo/web/app/gemini_vision_client.py`
   - fallback を `gemini-3.1-flash-image-preview` に変更

2. `tmp_market_lens_ai_repo/render.yaml`
   - `GEMINI_VISION_MODEL` を `gemini-3.1-flash-image-preview` に変更

3. repo 内の 2.0 参照を grep し、必要なものを更新
   - docs
   - tests
   - comments
   - handoff / plans は全部直さなくてもよいが、実装や deploy に効く箇所は揃える

4. 生成 API が model override を受ける場合も、default は 3.1 で統一

### 対象ファイル

- `tmp_market_lens_ai_repo/web/app/gemini_vision_client.py`
- `tmp_market_lens_ai_repo/render.yaml`
- 2.0 記述が残る関連ファイル

### 受け入れ条件

- code fallback が 3.1
- deploy config も 3.1
- README と実装が矛盾しない

---

## 7. Workstream D: review -> generation の結線整合

### 目的

review の `run_id` を generation の `review_run_id` として確実に繋ぐ。

### 実装タスク

1. review response shape を frontend 側で normalize
   - `run_id`
   - `review`

2. generation 開始時に `review_run_id` を必ず送る
3. generation の poll 結果から `status`, `error_message`, `image_url` 相当を扱う
4. review 失敗時は generation を触れないようにする

### 参考

- `tmp_market_lens_ai_repo/web/app/routers/review_routes.py:127`
- `tmp_market_lens_ai_repo/web/app/routers/generation_routes.py:40`
- `tmp_market_lens_ai_repo/src/pages/creative-review-page.js:199`

---

## 8. Workstream E: 検証

### 必須検証

1. lint
   - `npm run lint`

2. build
   - `npm run build`

3. upload happy path
   - PNG/JPG を upload
   - `asset_id` が返る
   - preview が出る

4. banner review happy path
   - `LP URL` なしで `POST /reviews/banner`
   - review が返る
   - `run_id` が保持される

5. ad-lp review happy path
   - `LP URL` ありで `POST /reviews/ad-lp`

6. generation happy path
   - `POST /generation/banner`
   - `GET /generation/{gen_id}` poll
   - `GET /generation/{gen_id}/image` で画像取得

7. error path
   - upload failure
   - invalid asset
   - generation failed
   - API key missing

### 任意検証

- hard reload 後の state reset
- re-upload で古い review result が消えること
- 生成画像 download link の動作

---

## 9. 実装順

1. Market Lens helper を拡張
2. CreativeReview UI を upload-first workflow に置換
3. review 実行を接続
4. generation 実行と polling を接続
5. Vision model 3.1 統一を別 repo 側で反映
6. lint / build / smoke test
7. 必要なら CreativeReview 文言と FAQ を新 UI に合わせて再調整

---

## 10. Agent Team 推奨分担

このタスクは `Insight Studio frontend` と `tmp_market_lens_ai_repo` の 2 repo に跨るため、agent team で分離した方が安全です。

### Lead / Integrator

責務:

- 全体方針の固定
- `asset_id`, `run_id`, `gen_id` の state machine を統合
- review と generation の API 契約を最終確認
- 最終 diff review

### Agent 1: Frontend API / State Worker

責務:

- `src/api/marketLens.js`
- 必要なら `src/utils/*`

担当:

- upload helper
- review helper
- generation helper
- polling helper
- error normalization

### Agent 2: CreativeReview UI Worker

責務:

- `src/pages/CreativeReview.jsx`
- 必要なら `src/components/ui/*`

担当:

- upload UI
- preview UI
- review result UI
- generation preview UI

### Agent 3: Market Lens Config Worker

責務:

- `tmp_market_lens_ai_repo/web/app/gemini_vision_client.py`
- `tmp_market_lens_ai_repo/render.yaml`
- 3.1 / 2.0 記述の整理

担当:

- Nano Banana2 の 3.1 統一
- deploy / config 整合

### Agent 4: QA / Verifier

責務:

- route smoke
- request payload / response shape の目視確認
- build / lint
- failure mode チェック

---

## 11. Skills について

今回の作業に直接効く専用 skill は、この session の skill catalog にはありません。

したがって方針は以下です。

- skills 前提ではなく、**agent team + repo grounded implementation** を使う
- 参照先は `tmp_market_lens_ai_repo` を一次情報として扱う

---

## 12. Claude への依頼文

以下をそのまま投げてよいです。

```md
`plans/2026-03-27-claude-plan-creative-review-and-nano-banana2.md` を読んで、この計画に沿って実装してください。

背景:
- `AI考察` の mixed-format / markdown renderer 改善は別 workstream で進行済み
- 今回の主目的は `CreativeReview` を本当に使える状態へ戻すこと

絶対条件:
1. バナー生成モデルは **必ず** `gemini-3.1-flash-image-preview`
2. `gemini-2.0-flash-preview-image-generation` は採用しない
3. `asset_id` は user 手入力ではなく upload 結果として内部保持する
4. review と generation は同じ Gemini API キー（BYOK）を使う

実装したいフロー:
1. 画像アップロード
2. `asset_id` 取得
3. `POST /api/reviews/banner` でレビュー
4. review の `run_id` 取得
5. `POST /api/generation/banner` で Nano Banana2 生成
6. poll して生成画像を表示・ダウンロード

参照 repo:
- `tmp_market_lens_ai_repo`

必ず確認する契約:
- `POST /api/assets`
- `POST /api/reviews/banner`
- `POST /api/reviews/ad-lp`
- `POST /api/generation/banner`
- `GET /api/generation/{gen_id}`
- `GET /api/generation/{gen_id}/image`

タスク量が多いので、必要なら agent team で
- frontend API/state
- CreativeReview UI
- Market Lens config 3.1統一
- QA
を並列で進めてください。
```

---

## 13. 一言まとめ

今回の本質は「CreativeReview を再開する」ではなく、**upload -> asset_id -> review_run_id -> generation** という正しい資産連鎖を frontend に実装することです。  
そして、その生成モデルは **Nano Banana2 = `gemini-3.1-flash-image-preview` に固定**します。2.0 を残したまま進めると、また途中で前提が崩れます。
