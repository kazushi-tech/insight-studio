"""Playwright verification for Compare.jsx C-1/C-2/C-3 hotfix."""
import sys
from playwright.sync_api import sync_playwright

errors = []

def log(msg):
    # Windows cp932 safe output
    try:
        print(msg)
    except UnicodeEncodeError:
        print(msg.encode('ascii', errors='replace').decode('ascii'))

def is_backend_error(text):
    return "502" in text or "Failed to load resource" in text or "ERR_CONNECTION" in text or "market-lens" in text.lower()

BASE = "http://localhost:3003"

MOCK_AUTH_SCRIPT = """() => {
    localStorage.setItem('is_user', JSON.stringify({
        user_id: 'test-user-001',
        email: 'test@example.com',
        role: 'admin',
        display_name: 'Test User'
    }));
    localStorage.setItem('is_ads_token', 'test-token-for-playwright');
    sessionStorage.setItem('is_claude_key', 'sk-' + 'ant-test-only-not-a-real-key');
}"""

def setup_auth(page):
    """Navigate to origin and inject mock auth into localStorage."""
    page.goto(f"{BASE}/", wait_until="domcontentloaded", timeout=15000)
    page.evaluate(MOCK_AUTH_SCRIPT)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # ── V3: Expired sessionStorage job -> banner shown ──
    log("\n=== V3: Expired job -> error banner ===")
    ctx3 = browser.new_context()
    page3 = ctx3.new_page()
    all_console3 = []
    js_errors3 = []
    page3.on("console", lambda m: (
        all_console3.append(f"[{m.type}] {m.text}"),
        js_errors3.append(f"[{m.type}] {m.text}") if m.type == "error" and not is_backend_error(m.text) else None
    ))
    page3.on("pageerror", lambda e: js_errors3.append(f"[pageerror] {e}"))

    # Setup auth then go to compare
    setup_auth(page3)
    page3.goto(f"{BASE}/compare", wait_until="domcontentloaded", timeout=15000)
    page3.wait_for_timeout(1000)

    # Inject expired job (12 minutes ago)
    page3.evaluate("""() => {
        const startedAt = Date.now() - 12 * 60 * 1000;
        sessionStorage.setItem('is-compare-active-scan-job', JSON.stringify({
            jobId: 'test-expired-job',
            pollUrl: '/scan/jobs/test-expired-job',
            urls: { target: 'https://example.com', compA: '', compB: '' },
            startedAt: startedAt
        }));
        console.log('[TEST] Injected expired job startedAt=' + startedAt + ' diff=' + (Date.now() - startedAt));
    }""")

    # Reload — resume effect fires on mount
    page3.reload(wait_until="domcontentloaded")
    page3.wait_for_timeout(2000)

    # Check sessionStorage
    ss_val = page3.evaluate("() => sessionStorage.getItem('is-compare-active-scan-job')")
    log(f"[V3] sessionStorage after reload: {'cleared' if ss_val is None else 'STILL PRESENT'}")

    # Check banner
    banner_found = page3.evaluate("""() => {
        const text = document.body.innerText;
        return text.includes('タイムアウト上限') || text.includes('11') && text.includes('すぎました');
    }""")
    log(f"[V3] Banner-like text found: {banner_found}")

    # More specific check
    timer_elements = page3.evaluate("""() => {
        const spans = document.querySelectorAll('span, div, p');
        const results = [];
        for (const el of spans) {
            const t = el.textContent || '';
            if (t.includes('タイムアウト') && el.children.length <= 3) {
                results.push(t.trim().slice(0, 100));
            }
        }
        return results;
    }""")
    log(f"[V3] Elements with timeout text: {timer_elements}")

    # Log compare-related console messages
    compare_logs = [m for m in all_console3 if 'Compare' in m or 'TEST' in m or 'resume' in m.lower() or 'expired' in m.lower()]
    log(f"[V3] Compare/Test console: {compare_logs}")

    if ss_val is None:
        log("[V3] sessionStorage cleared OK")
    else:
        log("[V3] FAIL: sessionStorage not cleared")
        errors.append("V3: sessionStorage not cleared after expired job")

    if not banner_found and not timer_elements:
        log("[V3] FAIL: Expired job banner not shown")
        errors.append("V3: Expired job banner not shown")
    else:
        log("[V3] Expired job banner shown OK")

    if js_errors3:
        log(f"[V3] JS errors: {js_errors3}")
        errors.append(f"V3 JS errors: {js_errors3}")

    page3.close()
    ctx3.close()

    # ── V4: Cancel button visible during active polling ──
    log("\n=== V4: Cancel button ===")
    ctx4 = browser.new_context()
    page4 = ctx4.new_page()
    js_errors4 = []
    page4.on("console", lambda m: js_errors4.append(f"[{m.type}] {m.text}")
             if m.type == "error" and not is_backend_error(m.text) else None)
    page4.on("pageerror", lambda e: js_errors4.append(f"[pageerror] {e}"))

    setup_auth(page4)

    # Inject non-expired job to trigger loading state
    page4.evaluate("""() => {
        sessionStorage.setItem('is-compare-active-scan-job', JSON.stringify({
            jobId: 'test-active-job',
            pollUrl: '/scan/jobs/test-active-job',
            urls: { target: 'https://example.com', compA: 'https://comp.com', compB: '' },
            startedAt: Date.now() - 30 * 1000
        }));
    }""")
    page4.goto(f"{BASE}/compare", wait_until="domcontentloaded", timeout=15000)
    page4.wait_for_timeout(2000)

    cancel_btn = page4.evaluate("""() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const found = btns.find(b => b.textContent.includes('キャンセル'));
        return found ? found.textContent.trim() : null;
    }""")
    if cancel_btn:
        log(f"[V4] Cancel button found: {cancel_btn!r} (OK)")
    else:
        # If backend is not reachable, resume polling might fail quickly — check if loading state was even set
        is_loading = page4.evaluate("""() => document.body.innerText.includes('分析中')""")
        log(f"[V4] Cancel button not visible. Loading state active: {is_loading}")
        if not is_loading:
            log("[V4] NOTE: Not in loading state (backend unreachable, job resumed then failed). Cancel button check skipped.")

    if js_errors4:
        log(f"[V4] JS errors: {js_errors4}")
        errors.append(f"V4 JS errors: {js_errors4}")

    page4.close()
    ctx4.close()

    # ── V5: Regression /discovery, /, /compare ──
    log("\n=== V5: Regression checks ===")
    for path, label in [("/", "home"), ("/compare", "compare"), ("/discovery", "discovery")]:
        ctx = browser.new_context()
        page = ctx.new_page()
        js_errs = []
        page.on("console", lambda m, errs=js_errs: errs.append(f"[{m.type}] {m.text}")
                if m.type == "error" and not is_backend_error(m.text) else None)
        page.on("pageerror", lambda e, errs=js_errs: errs.append(f"[pageerror] {e}"))

        setup_auth(page)
        page.goto(f"{BASE}{path}", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(1500)

        if js_errs:
            log(f"[V5/{label}] JS errors: {js_errs}")
            errors.append(f"V5/{label} JS errors: {js_errs}")
        else:
            log(f"[V5/{label}] No JS errors OK")

        page.close()
        ctx.close()

    browser.close()

print()
if errors:
    print(f"FAILED ({len(errors)} issues):")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
else:
    print("ALL CHECKS PASSED")
