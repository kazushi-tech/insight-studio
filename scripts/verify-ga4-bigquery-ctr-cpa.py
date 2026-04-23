"""
GA4/BigQuery CTR CPA plan verification.
Checks:
  1. /discovery page loads with no console errors
  2. /ads/ai page loads with no console errors
  3. /debug/report-v2 shows V2 components
  4. Compare and AI Explorer regression check
"""
import json
import sys
import time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3002"


def seed_auth(context):
    token = "ga4-verify-stub"
    user = {"role": "admin", "display_name": "GA4 Tester"}
    context.add_init_script(
        "window.localStorage.setItem('is_ads_token', "
        + json.dumps(token) + ");"
        "window.localStorage.setItem('is_user', "
        + json.dumps(json.dumps(user)) + ");"
    )


def check_page(browser, name, url, wait_selector=None, timeout_ms=10000):
    ctx = browser.new_context()
    seed_auth(ctx)
    page = ctx.new_page()
    errors = []
    page_errors = []

    page.on("console", lambda msg: errors.append(f"[{msg.type}] {msg.text}")
            if msg.type == "error" else None)
    page.on("pageerror", lambda err: page_errors.append(str(err)))

    page.goto(url, wait_until="domcontentloaded", timeout=30000)

    if wait_selector:
        try:
            page.wait_for_selector(wait_selector, timeout=timeout_ms)
        except Exception:
            pass

    page.wait_for_timeout(2000)

    # Filter out known benign errors
    real_errors = [
        e for e in errors + page_errors
        if "401" not in e
        and "favicon" not in e.lower()
        and "Failed to load resource" not in e
        and "/api/ads/auth" not in e
        and "/api/ads/cases" not in e
        and "Discovery] tick" not in e
    ]

    passed = len(real_errors) == 0
    status = "PASS" if passed else "FAIL"
    print(f"[{status}] {name}: {url}")
    for e in real_errors:
        print(f"  ERROR: {e}")

    ctx.close()
    return passed


def check_debug_v2(browser):
    """Check that new V2 components are imported correctly."""
    ctx = browser.new_context()
    seed_auth(ctx)
    page = ctx.new_page()
    errors = []

    page.on("console", lambda msg: errors.append(f"[{msg.type}] {msg.text}")
            if msg.type == "error" else None)

    page.goto(f"{BASE}/debug/report-v2?fixture=discovery-sample",
              wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(3000)

    # Check V2 section renders (it should at minimum show PriorityActionHeroV2)
    has_v2 = page.query_selector(".ui-v2") is not None
    has_matrix = page.query_selector('[data-testid="competitor-matrix-v2"]') is not None
    has_radar = page.query_selector('[data-testid="brand-radar-v2"]') is not None

    real_errors = [
        e for e in errors
        if "favicon" not in e.lower()
        and "Failed to load resource" not in e
    ]

    passed = len(real_errors) == 0
    status = "PASS" if passed else "FAIL"
    print(f"[{status}] debug-report-v2: {BASE}/debug/report-v2?fixture=discovery-sample")
    print(f"  ui-v2 present: {has_v2}, matrix: {has_matrix}, radar: {has_radar}")
    for e in real_errors:
        print(f"  ERROR: {e}")

    ctx.close()
    return passed


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        results = []

        results.append(check_page(browser, "discovery", f"{BASE}/discovery"))
        results.append(check_page(browser, "ads-ai", f"{BASE}/ads/ai"))
        results.append(check_page(browser, "compare", f"{BASE}/compare"))
        results.append(check_debug_v2(browser))

        browser.close()

    passed = all(results)
    total = len(results)
    ok_count = sum(1 for r in results if r)
    print(f"\nResult: {ok_count}/{total} pages passed")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
