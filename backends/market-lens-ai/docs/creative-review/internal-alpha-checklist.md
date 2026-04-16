# Internal Alpha Acceptance Checklist

## 目的

Pack A (Internal Alpha) の出口判定チェックリスト。
required items が Pass になり、explicit defer 項目が truthfully documented された時点で alpha formal-complete とする。

---

## Verification Method Legend

- **(A)** = Playwright browser automation verified (2026-03-22)
- **(T)** = pytest / TestClient verified
- **(H)** = Human-only (not yet done)
- **(B)** = Environment-dependent (local verification blocked; may be explicitly deferred by exit decision)

---

## 1. 機能フロー確認

### 1.1 バナーアップロード

- [x] PNG/JPG/GIF/WebP 画像をドラッグ＆ドロップでアップロードできる **(A)** CR-2
- [x] ファイル選択ダイアログからアップロードできる **(A)** CR-3
- [x] アップロード後にプレビュー画像が表示される **(A)** CR-2/CR-3 screenshots
- [x] 10MB 超のファイルがエラーになる **(T)** test_creative_asset_routes
- [x] 未対応 MIME タイプ（PDF 等）がエラーになる **(T)** test_creative_asset_routes
- [x] アップロード完了後に asset_id が返される **(A)** CR-4

### 1.2 バナーレビュー

- [x] アップロード済みバナーに対してレビューを実行できる **(A)** CR-5 (smoke mode)
- [x] レビュー結果が Good / Keep / Improve / Test / Evidence で表示される **(A)** CR-7
- [x] good_points が先頭に表示される **(A)** CR-7 screenshot
- [x] evidence が空でない **(T)** test_review_routes golden fixture
- [x] rubric_scores が含まれる **(T)** test_review_routes + strictness tests
- [x] 禁止表現（効果の断定等）が含まれない **(H)** machine precheck 12/12 CLEAN + human review confirmed (2026-03-23)

### 1.3 広告-LP 整合レビュー

- [x] LP URL を入力して ad-to-LP review を実行できる **(A)** CR-6 (smoke mode)
- [x] message match と mismatch が区別される **(T)** test_review_routes
- [x] LP 側の evidence と広告側の evidence が併記される **(T)** golden fixture

### 1.4 レビュープレビュー

- [x] operator が JSON ではなく読みやすい日本語で確認できる **(A)** CR-7 screenshot
- [x] Good / Keep / Improve / Test / Evidence の 5 セクションが表示される **(A)** CR-7
- [x] 各ポイントの理由と根拠が確認できる **(A)** CR-7 screenshot

### 1.5 One-Pager HTML 出力

- [x] レビュー結果から HTML one-pager をダウンロードできる **(A)** CR-8 (3162 bytes)
- [x] ダウンロードした HTML をブラウザで開くと正しく表示される **(T)** onepager render test
- [x] good_points / keep / improve / test_ideas / evidence が欠落しない **(T)** render test
- [x] 印刷時のレイアウトが崩れない（@media print 確認） **(H)** CSS rule present + human visual print preview confirmed on banner_06/09 (2026-03-23)

### 1.6 PDF 出力

- [ ] レビュー結果から PDF をダウンロードできる **(B)** WeasyPrint 未インストール
- [ ] PDF を開いて内容が正しく表示される **(B)** 同上
- [ ] 日本語フォントが文字化けしない **(B)** 同上
- [ ] client sendable な品質である（フォーマット崩れなし） **(B)** 同上

**注記**: 現在の Windows env では WeasyPrint/GTK3 依存により local verification 不能。Pack A exit decision では explicit defer として扱う。

---

## 2. 品質基準

### 2.1 レビュー品質（12 件サンプル）

- [x] 12 件の banner fixture に対して real Gemini review を実行 **(H)** 12/12 probed (8 PASS, 4 WARN, 0 ERROR, 2026-03-23)
- [x] human acceptance rate 70% 以上 (9/12 Pass) **(H)** 75% (9/12 Pass) — AI-assisted scoring, human approved (2026-03-23)
  - 採点基準: `docs/creative-review/human-review-scorecard.md`
- [x] good_points の適切性: 実際にバナーの良い点を捉えている **(H)** 軸平均 3.42/5 (2026-03-23)
- [x] improvements の行動可能性: 具体的なアクションが提示されている **(H)** 軸平均 4.08/5 (2026-03-23)
- [x] test_ideas の妥当性: AB テストとして実行可能な仮説がある **(H)** 軸平均 3.75/5 (2026-03-23)
- [x] evidence の根拠強度: 許可ソース以外を使っていない **(H)** 軸平均 3.75/5 + WARN 4件 ACCEPTED (2026-03-23)

**注記**: 当初目標は 20 件だが、現在の banner fixture は 12 件。12 件での計測に変更。

### 2.2 human-review-scorecard 記録

- [x] 各レビューの採点結果を `human-review-scorecard.md` に記録 **(H)** 12/12 scored (2026-03-23)
- [x] 不合格レビューについて改善ポイントを記録 **(H)** 3件 Fail の改善方向を記録済み (2026-03-23)

---

## 3. 既存 MVP 互換性

- [x] `/api/scan` エンドポイントが正常に動作する **(A)** SH-1 (smoke mode)
- [x] `/api/scans` 履歴取得が正常に動作する **(A)** SH-2
- [x] `/api/scans/{id}` 詳細取得が正常に動作する **(A)** SH-3
- [x] `/api/scans/{id}` DELETE が正常に動作する **(A)** SH-3
- [x] `/api/health` が正常に動作する **(T)** test_api
- [x] テーマ切替（ライト/ダーク）が正常に動作する **(A)** SH-4
- [x] BYOK API キー入力が正常に動作する **(T)** test_api BYOK tests

---

## 4. テスト・ビルド

- [x] `pytest` 全テスト PASS — **306 passed, 7 warnings** (2026-03-23 再確認)
- [x] `npm run build` 成功 (2026-03-23 再確認)
- [x] セキュリティ: DOMPurify でのサニタイズが機能している **(T)** test suite
- [x] セキュリティ: SSRF 防御が維持されている **(T)** test_policies

---

## 5. エンドツーエンド確認

- [x] upload → review → preview → HTML export の一連フローが通る **(A)** CR-2→CR-5→CR-7→CR-8
- [ ] upload → review → preview → PDF export の一連フローが通る **(B)** WeasyPrint 未インストール
- [x] LP URL を入力した ad-to-LP review → preview → export が通る **(A)** CR-6→CR-7→CR-8

---

## 判定

| 区分 | 必須 Pass 数 | 実際 Pass 数 | 判定 |
|------|-------------|-------------|------|
| 機能フロー (1.1-1.5) | 18 | 18/18 | **GREEN** |
| 機能フロー (1.6 PDF disposition) | explicit defer documented | documented | **DEFERRED** (local env not verifiable, not Pack A engineering blocker) |
| 品質基準 | 70% acceptance | 75% (9/12 Pass) | **GREEN** |
| MVP 互換性 | 7 | 7/7 | **GREEN** |
| テスト・ビルド | 4 | 4/4 | **GREEN** |
| E2E (HTML) | 2 | 2/2 | **GREEN** |
| E2E (PDF disposition) | explicit defer documented | documented | **DEFERRED** (local env not verifiable, not Pack A engineering blocker) |

**最終判定**: **PACK A FORMAL-COMPLETE**
- Acceptance Rate: 75% (9/12 Pass) — 70% threshold MET
- WARN 4件: all ACCEPTED
- Prohibited-expression: CLEAR
- @media print: CONFIRMED
- PDF: EXPLICIT DEFER (env blocker, not Pack A blocker)

**判定日**: 2026-03-23

**判定者**: Human reviewer (AI-assisted scoring, human approved)

---

## Residual Summary (2026-03-23)

| Residual | Type | Status |
|----------|------|--------|
| Human acceptance scoring (12 reviews, 70%) | Human-only | **COMPLETE** — 75% (9/12 Pass), AI-assisted scoring human approved (2026-03-23) |
| PDF export (WeasyPrint) | Environment | DEFERRED (code complete, env blocker documented) |
| Real Gemini output quality | Human + API | 12/12 PROBED; 4 WARN all ACCEPTED (2026-03-23) |
| 禁止表現チェック | Human + machine | **CLEAR** — machine precheck + human review confirmed (2026-03-23) |
| @media print layout check | Human + machine | **CONFIRMED** — CSS rule present + human visual print preview (2026-03-23) |
