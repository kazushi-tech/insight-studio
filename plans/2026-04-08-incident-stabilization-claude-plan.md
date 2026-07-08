# Incident Stabilization Plan for Claude

## Title

Insight Studio 本番障害対応プラン

対象症状:
- `競合発見` が 10 分以上進行し続ける、または明確に失敗へ遷移しない
- `Creative Review` の `広告 + LP 統合レビュー` が本番で `502` を返す
- ユーザー体感として「修正のたびに悪化している」と認識されている

作成日: `2026-04-08`

---

## 0. このプランの目的

この文書は、Claude にそのまま渡して調査・修正を進めさせるための実行計画である。

重要なのは「速い修正」ではなく、以下を満たすこと:

1. まず事実を確定する
2. rollback すべきなら先に rollback する
3. frontend 起因と backend 起因を混同しない
4. 追加デプロイは、検証条件を満たしたものだけに絞る

---

## 1. 現時点で確定している事実

### 1-1. 現在の frontend 直近デプロイ

- 現在の `insight-studio` HEAD: `e24c9ac96f4919fe777e16da031736f5574dcb5e`
- 直前のコミット: `b43693cd7172585279fa5c570c9ffaf1fcb91dc8`
- 本番 URL: `https://insight-studio-chi.vercel.app`

### 1-2. 現在の backend 生存確認

- `GET https://market-lens-ai.onrender.com/api/health` は `200`
- 応答本文:
  - `{"ok":true,"service":"market-lens","commit":"9a8fe4f4de2255a63592eff4a74333c983d17e67"}`

これは「backend プロセスが生きている」ことしか意味しない。
`/api/reviews/ad-lp` や `/api/discovery/jobs/*` が正常とは限らない。

### 1-3. ブラウザで観測された本番症状

- `Creative Review` の `広告 + LP 統合レビュー` 実行時に、DevTools 上で
  - `POST https://market-lens-ai.onrender.com/api/reviews/ad-lp`
  - が繰り返し `502` を返している
- `競合発見` は UI 上で長時間 `バックグラウンド実行中` のまま進行している

### 1-4. コード上で確認できる関連点

#### frontend

- `src/api/marketLens.js`
  - `scan`
  - `startDiscoveryJob`
  - `getDiscoveryJob`
  - `reviewBanner`
  - `reviewAdLp`
  が direct backend 優先で投げるようになっている
- `src/pages/Discovery.jsx`
  - クライアント側の絶対タイムアウトは `5 分`

#### backend

- `tmp_market_lens_ai_repo/web/app/routers/review_routes.py`
  - `POST /api/reviews/ad-lp`
  - `RuntimeError` を `502` に変換している
- `tmp_market_lens_ai_repo/web/app/routers/discovery_routes.py`
  - discovery job は非同期ジョブ
  - default timeout:
    - `DISCOVERY_SEARCH_TIMEOUT_SEC = 90`
    - `DISCOVERY_ANALYZE_TIMEOUT_SEC = 150`
  - poll response は `retry_after_sec` / `progress_pct` / `stage` を返す

---

## 2. Claude への最重要ルール

Claude は以下を必ず守ること。

1. 推測で直さない
2. まず `frontend rollback が必要か` を判定する
3. `Creative Review 502` と `Discovery 長時間ハング` を別トラックで扱う
4. 修正前に「どのログ / どのレスポンス / どの commit 差分」が根拠かを明示する
5. 検証が通るまで本番再デプロイしない
6. ユーザー体感を悪化させる長時間リトライや silent retry は増やさない

---

## 3. まず最初にやること: rollback 判定

### 3-1. 判定対象

`e24c9ac` で入った frontend 変更が、症状を悪化させたかを最初に判定する。

比較対象:
- `b43693c` = 直前
- `e24c9ac` = 現在本番

### 3-2. 重点確認ポイント

- `src/api/marketLens.js`
  - direct backend 優先化
  - optimistic direct
  - proxy fallback 条件
- `src/api/adsInsights.js`
  - 同種の direct strategy 変更
- `src/pages/Discovery.jsx`
  - poll 初回間隔
  - timeout / stale 状態の扱い

### 3-3. rollback 判断基準

以下のどれかに当てはまれば、frontend rollback を最優先する。

1. `e24c9ac` 以降に `Creative Review` が proxy 経由ではなく direct backend へ張り付き、結果として `502` を露出させるようになった
2. `Discovery` の poll が terminal state を拾えず、running を維持し続ける回帰が `e24c9ac` 以降で再現する
3. `b43693c` に戻すと少なくとも症状が軽減することが確認できる

### 3-4. rollback しない条件

以下が確認できた場合に限り、rollback せず原因を backend 側へ進める。

1. `b43693c` でも `POST /api/reviews/ad-lp` が direct にせよ proxy にせよ同様に `502`
2. `Discovery` の長時間 running が frontend 変更とは独立して backend job persistence 側で再現

---

## 4. Track A: Creative Review 502 の潰し込み

### 4-1. ゴール

- `広告 + LP 統合レビュー` が `60 秒以内` に
  - `200` 成功
  - もしくは明確な失敗理由付き `4xx/5xx`
  のどちらかへ必ず到達する
- 同一リクエストで `502` を無意味に連打しない

### 4-2. まず切るべき仮説

1. LP fetch 失敗が `RuntimeError -> 502` へ雑に変換されている
2. Claude 呼び出し失敗が `Review provider error` としてしか見えていない
3. direct backend 優先化で、proxy 側の吸収していた失敗が露出しただけ
4. review route 自体は正しいが、`ad_lp_fit_service.py` 内部で timeout / parse / fetch error を RuntimeError 化している

### 4-3. Claude が確認すべきファイル

- `tmp_market_lens_ai_repo/web/app/routers/review_routes.py`
- `tmp_market_lens_ai_repo/web/app/services/review/ad_lp_fit_service.py`
- `tmp_market_lens_ai_repo/web/app/services/review/banner_review_service.py`
- `tmp_market_lens_ai_repo/tests/test_review_routes.py`
- `src/api/marketLens.js`
- `src/pages/CreativeReview.jsx`

### 4-4. やるべきこと

1. `review_ad_lp_fit()` の例外分類を確認する
2. `RuntimeError` を投げている箇所を洗い出す
3. fetch failure / LP parse failure / provider timeout / schema validation failure を別々にログ出しする
4. `502` を返す前に、原因粒度が UI で読める detail を返す
5. deterministic な失敗に対する frontend auto retry を抑制する
6. `LP URL` が原因なら `422/424` 寄りに落とすべきか検討する

### 4-5. 成功判定

- 実 URL で `POST /api/reviews/ad-lp` が成功する
- 失敗する場合も detail が「provider 失敗 / LP fetch 失敗 / parse 失敗」のどれかに分かれる
- frontend 側で 502 の連続リクエストが消える

---

## 5. Track B: Discovery が 10 分以上止まる件の潰し込み

### 5-1. ゴール

- discovery job が `running` のまま放置されない
- 正常なら `60 秒以内` に完了を目指す
- 60 秒で終わらないケースでも、少なくとも `90 秒以内` に
  - 完了
  - もしくは明示的失敗
  のどちらかへ必ず遷移させる

### 5-2. まず切るべき仮説

1. backend job task が死んでいるのに record が `running` のまま残っている
2. `job_repo.save_job()` が失敗し、stage 更新が止まっている
3. `on_stage` は進んでいるが、frontend poll が stale state しか取れていない
4. `Discovery.jsx` の timeout guard が UI 上の継続表示と整合していない
5. search / analyze timeout は動いているが、terminal failure persist が抜けている
6. visibility change / navigation / persisted run の扱いで UI だけが「動いているように見える」

### 5-3. Claude が確認すべきファイル

- `tmp_market_lens_ai_repo/web/app/routers/discovery_routes.py`
- `tmp_market_lens_ai_repo/web/app/services/discovery/discovery_pipeline.py`
- `tmp_market_lens_ai_repo/web/app/repositories/discovery_job_repository.py`
- `tmp_market_lens_ai_repo/web/app/repositories/file_discovery_job_repository.py`
- `tmp_market_lens_ai_repo/web/app/schemas/discovery_job.py`
- `tmp_market_lens_ai_repo/tests/test_discovery_jobs.py`
- `tmp_market_lens_ai_repo/tests/test_discovery_routes.py`
- `src/pages/Discovery.jsx`
- `src/api/marketLens.js`

### 5-4. やるべきこと

1. `POST /api/discovery/jobs` から `GET /api/discovery/jobs/{id}` までをローカルで再現する
2. stage ごとの `updated_at` 更新を確認する
3. task 例外時に必ず `failed` が永続化されるか確認する
4. stale `running` job を fail へ切り替える safety valve を入れる
5. poll response に `last_updated_at` / `elapsed_ms` が必要なら追加する
6. frontend 側で `stage` が変わらず `updated_at` も動かない場合は stale とみなして fail 表示にする
7. `retry_after_sec` が長すぎて UI が止まって見えるなら見直す

### 5-5. 成功判定

- 実 URL で discovery job が terminal state へ確実に落ちる
- `10 分以上 running` の再現が消える
- ユーザーには「どの stage で止まったか」が分かる

---

## 6. frontend 側の扱い方針

frontend は「backend の本当の失敗を隠す」方向には振らないこと。

やるべきことは以下に限定する。

1. rollback が必要なら rollback
2. deterministic failure に対する無意味な retry を止める
3. stale running を UI でも fail に寄せる
4. stage / elapsed / last update を見せる
5. `1 分以内に終わらないなら fail-fast にする` というユーザー期待に寄せる

やってはいけないこと:

1. spinner を長く見せるだけの UX 調整
2. backend failure を silent retry で隠す
3. 「health が 200 だから大丈夫」という判断

---

## 7. backend 側の扱い方針

backend では「原因別に失敗を分解して返す」ことを最優先する。

優先順位:

1. terminal state が保存されない問題を直す
2. 502 の原因粒度を上げる
3. timeout budget を調整する
4. 必要なら fail-fast 化する

特に discovery は、速く終わらせるより先に「止まり続けない」ことを保証する。

---

## 8. Claude が最初に出すべき成果物

Claude はいきなり修正を始めず、最初に次の 4 点を報告すること。

1. `e24c9ac` と `b43693c` の差分要約
2. rollback 要否の判断
3. `Creative Review 502` の第一原因候補
4. `Discovery running 固着` の第一原因候補

この 4 点が曖昧なら、まだコードを書いてはいけない。

---

## 9. 実装順序

1. rollback 判定
2. `Creative Review 502` の再現と原因確定
3. `Discovery` の stale running 原因確定
4. backend の terminal state / error detail 修正
5. frontend の retry / stale handling 修正
6. ローカル再現試験
7. 必要なら staging / preview で再確認
8. 本番デプロイ

---

## 10. 検証条件

### Creative Review

最低限、以下を満たすこと。

- `広告 + LP 統合レビュー` が result か terminal error へ遷移する
- 同一クリックで `502` が連打されない
- UI の滞留時間が意味なく伸びない

### Discovery

最低限、以下を満たすこと。

- `running` のまま放置されない
- `failed` になるなら stage 付きで落ちる
- stale job を UI / API のどちらかで検知できる

### 共通

- `npm run build`
- 修正した領域の lint
- 可能なら backend 該当 pytest
- before / after の所要時間または terminal error までの時間

---

## 11. Claude に禁止する進め方

1. frontend だけ直して backend を見ない
2. backend だけ直して rollback 判定を飛ばす
3. 症状を再現せずに「たぶんこれ」と直す
4. 本番 deploy を 2 回以上連続で打って様子を見る
5. エラー detail を隠して generic message に戻す

---

## 12. Claude への最終指示文

以下をそのまま Claude に渡してよい。

```text
Insight Studio 本番障害対応です。

症状は 2 本あります。
1. Discovery が 10 分以上 running のまま止まる
2. Creative Review の ad-lp review が本番で 502

まず修正に入らず、以下を順番にやってください。

1. frontend commit e24c9ac と直前 b43693c を比較し、rollback が必要か判断する
2. Creative Review 502 の原因を backend / frontend の両方から確定する
3. Discovery running 固着の原因を backend job persistence / frontend stale state の両方から確定する
4. それぞれについて、最小で可逆な修正案を出す
5. 修正後に build / lint / 関連テスト / 再現確認を行う

重要:
- 推測で直さない
- rollback が必要なら先に rollback
- 502 の原因粒度を上げる
- Discovery は「速くする」前に「止まり続けない」ことを保証する
- 本番 deploy は検証条件を満たした 1 回だけ

最初の返答では、必ず以下を出してください。
- 差分要約
- rollback 要否
- Creative Review 502 の第一原因候補
- Discovery 固着の第一原因候補
```

