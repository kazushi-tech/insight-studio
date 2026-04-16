"""Take UI screenshots for Phase E verification."""

from playwright.sync_api import sync_playwright
import os

SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "screenshots")
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)


def take_screenshots():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # Desktop screenshots
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.goto("http://localhost:3001")
        page.wait_for_load_state("networkidle")

        # 1. Top page (hero + scan workspace)
        page.screenshot(
            path=os.path.join(SCREENSHOTS_DIR, "01_top_page.png"),
            full_page=True,
        )
        print("01_top_page.png captured")

        # 2. Scan workspace (scroll to input area)
        scan_card = page.locator(".card").first
        if scan_card.count() > 0:
            scan_card.scroll_into_view_if_needed()
            page.screenshot(
                path=os.path.join(SCREENSHOTS_DIR, "02_scan_workspace.png"),
            )
            print("02_scan_workspace.png captured")

        # 3. History tab
        history_tab = page.locator("text=History").or_(page.locator("text=履歴"))
        if history_tab.count() > 0:
            history_tab.first.click()
            page.wait_for_timeout(500)
            page.screenshot(
                path=os.path.join(SCREENSHOTS_DIR, "03_history_view.png"),
            )
            print("03_history_view.png captured")

        page.close()

        # 4. Mobile screenshot
        mobile_page = browser.new_page(viewport={"width": 375, "height": 812})
        mobile_page.goto("http://localhost:3001")
        mobile_page.wait_for_load_state("networkidle")
        mobile_page.screenshot(
            path=os.path.join(SCREENSHOTS_DIR, "04_mobile_view.png"),
            full_page=True,
        )
        print("04_mobile_view.png captured")

        mobile_page.close()
        browser.close()
        print(f"\nAll screenshots saved to {SCREENSHOTS_DIR}")


if __name__ == "__main__":
    take_screenshots()
