"""Phase 5B — Real-data E2E verification for Stitch 2.0 v2.

Runs four Playwright patterns against a live dev server:

    G: /discovery/result?search_id=<id>&ui=v1  (v1 baseline regression)
    H: /discovery/result?search_id=<id>&ui=v2  (v2 main verification)
    I: /compare/result?search_id=<id>&ui=v2    (Compare v2)
    J: /discovery/result?search_id=<id>&ui=v2  (envelope forced null — MD fallback)

Prerequisites
-------------
* `npm run dev` on port 3002 and both backends running (see CLAUDE.md /dev.ps1).
* A completed Discovery job whose `search_id` is exported as DISCOVERY_SEARCH_ID.
* An auth token exported as AUTH_TOKEN if the app requires login; otherwise the
  script attempts unauthenticated access.
* `pip install playwright && python -m playwright install chromium`.

Outputs land in `verify_output/phase5b/` (gitignored).
"""

from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    from playwright.sync_api import (
        Browser,
        BrowserContext,
        Page,
        Route,
        sync_playwright,
    )
except ImportError:  # pragma: no cover
    print("playwright is not installed. Run: pip install playwright && python -m playwright install chromium")
    sys.exit(2)


BASE_URL = os.environ.get("PHASE5B_BASE_URL", "http://localhost:3002")
SEARCH_ID = os.environ.get("DISCOVERY_SEARCH_ID", "").strip()
AUTH_TOKEN = os.environ.get("AUTH_TOKEN", "").strip()
OUTPUT_DIR = Path(os.environ.get("PHASE5B_OUTPUT_DIR", "verify_output/phase5b"))
VIEWPORT = {"width": 1440, "height": 900}
LOAD_STATE = "networkidle"


@dataclass
class PatternResult:
    name: str
    url: str
    passed: bool = True
    findings: list[str] = field(default_factory=list)
    console_errors: list[str] = field(default_factory=list)
    page_errors: list[str] = field(default_factory=list)
    failed_requests: list[str] = field(default_factory=list)
    screenshots: list[str] = field(default_factory=list)
    checks: dict[str, Any] = field(default_factory=dict)

    def fail(self, msg: str) -> None:
        self.passed = False
        self.findings.append(msg)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "url": self.url,
            "passed": self.passed,
            "findings": self.findings,
            "console_errors": self.console_errors,
            "page_errors": self.page_errors,
            "failed_requests": self.failed_requests,
            "screenshots": self.screenshots,
            "checks": self.checks,
        }


def seed_auth(context: BrowserContext) -> None:
    if not AUTH_TOKEN:
        return
    context.add_init_script(
        f"window.localStorage.setItem('auth_token', {json.dumps(AUTH_TOKEN)});"
    )


def attach_listeners(page: Page, result: PatternResult) -> None:
    def on_console(msg):
        if msg.type in ("error",):
            result.console_errors.append(msg.text)

    def on_pageerror(err):
        result.page_errors.append(str(err))

    def on_requestfailed(req):
        # Ignore aborted navigations & canceled HMR polls
        failure = req.failure or ""
        if "ERR_ABORTED" in failure or "net::ERR_ABORTED" in failure:
            return
        result.failed_requests.append(f"{req.method} {req.url} — {failure}")

    page.on("console", on_console)
    page.on("pageerror", on_pageerror)
    page.on("requestfailed", on_requestfailed)


def maybe_force_envelope_null(page: Page, forced: bool) -> None:
    if not forced:
        return

    def handler(route: Route) -> None:
        route.fulfill(status=404, body='{"detail":"forced null by phase5b"}')

    page.route("**/api/ml/discovery/*/report-envelope", handler)
    page.route("**/api/ml/scan/*/report-envelope", handler)


def v2_checks(page: Page, result: PatternResult) -> None:
    """Assert v2 DOM + tokens + chart defaults."""
    root_count = page.locator("div.ui-v2").count()
    result.checks["ui_v2_root_count"] = root_count
    if root_count < 1:
        result.fail("ui-v2 root not found")

    # Components (fall back to heuristics — PriorityActionHero etc. render a
    # dedicated card; we look for their data-testid if present, else the card
    # container's text).
    locators = {
        "priority_action_hero_v2": "[data-testid='priority-action-hero-v2'], .ui-v2 [class*='priorityActionHeroV2']",
        "competitor_matrix_v2": "[data-testid='competitor-matrix-v2'], .ui-v2 table",
        "brand_radar_v2": "[data-testid='brand-radar-v2'], .ui-v2 canvas",
        "market_range_v2": "[data-testid='market-range-v2'], .ui-v2 [class*='marketRangeV2']",
        "confidence_pill": "[data-testid='confidence-pill'], .ui-v2 [class*='confidencePill']",
    }
    for key, selector in locators.items():
        count = page.locator(selector).count()
        result.checks[key] = count
        if count < 1:
            result.fail(f"{key} not found (selector: {selector})")

    token = page.evaluate(
        "() => {"
        "  const root = document.querySelector('div.ui-v2');"
        "  if (!root) return null;"
        "  const cs = getComputedStyle(root);"
        "  return {"
        "    primary: cs.getPropertyValue('--md-sys-color-primary').trim(),"
        "    fontFamily: cs.getPropertyValue('font-family').trim(),"
        "  };"
        "}"
    )
    result.checks["md_tokens"] = token
    if not token or token.get("primary") not in {"#003925", "rgb(0, 57, 37)"}:
        result.fail(f"--md-sys-color-primary not resolved on .ui-v2 (got {token})")
    if token and "Manrope" not in (token.get("fontFamily") or "") and "Inter" not in (token.get("fontFamily") or ""):
        result.fail(f"v2 font-family not Manrope/Inter (got {token.get('fontFamily')})")

    chart_defaults = page.evaluate(
        "() => (window.Chart && window.Chart.defaults && window.Chart.defaults.font && window.Chart.defaults.font.family) || null"
    )
    result.checks["chart_defaults_family"] = chart_defaults
    if chart_defaults and "Manrope" not in chart_defaults:
        result.fail(f"Chart.defaults.font.family missing Manrope (got {chart_defaults})")


def v1_checks(page: Page, result: PatternResult) -> None:
    root_count = page.locator("div.ui-v2").count()
    result.checks["ui_v2_root_count"] = root_count
    if root_count > 0:
        result.fail("ui-v2 root unexpectedly present in v1 pattern")


def run_pattern(
    browser: Browser,
    name: str,
    path: str,
    *,
    is_v2: bool,
    force_envelope_null: bool = False,
) -> PatternResult:
    url = f"{BASE_URL}{path}"
    result = PatternResult(name=name, url=url)
    context = browser.new_context(viewport=VIEWPORT)
    seed_auth(context)
    page = context.new_page()
    attach_listeners(page, result)
    maybe_force_envelope_null(page, force_envelope_null)

    try:
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        try:
            page.wait_for_load_state(LOAD_STATE, timeout=15_000)
        except Exception as exc:  # pragma: no cover
            result.findings.append(f"networkidle wait failed: {exc}")
        # Let charts settle
        page.wait_for_timeout(1_200)

        if is_v2:
            v2_checks(page, result)
        else:
            v1_checks(page, result)

        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        shot = OUTPUT_DIR / f"{name}.png"
        page.screenshot(path=str(shot), full_page=True)
        result.screenshots.append(shot.as_posix())
    finally:
        context.close()

    # Accumulated errors fail the pattern
    if result.console_errors:
        result.fail(f"{len(result.console_errors)} console error(s)")
    if result.page_errors:
        result.fail(f"{len(result.page_errors)} pageerror(s)")
    if result.failed_requests:
        result.fail(f"{len(result.failed_requests)} failed request(s)")

    return result


def main() -> int:
    if not SEARCH_ID:
        print(
            "[phase5b] DISCOVERY_SEARCH_ID env var is required — skipping run.\n"
            "  Export it to a completed Discovery job id, e.g.:\n"
            "  DISCOVERY_SEARCH_ID=a03bc0f98cfa python scripts/phase5b-verify.py",
            file=sys.stderr,
        )
        return 3

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    start = time.time()
    results: list[PatternResult] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            results.append(
                run_pattern(
                    browser,
                    "G_discovery_v1",
                    f"/discovery/result?search_id={SEARCH_ID}&ui=v1",
                    is_v2=False,
                )
            )
            results.append(
                run_pattern(
                    browser,
                    "H_discovery_v2",
                    f"/discovery/result?search_id={SEARCH_ID}&ui=v2",
                    is_v2=True,
                )
            )
            results.append(
                run_pattern(
                    browser,
                    "I_compare_v2",
                    f"/compare/result?search_id={SEARCH_ID}&ui=v2",
                    is_v2=True,
                )
            )
            results.append(
                run_pattern(
                    browser,
                    "J_discovery_v2_md_fallback",
                    f"/discovery/result?search_id={SEARCH_ID}&ui=v2",
                    is_v2=True,
                    force_envelope_null=True,
                )
            )
        finally:
            browser.close()

    elapsed = time.time() - start
    summary = {
        "base_url": BASE_URL,
        "search_id": SEARCH_ID,
        "elapsed_seconds": round(elapsed, 2),
        "patterns": [r.to_dict() for r in results],
        "all_passed": all(r.passed for r in results),
    }

    summary_path = OUTPUT_DIR / "summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")

    print(json.dumps(summary, indent=2, ensure_ascii=False))
    print(f"\n[phase5b] summary -> {summary_path}")

    return 0 if summary["all_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
