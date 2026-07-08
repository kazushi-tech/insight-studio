"""CORS fix regression check via Playwright sync API"""
from playwright.sync_api import sync_playwright
import sys

BASE = "http://localhost:3003"
PAGES = [
    ("/ads/ai", "AI考察"),
    ("/discovery", "Discovery"),
    ("/ads/setup", "Ads Setup"),
    ("/ads/analysis", "Ads Analysis"),
]

def run():
    errors_found = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context()

        for path, label in PAGES:
            page = ctx.new_page()
            console_errors = []

            def on_console(msg, label=label):
                if msg.type in ("error", "warning"):
                    text = msg.text
                    if any(kw in text for kw in ["CORS", "Failed to fetch", "NetworkError", "TypeError"]):
                        console_errors.append(f"[{label}] {msg.type}: {text}")

            page.on("console", on_console)

            try:
                resp = page.goto(f"{BASE}{path}", wait_until="domcontentloaded", timeout=15000)
                page.wait_for_timeout(2000)
                status = resp.status if resp else "?"
                print(f"[OK] {label} ({path}) → HTTP {status}")
                if console_errors:
                    print(f"  [WARN] Console errors:")
                    for e in console_errors:
                        print(f"    {e}")
                    errors_found.extend(console_errors)
            except Exception as ex:
                msg = f"[FAIL] {label} ({path}): {ex}"
                print(msg)
                errors_found.append(msg)
            finally:
                page.close()

        browser.close()

    if errors_found:
        print("\n=== FAILURES ===")
        for e in errors_found:
            print(e)
        sys.exit(1)
    else:
        print("\n=== ALL PAGES OK ===")

if __name__ == "__main__":
    run()
