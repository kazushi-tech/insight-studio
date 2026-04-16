"""Tests for discovery API routes — jobs endpoints only (Claude-only migration).

Deprecated sync endpoints (POST /search, GET /candidates, POST /candidates/approve|reject,
POST /analyze) have been removed. Only POST /jobs and GET /jobs/{job_id} remain.
"""

from __future__ import annotations

import time
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from web.app.repositories.file_discovery_job_repository import FileDiscoveryJobRepository
from web.app.routers.discovery_routes import create_discovery_router
from web.app.services.discovery.search_client import SearchClient, SearchClientError, SearchResult

_FAKE_HTML = "<html><head><title>Test</title></head><body><h1>Hello</h1></body></html>"


class MockSearchClient(SearchClient):
    """Mock search client that returns predetermined results."""

    def __init__(self, results: list[SearchResult] | None = None, error: str | None = None):
        self._results = results or []
        self._error = error

    async def search(
        self,
        query: str,
        *,
        num: int = 10,
        brand_context: str = "",
        deadline: float | None = None,
        request_id: str | None = None,
    ) -> list[SearchResult]:
        if self._error:
            raise SearchClientError(self._error)
        return self._results


def _default_results() -> list[SearchResult]:
    return [
        SearchResult(url="https://competitor1.com", title="Comp One", snippet="A great alternative"),
        SearchResult(url="https://competitor2.com", title="Comp Two", snippet="Another option"),
        SearchResult(url="https://example.com", title="Brand Itself", snippet="Our site"),
    ]


def _make_app(job_repo=None, search_client: SearchClient | None = None) -> FastAPI:
    app = FastAPI()
    router = create_discovery_router(
        search_client=search_client or MockSearchClient(_default_results()),
        job_repo=job_repo,
    )
    app.include_router(router)
    return app


def _patch_validate_candidates():
    return patch(
        "web.app.routers.discovery_routes.validate_candidates_with_llm",
        new_callable=AsyncMock,
        side_effect=lambda candidates, *args, **kwargs: candidates,
    )


def _patch_pipeline():
    return (
        patch("web.app.routers.discovery_routes.validate_operator_url", side_effect=lambda url: None),
        patch("web.app.routers.discovery_routes.fetch_html", new_callable=AsyncMock, return_value=(_FAKE_HTML, None)),
        patch("web.app.routers.discovery_routes.classify_industry", new_callable=AsyncMock, return_value="テスト業種"),
        patch("web.app.routers.discovery_routes.analyze", new_callable=AsyncMock, return_value=("# Report", None)),
        _patch_validate_candidates(),
    )


def _poll_until_terminal(client, job_id, headers=None):
    for _ in range(30):
        resp = client.get(f"/api/discovery/jobs/{job_id}", headers=headers or {})
        assert resp.status_code == 200
        data = resp.json()
        if data["status"] in {"completed", "failed", "cancelled"}:
            return data
        time.sleep(0.05)
    raise AssertionError("Job did not reach terminal state")


class TestDiscoveryJobs:
    """Tests for POST /api/discovery/jobs and GET /api/discovery/jobs/{job_id}."""

    def test_start_job_returns_202(self):
        """POST /jobs with valid input returns 202 Accepted."""
        with TemporaryDirectory() as tmpdir:
            patches = _patch_pipeline()
            with patches[0], patches[1], patches[2], patches[3], patches[4]:
                client = TestClient(_make_app(
                    job_repo=FileDiscoveryJobRepository(tmpdir),
                ))
                resp = client.post(
                    "/api/discovery/jobs",
                    headers={"X-Insight-User": "guest:testuser01"},
                    json={"brand_url": "https://example.com", "api_key": "test-key"},
                )
                assert resp.status_code == 202
                data = resp.json()
                assert data["status"] == "queued"
                assert data["job_id"]
                assert data["poll_url"].endswith(data["job_id"])

    def test_start_job_and_poll_to_completion(self):
        """Full lifecycle: start job, poll until completed."""
        with TemporaryDirectory() as tmpdir:
            patches = _patch_pipeline()
            with patches[0], patches[1], patches[2], patches[3], patches[4]:
                client = TestClient(_make_app(
                    job_repo=FileDiscoveryJobRepository(tmpdir),
                ))
                headers = {"X-Insight-User": "guest:testuser02"}
                start_resp = client.post(
                    "/api/discovery/jobs",
                    headers=headers,
                    json={"brand_url": "https://example.com", "api_key": "test-key"},
                )
                job_id = start_resp.json()["job_id"]
                final = _poll_until_terminal(client, job_id, headers=headers)
                assert final["status"] == "completed"
                assert final["result"]["report_md"] == "# Report"

    def test_poll_nonexistent_job_returns_404(self):
        """GET /jobs/{unknown_id} returns 404."""
        with TemporaryDirectory() as tmpdir:
            client = TestClient(_make_app(
                job_repo=FileDiscoveryJobRepository(tmpdir),
            ))
            resp = client.get(
                "/api/discovery/jobs/nonexistent",
                headers={"X-Insight-User": "guest:testuser03"},
            )
            assert resp.status_code == 404

    def test_owner_mismatch_returns_404(self):
        """Polling a job owned by another user returns 404."""
        with TemporaryDirectory() as tmpdir:
            patches = _patch_pipeline()
            with patches[0], patches[1], patches[2], patches[3], patches[4]:
                client = TestClient(_make_app(
                    job_repo=FileDiscoveryJobRepository(tmpdir),
                ))
                start_resp = client.post(
                    "/api/discovery/jobs",
                    headers={"X-Insight-User": "guest:ownerA"},
                    json={"brand_url": "https://example.com", "api_key": "test-key"},
                )
                job_id = start_resp.json()["job_id"]
                resp = client.get(
                    f"/api/discovery/jobs/{job_id}",
                    headers={"X-Insight-User": "guest:ownerB"},
                )
                assert resp.status_code == 404

    def test_invalid_brand_url_fails_job(self):
        """POST /jobs with private IP accepts job, which then fails during execution."""
        with TemporaryDirectory() as tmpdir:
            client = TestClient(_make_app(
                job_repo=FileDiscoveryJobRepository(tmpdir),
            ))
            headers = {"X-Insight-User": "guest:testuser04"}
            resp = client.post(
                "/api/discovery/jobs",
                headers=headers,
                json={"brand_url": "http://127.0.0.1", "api_key": "test-key"},
            )
            # Job is accepted (async), SSRF validation happens inside the task
            assert resp.status_code == 202
            job_id = resp.json()["job_id"]
            final = _poll_until_terminal(client, job_id, headers=headers)
            assert final["status"] == "failed"
