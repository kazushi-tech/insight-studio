"""
Insight Studio — deterministic browser QA (Claude side, 95点化検証).

Connects to the already-running dev server on :3002. Public sales/login pages
run in a clean context; guarded app pages run in a separate seeded context.
The script then sweeps every required route
at multiple viewports. For each route it records: final URL (redirects),
console errors/warnings, page errors, failed network requests, broken images,
leftover '#' anchors, horizontal overflow, suspicious unsupported-claim copy,
and provider mentions. Full-page screenshots go to output/verification/.

Usage:
    python scripts/qa-browser-verify.py [zoom]
        zoom = "1.0" (default sweep 1366x768 + 1440x900) or "1.25" (zoom pass)
"""
import json
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3002"
OUT = Path("output/verification")

ROUTES = [
    ("/lp", "lp"),
    ("/lp/pricing", "lp-pricing"),
    ("/login", "login"),
    ("/", "dashboard"),
    ("/analysis", "analysis-hub"),
    ("/ads/wizard", "ads-wizard"),
    ("/ads/graphs", "ads-graphs"),
    ("/insights/ai?ui=v2", "insights-ai-v2"),
    ("/compare", "compare"),
    ("/discovery", "discovery"),
    ("/creative-review", "creative-review"),
]

# Unsupported / over-claim copy that must NOT appear anywhere.
SUSPICIOUS = [
    "SOC 2", "SOC2", "98%", "無制限", "公式保証", "学習利用なし",
    "1分で特定", "CVR 1-3%", "CVR1-3%", "直帰率40-60%",
    "直帰率10pt改善でCV",
]

SETUP_STATE = {
    "version": 3,
    "queryTypes": ["cv", "traffic", "landing"],
    "periods": ["2026-05"],
    "granularity": "monthly",
    "datasetId": "analytics_311324674",
    "completedAt": "2026-05-01T00:00:00.000Z",
}
CURRENT_CASE = {"case_id": "petabit", "name": "ペタビット", "dataset_id": "analytics_311324674"}
USER = {"role": "admin", "display_name": "QA Operator"}

SEED_JS = f"""
try {{
  localStorage.setItem('is_user', JSON.stringify({json.dumps(USER)}));
  localStorage.setItem('is_ads_token', 'qa-verify-token');
  localStorage.setItem('insight-studio-current-case', JSON.stringify({json.dumps(CURRENT_CASE)}));
  localStorage.setItem('insight-studio-case-authenticated', 'true');
  localStorage.setItem('insight-studio-ads-setup:petabit', JSON.stringify({json.dumps(SETUP_STATE)}));
  localStorage.setItem('insight-studio-guide-seen', '1');
}} catch (e) {{}}
"""

DIAG_JS = r"""
() => {
  const imgs = [...document.querySelectorAll('img')];
  const broken = imgs
    .filter(i => (i.complete && i.naturalWidth === 0) || (!i.complete && i.getAttribute('src')))
    .map(i => ({ alt: i.alt || '(no alt)', src: (i.currentSrc || i.src || '').slice(0, 80) }));
  const hashAnchors = [...document.querySelectorAll('a[href="#"], a[href=""]')]
    .map(a => (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 40))
    .filter(Boolean);
  const overflowX = document.documentElement.scrollWidth - window.innerWidth;
  const bodyText = document.body ? document.body.innerText : '';
  const heads = [...document.querySelectorAll('h1,h2,h3')]
    .map(h => h.innerText.trim()).filter(Boolean).slice(0, 8);
  const providerMentions = ['Gemini', 'Claude', 'Anthropic', 'GPT', 'OpenAI']
    .filter(p => bodyText.includes(p));
  return {
    finalUrl: location.pathname + location.search + location.hash,
    title: document.title,
    headings: heads,
    bodyLen: bodyText.length,
    imgTotal: imgs.length,
    brokenImgs: broken,
    hashAnchors,
    overflowXpx: overflowX,
    providerMentions,
    bodySample: bodyText.replace(/\s+/g, ' ').slice(0, 400),
  };
}
"""


def scroll_through(page):
    """Trigger IntersectionObserver reveals + lazy content, then return to top."""
    try:
        total = page.evaluate("document.documentElement.scrollHeight")
        vh = page.evaluate("window.innerHeight")
        y = 0
        while y < total:
            page.evaluate(f"window.scrollTo(0, {y})")
            page.wait_for_timeout(120)
            y += int(vh * 0.8)
        page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
        page.wait_for_timeout(200)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(200)
    except Exception:
        pass


def run_route(context, path, slug, viewport_label, zoom):
    page = context.new_page()
    console_errors, console_warnings, page_errors, failed_net = [], [], [], []

    page.on("console", lambda m: (
        console_errors.append(m.text[:200]) if m.type == "error"
        else console_warnings.append(m.text[:200]) if m.type == "warning"
        else None))
    page.on("pageerror", lambda e: page_errors.append(str(e)[:200]))
    page.on("requestfailed", lambda r: failed_net.append(
        {"url": r.url[:90], "err": (r.failure or "")[:60]}))

    def on_response(r):
        if r.status >= 400:
            failed_net.append({"url": r.url[:90], "status": r.status})
    page.on("response", on_response)

    try:
        page.goto(f"{BASE}{path}", wait_until="domcontentloaded", timeout=30000)
    except Exception as e:
        console_errors.append(f"[goto] {e}")
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass
    page.wait_for_timeout(700)

    if zoom and zoom != 1.0:
        page.evaluate(f"document.documentElement.style.zoom = '{zoom}'")
        page.wait_for_timeout(300)

    scroll_through(page)

    try:
        diag = page.evaluate(DIAG_JS)
    except Exception as e:
        diag = {"error": str(e)}

    # ignore network noise we can't control: external CDN + missing local API backend
    def is_ignorable(item):
        u = item.get("url", "")
        return ("googleusercontent.com" in u or "/api/ads/" in u or "/api/ml/" in u)

    real_net = [n for n in failed_net if not is_ignorable(n)]
    ignored_net = [n for n in failed_net if is_ignorable(n)]

    body = diag.get("bodySample", "") + " ".join(diag.get("headings", []))
    found_claims = [c for c in SUSPICIOUS if c in (diag.get("bodySample", "") or "")]

    OUT.joinpath(viewport_label).mkdir(parents=True, exist_ok=True)
    shot = OUT / viewport_label / f"{slug}.png"
    try:
        page.screenshot(path=str(shot), full_page=True)
    except Exception:
        try:
            page.screenshot(path=str(shot))
        except Exception:
            pass

    result = {
        "route": path,
        "viewport": viewport_label,
        "finalUrl": diag.get("finalUrl"),
        "redirected": (diag.get("finalUrl", path).split("?")[0].split("#")[0] != path.split("?")[0].split("#")[0]),
        "title": diag.get("title"),
        "bodyLen": diag.get("bodyLen"),
        "headings": diag.get("headings"),
        "imgTotal": diag.get("imgTotal"),
        "brokenImgs": diag.get("brokenImgs"),
        "hashAnchors": diag.get("hashAnchors"),
        "overflowXpx": diag.get("overflowXpx"),
        "suspiciousClaims": found_claims,
        "providerMentions": diag.get("providerMentions"),
        "consoleErrors": console_errors,
        "consoleWarnings": console_warnings[:5],
        "pageErrors": page_errors,
        "realFailedNet": real_net,
        "ignoredFailedNetCount": len(ignored_net),
        "screenshot": str(shot),
    }
    page.close()
    return result


def verify_public_sales_flow(context, viewport_label):
    """The public sample CTA must never dead-end at the password screen."""
    page = context.new_page()
    try:
        page.goto(f"{BASE}/lp", wait_until="domcontentloaded", timeout=30000)
        page.get_by_role("link", name="画面サンプルを見る").first.click()
        page.wait_for_timeout(300)
        final_url = page.evaluate("location.pathname + location.hash")
        preview_visible = page.get_by_role("heading", name="開いたら、見る順番が分かります。").is_visible()
        if final_url != "/lp#product-preview" or not preview_visible:
            raise AssertionError(f"public sample CTA failed: url={final_url}, visible={preview_visible}")
        print(f"[{viewport_label}] public sample CTA          -> {final_url:30s} [OK]")
    finally:
        page.close()


def main():
    zoom = float(sys.argv[1]) if len(sys.argv) > 1 else 1.0
    if zoom == 1.0:
        viewports = [(390, 844, "390x844"), (1366, 768, "1366x768"), (1440, 900, "1440x900")]
    else:
        viewports = [(1366, 768, f"1366x768-zoom{zoom}")]

    all_results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for w, h, label in viewports:
            public_context = browser.new_context(viewport={"width": w, "height": h})
            for path, slug in ROUTES[:3]:
                res = run_route(public_context, path, slug, label, zoom)
                all_results.append(res)
                flag = "OK"
                if res["consoleErrors"] or res["pageErrors"]:
                    flag = "CONSOLE_ERR"
                if res["brokenImgs"]:
                    flag = "BROKEN_IMG"
                if res["realFailedNet"]:
                    flag = "NET_ERR"
                if res["suspiciousClaims"]:
                    flag = "CLAIM"
                print(f"[{label}] {path:28s} -> {res['finalUrl']:30s} "
                      f"ovf={res['overflowXpx']:>4}px img={len(res['brokenImgs'])} "
                      f"cerr={len(res['consoleErrors'])} perr={len(res['pageErrors'])} "
                      f"net={len(res['realFailedNet'])} claim={len(res['suspiciousClaims'])} [{flag}]")
            verify_public_sales_flow(public_context, label)
            public_context.close()

            app_context = browser.new_context(viewport={"width": w, "height": h})
            app_context.add_init_script(SEED_JS)
            for path, slug in ROUTES[3:]:
                res = run_route(app_context, path, slug, label, zoom)
                all_results.append(res)
                flag = "OK"
                if res["consoleErrors"] or res["pageErrors"]:
                    flag = "CONSOLE_ERR"
                if res["brokenImgs"]:
                    flag = "BROKEN_IMG"
                if res["realFailedNet"]:
                    flag = "NET_ERR"
                if res["suspiciousClaims"]:
                    flag = "CLAIM"
                print(f"[{label}] {path:28s} -> {res['finalUrl']:30s} "
                      f"ovf={res['overflowXpx']:>4}px img={len(res['brokenImgs'])} "
                      f"cerr={len(res['consoleErrors'])} perr={len(res['pageErrors'])} "
                      f"net={len(res['realFailedNet'])} claim={len(res['suspiciousClaims'])} [{flag}]")
            app_context.close()
        browser.close()

    OUT.mkdir(parents=True, exist_ok=True)
    report_path = OUT / (f"qa-report-zoom{zoom}.json" if zoom != 1.0 else "qa-report.json")
    report_path.write_text(json.dumps(all_results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nReport written: {report_path}")


if __name__ == "__main__":
    main()
