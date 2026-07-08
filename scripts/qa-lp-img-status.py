"""Carefully inspect LP image load status after a proper settle."""
from pathlib import Path
from playwright.sync_api import sync_playwright

PAGES = ["/lp", "/lp/compare", "/lp/creative", "/lp/discovery", "/lp/performance"]

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1366, "height": 768})
    for path in PAGES:
        pg = ctx.new_page()
        pg.goto(f"http://localhost:3002{path}", wait_until="domcontentloaded", timeout=30000)
        try:
            pg.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        # scroll fully to mount/trigger all images
        total = pg.evaluate("document.documentElement.scrollHeight")
        y = 0
        while y < total:
            pg.evaluate(f"window.scrollTo(0,{y})")
            pg.wait_for_timeout(120)
            y += 500
        pg.wait_for_timeout(3000)  # let any 4xx errors propagate
        info = pg.evaluate("""() => {
          const imgs = [...document.querySelectorAll('img')];
          return {
            imgTotal: imgs.length,
            loaded: imgs.filter(i=>i.complete && i.naturalWidth>0).length,
            broken: imgs.filter(i=>i.complete && i.naturalWidth===0).length,
            pending: imgs.filter(i=>!i.complete).length,
            placeholders: document.querySelectorAll('div[role=img]').length,
            imgSrcs: imgs.map(i => (i.currentSrc||i.src).slice(0,50))
          };
        }""")
        print(f"{path:18s} total={info['imgTotal']} loaded={info['loaded']} "
              f"broken={info['broken']} pending={info['pending']} placeholders={info['placeholders']}")
        for s in info['imgSrcs']:
            print("      img:", s)
        pg.close()
    b.close()
