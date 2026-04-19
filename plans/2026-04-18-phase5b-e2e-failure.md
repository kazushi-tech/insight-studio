# Phase 5B 実データ E2E — Gate FAIL 報告

**実行日時**: 2026-04-19 09:00 JST
**実行者**: Claude (Opus 4.7, Auto mode)
**ベースコミット**: `4143319` (PR #42 マージ済、master pull 後)
**対応プラン**: [plans/2026-04-18-phase5b-e2e-exec-and-5c-handoff.md](2026-04-18-phase5b-e2e-exec-and-5c-handoff.md)
**成果物**: [verify_output/phase5b/summary.json](../verify_output/phase5b/summary.json)（gitignored）

---

## 1. 結論

**Gate: FAIL**。4 パターンのうち G（v1 baseline）のみ false-positive で PASS、H / I / J（v2 実描画検証）は全て `ui-v2 root not found` 系 finding で失敗した。

**Phase 5C（`useUiVersion.DEFAULT='v1'→'v2'`）は実施保留** とする（プラン §3-4 の指示に従い、Gate 通過後の次セッション送り）。

---

## 2. 4 パターン判定表

| # | URL | passed | 主 finding |
|---|---|---|---|
| G | `/discovery?search_id=a03bc0f98cfa&ui=v1` | ✅ PASS | (v1 は `.ui-v2` 非存在のみチェック — 実際は Discovery 入力フォーム表示) |
| H | `/discovery?search_id=a03bc0f98cfa&ui=v2` | ❌ FAIL | `ui-v2 root not found` + v2 5 コンポーネント全 absent |
| I | `/compare?search_id=a03bc0f98cfa&ui=v2` | ❌ FAIL | 同上 |
| J | `/discovery?search_id=a03bc0f98cfa&ui=v2` (envelope forced null) | ❌ FAIL | 同上（MD fallback も発動せず） |

console / pageerror / failed request はいずれもゼロ。DOM に `div.ui-v2` が出現しない（= `ReportViewV2` が mount されない）ことのみが失敗要因じゃ。

---

## 3. 根本原因分析（プラン §4-1 failure class に沿う）

### 3-1. 真の原因: `ReportViewV2` は完了済ジョブが store にある時のみ mount される

[src/pages/Discovery.jsx:971](../src/pages/Discovery.jsx#L971):

```jsx
{isUiV2 ? (
  <ReportViewV2 envelope={discoveryEnvelope} reportMd={result.report_md} />
) : ( ... v1 ... )}
```

この `isUiV2` 分岐は `result` が非 null の時（= `useAnalysisRuns` の store に `run.result` が入っている時）しか到達しない。Compare も同様（[src/pages/Compare.jsx:724](../src/pages/Compare.jsx#L724)）。

### 3-2. 派生原因: harness の URL 設計

`search_id` クエリパラメータは **Discovery.jsx / Compare.jsx どちらも読まない**。どちらのページも `useAnalysisRuns` コンテキストから `run.result` を読むのみで、URL 由来の `search_id` から store を復元する経路は未実装じゃ。

つまり `/discovery?search_id=X&ui=v2` で外部リンクを踏んでも、v2 描画は始まらぬ。harness の前提（「search_id 渡せば v2 が描画される」）が成り立たない構造じゃった。

### 3-3. 副次的問題（PR #42 harness のバグ、本 PR で修正済）

PR #42 で導入された harness に以下 3 点の誤りを発見。本 PR で修正した：

| 箇所 | 修正前 | 修正後 | 影響 |
|---|---|---|---|
| URL path | `/discovery/result`, `/compare/result` | `/discovery`, `/compare` | 存在しないルートで catch-all (`*→/`) に落ちておった |
| auth key | `auth_token` | `is_ads_token` + `is_user` (Phase 5A と一致) | AuthGuard 突破不可 → `/login` へ redirect |
| MD fallback intercept path | `**/api/ml/discovery/*/report-envelope` | `**/api/ml/discovery/jobs/*/report.json` | 実際の envelope endpoint と不一致のため Pattern J 無効化 |

修正後も H / I / J が落ちる理由は §3-1, §3-2。

---

## 4. スクリーンショット所見

- G / H / I / J の `verify_output/phase5b/*.png`: いずれも Discovery 入力フォームもしくはガイドオーバーレイ状態で、ReportViewV2 は一切 mount されておらぬ
- `H_discovery_v2.png`: 「Insight Studio ガイド」モーダル（初回訪問 onboarding）で占められており、背後に入力フォームが見える
- v2 root `<div class="ui-v2">` は DOM 全体を検索しても 0 個

---

## 5. 次に進むための選択肢

以下のいずれかを取れば Phase 5B E2E は完遂できる：

### 選択肢 A（推奨）: staging の完了済ジョブで staging 環境に対して harness を回す
- staging DB（Render）の `data/discovery_jobs/` 配下に完了済ジョブあり（不二樹確認対象）
- `PHASE5B_BASE_URL=https://<vercel-preview>.vercel.app` に向けるか、`vite.config.js` の proxy target を Render に向けて走らせる
- `AUTH_TOKEN` に staging の `is_ads_token` を注入

### 選択肢 B: ローカルに完了済ジョブ固定フィクスチャを配置する
- `backends/market-lens-ai/data/discovery_jobs/<FIXTURE_ID>/{job.json,result.json}` を手書きで生成
- `report_md` は Section 5 テンプレートを含む最小 MD（`build_envelope_from_md` が parse できるよう）
- **課題**: それでも URL 由来で store 復元しないと Discovery ページは result を描画せぬ。`search_id` を起点に `run.result` を hydrate する薄い "resume" ロジックを Discovery / Compare に追加する必要あり（本来の想定 UX と整合するため、改修は機能追加相当）

### 選択肢 C: v2 を直接 render するテスト専用 route を追加する
- `/debug/report-v2?jobId=X` のようなデバッグ route を dev 環境限定で生やし、そこで `ReportViewV2` を単独 mount
- E2E harness 専用の隙間であり、運用コードの汚染にはならぬ
- 工数軽め、効果大

### 選択肢 D: 現状の `ReportViewV2.test.jsx` + Playwright empty-state で代替完了とする
- Phase 5A で empty-state + コンポーネント単体テストは通過済
- Phase 5C（v2 デフォルト昇格）の根拠としては**弱い**（PR #41 §8 で自認済）

---

## 6. 本 PR の範囲

| 成果物 | 内容 |
|---|---|
| [scripts/phase5b-verify.py](../scripts/phase5b-verify.py) | URL path / auth key / MD fallback intercept を正しい値に修正（§3-3） |
| [plans/2026-04-18-phase5b-e2e-failure.md](2026-04-18-phase5b-e2e-failure.md) | 本ドキュメント |
| [plans/2026-04-18-phase5b-verification-result.md](2026-04-18-phase5b-verification-result.md) | Phase 5B 実行結果セクションを追記 |

Phase 5C プラン起草は**行わない**（Gate FAIL のため、プラン §3-4 指示に従う）。

---

## 7. 不二樹向け提案

1. 選択肢 A または C のどちらに進むかを判断してほしい
2. 選択肢 A の場合: staging 完了ジョブの `search_id` と `is_ads_token` を共有してもらえれば、同一 harness で即再実行できる
3. 選択肢 C の場合: 別タスクとして debug route 追加を起票し、実装後に harness を再走させる

不二樹の判断を待つ。
