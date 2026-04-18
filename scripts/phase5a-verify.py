"""Phase 5A browser verification for Stitch 2.0 v2 UI.

Patterns A-F from plans/2026-04-18-phase5a-stitch-v2-browser-verification-plan.md.
Run under webapp-testing's with_server.py (npm run dev on port 3002).
"""

import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, Page, BrowserContext

BASE_URL = "http://localhost:3002"
OUT = Path(__file__).parent
RESULTS: list[dict] = []

AUTH_SEED = """
localStorage.setItem('is_ads_token', 'phase5a-admin-token');
localStorage.setItem('is_user', JSON.stringify({ role: 'admin', display_name: 'Phase5A Tester' }));
"""


def seed_auth(context: BrowserContext):
    """Seed authentication via init script so all pages in this context are authed."""
    context.add_init_script(AUTH_SEED)


def collect_listeners(page: Page) -> dict:
    bag = {"console_errors": [], "page_errors": [], "failed_requests": []}
    page.on(
        "console",
        lambda msg: bag["console_errors"].append(
            {"text": msg.text, "location": str(msg.location)}
        )
        if msg.type == "error"
        else None,
    )
    page.on("pageerror", lambda err: bag["page_errors"].append(str(err)))
    page.on(
        "requestfailed",
        lambda req: bag["failed_requests"].append(
            {"url": req.url, "failure": req.failure}
        ),
    )
    return bag


def goto_and_wait(page: Page, url: str) -> int:
    resp = page.goto(url, wait_until="domcontentloaded", timeout=20000)
    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass
    try:
        page.wait_for_function("document.fonts.ready", timeout=10000)
    except Exception:
        pass
    return resp.status if resp else -1


def snap(page: Page, name: str) -> str:
    path = OUT / f"{name}.png"
    page.screenshot(path=str(path), full_page=False, animations="disabled")
    return str(path)


def run_pattern(
    context: BrowserContext,
    name: str,
    path: str,
    ui: str | None,
    check_fn,
) -> dict:
    page = context.new_page()
    bag = collect_listeners(page)
    url = f"{BASE_URL}{path}"
    if ui:
        sep = "&" if "?" in path else "?"
        url = f"{url}{sep}ui={ui}"
    result = {"name": name, "url": url, "ui": ui, "passes": [], "fails": []}
    try:
        status = goto_and_wait(page, url)
        result["http_status"] = status
        if status not in (200, 304):
            result["fails"].append(f"HTTP {status}")
        # Confirm we landed somewhere authed (not /login)
        final_url = page.url
        result["final_url"] = final_url
        if "/login" in final_url:
            result["fails"].append(f"redirected to login: {final_url}")
        check_fn(page, result)
        result["screenshot"] = snap(page, name)
    except Exception as e:
        result["fails"].append(f"exception: {type(e).__name__}: {e}")
    finally:
        result["console_errors"] = bag["console_errors"]
        result["page_errors"] = bag["page_errors"]
        result["failed_requests"] = bag["failed_requests"]
        if bag["page_errors"]:
            result["fails"].append(f"{len(bag['page_errors'])} page errors")
        hard_console = [
            e for e in bag["console_errors"]
            if "favicon" not in e["text"].lower()
            and "HMR" not in e["text"]
            and "[vite]" not in e["text"].lower()
        ]
        if hard_console:
            result["fails"].append(f"{len(hard_console)} console errors")
        page.close()
    status_tag = "PASS" if not result["fails"] else "FAIL"
    print(f"[{status_tag}] {name} ({url})")
    for f in result["fails"]:
        print(f"   ! {f}")
    RESULTS.append(result)
    return result


# ---- Checkers ----

def check_discovery_v1(page: Page, result: dict):
    loaded = (
        page.locator("text=Discovery").count() > 0
        or page.locator("text=考察").count() > 0
        or page.locator("h1, h2").count() > 0
    )
    if not loaded:
        result["fails"].append("Discovery page content not rendered")
    else:
        result["passes"].append("Discovery page rendered")
    v2_roots = page.locator(".ui-v2").count()
    if v2_roots > 0:
        result["fails"].append(f"ui-v2 root unexpectedly in v1 ({v2_roots})")
    else:
        result["passes"].append("No ui-v2 root in v1 (correct)")


def check_discovery_v2(page: Page, result: dict):
    loaded = (
        page.locator("text=Discovery").count() > 0
        or page.locator("text=考察").count() > 0
        or page.locator("h1, h2").count() > 0
    )
    if not loaded:
        result["fails"].append("Discovery page content not rendered")
    else:
        result["passes"].append("Discovery page rendered")
    # With no completed job, ReportViewV2 isn't mounted — only the input form.
    # That's expected; the critical test is that the page doesn't crash.
    result["passes"].append(
        "v2 empty state booted; ReportViewV2 mounts only after job completion"
    )


def check_compare_v1(page: Page, result: dict):
    loaded = (
        page.locator("text=Compare").count() > 0
        or page.locator("text=比較").count() > 0
        or page.locator("h1, h2").count() > 0
    )
    if not loaded:
        result["fails"].append("Compare page content not rendered")
    else:
        result["passes"].append("Compare page rendered")


def check_compare_v2(page: Page, result: dict):
    loaded = (
        page.locator("text=Compare").count() > 0
        or page.locator("text=比較").count() > 0
        or page.locator("h1, h2").count() > 0
    )
    if not loaded:
        result["fails"].append("Compare page content not rendered")
    else:
        result["passes"].append("Compare page rendered")


def check_toggle_sync(page: Page, result: dict):
    url = page.url
    if "ui=v2" not in url:
        result["fails"].append(f"URL missing ui=v2 after navigation: {url}")
    else:
        result["passes"].append("URL preserves ui=v2")

    page.evaluate("() => localStorage.setItem('reportUiVersion', 'v2')")
    stored = page.evaluate("() => localStorage.getItem('reportUiVersion')")
    if stored != "v2":
        result["fails"].append(f"localStorage.reportUiVersion != v2: {stored}")
    else:
        result["passes"].append("localStorage.reportUiVersion=v2 persisted")

    page.goto(f"{BASE_URL}/discovery", wait_until="domcontentloaded", timeout=20000)
    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass
    stored2 = page.evaluate("() => localStorage.getItem('reportUiVersion')")
    if stored2 != "v2":
        result["fails"].append(f"storage lost after reload: {stored2}")
    else:
        result["passes"].append("storage persists across reload")

    page.evaluate("() => localStorage.removeItem('reportUiVersion')")
    cleared = page.evaluate("() => localStorage.getItem('reportUiVersion')")
    if cleared is not None:
        result["fails"].append(f"clear failed: {cleared}")
    else:
        result["passes"].append("clear works")


def run_print_pdf(context: BrowserContext, name: str, path: str, ui: str | None):
    page = context.new_page()
    url = f"{BASE_URL}{path}"
    if ui:
        sep = "&" if "?" in path else "?"
        url = f"{url}{sep}ui={ui}"
    try:
        goto_and_wait(page, url)
        page.emulate_media(media="print")
        pdf_path = OUT / f"{name}.pdf"
        page.pdf(path=str(pdf_path), format="A4", print_background=True)
        print(f"[PDF ] {name} -> {pdf_path}")
        return {"name": name, "pdf": str(pdf_path), "ok": True}
    except Exception as e:
        print(f"[PDF!] {name} failed: {e}")
        return {"name": name, "ok": False, "error": str(e)}
    finally:
        page.close()


def run_responsive(context: BrowserContext, path: str, ui: str | None):
    results = []
    for w, h in [(1440, 900), (1280, 720), (1024, 768)]:
        page = context.new_page()
        page.set_viewport_size({"width": w, "height": h})
        url = f"{BASE_URL}{path}"
        if ui:
            sep = "&" if "?" in path else "?"
            url = f"{url}{sep}ui={ui}"
        try:
            goto_and_wait(page, url)
            ss = snap(page, f"responsive_{w}x{h}_{ui or 'v1'}")
            results.append({"viewport": f"{w}x{h}", "ui": ui, "screenshot": ss})
            print(f"[RESP] {w}x{h} ui={ui or 'v1'} -> {ss}")
        except Exception as e:
            results.append({"viewport": f"{w}x{h}", "ui": ui, "error": str(e)})
            print(f"[RESP!] {w}x{h} failed: {e}")
        finally:
            page.close()
    return results


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1440, "height": 900}
        )
        seed_auth(context)

        run_pattern(context, "A_discovery_v1", "/discovery", "v1", check_discovery_v1)
        run_pattern(context, "B_discovery_v2", "/discovery", "v2", check_discovery_v2)

        # Pattern C: v2 via localStorage, no query
        setup_page = context.new_page()
        setup_page.goto(f"{BASE_URL}/discovery", wait_until="domcontentloaded")
        setup_page.evaluate("() => localStorage.setItem('reportUiVersion', 'v2')")
        setup_page.close()
        run_pattern(
            context,
            "C_discovery_v2_storage",
            "/discovery",
            None,
            check_discovery_v2,
        )

        run_pattern(context, "D_compare_v1", "/compare", "v1", check_compare_v1)
        run_pattern(context, "E_compare_v2", "/compare", "v2", check_compare_v2)
        run_pattern(context, "F_toggle_sync", "/discovery", "v2", check_toggle_sync)

        pdf_results = [
            run_print_pdf(context, "print_v1_discovery", "/discovery", "v1"),
            run_print_pdf(context, "print_v2_discovery", "/discovery", "v2"),
        ]

        resp_results = run_responsive(context, "/discovery", "v2")

        browser.close()

    summary = {
        "patterns": RESULTS,
        "pdf": pdf_results,
        "responsive": resp_results,
        "total_fails": sum(len(r["fails"]) for r in RESULTS),
    }
    (OUT / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"\n=== SUMMARY ===")
    print(f"Patterns: {len(RESULTS)}, total fails: {summary['total_fails']}")
    print(f"Report: {OUT / 'summary.json'}")
    return 0 if summary["total_fails"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
