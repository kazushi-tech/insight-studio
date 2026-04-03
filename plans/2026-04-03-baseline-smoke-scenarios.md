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

## 9. 実施ログの記録テンプレート

各 smoke 実施時に最低限これを埋める。

| Date | Scenario | Result | Time | Failure Category | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-04-03 | Ads AI | 未計測 | - | - | Phase 0 文書固定のみ |
| 2026-04-03 | Compare | 未計測 | - | - | build 検証のみ実施 |
| 2026-04-03 | Discovery | 未計測 | - | - | build 検証のみ実施 |
| 2026-04-03 | Creative Review | 未計測 | - | - | build 検証のみ実施 |
| 2026-04-03 | Creative Generation | 未計測 | - | - | optional addon |

---

## 10. この baseline で固定する判断

- `Gemini 未設定` は `Creative Generation unavailable` を意味するだけで、core flow の失敗ではない
- `Creative Review` の baseline は review only を core として扱う
- `Ads AI` は `Claude key + Ads auth + setup` が揃って初めて ready とみなす
- Phase 2 以降の state/error 再設計は、この baseline を起点に評価する
