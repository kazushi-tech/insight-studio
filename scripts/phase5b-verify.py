"""Phase 5B — Real-data E2E verification for Stitch 2.0 v2.

Runs three Playwright patterns against a live dev server:

    G: /debug/report-v2?jobId=<id>&ui=v1  (parity — debug route ignores ui query, treated as v2 smoke)
    H: /debug/report-v2?jobId=<id>&ui=v2  (v2 main verification)
    J: /debug/report-v2?jobId=<id>&ui=v2&envelope=null  (MD fallback)

Pattern I (Compare v2) is intentionally skipped: Compare side currently has no
debug route, and Compare simply calls ReportViewV2 the same way Discovery does,
so G/H/J cover the v2 component health needed for Phase 5C promotion.

Prerequisites
-------------
* `npm run dev` on port 3002 and both backends running (see CLAUDE.md /dev.ps1).
* A completed Discovery job whose job id is exported as DISCOVERY_SEARCH_ID.
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
# DISCOVERY_SEARCH_ID is the Discovery job id to hydrate against.
JOB_ID = os.environ.get("DISCOVERY_SEARCH_ID", "").strip()
AUTH_TOKEN = os.environ.get("AUTH_TOKEN", "").strip()
OUTPUT_DIR = Path(os.environ.get("PHASE5B_OUTPUT_DIR", "verify_output/phase5b"))
VIEWPORT = {"width": 1440, "height": 900}
LOAD_STATE = "networkidle"


def build_debug_url(job_id: str, *, ui: str | None = None, envelope_null: bool = False) -> str:
    params = [f"jobId={job_id}"]
    if ui:
        params.append(f"ui={ui}")
    if envelope_null:
        params.append("envelope=null")
    return f"{BASE_URL}/debug/report-v2?{'&'.join(params)}"


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
    # AuthGuard reads `is_ads_token` + `is_user` from localStorage. When AUTH_TOKEN
    # is provided we honor it, otherwise we seed a deterministic dev-mode stub so
    # the Discovery / Compare pages (both under AuthGuard) become reachable.
    token = AUTH_TOKEN or "phase5b-dev-token"
    user = {"role": "admin", "display_name": "Phase 5B Tester"}
    context.add_init_script(
        "window.localStorage.setItem('is_ads_token', "
        f"{json.dumps(token)});"
        "window.localStorage.setItem('is_user', "
        f"{json.dumps(json.dumps(user))});"
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

    # Real endpoints (see src/api/marketLens.js:888-894):
    #   GET /api/ml/scans/{run_id}/report.json
    #   GET /api/ml/discovery/jobs/{job_id}/report.json
    page.route("**/api/ml/discovery/jobs/*/report.json", handler)
    page.route("**/api/ml/scans/*/report.json", handler)


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
    url: str,
    *,
    is_v2: bool,
    force_envelope_null: bool = False,
) -> PatternResult:
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
    if not JOB_ID:
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

    # Pattern I (Compare v2) is skipped — Compare currently has no debug route
    # and calls ReportViewV2 identically to Discovery, so H + J sufficiently
    # exercise the v2 component health for Phase 5C promotion. See plan
    # plans/claude-html-markdown-claude-claude-jolly-kay.md §3-1 Pattern I note.
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            # Pattern G — debug route does not branch to v1, so we treat G as
            # an additional v2 smoke with ui=v1 query preserved purely for
            # parity with the plan's URL mapping. v1 baseline is covered by
            # vitest unit tests (see src/pages/__tests__).
            results.append(
                run_pattern(
                    browser,
                    "G_debug_v2_with_v1_query",
                    build_debug_url(JOB_ID, ui="v1"),
                    is_v2=True,
                )
            )
            results.append(
                run_pattern(
                    browser,
                    "H_debug_v2",
                    build_debug_url(JOB_ID, ui="v2"),
                    is_v2=True,
                )
            )
            results.append(
                run_pattern(
                    browser,
                    "J_debug_v2_md_fallback",
                    build_debug_url(JOB_ID, ui="v2", envelope_null=True),
                    is_v2=True,
                    force_envelope_null=True,
                )
            )
        finally:
            browser.close()

    elapsed = time.time() - start
    summary = {
        "base_url": BASE_URL,
        "job_id": JOB_ID,
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
