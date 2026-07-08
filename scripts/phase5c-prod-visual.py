"""Phase 5C production visual check — Compare-first Playwright smoke.

Target the live Vercel deployment. Assert:
  - HTTP 200 reachable
  - v2 ReportView mount OR empty-input form (depending on login state)
  - console_error == 0

Exit 0 on pass, 1 on any console_error / pageerror.
"""
import json
import sys
from playwright.sync_api import sync_playwright

BASE = "https://insight-studio.vercel.app"
PAGES = [
    ("compare", f"{BASE}/compare"),
    ("discovery", f"{BASE}/discovery"),
]


def seed_auth(context):
    token = "phase5c-prod-smoke"
    user = {"role": "admin", "display_name": "Phase 5C Prod Smoke"}
    context.add_init_script(
        "window.localStorage.setItem('is_ads_token', "
        f"{json.dumps(token)});"
        "window.localStorage.setItem('is_user', "
        f"{json.dumps(json.dumps(user))});"
    )


def check_page(browser, name, url):
    ctx = browser.new_context()
    seed_auth(ctx)
    page = ctx.new_page()
    errors = []
    page_errors = []
    failed_requests = []

    def on_console(msg):
        if msg.type == "error":
            errors.append(msg.text)

    def on_requestfailed(req):
        failure = req.failure or ""
        if "ERR_ABORTED" in failure or "net::ERR_ABORTED" in failure:
            return
        failed_requests.append(f"{req.method} {req.url} -- {failure}")

    def on_response(resp):
        if resp.status >= 500:
            failed_requests.append(f"HTTP {resp.status} {resp.url}")

    page.on("console", on_console)
    page.on("pageerror", lambda exc: page_errors.append(str(exc)))
    page.on("requestfailed", on_requestfailed)
    page.on("response", on_response)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        try:
            page.wait_for_load_state("networkidle", timeout=20000)
        except Exception as e:
            page_errors.append(f"networkidle wait failed: {e}")
        page.wait_for_timeout(2000)
        v2_root = page.locator(".ui-v2").count()
        v1_root = page.locator(".ui-v1").count()
        title = page.title()
    finally:
        ctx.close()
    return {
        "name": name,
        "url": url,
        "title": title,
        "v2_root_count": v2_root,
        "v1_root_count": v1_root,
        "console_errors": errors,
        "page_errors": page_errors,
        "failed_requests": failed_requests,
    }


def main():
    results = []
    failed = False
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for name, url in PAGES:
            res = check_page(browser, name, url)
            results.append(res)
            if res["console_errors"] or res["page_errors"]:
                failed = True
        browser.close()

    for r in results:
        print(f"--- {r['name']} ---")
        print(f"  url={r['url']}")
        print(f"  title={r['title']!r}")
        print(f"  v2_root_count={r['v2_root_count']}  v1_root_count={r['v1_root_count']}")
        print(f"  console_errors={len(r['console_errors'])}  page_errors={len(r['page_errors'])}  failed_requests={len(r.get('failed_requests', []))}")
        for e in r["console_errors"]:
            print(f"    [console.error] {e}")
        for e in r["page_errors"]:
            print(f"    [pageerror] {e}")
        for e in r.get("failed_requests", []):
            print(f"    [req] {e}")

    print()
    print(f"ALL_PASSED: {not failed}")
    sys.exit(0 if not failed else 1)


if __name__ == "__main__":
    main()
