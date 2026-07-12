"""Deterministic desktop/mobile browser smoke for the customer journey.

Every scenario starts from a brand-new Playwright context.  API calls are
fulfilled with non-customer fixtures so the gate never needs production data or
secrets and any failed request is treated as a regression.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from urllib.parse import urlparse

from playwright.sync_api import BrowserContext, Page, Route, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
AXE_SOURCE = ROOT / "node_modules" / "axe-core" / "axe.min.js"


VIEWPORTS = (
    (360, 800, "mobile-360"),
    (390, 844, "mobile-390"),
    (768, 1024, "tablet-768"),
    (1440, 900, "desktop-1440"),
)
SETUP = {
    "version": 3,
    "queryTypes": ["pv", "traffic", "cv"],
    "periods": ["2026-06", "2026-07"],
    "granularity": "monthly",
    "datasetId": "analytics_ci_fixture",
    "completedAt": "2026-07-12T00:00:00.000Z",
}

PUBLIC_REPORT = {
    "schema_version": "report.v2",
    "report_id": "ci-contract-report",
    "project_id": "ci-project",
    "scope": {
        "current_period": {"start": "2026-07-01", "end": "2026-07-31"},
        "site_name": "CI確認サイト",
    },
    "availability": {"overall": "full", "metrics": []},
    "metrics": [],
    "conclusions": [
        {
            "kind": "what_happened",
            "title": "訪問が増えています",
            "body": "前の期間との違いを確認できました。",
            "severity": "positive",
            "confidence": "high",
            "evidence_keys": ["evidence-1"],
        }
    ],
    "actions": [],
    "evidence": [
        {"key": "evidence-1", "query_type": "traffic", "title": "訪問の推移", "chart": None}
    ],
    "caveats": [],
    "generated_at": "2026-08-01T00:00:00Z",
}


def _mock_api(route: Route) -> None:
    request = route.request
    path = urlparse(request.url).path
    headers = {"access-control-allow-origin": "*", "content-type": "application/json"}
    if "/report-shares/" in path:
        body = {
            "ok": True,
            "share": {
                "title": "Web成果レポート",
                "summary": "確認できた範囲をまとめました。",
                "report": PUBLIC_REPORT,
                "expires_at": "2026-08-08T00:00:00Z",
            },
        }
    elif path.endswith("/projects/ci-project/reports/ci-report"):
        body = {
            "ok": True,
            "report": {
                "id": "ci-report",
                "title": "Web成果レポート",
                "summary": "確認できた範囲をまとめました。",
                "report": PUBLIC_REPORT,
            },
        }
    elif path.endswith("/cases/login"):
        body = {
            "ok": True,
            "case_id": "ci-demo",
            "name": "CIデモ案件",
            "dataset_id": "analytics_ci_fixture",
            "is_demo": True,
            "token": "ci-browser-token",
        }
    elif path.endswith("/cases"):
        body = {
            "ok": True,
            "cases": [
                {
                    "case_id": "ci-demo",
                    "name": "CIデモ案件",
                    "dataset_id": "analytics_ci_fixture",
                    "is_demo": True,
                }
            ],
        }
    elif path.endswith("/projects") and request.method == "GET":
        body = {
            "ok": True,
            "projects": [
                {
                    "id": "ci-project",
                    "name": "CI管理サイト",
                    "description": "権限分離を確認するテストサイト",
                    "status": "active",
                    "version": 1,
                }
            ],
        }
    elif path.endswith("/projects") and request.method == "POST":
        body = {
            "ok": True,
            "project": {
                "id": "ci-created-project",
                "name": "CI新規サイト",
                "description": None,
                "status": "active",
                "version": 1,
            },
        }
    elif path.endswith("/projects/ci-project") and request.method == "PATCH":
        body = {
            "ok": True,
            "project": {
                "id": "ci-project",
                "name": "CI管理サイト",
                "description": "権限分離を確認するテストサイト",
                "status": "active",
                "version": 2,
            },
        }
    elif path.endswith("/projects/ci-project/data-source"):
        body = {"ok": True, "data_source": {"configured": True, "status": "active"}}
    elif path.endswith("/projects/ci-created-project/data-source"):
        body = {"ok": True, "data_source": {"configured": False, "status": "not_configured"}}
    elif path.endswith("/projects/ci-project/members"):
        body = {"ok": True, "members": []}
    elif path.endswith("/bq/periods"):
        body = {"ok": True, "periods": ["2026-06", "2026-07"], "dataset_id": "analytics_ci_fixture"}
    elif path.endswith("/bq/query_types"):
        body = {"ok": True, "query_types": ["pv", "traffic", "cv"]}
    elif "/bq/generate" in path:
        def report_result(period: str, values: list[int]) -> dict:
            return {
                "ok": True,
                "period": period,
                "site": {"name": "CI確認サイト", "url": "https://ci.example.invalid"},
                "data_availability": "full",
                "report_md": f"# {period}の確認結果",
                "chart_data": {
                    "groups": [
                        {
                            "title": "閲覧数 — 日別推移",
                            "query_type": "pv",
                            "chartType": "line",
                            "labels": [f"{period}-01", f"{period}-02"],
                            "datasets": [{"label": "見られた回数", "data": values}],
                        }
                    ]
                },
                "execution_summary": [
                    {
                        "query_type": "pv",
                        "status": "success",
                        "row_count": len(values),
                        "chart_group_count": 1,
                    }
                ],
                "beginner_report": {
                    "version": "beginner_report_v1",
                    "summary_cards": [
                        {
                            "type": "what_happened",
                            "title": "訪問が増えています",
                            "body": "前の期間との違いを確認できました。",
                            "severity": "positive",
                            "evidence_chart_ids": ["chart_01"],
                        }
                    ],
                    "next_actions": [
                        {
                            "priority": "P1",
                            "title": "増えた日の内容を確認する",
                            "reason": "伸びた理由を次の改善へ活かすためです。",
                        }
                    ],
                    "data_gaps": [],
                    "recommended_charts": ["chart_01"],
                },
            }

        request_payload = request.post_data_json if request.post_data else {}
        period = str(request_payload.get("period") or "2026-07")
        values = [120, 160] if period == "2026-07" else [90, 110]
        body = report_result(period, values)
    elif path.endswith("/health") or path.endswith("/readiness"):
        body = {"ok": True, "status": "healthy", "version": "ci"}
    elif "/bq-status" in path:
        body = {"ok": True, "connected": True, "latest_date": "2026-07-11"}
    else:
        body = {"ok": True, "items": [], "results": []}
    route.fulfill(status=200, headers=headers, body=json.dumps(body, ensure_ascii=False))


def _wire_context(context: BrowserContext) -> None:
    context.add_init_script(
        """
        window.__insightCiBootErrors = [];
        window.addEventListener('error', (event) => {
          window.__insightCiBootErrors.push(String(event.message || 'window error'));
        });
        window.addEventListener('unhandledrejection', (event) => {
          window.__insightCiBootErrors.push(String(event.reason?.message || event.reason || 'unhandled rejection'));
        });
        """
    )
    # Keep browser verification hermetic. External font stylesheets are
    # parser-blocking for module execution and can leave DOMContentLoaded
    # waiting until Playwright's navigation timeout in network-restricted CI.
    context.route(
        "https://fonts.googleapis.com/**",
        lambda route: route.fulfill(
            status=200,
            headers={"content-type": "text/css; charset=utf-8"},
            body="",
        ),
    )
    context.route("**/api/ads/**", _mock_api)
    context.route("**/api/insights/**", _mock_api)
    context.route("**/api/ml/**", _mock_api)


def _wire_hybrid_admin_login(context: BrowserContext) -> None:
    """Exercise the clean-storage legacy admin bridge without persisting its JWT."""

    context.route(
        "**/api/ads/cases/login",
        lambda route: route.fulfill(
            status=401,
            headers={"content-type": "application/json"},
            body=json.dumps({"ok": False, "detail": "invalid credentials"}),
        ),
    )
    context.route(
        "**/api/ads/auth/login",
        lambda route: route.fulfill(
            status=200,
            headers={"content-type": "application/json"},
            body=json.dumps({"ok": True, "token": "ci-admin-token"}),
        ),
    )


def _login_hybrid_admin(page: Page, base_url: str, label: str) -> None:
    page.goto(f"{base_url}/login", wait_until="commit")
    _assert_surface(page, "/login", f"{label}/login")
    page.locator("#login-password").fill("ci-admin-fixture-password")
    page.get_by_role("button", name="ログインする").click()
    # Legacy admins correctly land on Dashboard; move through the SPA without a
    # reload so the memory-only token is preserved for the protected journey.
    page.wait_for_url(f"{base_url}/", timeout=10_000)
    _assert_surface(page, "/", f"{label}/home")
    guide = page.get_by_role("dialog", name="使い方ガイド")
    if guide.count() and guide.is_visible():
        guide.get_by_role("button", name="閉じる").click()
        guide.wait_for(state="hidden", timeout=10_000)
    _spa_navigate(page, "/ads/wizard")
    _assert_surface(page, "/ads/wizard", f"{label}/wizard")
    if page.evaluate("Boolean(localStorage.getItem('is_ads_token'))"):
        raise AssertionError(f"{label}: hybrid admin token leaked into localStorage")


def _spa_navigate(page: Page, path: str, *, accepted_paths: tuple[str, ...] | None = None) -> None:
    current_heading = page.locator("main h1").first
    previous_heading = current_heading.text_content() if current_heading.count() else None
    page.evaluate(
        """path => {
          window.history.pushState({}, '', path);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }""",
        path,
    )
    paths = list(accepted_paths or (path,))
    page.wait_for_function(
        "paths => paths.includes(window.location.pathname)",
        arg=paths,
        timeout=10_000,
    )
    if previous_heading is not None:
        page.wait_for_function(
            """previous => {
              const heading = document.querySelector('main h1');
              return !heading || (heading.textContent || '').trim() !== previous.trim();
            }""",
            arg=previous_heading,
            timeout=10_000,
        )


class Diagnostics:
    def __init__(self, page: Page, origin: str) -> None:
        self.console_errors: list[str] = []
        self.page_errors: list[str] = []
        self.failed_requests: list[str] = []
        origin_host = urlparse(origin).netloc
        page.on(
            "console",
            lambda message: self.console_errors.append(message.text)
            if message.type == "error"
            else None,
        )
        page.on("pageerror", lambda error: self.page_errors.append(str(error)))

        def record_failed(request) -> None:
            failure = request.failure or ""
            if "ERR_ABORTED" in failure:
                return
            if urlparse(request.url).netloc == origin_host:
                self.failed_requests.append(urlparse(request.url).path)

        page.on("requestfailed", record_failed)

    def assert_clean(self, label: str) -> None:
        failures = []
        if self.console_errors:
            failures.append(f"console={self.console_errors[:3]}")
        if self.page_errors:
            failures.append(f"page={self.page_errors[:3]}")
        if self.failed_requests:
            failures.append(f"network={self.failed_requests[:3]}")
        if failures:
            raise AssertionError(f"{label}: " + "; ".join(failures))


def _assert_surface(page: Page, expected_path: str, label: str) -> None:
    try:
        page.wait_for_function(
            "expected => window.location.pathname === expected",
            arg=expected_path,
            timeout=10_000,
        )
        page.wait_for_function(
            """expected => {
              const main = document.querySelector('main');
              const heading = main?.querySelector('h1');
              const loading = (document.body?.innerText || '').includes('画面を準備しています');
              const ready = window.location.pathname === expected
                && Boolean(main)
                && Boolean(heading?.getClientRects().length)
                && !loading;
              if (!ready) {
                window.__insightSurfaceReadySince = 0;
                return false;
              }
              const now = performance.now();
              window.__insightSurfaceReadySince ||= now;
              return now - window.__insightSurfaceReadySince >= 250;
            }""",
            arg=expected_path,
            timeout=10_000,
        )
    except Exception as exc:
        state = page.evaluate(
            """() => ({
              readyState: document.readyState,
              rootChildren: document.querySelector('#root')?.childElementCount ?? -1,
              rootText: (document.querySelector('#root')?.textContent || '').slice(0, 160),
              bootErrors: window.__insightCiBootErrors || [],
              resources: performance.getEntriesByType('resource').slice(-12).map((entry) => {
                try { return new URL(entry.name).pathname; } catch { return 'invalid-resource'; }
              }),
            })"""
        )
        raise AssertionError(f"{label}: application surface did not render; {state}") from exc
    actual_path = urlparse(page.url).path
    if actual_path != expected_path:
        state = page.evaluate(
            """() => ({
              hasToken: Boolean(localStorage.getItem('is_ads_token')),
              role: JSON.parse(localStorage.getItem('is_user') || 'null')?.role || null,
              caseId: JSON.parse(localStorage.getItem('insight-studio-current-case') || 'null')?.case_id || null,
              caseAuthenticated: localStorage.getItem('insight-studio-case-authenticated'),
              setupKeys: Object.keys(localStorage).filter(key => key.startsWith('insight-studio-ads-setup')),
            })"""
        )
        raise AssertionError(
            f"{label}: expected {expected_path}, got {actual_path}; state={state}"
        )
    metrics = page.evaluate(
        """() => ({
          mainCount: document.querySelectorAll('main').length,
          headingCount: document.querySelectorAll('h1,h2').length,
          h1Count: document.querySelectorAll('h1').length,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          bodyLength: document.body?.innerText?.trim().length || 0,
        })"""
    )
    if metrics["mainCount"] != 1:
        raise AssertionError(f"{label}: expected one main landmark, got {metrics['mainCount']}")
    if metrics["headingCount"] < 1 or metrics["bodyLength"] < 30:
        excerpt = page.locator("body").inner_text()[:500]
        raise AssertionError(
            f"{label}: page content or heading is missing; metrics={metrics}; body={excerpt!r}"
        )
    if metrics["overflow"] > 1:
        raise AssertionError(f"{label}: horizontal overflow is {metrics['overflow']}px")
    if metrics["h1Count"] != 1:
        raise AssertionError(f"{label}: expected one h1, got {metrics['h1Count']}")
    _assert_axe(page, label)


def _assert_axe(page: Page, label: str) -> None:
    """Fail on the critical/serious axe findings required by the pilot gate."""

    if not AXE_SOURCE.is_file():
        raise AssertionError(
            "axe-core is not installed; run npm ci before the browser gate"
        )
    if not page.evaluate("Boolean(window.axe)"):
        page.add_script_tag(path=str(AXE_SOURCE))
    result = page.evaluate(
        """async () => {
          if (!window.axe) {
            throw new Error('axe-core did not load');
          }
          const result = await window.axe.run(document, {
            runOnly: {
              type: 'tag',
              values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
            },
            resultTypes: ['violations'],
          });
          const compact = item => ({
              id: item.id,
              impact: item.impact,
              help: item.help,
              targets: item.nodes.slice(0, 5).map(node => node.target.join(' ')),
              html: item.nodes.slice(0, 3).map(node => node.html.slice(0, 240)),
              failure: item.nodes.slice(0, 3).map(node => node.failureSummary || ''),
          });
          return {
            violations: result.violations
              .filter(item => item.impact === 'critical' || item.impact === 'serious')
              .map(compact),
            incomplete: result.incomplete.map(compact),
          };
        }"""
    )
    incomplete = result["incomplete"]
    if incomplete:
        compact_incomplete = json.dumps(
            incomplete[:8], ensure_ascii=False, separators=(",", ":")
        )
        print(f"{label}: axe incomplete (manual review required): {compact_incomplete}")
    findings = result["violations"]
    if findings:
        compact = json.dumps(findings[:8], ensure_ascii=False, separators=(",", ":"))
        raise AssertionError(f"{label}: axe critical/serious violations: {compact}")


def _run_customer_journey(
    browser,
    base_url: str,
    width: int,
    height: int,
    label: str,
    screenshot_dir: Path | None = None,
) -> None:
    context = browser.new_context(
        viewport={"width": width, "height": height}, reduced_motion="reduce"
    )
    if context.storage_state()["origins"]:
        raise AssertionError(f"{label}: browser context did not start with clean storage")
    _wire_context(context)
    page = context.new_page()
    diagnostics = Diagnostics(page, base_url)

    page.goto(f"{base_url}/login", wait_until="commit")
    _assert_surface(page, "/login", f"{label}/login")
    page.locator("#login-password").fill("ci-fixture-password")
    page.get_by_role("button", name="ログインする").click()
    page.wait_for_url("**/ads/wizard")
    _assert_surface(page, "/ads/wizard", f"{label}/wizard")
    if page.evaluate("Boolean(localStorage.getItem('is_ads_token'))"):
        raise AssertionError(f"{label}/login: authentication token leaked into localStorage")

    page.get_by_role("button", name=re.compile(r"^次へ")).click()
    page.get_by_role("heading", name="いつの結果を見ますか？").wait_for(timeout=10_000)
    page.get_by_role("button", name=re.compile(r"^次へ")).click()
    page.get_by_role("heading", name="最初のレポートができました").wait_for(timeout=15_000)
    page.get_by_role("button", name="レポートを見る").click()
    page.wait_for_url("**/ads/report")
    _assert_surface(page, "/ads/report", f"{label}/ads/report")
    _assert_customer_safe(page, f"{label}/ads/report")
    if screenshot_dir:
        page.screenshot(path=str(screenshot_dir / f"{label}-report.png"), full_page=True)
        page.evaluate("window.scrollTo(0, 0)")

    page.get_by_role("button", name="この結果をAIに聞く").click()
    page.locator("#report-question-panel").wait_for(state="visible", timeout=10_000)
    if screenshot_dir:
        page.screenshot(
            path=str(screenshot_dir / f"{label}-report-question.png"),
            full_page=True,
        )
        page.evaluate("window.scrollTo(0, 0)")
    _assert_axe(page, f"{label}/ads/report-question")
    page.get_by_role("link", name="すべて見る").click()
    page.wait_for_url("**/ads/graphs")
    _assert_surface(page, "/ads/graphs", f"{label}/ads/graphs")
    _assert_customer_safe(page, f"{label}/ads/graphs")
    if screenshot_dir:
        page.screenshot(path=str(screenshot_dir / f"{label}-graphs.png"), full_page=True)
        page.evaluate("window.scrollTo(0, 0)")
    ai_link = page.locator('a[href="/insights/ai"]:visible').first
    if ai_link.count() == 0:
        page.get_by_role("button", name="この数字をAIに聞く").click()
        ai_link.wait_for(state="visible", timeout=10_000)
    ai_link.click()
    page.wait_for_url("**/insights/ai")
    _assert_surface(page, "/insights/ai", f"{label}/insights/ai")
    _assert_customer_safe(page, f"{label}/insights/ai")

    diagnostics.assert_clean(label)
    context.close()


def _run_project_management(browser, base_url: str, width: int, height: int, label: str) -> None:
    context = browser.new_context(
        viewport={"width": width, "height": height}, reduced_motion="reduce"
    )
    if context.storage_state()["origins"]:
        raise AssertionError(f"{label}: admin context did not start with clean storage")
    _wire_context(context)
    _wire_hybrid_admin_login(context)
    page = context.new_page()
    _login_hybrid_admin(page, base_url, f"{label}/projects-auth")
    # The expected /cases/login 401 belongs to the hybrid fallback contract;
    # subsequent project traffic must remain completely clean.
    diagnostics = Diagnostics(page, base_url)
    project_link = page.locator('a[href="/projects"]:visible').first
    destination_link = project_link if project_link.count() else page.locator('a[href="/settings"]:visible').first
    destination_link.click()
    page.wait_for_url(re.compile(r"/(projects|settings)(?:\?.*)?$"), timeout=10_000)
    actual_path = urlparse(page.url).path
    if actual_path not in {"/projects", "/settings"}:
        raise AssertionError(f"{label}/projects: unexpected feature-gate destination {actual_path}")
    _assert_surface(page, actual_path, f"{label}/projects")
    if page.evaluate("Boolean(localStorage.getItem('is_ads_token'))"):
        raise AssertionError(f"{label}/projects: legacy authentication token remained in localStorage")
    if actual_path == "/projects":
        page.get_by_role("heading", name="CI管理サイト").wait_for(timeout=10_000)
        opener = page.get_by_role("button", name="設定", exact=True).first
        opener.click()
        dialog = page.get_by_role("dialog", name=re.compile(r"案件を編集|サイトを登録"))
        dialog.wait_for(state="visible", timeout=10_000)
        dialog.get_by_role("button", name="閉じる").click()
        dialog.wait_for(state="hidden", timeout=10_000)
        if not opener.evaluate("element => element === document.activeElement"):
            raise AssertionError(f"{label}/projects: dialog focus did not return to its opener")

        page.get_by_role("button", name="メンバー", exact=True).first.click()
        member_dialog = page.get_by_role("dialog", name=re.compile(r"CI管理サイト.*メンバー"))
        member_dialog.wait_for(state="visible", timeout=10_000)
        member_dialog.get_by_role("button", name="閉じる").click()
        member_dialog.wait_for(state="hidden", timeout=10_000)
    diagnostics.assert_clean(f"{label}/projects")
    context.close()


def _assert_customer_safe(page: Page, label: str) -> None:
    body = page.locator("body").inner_text()
    forbidden = re.search(
        r"GA4|BigQuery|dataset|データセット|\bPV\b|\bCV\b|chart_01|null|API key|API\s*キー",
        body,
        re.IGNORECASE,
    )
    if forbidden:
        raise AssertionError(f"{label}: leaked implementation term {forbidden.group(0)!r}")


def _run_public_share(browser, base_url: str, width: int, height: int, label: str) -> None:
    context = browser.new_context(
        viewport={"width": width, "height": height}, reduced_motion="reduce"
    )
    if context.storage_state()["origins"]:
        raise AssertionError(f"{label}: public share context did not start with clean storage")
    _wire_context(context)
    page = context.new_page()
    diagnostics = Diagnostics(page, base_url)
    page.goto(f"{base_url}/report-shares/ci-public-token", wait_until="commit")
    page.get_by_role("heading", name="Web成果レポート", exact=True).wait_for(timeout=10_000)
    _assert_surface(page, "/report-shares/ci-public-token", f"{label}/public-share")
    _assert_customer_safe(page, f"{label}/public-share")
    privacy = page.evaluate(
        """() => ({
          robots: document.querySelector('meta[name="robots"]')?.content || '',
          cache: document.querySelector('meta[http-equiv="Cache-Control"]')?.content || '',
        })"""
    )
    if "noindex" not in privacy["robots"] or "no-store" not in privacy["cache"]:
        raise AssertionError(f"{label}/public-share: missing privacy metadata {privacy}")
    diagnostics.assert_clean(f"{label}/public-share")
    context.close()


def _run_print_report(browser, base_url: str, width: int, height: int, label: str) -> None:
    context = browser.new_context(
        viewport={"width": width, "height": height}, reduced_motion="reduce"
    )
    if context.storage_state()["origins"]:
        raise AssertionError(f"{label}: print context did not start with clean storage")
    _wire_context(context)
    _wire_hybrid_admin_login(context)
    page = context.new_page()
    _login_hybrid_admin(page, base_url, f"{label}/print-auth")
    diagnostics = Diagnostics(page, base_url)
    path = "/projects/ci-project/reports/ci-report/print"
    _spa_navigate(page, path)
    page.get_by_role("heading", name="Web成果レポート", exact=True).wait_for(timeout=10_000)
    _assert_surface(page, path, f"{label}/print-report")
    if page.evaluate("Boolean(localStorage.getItem('is_ads_token'))"):
        raise AssertionError(f"{label}/print-report: legacy authentication token remained in localStorage")
    _assert_customer_safe(page, f"{label}/print-report")
    if page.get_by_role("button", name="印刷・PDFとして保存").count() != 1:
        raise AssertionError(f"{label}/print-report: print action is missing")
    page.emulate_media(media="print")
    if not page.get_by_role("heading", name="Web成果レポート", exact=True).is_visible():
        raise AssertionError(f"{label}/print-report: report title disappeared in print media")
    if page.get_by_role("button", name="印刷・PDFとして保存").is_visible():
        raise AssertionError(f"{label}/print-report: screen-only print action remained visible")
    page.emulate_media(media="screen")
    diagnostics.assert_clean(f"{label}/print-report")
    context.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:3002")
    parser.add_argument(
        "--viewport",
        action="append",
        choices=[label for _width, _height, label in VIEWPORTS],
        help="run only the named viewport; repeat to select multiple",
    )
    parser.add_argument(
        "--screenshot-dir",
        type=Path,
        help="optional directory for report/graph browser proof screenshots",
    )
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")
    viewports = tuple(
        item for item in VIEWPORTS if not args.viewport or item[2] in args.viewport
    )
    screenshot_dir = args.screenshot_dir.resolve() if args.screenshot_dir else None
    if screenshot_dir:
        screenshot_dir.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            for width, height, label in viewports:
                _run_customer_journey(
                    browser,
                    base_url,
                    width,
                    height,
                    label,
                    screenshot_dir=screenshot_dir,
                )
                _run_public_share(browser, base_url, width, height, label)
                if label in {"mobile-390", "desktop-1440"}:
                    _run_project_management(browser, base_url, width, height, label)
                if label == "desktop-1440":
                    _run_print_report(browser, base_url, width, height, label)
                print(f"{label}: customer browser smoke passed")
            browser.close()
    except Exception as exc:  # Playwright errors include actionable route details.
        print(f"::error::{exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
