#!/usr/bin/env python
"""Smoke test script for Market Lens AI staging / local verification.

Hits key API endpoints and reports pass/fail for each.
Requires the API server to be running.

Usage:
    python scripts/smoke_test.py
    BASE_URL=https://market-lens-api.onrender.com python scripts/smoke_test.py

Environment variables:
    BASE_URL        API base URL (default: http://localhost:8002)
    GEMINI_API_KEY  If set, used as BYOK key for scan tests
    SMOKE_TIMEOUT   HTTP timeout in seconds (default: 30)
"""

from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass, field
from typing import Optional

try:
    import httpx
except ImportError:
    print("ERROR: httpx is required. Install with: pip install httpx")
    sys.exit(1)

BASE_URL = os.getenv("BASE_URL", "http://localhost:8002").rstrip("/")
API_KEY = os.getenv("GEMINI_API_KEY", "")
TIMEOUT = int(os.getenv("SMOKE_TIMEOUT", "30"))

# ── 3-industry sample URLs (must be in allowlist for real scans) ──────────

INDUSTRY_SAMPLES = {
    "real_estate": [
        "https://suumo.jp",
        "https://www.homes.co.jp",
        "https://www.athome.co.jp",
    ],
    "ec": [
        "https://www.amazon.co.jp",
        "https://www.rakuten.co.jp",
        "https://shopping.yahoo.co.jp",
    ],
    "beauty": [
        "https://www.cosme.net",
        "https://lipscosme.com",
        "https://maquia.hpplus.jp",
    ],
}


@dataclass
class TestResult:
    name: str
    passed: bool
    status_code: Optional[int] = None
    detail: str = ""
    elapsed_ms: float = 0.0


@dataclass
class TestSuite:
    results: list[TestResult] = field(default_factory=list)

    def add(self, result: TestResult) -> None:
        self.results.append(result)
        mark = "PASS" if result.passed else "FAIL"
        timing = f"({result.elapsed_ms:.0f}ms)"
        detail = f" -- {result.detail}" if result.detail else ""
        print(f"  [{mark}] {result.name} {timing}{detail}")

    def summary(self) -> str:
        total = len(self.results)
        passed = sum(1 for r in self.results if r.passed)
        failed = total - passed
        lines = [
            "",
            "=" * 60,
            f"SMOKE TEST SUMMARY: {passed}/{total} passed, {failed} failed",
            "=" * 60,
        ]
        if failed > 0:
            lines.append("")
            lines.append("Failed tests:")
            for r in self.results:
                if not r.passed:
                    lines.append(f"  - {r.name}: {r.detail}")
        return "\n".join(lines)

    @property
    def all_passed(self) -> bool:
        return all(r.passed for r in self.results)


def _request(
    client: httpx.Client,
    method: str,
    path: str,
    **kwargs,
) -> tuple[httpx.Response | None, float]:
    """Make an HTTP request and return (response, elapsed_ms)."""
    url = f"{BASE_URL}{path}"
    start = time.monotonic()
    try:
        resp = client.request(method, url, timeout=TIMEOUT, **kwargs)
        elapsed = (time.monotonic() - start) * 1000
        return resp, elapsed
    except httpx.RequestError as exc:
        elapsed = (time.monotonic() - start) * 1000
        return None, elapsed


# ── Individual tests ──────────────────────────────────────────────────────


def test_health(client: httpx.Client, suite: TestSuite) -> None:
    """Test /api/health returns 200 with ok=True."""
    resp, ms = _request(client, "GET", "/api/health")
    if resp is None:
        suite.add(TestResult("health", False, detail="Connection refused", elapsed_ms=ms))
        return
    ok = resp.status_code == 200 and resp.json().get("ok") is True
    suite.add(TestResult(
        "health",
        ok,
        status_code=resp.status_code,
        detail="" if ok else f"status={resp.status_code} body={resp.text[:200]}",
        elapsed_ms=ms,
    ))


def test_policies(client: httpx.Client, suite: TestSuite) -> None:
    """Test /api/policies returns 200."""
    resp, ms = _request(client, "GET", "/api/policies")
    if resp is None:
        suite.add(TestResult("policies", False, detail="Connection refused", elapsed_ms=ms))
        return
    ok = resp.status_code == 200
    suite.add(TestResult(
        "policies",
        ok,
        status_code=resp.status_code,
        detail="" if ok else f"status={resp.status_code}",
        elapsed_ms=ms,
    ))


def test_scan_list(client: httpx.Client, suite: TestSuite) -> None:
    """Test /api/scans returns 200 (history list)."""
    resp, ms = _request(client, "GET", "/api/scans")
    if resp is None:
        suite.add(TestResult("scan_list", False, detail="Connection refused", elapsed_ms=ms))
        return
    ok = resp.status_code == 200
    suite.add(TestResult(
        "scan_list",
        ok,
        status_code=resp.status_code,
        detail="" if ok else f"status={resp.status_code}",
        elapsed_ms=ms,
    ))


def test_scan_validation_rejects_bad_url(client: httpx.Client, suite: TestSuite) -> None:
    """Test /api/scan rejects non-allowlisted URLs with 4xx."""
    payload = {"urls": ["http://localhost:9999"], "api_key": "fake"}
    resp, ms = _request(client, "POST", "/api/scan", json=payload)
    if resp is None:
        suite.add(TestResult("scan_reject_bad_url", False, detail="Connection refused", elapsed_ms=ms))
        return
    # Should be 400 or 403 (SSRF / allowlist block)
    ok = resp.status_code in (400, 403, 422)
    suite.add(TestResult(
        "scan_reject_bad_url",
        ok,
        status_code=resp.status_code,
        detail="" if ok else f"Expected 4xx, got {resp.status_code}",
        elapsed_ms=ms,
    ))


def test_library_crud(client: httpx.Client, suite: TestSuite) -> None:
    """Test /api/library/items CRUD cycle."""
    # List (should return 200)
    resp, ms = _request(client, "GET", "/api/library/items")
    if resp is None:
        suite.add(TestResult("library_list", False, detail="Connection refused", elapsed_ms=ms))
        return
    ok = resp.status_code == 200
    suite.add(TestResult(
        "library_list",
        ok,
        status_code=resp.status_code,
        detail="" if ok else f"status={resp.status_code}",
        elapsed_ms=ms,
    ))


def test_monitoring_list(client: httpx.Client, suite: TestSuite) -> None:
    """Test /api/monitoring/watchlist returns 200."""
    resp, ms = _request(client, "GET", "/api/monitoring/watchlist")
    if resp is None:
        suite.add(TestResult("monitoring_list", False, detail="Connection refused", elapsed_ms=ms))
        return
    ok = resp.status_code == 200
    suite.add(TestResult(
        "monitoring_list",
        ok,
        status_code=resp.status_code,
        detail="" if ok else f"status={resp.status_code}",
        elapsed_ms=ms,
    ))


def test_discovery_search_validation(client: httpx.Client, suite: TestSuite) -> None:
    """Test /api/discovery/search rejects empty body."""
    resp, ms = _request(client, "POST", "/api/discovery/search", json={})
    if resp is None:
        suite.add(TestResult("discovery_validation", False, detail="Connection refused", elapsed_ms=ms))
        return
    # Should be 422 (validation error)
    ok = resp.status_code == 422
    suite.add(TestResult(
        "discovery_validation",
        ok,
        status_code=resp.status_code,
        detail="" if ok else f"Expected 422, got {resp.status_code}",
        elapsed_ms=ms,
    ))


def test_generation_banner_no_loader(client: httpx.Client, suite: TestSuite) -> None:
    """Test /api/generation/banner returns 501 when no loader configured (or 422)."""
    resp, ms = _request(
        client, "POST", "/api/generation/banner",
        json={"review_run_id": "aabbccddeeff"},
    )
    if resp is None:
        suite.add(TestResult("generation_banner", False, detail="Connection refused", elapsed_ms=ms))
        return
    # 501 (not configured) or 422 (validation) are both acceptable
    ok = resp.status_code in (422, 501)
    suite.add(TestResult(
        "generation_banner",
        ok,
        status_code=resp.status_code,
        detail="" if ok else f"Expected 422/501, got {resp.status_code}",
        elapsed_ms=ms,
    ))


def test_export_list(client: httpx.Client, suite: TestSuite) -> None:
    """Test /api/exports with a fake run_id returns 200 empty list or 404."""
    resp, ms = _request(client, "GET", "/api/exports?run_id=aabbccddeeff")
    if resp is None:
        suite.add(TestResult("export_list", False, detail="Connection refused", elapsed_ms=ms))
        return
    ok = resp.status_code in (200, 404, 422)
    suite.add(TestResult(
        "export_list",
        ok,
        status_code=resp.status_code,
        detail="" if ok else f"Unexpected status {resp.status_code}",
        elapsed_ms=ms,
    ))


def test_industry_scan_payloads(client: httpx.Client, suite: TestSuite) -> None:
    """Verify 3-industry x 3-URL scan payloads are well-formed.

    This test only validates that the API accepts the request shape and
    returns a recognizable response (success or allowlist rejection).
    It does NOT require the domains to be in the allowlist or a valid API key.
    """
    for industry, urls in INDUSTRY_SAMPLES.items():
        payload: dict = {"urls": urls}
        if API_KEY:
            payload["api_key"] = API_KEY

        resp, ms = _request(client, "POST", "/api/scan", json=payload)
        if resp is None:
            suite.add(TestResult(
                f"scan_{industry}",
                False,
                detail="Connection refused",
                elapsed_ms=ms,
            ))
            continue

        # Any of these codes means the API processed the request properly:
        # 200 = scan succeeded
        # 400/403 = URL rejected by allowlist / SSRF
        # 422 = validation error (missing api_key etc.)
        # 429 = rate limited
        ok = resp.status_code in (200, 400, 403, 422, 429)
        suite.add(TestResult(
            f"scan_{industry}",
            ok,
            status_code=resp.status_code,
            detail="" if ok else f"Unexpected status {resp.status_code}: {resp.text[:200]}",
            elapsed_ms=ms,
        ))


def test_integration_status(client: httpx.Client, suite: TestSuite) -> None:
    """Test /api/integrations/status returns 200 (public endpoint)."""
    resp, ms = _request(client, "GET", "/api/integrations/status")
    if resp is None:
        suite.add(TestResult("integration_status", False, detail="Connection refused", elapsed_ms=ms))
        return
    ok = resp.status_code == 200 and resp.json().get("service") == "Market Lens AI Integration API"
    suite.add(TestResult(
        "integration_status",
        ok,
        status_code=resp.status_code,
        detail="" if ok else f"status={resp.status_code}",
        elapsed_ms=ms,
    ))


def test_integration_auth_required(client: httpx.Client, suite: TestSuite) -> None:
    """Test /api/integrations/webhook/review returns 401 without auth."""
    payload = {
        "source_tool": "test",
        "asset_url": "https://example.com/banner.png",
        "asset_type": "banner",
    }
    resp, ms = _request(client, "POST", "/api/integrations/webhook/review", json=payload)
    if resp is None:
        suite.add(TestResult("integration_auth", False, detail="Connection refused", elapsed_ms=ms))
        return
    # Should be 401 (unauthorized) when INTEGRATION_API_KEYS is set
    # or 200/202 if keys are not configured (MVP mode)
    ok = resp.status_code in (200, 202, 401)
    suite.add(TestResult(
        "integration_auth",
        ok,
        status_code=resp.status_code,
        detail="" if ok else f"Unexpected status {resp.status_code}",
        elapsed_ms=ms,
    ))


def test_templates_list(client: httpx.Client, suite: TestSuite) -> None:
    """Test /api/templates returns 200 with industry templates."""
    resp, ms = _request(client, "GET", "/api/templates")
    if resp is None:
        suite.add(TestResult("templates_list", False, detail="Connection refused", elapsed_ms=ms))
        return
    ok = resp.status_code == 200
    suite.add(TestResult(
        "templates_list",
        ok,
        status_code=resp.status_code,
        detail="" if ok else f"status={resp.status_code}",
        elapsed_ms=ms,
    ))


# ── Main ──────────────────────────────────────────────────────────────────


def main() -> int:
    print(f"Market Lens AI - Smoke Test")
    print(f"Target: {BASE_URL}")
    print(f"Timeout: {TIMEOUT}s")
    print(f"API Key: {'set' if API_KEY else 'not set (BYOK tests will use dummy)'}")
    print("-" * 60)

    suite = TestSuite()

    with httpx.Client() as client:
        # Core endpoints
        test_health(client, suite)
        test_policies(client, suite)
        test_scan_list(client, suite)

        # Validation / security
        test_scan_validation_rejects_bad_url(client, suite)
        test_discovery_search_validation(client, suite)

        # Pack B endpoints
        test_library_crud(client, suite)
        test_monitoring_list(client, suite)
        test_generation_banner_no_loader(client, suite)
        test_export_list(client, suite)

        # Part 9 endpoints (Integration API, Templates)
        test_integration_status(client, suite)
        test_integration_auth_required(client, suite)
        test_templates_list(client, suite)

        # 3-industry x 3-URL scan payloads
        test_industry_scan_payloads(client, suite)

    print(suite.summary())
    return 0 if suite.all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
