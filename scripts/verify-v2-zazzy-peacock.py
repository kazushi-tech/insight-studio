"""Smoke test for zazzy-peacock v2 report UI changes.

Boots `npm run dev`, then opens Discovery and Compare pages to verify
that the updated v2 components render without console errors.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

BASE = "http://localhost:3002"
ROUTES = ["/", "/discovery", "/compare", "/analyze"]


def capture(page: Page, url: str, log: list[tuple[str, str, str]]) -> None:
    console_errors: list[str] = []
    page_errors: list[str] = []

    page.on(
        "console",
        lambda m: console_errors.append(m.text) if m.type == "error" else None,
    )
    page.on("pageerror", lambda e: page_errors.append(str(e)))

    resp = page.goto(url, wait_until="networkidle", timeout=20000)
    time.sleep(0.6)
    status = resp.status if resp else "?"
    log.append((url, f"status={status}", f"console_errors={len(console_errors)} page_errors={len(page_errors)}"))
    if console_errors:
        log.append((url, "console_error_sample", console_errors[0][:200]))
    if page_errors:
        log.append((url, "page_error_sample", page_errors[0][:200]))


def main() -> int:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        log: list[tuple[str, str, str]] = []
        for route in ROUTES:
            try:
                capture(page, f"{BASE}{route}", log)
            except Exception as exc:
                log.append((route, "EXCEPTION", str(exc)[:200]))
        browser.close()

    print("\n=== zazzy-peacock v2 UI smoke results ===")
    had_error = False
    for row in log:
        print(" | ".join(str(x) for x in row))
        if "error_sample" in row[1] or "EXCEPTION" in row[1]:
            had_error = True
    return 1 if had_error else 0


if __name__ == "__main__":
    sys.exit(main())
