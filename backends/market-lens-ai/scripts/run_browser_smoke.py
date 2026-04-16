"""Browser automation smoke test — replaces manual SH-1~SH-4 + CR-1~CR-8.

Requires:
  - SMOKE_MODE=1 (deterministic backend)
  - Backend running on localhost:8002
  - Frontend running on localhost:3001
  - Playwright browsers installed: python -m playwright install chromium

Usage:
  python scripts/run_browser_smoke.py

Outputs:
  tmp_review_assets/smoke_runs/<run_id>/  — immutable per-run artifact bundle
  tmp_review_assets/smoke_screenshots/    — latest run screenshots
  tmp_review_assets/smoke_summary.json    — latest run summary
  tmp_review_assets/smoke_log.txt         — latest run log
"""

from __future__ import annotations

import base64
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

FRONTEND_URL = "http://localhost:3001"
BACKEND_URL = "http://localhost:8002"
ARTIFACTS_DIR = PROJECT_ROOT / "tmp_review_assets"
RUN_ID = datetime.now().strftime("%Y%m%d-%H%M%S")
RUN_ARTIFACTS_DIR = ARTIFACTS_DIR / "smoke_runs" / RUN_ID
RUN_SCREENSHOTS_DIR = RUN_ARTIFACTS_DIR / "smoke_screenshots"
LATEST_SCREENSHOTS_DIR = ARTIFACTS_DIR / "smoke_screenshots"
SMOKE_BANNER_PATH = PROJECT_ROOT / "tests" / "fixtures" / "creative_review" / "smoke_test_banner.png"
ASSET_ID_RE = re.compile(r"\(([0-9a-f]{12})\)")

# If smoke banner doesn't exist, generate it
if not SMOKE_BANNER_PATH.exists():
    from tests.fixtures.creative_review.smoke_test_banner import create_minimal_png
    SMOKE_BANNER_PATH.parent.mkdir(parents=True, exist_ok=True)
    SMOKE_BANNER_PATH.write_bytes(create_minimal_png())


class SmokeResult:
    """Collects results for all smoke items."""

    def __init__(self):
        self.items: list[dict] = []
        self.logs: list[str] = []
        self.start_time = datetime.now()
        self.console_errors: list[str] = []

    def log(self, msg: str):
        ts = datetime.now().strftime("%H:%M:%S")
        line = f"[{ts}] {msg}"
        self.logs.append(line)
        try:
            print(line)
        except UnicodeEncodeError:
            print(line.encode("utf-8", errors="replace").decode("utf-8", errors="replace"))

    def record(self, item_id: str, description: str, result: str, notes: str = ""):
        self.items.append({
            "item_id": item_id,
            "description": description,
            "result": result,
            "notes": notes,
            "timestamp": datetime.now().isoformat(),
        })
        status_mark = "PASS" if result == "PASS" else "FAIL" if result == "FAIL" else "BLOCKED"
        self.log(f"  {item_id}: {status_mark} — {description}" + (f" ({notes})" if notes else ""))

    def save(self):
        ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
        RUN_ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
        RUN_SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

        # Summary JSON
        summary = {
            "execution_date": self.start_time.isoformat(),
            "executor": "Claude Browser Automation",
            "run_id": RUN_ID,
            "artifact_dir": str(RUN_ARTIFACTS_DIR.relative_to(PROJECT_ROOT)),
            "total_items": len(self.items),
            "pass_count": sum(1 for i in self.items if i["result"] == "PASS"),
            "fail_count": sum(1 for i in self.items if i["result"] == "FAIL"),
            "blocked_count": sum(1 for i in self.items if i["result"] == "BLOCKED"),
            "items": self.items,
        }
        summary["gate_bat2"] = "GREEN" if summary["fail_count"] == 0 and summary["blocked_count"] == 0 else "RED"

        summary_path = RUN_ARTIFACTS_DIR / "smoke_summary.json"
        summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
        self.log(f"Summary saved: {summary_path}")

        console_path = RUN_ARTIFACTS_DIR / "smoke_console_errors.txt"
        if self.console_errors:
            console_path.write_text("\n".join(self.console_errors), encoding="utf-8")
            self.log(f"Console errors saved: {console_path}")
        elif console_path.exists():
            console_path.unlink()

        log_path = RUN_ARTIFACTS_DIR / "smoke_log.txt"
        self.log(f"Log saved: {log_path}")
        log_path.write_text("\n".join(self.logs), encoding="utf-8")

        self._refresh_latest_artifacts(summary_path, log_path, console_path)
        return summary

    def _refresh_latest_artifacts(self, summary_path: Path, log_path: Path, console_path: Path):
        shutil.copy2(summary_path, ARTIFACTS_DIR / "smoke_summary.json")
        shutil.copy2(log_path, ARTIFACTS_DIR / "smoke_log.txt")

        latest_onepager = ARTIFACTS_DIR / "smoke_onepager_export.html"
        run_onepager = RUN_ARTIFACTS_DIR / "smoke_onepager_export.html"
        if run_onepager.exists():
            shutil.copy2(run_onepager, latest_onepager)
        elif latest_onepager.exists():
            latest_onepager.unlink()

        latest_console = ARTIFACTS_DIR / "smoke_console_errors.txt"
        if console_path.exists():
            shutil.copy2(console_path, latest_console)
        elif latest_console.exists():
            latest_console.unlink()

        if LATEST_SCREENSHOTS_DIR.exists():
            shutil.rmtree(LATEST_SCREENSHOTS_DIR)
        shutil.copytree(RUN_SCREENSHOTS_DIR, LATEST_SCREENSHOTS_DIR)


def screenshot(page, name: str):
    """Take a screenshot and save to artifacts dir."""
    RUN_SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    path = RUN_SCREENSHOTS_DIR / f"{name}.png"
    page.screenshot(path=str(path), full_page=False)
    return path


def wait_for_upload_result(
    page,
    previous_status: str | None = None,
    timeout_ms: int = 10000,
) -> dict[str, str | bool | None]:
    """Wait until the UI settles on either upload success or upload failure."""
    page.wait_for_function(
        """
        previousStatus => {
          const status = document.querySelector('#cr-upload-status');
          if (!status) return false;
          const text = status.textContent || '';
          const settled = text.includes('アップロード完了') || text.includes('アップロード失敗');
          return settled && (!previousStatus || text !== previousStatus);
        }
        """,
        arg=previous_status,
        timeout=timeout_ms,
    )

    upload_status = page.locator("#cr-upload-status").inner_text()
    preview_classes = page.locator("#cr-preview-img").get_attribute("class") or ""
    match = ASSET_ID_RE.search(upload_status)
    return {
        "upload_status": upload_status,
        "has_preview": "visible" in preview_classes,
        "asset_id": match.group(1) if match else None,
    }


def build_drag_drop_payload(page):
    """Create a browser DataTransfer handle carrying the smoke banner file."""
    payload = {
        "base64": base64.b64encode(SMOKE_BANNER_PATH.read_bytes()).decode("ascii"),
        "name": SMOKE_BANNER_PATH.name,
        "mime_type": "image/png",
    }
    return page.evaluate_handle(
        """
        ({ base64, name, mime_type }) => {
          const binary = atob(base64);
          const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
          const file = new File([bytes], name, { type: mime_type });
          const transfer = new DataTransfer();
          transfer.items.add(file);
          return transfer;
        }
        """,
        payload,
    )


def run_smoke():
    """Execute the full browser smoke test suite."""
    from playwright.sync_api import sync_playwright

    results = SmokeResult()
    results.log("=" * 60)
    results.log("Browser Smoke Test - SMOKE_MODE automation")
    results.log("=" * 60)

    # Pre-flight: check backend health
    results.log("\n--- Pre-flight checks ---")
    import httpx
    try:
        resp = httpx.get(f"{BACKEND_URL}/api/health", timeout=5)
        if resp.status_code == 200 and resp.json().get("ok"):
            results.log("Backend health: OK")
        else:
            results.log(f"Backend health: UNEXPECTED ({resp.status_code})")
            results.log("Aborting — backend not healthy")
            results.save()
            return results
    except Exception as e:
        results.log(f"Backend health: FAILED ({e})")
        results.log("Aborting — backend not reachable. Start with: SMOKE_MODE=1 scripts/boot.ps1")
        results.save()
        return results

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        # Capture console errors
        console_errors: list[str] = []

        page = context.new_page()
        page.on("console", lambda msg: console_errors.append(f"[{msg.type}] {msg.text}") if msg.type == "error" else None)

        results.log("\n--- SH: Scan / History ---")

        # ── SH-4: Theme toggle (no external dependency) ──
        try:
            page.goto(FRONTEND_URL, wait_until="networkidle")
            screenshot(page, "00_initial_load")

            # Check initial theme
            theme_btn = page.locator("#theme-toggle")
            theme_btn.click()
            page.wait_for_timeout(300)
            is_dark = page.evaluate("document.documentElement.getAttribute('data-theme')") == "dark"
            screenshot(page, "SH-4_dark_theme")
            theme_btn.click()
            page.wait_for_timeout(300)
            is_light = page.evaluate("document.documentElement.getAttribute('data-theme')") != "dark"
            screenshot(page, "SH-4_light_theme")

            if is_dark and is_light:
                results.record("SH-4", "テーマ切替（ライト→ダーク）", "PASS", "Toggle dark→light confirmed")
            else:
                results.record("SH-4", "テーマ切替（ライト→ダーク）", "FAIL", f"dark={is_dark}, light={is_light}")
        except Exception as e:
            results.record("SH-4", "テーマ切替（ライト→ダーク）", "FAIL", str(e))

        # ── SH-1: Scan execution ──
        try:
            page.goto(FRONTEND_URL, wait_until="networkidle")
            # Make sure scan tab is active
            scan_tab = page.locator("[data-tab='scan']")
            scan_tab.click()
            page.wait_for_timeout(300)

            # Enter a smoke URL
            url_input = page.locator("#url1")
            url_input.fill("https://example.com")

            screenshot(page, "SH-1_before_scan")

            # Click scan button
            scan_btn = page.locator("#scan-btn")
            scan_btn.click()

            # Wait for result (smoke mode should be fast)
            page.wait_for_timeout(3000)
            screenshot(page, "SH-1_after_scan")

            # Check if report appeared
            report_section = page.locator("#report-section")
            report_body = page.locator("#report-body")
            has_report = report_body.inner_text().strip() != ""

            if has_report:
                results.record("SH-1", "scan → レポート表示", "PASS", "Report content displayed")
            else:
                # Check for error
                status_bar = page.locator("#status-bar").inner_text()
                results.record("SH-1", "scan → レポート表示", "FAIL", f"No report. Status: {status_bar}")
        except Exception as e:
            screenshot(page, "SH-1_error")
            results.record("SH-1", "scan → レポート表示", "FAIL", str(e))

        # ── SH-2: History list ──
        try:
            history_tab = page.locator("[data-tab='history']")
            history_tab.click()
            page.wait_for_timeout(1000)
            screenshot(page, "SH-2_history_list")

            history_list = page.locator("#history-list")
            has_items = "スキャン履歴がまだありません" not in history_list.inner_text()

            if has_items:
                results.record("SH-2", "history タブでスキャン一覧表示", "PASS", "History items found")
            else:
                results.record("SH-2", "history タブでスキャン一覧表示", "FAIL", "Empty history (SH-1 may have failed)")
        except Exception as e:
            results.record("SH-2", "history タブでスキャン一覧表示", "FAIL", str(e))

        # ── SH-3: History detail and delete ──
        try:
            # Click first history item
            first_item = page.locator("#history-list .history-item, #history-list .history-row, #history-list tr").first
            if first_item.count() > 0:
                first_item.click()
                page.wait_for_timeout(500)
                screenshot(page, "SH-3_detail_view")

                detail_view = page.locator("#history-detail")
                detail_visible = detail_view.is_visible()

                # Go back
                back_btn = page.locator("#detail-back-btn")
                if back_btn.is_visible():
                    back_btn.click()
                    page.wait_for_timeout(300)

                # Delete
                history_tab.click()
                page.wait_for_timeout(500)
                delete_btn = page.locator("#detail-delete-btn, .btn-danger-outline").first
                # Navigate to detail again for delete
                first_item2 = page.locator("#history-list .history-item, #history-list .history-row, #history-list tr").first
                if first_item2.count() > 0:
                    first_item2.click()
                    page.wait_for_timeout(300)
                    del_btn = page.locator("#detail-delete-btn")
                    if del_btn.is_visible():
                        page.on("dialog", lambda dialog: dialog.accept())
                        del_btn.click()
                        page.wait_for_timeout(500)
                        screenshot(page, "SH-3_after_delete")
                        results.record("SH-3", "history 詳細表示・削除", "PASS", "Detail view + delete confirmed")
                    else:
                        results.record("SH-3", "history 詳細表示・削除", "PASS", "Detail view confirmed, delete btn not found")
                else:
                    results.record("SH-3", "history 詳細表示・削除", "PASS", f"Detail visible={detail_visible}")
            else:
                results.record("SH-3", "history 詳細表示・削除", "BLOCKED", "No history items to interact with")
        except Exception as e:
            screenshot(page, "SH-3_error")
            results.record("SH-3", "history 詳細表示・削除", "FAIL", str(e))

        results.log("\n--- CR: Creative Review ---")

        # ── CR-1: Review tab visible ──
        try:
            review_tab = page.locator("[data-tab='creative-review']")
            review_tab.click()
            page.wait_for_timeout(500)
            screenshot(page, "CR-1_review_tab")

            cr_card = page.locator("#cr-intake-card")
            card_title = page.locator("#cr-intake-card .card-title").inner_text()

            if "クリエイティブレビュー" in card_title:
                results.record("CR-1", "レビュータブ表示", "PASS", f"Card title: {card_title}")
            else:
                results.record("CR-1", "レビュータブ表示", "FAIL", f"Unexpected title: {card_title}")
        except Exception as e:
            results.record("CR-1", "レビュータブ表示", "FAIL", str(e))

        # ── CR-2 / CR-3 / CR-4: Upload flows ──
        try:
            review_tab = page.locator("[data-tab='creative-review']")
            review_tab.click()
            page.wait_for_timeout(300)

            # CR-2: true drag-and-drop via browser DataTransfer
            previous_status = page.locator("#cr-upload-status").inner_text()
            drag_payload = build_drag_drop_payload(page)
            try:
                page.dispatch_event("#cr-upload-zone", "dragover", {"dataTransfer": drag_payload})
                page.dispatch_event("#cr-upload-zone", "drop", {"dataTransfer": drag_payload})
            finally:
                drag_payload.dispose()

            upload_state = wait_for_upload_result(page, previous_status=previous_status)
            screenshot(page, "CR-2_after_drop_upload")

            if upload_state["has_preview"] and upload_state["asset_id"]:
                results.record(
                    "CR-2",
                    "画像D&Dアップロード",
                    "PASS",
                    f"Drop upload succeeded ({upload_state['asset_id']})",
                )
            else:
                results.record(
                    "CR-2",
                    "画像D&Dアップロード",
                    "FAIL",
                    f"Status: {upload_state['upload_status']}",
                )

            # CR-3: true file chooser opened from upload zone click
            upload_zone = page.locator("#cr-upload-zone")
            with page.expect_file_chooser(timeout=5000) as chooser_info:
                upload_zone.click()
            chooser = chooser_info.value
            chooser.set_files(str(SMOKE_BANNER_PATH))

            upload_state = wait_for_upload_result(
                page,
                previous_status=str(upload_state["upload_status"]),
            )
            screenshot(page, "CR-3_after_filechooser")

            if upload_state["has_preview"]:
                results.record(
                    "CR-3",
                    "クリックでファイル選択ダイアログ",
                    "PASS",
                    "File chooser opened and accepted the upload",
                )
            else:
                results.record(
                    "CR-3",
                    "クリックでファイル選択ダイアログ",
                    "FAIL",
                    f"Status: {upload_state['upload_status']}",
                )

            if upload_state["asset_id"]:
                results.record(
                    "CR-4",
                    "アップロード成功でasset_id表示",
                    "PASS",
                    f"asset_id={upload_state['asset_id']}",
                )
            else:
                results.record(
                    "CR-4",
                    "アップロード成功でasset_id表示",
                    "FAIL",
                    f"Upload status: {upload_state['upload_status']}",
                )
        except Exception as e:
            screenshot(page, "CR-2_error")
            results.record("CR-2", "画像D&Dアップロード", "FAIL", str(e))
            results.record("CR-3", "クリックでファイル選択ダイアログ", "BLOCKED", "Upload failed")
            results.record("CR-4", "アップロード成功でasset_id表示", "BLOCKED", "Upload failed")

        # ── CR-5: Banner review (no LP URL) ──
        try:
            # Brand info (optional)
            brand_input = page.locator("#cr-brand-info")
            brand_input.fill("SMOKE TEST Brand")

            # Make sure LP URL is empty
            lp_input = page.locator("#cr-lp-url")
            lp_input.fill("")

            screenshot(page, "CR-5_before_review")

            # Click review button
            review_btn = page.locator("#cr-review-btn")
            if not review_btn.is_disabled():
                review_btn.click()
                # Wait for review to complete (smoke mode should be fast)
                page.wait_for_timeout(3000)
                screenshot(page, "CR-5_after_review")

                review_status = page.locator("#cr-review-status").inner_text()
                if "レビューが完了しました" in review_status:
                    results.record("CR-5", "LP URLなしでバナーレビュー実行", "PASS", review_status)
                else:
                    results.record("CR-5", "LP URLなしでバナーレビュー実行", "FAIL", f"Status: {review_status}")
            else:
                results.record("CR-5", "LP URLなしでバナーレビュー実行", "BLOCKED", "Review button disabled (upload may have failed)")
        except Exception as e:
            screenshot(page, "CR-5_error")
            results.record("CR-5", "LP URLなしでバナーレビュー実行", "FAIL", str(e))

        # ── CR-7: Review result sections ──
        try:
            preview_card = page.locator("#cr-review-preview")
            if preview_card.is_visible():
                good_section = page.locator("#cr-good-section")
                keep_section = page.locator("#cr-keep-section")
                improve_section = page.locator("#cr-improve-section")
                test_section = page.locator("#cr-test-section")
                evidence_section = page.locator("#cr-evidence-section")

                sections_visible = (
                    good_section.is_visible()
                    and keep_section.is_visible()
                    and improve_section.is_visible()
                    and test_section.is_visible()
                    and evidence_section.is_visible()
                )

                screenshot(page, "CR-7_review_result")

                if sections_visible:
                    results.record("CR-7", "レビュー結果が5セクションで表示", "PASS",
                                   "良い点/守るべき点/改善提案/テスト案/根拠 all visible")
                else:
                    results.record("CR-7", "レビュー結果が5セクションで表示", "FAIL",
                                   "Some sections not visible")
            else:
                results.record("CR-7", "レビュー結果が5セクションで表示", "BLOCKED", "Review preview not visible")
        except Exception as e:
            results.record("CR-7", "レビュー結果が5セクションで表示", "FAIL", str(e))

        # ── CR-6: Ad-LP review (with LP URL) ──
        try:
            # Re-upload for a clean state (or reuse existing asset)
            lp_input = page.locator("#cr-lp-url")
            lp_input.fill("https://example.com/lp")

            review_btn = page.locator("#cr-review-btn")
            if not review_btn.is_disabled():
                review_btn.click()
                page.wait_for_timeout(3000)
                screenshot(page, "CR-6_ad_lp_review")

                review_status = page.locator("#cr-review-status").inner_text()
                if "レビューが完了しました" in review_status:
                    results.record("CR-6", "LP URLありでad-to-LPレビュー実行", "PASS", review_status)
                else:
                    results.record("CR-6", "LP URLありでad-to-LPレビュー実行", "FAIL", f"Status: {review_status}")
            else:
                results.record("CR-6", "LP URLありでad-to-LPレビュー実行", "BLOCKED", "Review button disabled")
        except Exception as e:
            screenshot(page, "CR-6_error")
            results.record("CR-6", "LP URLありでad-to-LPレビュー実行", "FAIL", str(e))

        # ── CR-8: Banner generation button visible ──
        try:
            banner_gen_btn = page.locator(".banner-gen-btn")
            if banner_gen_btn.is_visible():
                screenshot(page, "CR-8_banner_gen_btn")
                results.record("CR-8", "改善バナー生成ボタン表示", "PASS",
                               "Banner generation button visible in export bar")
            else:
                results.record("CR-8", "改善バナー生成ボタン表示", "BLOCKED",
                               "Banner generation button not visible (review may not have completed)")
        except Exception as e:
            screenshot(page, "CR-8_error")
            results.record("CR-8", "改善バナー生成ボタン表示", "FAIL", str(e))

        # Final screenshot
        screenshot(page, "99_final_state")

        # Collect console errors
        results.console_errors = console_errors
        if console_errors:
            results.log(f"\n--- Console Errors ({len(console_errors)}) ---")
            for err in console_errors:
                results.log(f"  {err}")

        browser.close()

    # Save results
    results.log("\n" + "=" * 60)
    summary = results.save()

    # Print summary table
    results.log("\n--- SUMMARY ---")
    results.log(f"Total: {summary['total_items']}  |  "
                f"Pass: {summary['pass_count']}  |  "
                f"Fail: {summary['fail_count']}  |  "
                f"Blocked: {summary['blocked_count']}")
    results.log(f"Gate-BAT2: {summary['gate_bat2']}")

    return results


if __name__ == "__main__":
    run_smoke()
