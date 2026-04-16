# Creative Review — Refactor Smoke Checklist

Frontend extraction (CR-R3) の完了確認用チェックリスト。

## Execution Record

| Field | Value |
|-------|-------|
| 実行日 | 2026-03-22 |
| 実行者 | Claude Browser Automation (Playwright) |
| 実行環境 | SMOKE_MODE=1 + Playwright headless Chromium |
| 制約 | Gemini / external fetch は smoke mode で fixture 置換。production path は未変更 |

## Build

- [x] `npx vite build` がエラーなく完了する
  - 証跡: `npm run build` => exit 0, `dist/index.html` + assets 生成
- [x] `dist/` に `index.html` と JS/CSS チャンクが生成される
  - 証跡: build output 確認済み

## Backend API Smoke (TestClient probe)

- [x] `GET /api/health` => 200
  - 証跡: `{'ok': True, 'service': 'market-lens'}`
- [x] `POST /api/reviews/banner` malformed asset_id => 422
  - 証跡: `asset_id="INVALID!!"` => 422 Unprocessable Entity
- [x] `POST /api/reviews/ad-lp` malformed asset_id => 422
  - 証跡: `asset_id="INVALID!!"` => 422 Unprocessable Entity
- [x] `POST /api/reviews/banner` valid-format missing asset => 404
  - 証跡: `asset_id="aaaaaaaaaaaa"` => 404 Not Found
- [x] `POST /api/reviews/ad-lp` valid-format missing asset => 404
  - 証跡: `asset_id="aaaaaaaaaaaa"` => 404 Not Found
- [x] `GET /api/reviews/{malformed}` => 422
  - 証跡: `GET /api/reviews/INVALID` => 422
- [x] `GET /api/reviews/{valid-format-missing}` => 404
  - 証跡: `GET /api/reviews/aaaaaaaaaaaa` => 404
- [x] `POST /api/exports/pdf` with incomplete body => 422 (Pydantic validation error)
  - 証跡: 不完全なリクエストボディを送信 => 422 Unprocessable Entity
- [x] `POST /api/exports/pdf` with valid body + WeasyPrint absent => 503 (PdfExportError)
  - 証跡: TestClient probe (test_valid_body_weasyprint_absent_returns_503) 確認済み (2026-03-22)

## Test Suite

- [x] `pytest -q` => 306 passed, 7 warnings (0 failed)
  - 証跡: 2026-03-22 browser automation takeover 後, 5.77s 実行
  - 内訳: 293 既存テスト + 13 smoke mode テスト

---

## Browser UI Smoke — Automated (Playwright)

Browser UI 12 項目は Playwright headless Chromium による自動実行に移行済み。
`SMOKE_MODE=1` で deterministic backend を使い、external dependency なしで再現可能。

### 実行コマンド

```powershell
# PowerShell Terminal 1: backend
$env:SMOKE_MODE = '1'
.\.venv\Scripts\python.exe -m uvicorn web.app.main:app --host 127.0.0.1 --port 8002

# PowerShell Terminal 2: frontend
npm run dev

# PowerShell Terminal 3: automation
$env:SMOKE_MODE = '1'
$env:PYTHONIOENCODING = 'utf-8'
.\.venv\Scripts\python.exe scripts/run_browser_smoke.py
```

### Automation Results (2026-03-22)

| Item | Description | Result | Notes |
|------|-------------|--------|-------|
| SH-1 | scan → レポート表示 | **PASS** | Report content displayed |
| SH-2 | history タブでスキャン一覧表示 | **PASS** | History items found |
| SH-3 | history 詳細表示・削除 | **PASS** | Detail view + delete confirmed |
| SH-4 | テーマ切替（ライト→ダーク） | **PASS** | Toggle dark/light confirmed |
| CR-1 | レビュータブ表示 | **PASS** | Card title confirmed |
| CR-2 | 画像D&Dアップロード | **PASS** | True drop upload succeeded |
| CR-3 | クリックでファイル選択ダイアログ | **PASS** | File chooser opened and accepted upload |
| CR-4 | アップロード成功でasset_id表示 | **PASS** | 12-hex asset_id parsed from status bar |
| CR-5 | LP URLなしでバナーレビュー実行 | **PASS** | Review completed |
| CR-6 | LP URLありでad-to-LPレビュー実行 | **PASS** | Review completed |
| CR-7 | レビュー結果が5セクションで表示 | **PASS** | All 5 sections visible |
| CR-8 | HTML One-Pager エクスポート | **PASS** | Downloaded 3162 bytes |

### Supplemental Browser Check (Gate 集計外)

- [ ] **CR-9:** PDF エクスポートが動く（WeasyPrint 環境のみ）
  - 未検証: WeasyPrint 未インストール環境
  - WeasyPrint 不在時の 503 は TestClient probe で検証済み

### Artifacts

```
tmp_review_assets/
  smoke_summary.json          # Latest run summary
  smoke_log.txt               # Latest run log
  smoke_onepager_export.html  # Latest run exported HTML one-pager
  smoke_screenshots/          # Latest run screenshots (17 in current execution)
    00_initial_load.png
    SH-1_before_scan.png
    SH-1_after_scan.png
    SH-2_history_list.png
    SH-3_detail_view.png
    SH-3_after_delete.png
    SH-4_dark_theme.png
    SH-4_light_theme.png
    CR-1_review_tab.png
    CR-2_after_drop_upload.png
    CR-3_after_filechooser.png
    CR-5_before_review.png
    CR-5_after_review.png
    CR-6_ad_lp_review.png
    CR-7_review_result.png
    CR-8_html_export.png
    99_final_state.png
  smoke_runs/
    <run_id>/
      smoke_summary.json
      smoke_log.txt
      smoke_onepager_export.html
      smoke_screenshots/
      smoke_console_errors.txt  # Present only when console errors occurred
```

---

## Bug Fix Found During Automation

### FE-BUG-001: Export 422 due to `_run_id` extra key

- **発見方法**: Browser automation CR-8 FAIL
- **原因**: `creative-review-page.js` が `crLastReview._run_id = envelope.run_id` で extra key を追加。
  `ReviewResult` の `extra="forbid"` (strictness closure d9deddf) により export API が 422 を返した。
- **修正**: `cleanReviewForExport()` helper で `_` prefix keys をストリップしてから export API に送信。
- **影響**: production path でも発生していたバグ。smoke test で初めて検出。

---

## Module 構成 (code inspection)

- [x] `src/lib/api.js` — API ヘルパー
- [x] `src/lib/dom.js` — DOM ユーティリティ
- [x] `src/lib/markdown.js` — Markdown レンダリング
- [x] `src/lib/render-review.js` — レビュー結果レンダリング
- [x] `src/pages/scan-page.js` — スキャンページロジック
- [x] `src/pages/history-page.js` — 履歴ページロジック
- [x] `src/pages/creative-review-page.js` — Creative Review ページロジック
- [x] `src/styles/app.css` — 全アプリケーションスタイル（index.html から抽出）

## Summary

| カテゴリ | Pass | Fail | 未検証 |
|---------|------|------|--------|
| Build | 2 | 0 | 0 |
| API Smoke | 9 | 0 | 0 |
| Test Suite | 1 | 0 | 0 |
| Browser UI (scan/history) | 4 | 0 | 0 |
| Browser UI (creative review) | 8 | 0 | 0 |
| Module 構成 (code inspection) | 8 | 0 | 0 |

**Browser UI 12 項目は Playwright 自動実行で全 PASS。**
**API Smoke の PDF 503 確認は TestClient probe で検証済み (2026-03-22)。**

---

## Smoke Execution Summary

| Date | Executor | Total Pass | Total Fail | Total Blocked | Gate-BAT2 Status |
|------|----------|------------|------------|---------------|-----------------|
| 2026-03-22 | Claude Browser Automation | 12/12 | 0/12 | 0/12 | **GREEN** |

### Gate 判定

| Gate | Status | Evidence |
|------|--------|----------|
| Gate-BAT1 (Smoke Mode) | **GREEN** | SMOKE_MODE=1 deterministic, 13 tests pass, existing 293 tests pass |
| Gate-BAT2 (Browser Automation) | **GREEN** | 12/12 items PASS, screenshots + summary saved |
| Gate-BAT3 (Artifacts) | **GREEN** | Per-run artifact bundle under `smoke_runs/<run_id>` + latest copies refreshed |
| Gate-BAT4 (Acceptance Packet) | **PENDING** | Human acceptance scoring (12 reviews, 70% threshold = 9/12 Pass) not started. Rebaselined from 20 to 12 — only 12 fixtures exist, no plan to create additional 8 |

---

## Residual Human-Only Items

以下は automation では代替できない、人手での判断が必要な項目。

| Item | Status | Description |
|------|--------|-------------|
| Human acceptance scoring | NOT STARTED | 12 banner reviews の品質採点 (70% = 9/12 Pass). Acceptance packet ready at `tmp_review_assets/acceptance_packet/` |
| CR-9 PDF export | DEFERRED | WeasyPrint not installed (Windows GTK3 dependency). Code complete, 503 handling verified. Explicitly deferred per exit decision memo |
| Real Gemini output quality | 1/12 PROBED | banner_01 PASS (2026-03-23). Probe script repaired. Remaining 11 awaiting execution |

---

## Boundary Summary

| 区分 | 状態 | 担当 |
|------|------|------|
| API contract / schema / tests | 完了 | 実装 (Claude) |
| OpenAPI nested contract | 完了 | 実装 (Claude) |
| Schema per-ID presence | 完了 | 実装 (Claude) |
| Browser UI 12項目 (functional) | **完了 (automated)** | Claude Browser Automation |
| PDF 503 probe | 検証済み (TestClient) | 実装 (Claude) |
| Export _run_id bug fix | **完了** | 実装 (Claude) |
| Human acceptance scoring | 未開始 | Human reviewer |
| Real Gemini output quality | 未検証 | Human reviewer + real Gemini |
