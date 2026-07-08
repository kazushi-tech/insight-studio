"""Capture the 4 non-required LP sub-pages to confirm image fallbacks look clean."""
from pathlib import Path
from playwright.sync_api import sync_playwright

PAGES = [("/lp/compare", "lp-compare"), ("/lp/creative", "lp-creative"),
         ("/lp/discovery", "lp-discovery"), ("/lp/performance", "lp-performance")]
OUT = Path("output/verification/1366x768")
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1366, "height": 768})
    for path, slug in PAGES:
        pg = ctx.new_page()
        broken = []
        pg.on("pageerror", lambda e: broken.append(("pageerror", str(e)[:120])))
        pg.goto(f"http://localhost:3002{path}", wait_until="domcontentloaded", timeout=30000)
        try:
            pg.wait_for_load_state("networkidle", timeout=6000)
        except Exception:
            pass
        pg.wait_for_timeout(500)
        # scroll through to trigger reveals
        total = pg.evaluate("document.documentElement.scrollHeight")
        y = 0
        while y < total:
            pg.evaluate(f"window.scrollTo(0,{y})")
            pg.wait_for_timeout(80)
            y += 600
        pg.evaluate("window.scrollTo(0,0)")
        pg.wait_for_timeout(200)
        info = pg.evaluate("""() => ({
          imgsBroken: [...document.querySelectorAll('img')].filter(i=>i.complete&&i.naturalWidth===0).length,
          imgTotal: document.querySelectorAll('img').length,
          placeholders: document.querySelectorAll('div[role=img]').length,
          overflowX: document.documentElement.scrollWidth - window.innerWidth
        })""")
        pg.screenshot(path=str(OUT / f"{slug}.png"), full_page=True)
        print(f"{path:20s} brokenImgs={info['imgsBroken']} imgTotal={info['imgTotal']} "
              f"placeholders={info['placeholders']} ovf={info['overflowX']} pageerrors={len(broken)}")
        pg.close()
    b.close()
