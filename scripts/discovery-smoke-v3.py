"""
Discovery Smoke Test v3 - Phase A Post-Env
Uses Playwright to test with browser localStorage API keys.
"""
import json
import time
from datetime import datetime
from playwright.sync_api import sync_playwright

TARGET_URL = "https://www.petabit.co.jp"
ORIGIN = "http://127.0.0.1:3002"
ATTEMPTS = 5
TIMEOUT = 180000  # 3 minutes per attempt

def run_smoke():
    results = []

    print("=== Discovery Smoke Test v3 - Phase A Post-Env ===")
    print(f"Target: {TARGET_URL}")
    print(f"Origin: {ORIGIN}")
    print(f"Timestamp: {datetime.now().strftime('%Y/%m/%d %H:%M:%S')} JST")
    print()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Navigate to set up localStorage
        page.goto(ORIGIN)
        page.wait_for_load_state("networkidle")

        # Check if API keys exist in localStorage
        has_claude_key = page.evaluate("() => localStorage.getItem('is_claude_key') !== null && localStorage.getItem('is_claude_key').length > 10")
        has_gemini_key = page.evaluate("() => localStorage.getItem('is_gemini_key') !== null && localStorage.getItem('is_gemini_key').length > 10")

        print(f"localStorage has CLAUDE_API_KEY: {has_claude_key}")
        print(f"localStorage has GEMINI_API_KEY: {has_gemini_key}")
        print()

        for i in range(1, ATTEMPTS + 1):
            print(f"=== Attempt {i} ===")
            start_time = time.time()
            start_ts = datetime.now().strftime('%Y/%m/%d %H:%M:%S')
            print(f"Start: {start_ts} JST")

            try:
                # Navigate to Discovery page
                page.goto(f"{ORIGIN}/discovery")
                page.wait_for_load_state("networkidle")

                # Fill in the URL input
                url_input = page.locator('input[type="url"], input[placeholder*="URL"], input[name="url"]').first
                if url_input:
                    url_input.fill(TARGET_URL)
                else:
                    # Try alternative selector
                    page.fill('input[type="text"]', TARGET_URL)

                # Click analyze button
                analyze_btn = page.locator('button:has-text("分析"), button:has-text("実行"), button[type="submit"]').first
                analyze_btn.click()

                # Wait for result (success or error)
                try:
                    # Wait for either success indicator or error banner
                    page.wait_for_selector(
                        '[data-testid="discovery-result"], .competitor-card, .error-banner, [role="alert"]',
                        timeout=TIMEOUT
                    )
                except:
                    pass

                end_time = time.time()
                elapsed = end_time - start_time
                end_ts = datetime.now().strftime('%Y/%m/%d %H:%M:%S')

                print(f"End: {end_ts} JST")
                print(f"Elapsed: {elapsed:.1f}s")

                # Check for success or failure
                error_banner = page.locator('.error-banner, [role="alert"]').first
                success_indicator = page.locator('.competitor-card, [data-testid="discovery-result"], .fetched-sites').first

                if success_indicator.is_visible():
                    print("Result: SUCCESS")
                    results.append({"attempt": i, "status": "success", "elapsed": elapsed})
                elif error_banner.is_visible():
                    error_text = error_banner.text_content()
                    print(f"Result: FAILED")
                    print(f"Detail: {error_text[:200]}")

                    # Classify error
                    stage = "unknown"
                    failure_class = "unknown"

                    if "stage=search" in error_text:
                        stage = "search"
                        if "SSL" in error_text or "TLS" in error_text or "WRONG_VERSION_NUMBER" in error_text:
                            failure_class = "SSL/TLS"
                        elif "timeout" in error_text or "タイムアウト" in error_text:
                            failure_class = "timeout/upstream_502"
                    elif "stage=analyze" in error_text:
                        stage = "analyze"
                        if "503" in error_text:
                            failure_class = "provider_503"
                        elif "401" in error_text or "API キー" in error_text:
                            failure_class = "auth_401"

                    results.append({
                        "attempt": i,
                        "status": "failed",
                        "elapsed": elapsed,
                        "stage": stage,
                        "failureClass": failure_class,
                        "detail": error_text[:100]
                    })
                else:
                    # Check page content for any indication
                    page_content = page.content()
                    if "競合" in page_content and "成功" in page_content:
                        print("Result: SUCCESS (inferred)")
                        results.append({"attempt": i, "status": "success", "elapsed": elapsed})
                    else:
                        print("Result: UNKNOWN")
                        results.append({"attempt": i, "status": "unknown", "elapsed": elapsed})

            except Exception as e:
                end_time = time.time()
                elapsed = end_time - start_time
                print(f"Result: FAILED")
                print(f"Detail: {str(e)[:200]}")
                results.append({"attempt": i, "status": "failed", "elapsed": elapsed, "error": str(e)[:100]})

            print()

        browser.close()

    # Summary
    print("=== Summary ===")
    success = sum(1 for r in results if r["status"] == "success")
    failed = sum(1 for r in results if r["status"] == "failed")
    print(f"Success: {success}/5 ({success * 20}%)")
    print(f"Failed: {failed}/5 ({failed * 20}%)")
    print()

    print("=== Failure Breakdown ===")
    ssl = sum(1 for r in results if r.get("failureClass") == "SSL/TLS")
    timeout = sum(1 for r in results if r.get("failureClass") == "timeout/upstream_502")
    provider_503 = sum(1 for r in results if r.get("failureClass") == "provider_503")
    auth_401 = sum(1 for r in results if r.get("failureClass") == "auth_401")
    unknown = failed - ssl - timeout - provider_503 - auth_401

    print(f"stage=search + SSL/TLS: {ssl}")
    print(f"stage=search + timeout/upstream_502: {timeout}")
    print(f"stage=analyze + provider_503: {provider_503}")
    print(f"stage=analyze + auth_401: {auth_401}")
    print(f"unknown: {unknown}")
    print()

    print("=== Comparison with v2 (3/5 success, 60%) ===")
    print(f"v3 success rate: {success * 20}%")
    if success >= 4:
        print("Conclusion: IMPROVED")
    elif success >= 3:
        print("Conclusion: STABLE")
    else:
        print("Conclusion: DEGRADED")

    return results

if __name__ == "__main__":
    run_smoke()
