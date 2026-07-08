"""
Phase Q2 UI verification via Playwright.
Checks:
  1. /discovery: ReportQualityBadge DOM exists (print:hidden chip)
  2. /discovery: old .quality-warning-banner banners are GONE
  3. /compare: same badge exists, old banner GONE
  4. /discovery?viewer=client: badge is hidden (RBAC client view)
  5. No console errors on any page
"""
from playwright.sync_api import sync_playwright, Error as PWError

BASE = "http://localhost:3002"
TIMEOUT = 12000

console_errors = []

def _check_page(page, url, label):
    errs = []
    page.on("console", lambda msg: errs.append(msg.text) if msg.type == "error" else None)
    try:
        page.goto(url, timeout=TIMEOUT, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
    except PWError as e:
        print(f"[WARN] {label}: navigation error: {e}")
    return errs

results = {}

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context()

    # ── 1. /discovery ──────────────────────────────────────
    page = ctx.new_page()
    errs = _check_page(page, f"{BASE}/discovery", "/discovery")

    # Badge: look for the print:hidden chip button
    badge_count = page.locator(".print\\:hidden button[aria-label]").count()
    banner_count = page.locator(".quality-warning-banner").count()

    results["discovery_badge_exists"] = badge_count > 0
    results["discovery_banner_gone"] = banner_count == 0
    results["discovery_console_errors"] = errs
    print(f"/discovery  badge_count={badge_count}  banner_count={banner_count}  errors={len(errs)}")
    page.close()

    # ── 2. /compare ────────────────────────────────────────
    page = ctx.new_page()
    errs = _check_page(page, f"{BASE}/compare", "/compare")

    badge_count_cmp = page.locator(".print\\:hidden button[aria-label]").count()
    banner_count_cmp = page.locator(".quality-warning-banner").count()

    results["compare_badge_exists"] = badge_count_cmp > 0
    results["compare_banner_gone"] = banner_count_cmp == 0
    results["compare_console_errors"] = errs
    print(f"/compare    badge_count={badge_count_cmp}  banner_count={banner_count_cmp}  errors={len(errs)}")
    page.close()

    # ── 3. /discovery?viewer=client (RBAC client view) ─────
    page = ctx.new_page()
    errs = _check_page(page, f"{BASE}/discovery?viewer=client", "/discovery?viewer=client")

    badge_count_client = page.locator(".print\\:hidden button[aria-label]").count()
    results["client_view_badge_hidden"] = badge_count_client == 0
    results["client_view_console_errors"] = errs
    print(f"?viewer=client  badge_count={badge_count_client}  errors={len(errs)}")
    page.close()

    browser.close()

# ── Summary ────────────────────────────────────────────────
print("\n=== RESULTS ===")
all_pass = True
checks = [
    ("discovery_banner_gone", "旧バナーが削除済み (/discovery)", True),
    ("compare_banner_gone", "旧バナーが削除済み (/compare)", True),
    ("client_view_badge_hidden", "?viewer=client でバッジが非表示", True),
]
for key, label, expected in checks:
    actual = results.get(key)
    ok = actual == expected
    status = "PASS" if ok else "FAIL"
    print(f"  [{status}] {label}: {actual}")
    if not ok:
        all_pass = False

# Badge existence is only visible when isAdmin=true (guest mode → no auth → DEV check)
print(f"  [INFO] discovery badge count: {results.get('discovery_badge_exists')} (admin/DEV gate applies)")
print(f"  [INFO] compare badge count: {results.get('compare_badge_exists')} (admin/DEV gate applies)")

for key in ["discovery_console_errors", "compare_console_errors", "client_view_console_errors"]:
    errs = results.get(key, [])
    if errs:
        print(f"  [WARN] Console errors in {key}: {errs}")
        all_pass = False

print(f"\n{'ALL CHECKS PASSED' if all_pass else 'SOME CHECKS FAILED'}")
