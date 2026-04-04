# Handoff: Phase 2 Frontend Complete / Backend Deploy Complete / Creative Review Validated / Discovery Follow-up Pending (2026-04-04)

## セッション要約

2026-04-04 の後続セッションで、`Phase 2 frontend` の確認、`Creative Review` の再訪時保持の微修正、backend 別トラックの調査、backend deploy、post-deploy smoke、さらに実キーを使った `Creative Review` 正常系 browser UI smoke まで進んだ。

現時点の結論は以下。

1. `Phase 2 frontend` は実ブラウザ smoke で合格
2. `Creative Review` の失敗後 state 保持は、SPA 再訪問まで含めて成立
3. local browser の `127.0.0.1` 系 CORS 問題は backend deploy で解消済み
4. `Discovery` の generic 500 は backend 側で stage-aware error に変換できるようになった
5. `Discovery` に残る不安定要因は code bug ではなく、Render outbound / provider 側の intermittent SSL・load 問題
6. `Creative Review` の `422 Could not process image` は mime/binary mismatch 対策で解消済み
7. `Creative Review review は Claude / generation は Gemini` という仕様は維持されている
8. 追加で backend の `review_routes.py` に error handling gap 修正を deploy 済み
9. `Creative Review` 正常系は browser UI で `Banner Review / Ad-LP Review / Generation` の 3 ケース通過済み
10. 現時点の主残課題は `Discovery` の intermittent infra/provider track と、軽微な test data / cosmetic 整理だけ

この handoff は `plans/handoff-2026-04-04-phase2.md` の続きであり、以後はこちらを優先参照するとよい。

---

## 1. 最初に読むべきファイル

次セッションで最初に読むべきファイル:

- `plans/handoff-2026-04-04-postdeploy.md` ← この handoff
- `plans/handoff-2026-04-04-phase2.md`
- `plans/2026-04-03-stability-hardening-plan.md`
- `plans/2026-04-03-baseline-smoke-scenarios.md`
- `plans/backend-investigation-2026-04-04.md`
- `src/pages/CreativeReview.jsx`
- `src/contexts/AuthContext.jsx`
- `tmp_market_lens_ai_repo/web/app/routers/review_routes.py`
- `tmp_market_lens_ai_repo/web/app/routers/discovery_routes.py`
- `tmp_market_lens_ai_repo/web/app/llm_client.py`

補助 artifact / smoke 系:

- `scripts/provision_smoke_profile.mjs`
- `scripts/phase2-smoke.mjs`
- `scripts/phase2-smoke-v2.mjs`
- `scripts/phase2-smoke-final.mjs`
- `smoke-manifest.json`

---

## 2. Frontend 側で完了したこと

### 2-A. Phase 2 frontend 実装

Claude 実装として以下が入っている。

- `src/api/marketLens.js`
  - `classifyError()` を追加
  - error を UI 用 category に分類
- `src/components/ui.jsx`
  - `ErrorBanner` を category-aware に変更
  - style / icon / guidance / retryable を category 別に表示
- `src/contexts/AnalysisRunsContext.jsx`
  - `failRun(kind, error, errorInfo)` で `errorInfo` を保存
- `src/pages/Compare.jsx`
  - category-aware error 表示
  - empty report 表示を generic error と分離
- `src/pages/Discovery.jsx`
  - category-aware error 表示
  - `stage=` marker を label に反映
- `src/pages/CreativeReview.jsx`
  - review/generation 失敗後の state 保持
  - category-aware error 表示
- `src/pages/AiExplorer.jsx`
  - `unavailable / cold_start / error / empty` を分離

### 2-B. Codex 側で追加した `Creative Review` 再訪時保持修正

当初の Phase 2 実装では、`src/pages/CreativeReview.jsx` で mount 時に failed run を無条件で `phase='error'` に戻していたため、SPA 再訪問時に `uploaded` / `reviewed` state が崩れる余地があった。

Codex 側で以下を反映済み。

- `src/pages/CreativeReview.jsx`
  - failed run 復元時も `phase` 自体は壊さない
  - review 失敗後は `uploaded` を維持
  - generation 失敗後は `reviewed` を維持
  - mount/revisit 時は error banner だけ復元

現コード上の確認ポイント:

- `persistedErrorState` で failed run の banner 復元
- `setPhase('uploaded')` / `setPhase('reviewed')` が失敗時 fallback として残っている
- `errorMessage && <ErrorBanner ...>` で phase 非依存のエラー表示

### 2-C. Frontend build

`npm run build` は Codex 側でも成功確認済み。

既知 warning:

- `@theme` warning
- chunk size warning

どちらも今回の修正起因ではない。

---

## 3. Frontend smoke の結果

Claude report による focused smoke 結果:

1. `Compare — エラー分類表示`: PASS
2. `Discovery — ステージ認識エラー`: PASS
3. `CreativeReview — 状態保持(失敗後)`: PASS
4. `CreativeReview — SPA再訪問`: PASS
5. `AiExplorer — ML状態分化`: PASS
6. `AiExplorer — 総合動作`: PASS

重要な確認済み事項:

- `Compare`
  - generic transport error に潰れず category-aware 表示
  - empty report が専用表示
- `Discovery`
  - backend error が generic network error に潰れない
  - `stage` があれば UI label に反映可能
- `CreativeReview`
  - 失敗後に画像・brand info・LP URL・operator memo が残る
  - SPA 再訪問でも review result / asset state が復元される
- `AiExplorer`
  - `unavailable / cold_start / error / empty` の区別が成立

---

## 4. Backend 調査と local patch

Claude が backend local copy (`tmp_market_lens_ai_repo`) で調査・修正した内容は `plans/backend-investigation-2026-04-04.md` に記録済み。

### 4-A. 修正された backend ファイル

- `tmp_market_lens_ai_repo/web/app/main.py`
  - `_default_origins` に `http://127.0.0.1:3002`
  - `_default_origins` に `http://127.0.0.1:3004`
- `tmp_market_lens_ai_repo/web/app/routers/discovery_routes.py`
  - search step に catch-all `except Exception`
  - `_fetch_one()` に catch-all `except Exception`
  - `(stage=search)` 契約を追加
- `tmp_market_lens_ai_repo/web/app/services/intake/asset_upload_service.py`
  - magic bytes による MIME type 自動補正
- `tmp_market_lens_ai_repo/web/app/services/review/banner_review_service.py`
  - 画像処理エラー時の silent fallback を廃止
  - mime/asset 情報付きの明示的エラーへ

### 4-B. その後の追加 backend 修正

後続セッションで、`Creative Review` の review endpoint が `ValueError` / `RuntimeError` を generic `500` に落としていた gap も修正済み。

対象:

- `tmp_market_lens_ai_repo/web/app/routers/review_routes.py`

変更概要:

- `/api/reviews/banner`
- `/api/reviews/ad-lp`

で以下を HTTPException に変換するよう追加。

- `ValueError` → `400`
- `RuntimeError` → `502`

既存契約は維持:

- `AssetNotFoundError` → `404`
- `BannerReviewError` / `AdLpReviewError` → `422`

---

## 5. Backend deploy と post-deploy smoke

以下は Claude report ベース。Codex はこのチャットで GitHub/Render を再照会していないため、必要なら backend repo 側で再確認すること。

### 5-A. deploy 情報（Claude report）

- backend repo: `kazushi-tech/market-lens-ai`
- deploy 済み commit:
  - `458d944`
  - 先行 `555405d`
- push 範囲:
  - `bbfb2ef..458d944 -> origin/main`
- 後続小修正:
  - `e3e9890`
- Render:
  - auto-deploy 完了
  - health endpoint で確認済みとの報告

### 5-B. post-deploy smoke 結果（Claude report）

#### CORS

以下は `200 OK` で確認済みとの報告。

- `OPTIONS /api/health` from `http://127.0.0.1:3002`
- `OPTIONS /api/health` from `http://127.0.0.1:3004`
- `OPTIONS /api/scan`
- `OPTIONS /api/discovery/analyze`
- `OPTIONS /api/reviews/banner`

結論:

- `127.0.0.1` 起因の CORS 問題は解消済み

#### Discovery

確認内容:

- `stage=search` marker 付き error 返却を確認
- 以前の generic `500 Internal server error (SSLError)` はそのまま露出しなくなり、stage-aware な error contract へ改善

後続の事実確認では以下も判明。

- `401 stage=search` は継続障害ではなく、その後解消済み
- 1回目:
  - `502` SSL 一時エラー (`WRONG_VERSION_NUMBER`)
- 2回目:
  - `search` 通過
  - `stage=analyze` で Gemini `503`

現時点の理解:

- `Discovery` の主残課題は code bug ではない
- Render outbound / provider 側の intermittent SSL / load 問題
- `GEMINI_API_KEY` 自体は Render に設定済みと推定

#### Creative Review

確認されたこと:

- `guide asset (.png 実体 JPEG)` を upload しても backend 側で `image/jpeg` に自動補正される
- mime mismatch 起因の `422 Could not process image` は解消
- 修正前に upload 済みの asset は再 upload が必要

追加確認:

- `review_routes.py` 修正後
  - Claude key なし → `400`
  - 無効な Claude key → `502`
  - 正常な Claude key → browser UI 正常系 smoke で確認済み

### 5-C. Creative Review browser UI 正常系 smoke（Claude report）

実キーを使った browser UI 実測で、以下 3 ケースが通過済み。

1. `Banner Review`
   - 画面: `/creative-review`
   - 操作: `728x90 PNG` を upload して `バナーレビューを実行`
   - API: `POST /api/ml/assets → 201`, `POST /api/ml/reviews/banner → 200`
   - UI: review result と `run_id` 表示を確認
2. `Ad-LP Review`
   - 画面: `/creative-review`
   - 操作: 画像 upload + `https://www.google.com` を入力して `広告+LP統合レビューを実行`
   - API: `POST /api/ml/assets → 201`, `POST /api/ml/reviews/ad-lp → 200`
   - UI: review result と `run_id` 表示を確認
3. `Generation`
   - 前提: `Ad-LP Review` 成功直後の同一画面
   - 操作: `改善バナーを試作（任意 / Experimental）`
   - API: `POST /api/ml/generation/banner → 200`
   - UI: 生成バナー表示を確認

補足:

- 上記 3 ケースでは generic `500` / transport error は発生していない
- `https://example.com/lp` は backend の SSL 証明書検証で `422` になり得るため、smoke 用 LP URL としては不適
- この `422` は test data 依存であり、今回の frontend / backend 修正の未解決バグとは扱わない

---

## 6. 仕様・契約として確定してよいこと

### 6-A. Creative Review の key/provider 契約

ここは途中で混乱があったが、最終的に以下で確定。

- review:
  - `Claude`
- generation:
  - `Gemini`

根拠ファイル:

- `src/contexts/AuthContext.jsx`
  - `analysisKey = claudeKey`
  - `analysisProvider = anthropic`
- `src/pages/CreativeReview.jsx`
  - review 系は `analysisKey` + `analysisProvider`
  - generation 系は `geminiKey`
- `tmp_market_lens_ai_repo/web/app/llm_client.py`
  - `provider='anthropic'` なら `call_anthropic_multimodal`
  - `provider='google'` なら `call_gemini_multimodal`

つまり、

- `Creative Review review は Gemini key が必要`

という前回の一時的な報告は誤りで、仕様変更は不要。

### 6-B. Discovery の stage-aware error 契約

backend は `detail` 内に `(stage=search)` 等の marker を含められる。

frontend 側は:

- `src/api/marketLens.js`
  - `extractStage()`
- `src/pages/Discovery.jsx`
  - `errorInfo.label` に `（stage）` を追記

で反映できる。

### 6-C. full reload と SPA revisit

- SPA revisit:
  - `AnalysisRunsContext` の run store により state 復元可
- full page reload:
  - in-memory store のため state は消える

これは現仕様通り。

---

## 7. 現時点で残っている課題

### P0: Discovery の intermittent infra/provider track

現時点の扱い:

- code bug としては一旦閉じてよい
- 別トラックで運用/インフラ課題として管理

見るべきもの:

- Render outbound TLS/SSL
- CA 証明書
- `trust_env=False` の影響
- Gemini API 側の高負荷 / 503

### P1: guide asset の cosmetic fix

`public/guide/page5-creative.png` は実体が JPEG。

実害:

- backend 側 magic bytes 修正により、review pipeline には実害なし

残課題:

- ファイル名/拡張子の cosmetic 整理を別タスク化してよい

### P2: smoke test data の固定

- `Ad-LP Review` は `https://www.google.com` で正常通過した
- `https://example.com/lp` は backend の SSL 証明書検証で `422` になり得る
- 次回以降の再現性のため、smoke 用 LP URL は安定 URL を固定したほうがよい

---

## 8. 次セッションでそのままやるべきこと

最も自然な次の一手:

1. `Creative Review` 正常系 3 ケース通過を前提に、この安定化トラックを close 候補として整理
2. `Discovery` intermittent SSL / provider load を infra/provider ticket に切り出す
3. `insight-studio` 側の docs/tooling/artifact を棚卸しして commit 対象を分離する
4. 必要なら `public/guide/page5-creative.png` の cosmetic 修正を別タスク化する

### Claude に渡す最小プロンプト要旨

次のチャットで短く伝えるなら以下で十分。

- `Creative Review` 正常系は browser UI で `Banner Review / Ad-LP Review / Generation` まで通過済み
- 次は `Discovery` intermittent SSL / provider load を別トラックで切り出す
- `insight-studio` 側では docs/tooling/artifact の commit 対象整理を進める
- secret は出さない
- 失敗時は frontend / backend / provider / test data の切り分けを明示

---

## 9. 作業ツリー・ローカル状態メモ

### main repo (`insight-studio`)

この handoff 作成時点で、main repo には以下のような未整理ファイルがある。

- tracked change:
  - `.gitignore`
  - `plans/2026-04-03-baseline-smoke-scenarios.md`
- untracked:
  - `plans/2026-04-03-stability-hardening-plan.md`
  - `plans/backend-investigation-2026-04-04.md`
  - `plans/handoff-2026-04-04-phase2.md`
  - `plans/handoff-2026-04-04-postdeploy.md`
  - `scripts/phase2-smoke*.mjs`
  - `scripts/provision_smoke_profile.mjs`
  - `smoke-manifest.json`
  - 多数の補助 `plans/*.md`
  - 他 artifact / local-only file

注意:

- user/Claude が作った未整理ファイルが多い
- これらを次セッションで勝手に削除しないこと
- 必要なら明示的に棚卸しする
- 現在の worktree 上では `src/` 配下の製品コード差分は見えておらず、pending は主に docs/tooling/artifact の整理である

### backend local copy (`tmp_market_lens_ai_repo`)

この handoff 作成時点で、local copy は dirty のまま。

主な変更ファイル:

- `web/app/main.py`
- `web/app/routers/discovery_routes.py`
- `web/app/routers/review_routes.py`
- `web/app/services/intake/asset_upload_service.py`
- `web/app/services/review/banner_review_service.py`

注意:

- すでに deploy 済みという報告はあるが、local copy の dirty state をそのまま信用せず、必要なら backend repo で commit/log を確認すること

---

## 10. セキュリティ / secret メモ

- `.env` に `CLAUDE_API_KEY` / `GEMINI_API_KEY` が入っている
- 次セッションの UI smoke では `.env` を読む前提でよい
- key の実値をログ、plan、handoff、screenshot、report に出さないこと
- smoke artifact に key を残さないこと

---

## 11. 最終判断

### いまクローズしてよいもの

- `Phase 2 frontend`
- local `127.0.0.1` CORS 問題
- mime mismatch 起因の `Creative Review 422`
- `Creative Review` の failed-state 保持
- `review_routes.py` の generic `500` gap
- `Creative Review` 正常系の browser UI 実測
- `Creative Review` 生成正常系の browser UI 実測

### まだ完全クローズではないもの

- `Discovery` の intermittent SSL / provider load 問題
- `example.com/lp` のような不安定 test data の整理
- `guide asset` のファイル名/拡張子 cosmetic fix

### 次チャットで最初にやること

- `Discovery` intermittent issue を infra/provider ticket に切り出す
- `insight-studio` の commit 対象を docs/tooling/artifact 単位で整理する
