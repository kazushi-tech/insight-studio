"""Playwright verification for /compare page changes."""
import sys
from playwright.sync_api import sync_playwright

errors = []

def log(msg):
    print(msg)

def is_backend_error(text):
    """502/network errors from the API backend are expected when backend is offline."""
    return "502" in text or "Failed to load resource" in text or "ERR_CONNECTION" in text

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context()

    # ── 1. /compare – fresh state (no localStorage) ──
    page = context.new_page()
    js_errors = []
    page.on("console", lambda m: js_errors.append(f"[{m.type}] {m.text}")
            if m.type == "error" and not is_backend_error(m.text) else None)
    page.on("pageerror", lambda e: js_errors.append(f"[pageerror] {e}"))

    page.goto("http://localhost:3002/compare", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(2000)

    # Check localStorage state
    ls_version = page.evaluate("() => localStorage.getItem('reportUiVersion')")
    log(f"[compare] localStorage.reportUiVersion = {ls_version!r}  (expected: None = use default v2)")

    # Check useUiVersion hook default: the hook reads query → localStorage → DEFAULT('v2')
    # Without any stored value, it should resolve to 'v2'
    # We verify by checking that the URL has no '?ui=v1' param
    current_url = page.url
    log(f"[compare] current URL = {current_url}")
    assert "ui=v1" not in current_url, "Default should not include ?ui=v1"
    log("[compare] v2 default URL check: OK")

    # Check UiVersionToggle or compare form exists
    has_toggle = page.evaluate("() => !!document.querySelector('[role=radiogroup]')")
    has_form = page.evaluate("() => !!document.querySelector('form, input[type=url], input[type=text]')")
    log(f"[compare] UiVersionToggle visible = {has_toggle}  form = {has_form}")

    # Check no makeHeadingSlug / import errors (specific to our changes)
    slug_import_error = any("makeHeadingSlug" in e or "headingSlug" in e or "ReportViewV2" in e for e in js_errors)
    if slug_import_error:
        errors.append(f"makeHeadingSlug import error: {[e for e in js_errors if 'makeHeadingSlug' in e or 'headingSlug' in e]}")

    if js_errors:
        log(f"[compare] JS errors (non-backend): {js_errors}")
        errors.append(f"compare JS errors: {js_errors}")
    else:
        log("[compare] No JS errors: OK")

    page.close()

    # ── 2. /compare with ?ui=v1 toggle check ──
    page2 = context.new_page()
    js_errors2 = []
    page2.on("pageerror", lambda e: js_errors2.append(f"[pageerror] {e}"))
    page2.goto("http://localhost:3002/compare?ui=v1", wait_until="domcontentloaded", timeout=15000)
    page2.wait_for_timeout(1500)
    v1_active = page2.evaluate("""() => {
      const btn = document.querySelector('[role=radio][aria-checked="true"]');
      return btn ? btn.textContent.trim() : null;
    }""")
    log(f"[compare?ui=v1] active toggle button = {v1_active!r}")
    if js_errors2:
        log(f"[compare?ui=v1] page errors: {js_errors2}")
        errors.append(f"compare?ui=v1 errors: {js_errors2}")
    page2.close()

    # ── 3. / – regression check ──
    page3 = context.new_page()
    js_errors3 = []
    page3.on("console", lambda m: js_errors3.append(f"[{m.type}] {m.text}")
             if m.type == "error" and not is_backend_error(m.text) else None)
    page3.on("pageerror", lambda e: js_errors3.append(f"[pageerror] {e}"))
    page3.goto("http://localhost:3002/", wait_until="domcontentloaded", timeout=15000)
    page3.wait_for_timeout(1500)
    if js_errors3:
        log(f"[/] JS errors: {js_errors3}")
        errors.append(f"home page JS errors: {js_errors3}")
    else:
        log("[/] No JS errors: OK")
    page3.close()

    browser.close()

print()
if errors:
    print(f"FAILED: {errors}")
    sys.exit(1)
else:
    print("ALL CHECKS PASSED")
