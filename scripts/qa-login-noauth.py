"""QA the /login page WITHOUT auth seed (so it does not redirect to /)."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

DIAG = r"""
() => ({
  url: location.pathname,
  title: document.title,
  bodyLen: document.body.innerText.length,
  heads: [...document.querySelectorAll('h1,h2,h3')].map(h=>h.innerText.trim()).filter(Boolean).slice(0,6),
  inputs: [...document.querySelectorAll('input')].map(i=>i.type+':'+(i.placeholder||i.name||'')).slice(0,8),
  buttons: [...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(Boolean).slice(0,8),
  overflowX: document.documentElement.scrollWidth - window.innerWidth,
  brokenImgs: [...document.querySelectorAll('img')].filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.alt||i.src.slice(0,60)),
  hashAnchors: [...document.querySelectorAll('a[href="#"]')].length,
  bodySample: document.body.innerText.replace(/\s+/g,' ').slice(0,300)
})
"""

errs, pe, net = [], [], []
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1366, "height": 768})
    pg = ctx.new_page()
    pg.on("console", lambda m: errs.append(m.text[:160]) if m.type == "error" else None)
    pg.on("pageerror", lambda e: pe.append(str(e)[:160]))
    pg.on("response", lambda r: net.append((r.status, r.url[:70])) if r.status >= 400 else None)
    pg.goto("http://localhost:3002/login", wait_until="domcontentloaded", timeout=30000)
    try:
        pg.wait_for_load_state("networkidle", timeout=6000)
    except Exception:
        pass
    pg.wait_for_timeout(800)
    d = pg.evaluate(DIAG)
    Path("output/verification/1366x768").mkdir(parents=True, exist_ok=True)
    pg.screenshot(path="output/verification/1366x768/login-noauth.png", full_page=True)
    print(json.dumps({"diag": d, "consoleErrors": errs, "pageErrors": pe,
                      "failedNet": [n for n in net if "/api/" in n[1]]},
                     ensure_ascii=False, indent=2))
    b.close()
