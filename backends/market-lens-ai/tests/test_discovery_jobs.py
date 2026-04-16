"""Tests for async Discovery job endpoints."""

from __future__ import annotations

import asyncio
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
        SearchResult(url="https://competitor1.com/lp", title="Comp One", snippet="A great alternative"),
        SearchResult(url="https://competitor2.com/lp", title="Comp Two", snippet="Another option"),
        SearchResult(url="https://competitor3.com/lp", title="Comp Three", snippet="Third option"),
        SearchResult(url="https://example.com", title="Brand Itself", snippet="Our site"),
    ]


def _make_app(job_repo, search_client: SearchClient | None = None) -> FastAPI:
    app = FastAPI()
    app.include_router(create_discovery_router(search_client=search_client, job_repo=job_repo))
    return app


def _patch_fetch_html():
    return patch(
        "web.app.routers.discovery_routes.fetch_html",
        new_callable=AsyncMock,
        return_value=(_FAKE_HTML, None),
    )


def _patch_analyze(report="# Report"):
    return patch(
        "web.app.routers.discovery_routes.analyze",
        new_callable=AsyncMock,
        return_value=(report, None),
    )


def _patch_ssrf():
    return patch(
        "web.app.routers.discovery_routes.validate_operator_url",
        side_effect=lambda url: None,
    )


def _patch_classify(industry="テスト業種"):
    return patch(
        "web.app.routers.discovery_routes.classify_industry",
        new_callable=AsyncMock,
        return_value=industry,
    )


def _patch_validate_candidates():
    return patch(
        "web.app.routers.discovery_routes.validate_candidates_with_llm",
        new_callable=AsyncMock,
        side_effect=lambda candidates, *args, **kwargs: candidates,
    )


def _poll_until_terminal(client: TestClient, job_id: str, headers: dict[str, str] | None = None):
    for _ in range(30):
        resp = client.get(f"/api/discovery/jobs/{job_id}", headers=headers or {})
        assert resp.status_code == 200
        data = resp.json()
        if data["status"] in {"completed", "failed", "cancelled"}:
            return data
        time.sleep(0.05)
    raise AssertionError("Job did not reach a terminal state in time")


class TestDiscoveryJobs:
    def test_start_job_and_poll_to_completion(self):
        with TemporaryDirectory() as tmpdir:
            app = _make_app(
                FileDiscoveryJobRepository(tmpdir),
                MockSearchClient(_default_results()),
            )
            with _patch_ssrf(), _patch_fetch_html(), _patch_classify(), _patch_analyze(), _patch_validate_candidates():
                client = TestClient(app)
                headers = {"X-Insight-User": "guest:testuser01"}
                start_resp = client.post(
                    "/api/discovery/jobs",
                    headers=headers,
                    json={
                        "brand_url": "https://example.com",
                        "api_key": "test-key",
                        "provider": "anthropic",
                    },
                )
                assert start_resp.status_code == 202
                start_data = start_resp.json()
                assert start_data["status"] == "queued"
                assert start_data["stage"] == "queued"
                assert start_data["poll_url"].endswith(start_data["job_id"])

                final_data = _poll_until_terminal(client, start_data["job_id"], headers=headers)
                assert final_data["status"] == "completed"
                assert final_data["stage"] == "complete"
                assert final_data["result"]["report_md"] == "# Report"
                assert final_data["result"]["brand_domain"] == "example.com"

    def test_owner_mismatch_returns_404(self):
        with TemporaryDirectory() as tmpdir:
            app = _make_app(
                FileDiscoveryJobRepository(tmpdir),
                MockSearchClient(_default_results()),
            )
            with _patch_ssrf(), _patch_fetch_html(), _patch_classify(), _patch_analyze(), _patch_validate_candidates():
                client = TestClient(app)
                start_resp = client.post(
                    "/api/discovery/jobs",
                    headers={"X-Insight-User": "guest:owner0001"},
                    json={
                        "brand_url": "https://example.com",
                        "api_key": "test-key",
                        "provider": "anthropic",
                    },
                )
                job_id = start_resp.json()["job_id"]

                resp = client.get(
                    f"/api/discovery/jobs/{job_id}",
                    headers={"X-Insight-User": "guest:other0001"},
                )
                assert resp.status_code == 404

    def test_failed_job_returns_failed_status(self):
        with TemporaryDirectory() as tmpdir:
            app = _make_app(
                FileDiscoveryJobRepository(tmpdir),
                MockSearchClient(_default_results()),
            )
            with _patch_ssrf(), _patch_fetch_html(), _patch_classify(), _patch_validate_candidates():
                with patch(
                    "web.app.routers.discovery_routes.analyze",
                    new_callable=AsyncMock,
                    side_effect=RuntimeError("rate limit exceeded for messages API"),
                ):
                    client = TestClient(app)
                    headers = {"X-Insight-User": "guest:testuser02"}
                    start_resp = client.post(
                        "/api/discovery/jobs",
                        headers=headers,
                        json={
                            "brand_url": "https://example.com",
                            "api_key": "test-key",
                            "provider": "anthropic",
                        },
                    )
                    job_id = start_resp.json()["job_id"]

                    final_data = _poll_until_terminal(client, job_id, headers=headers)
                    assert final_data["status"] == "failed"
                    assert final_data["stage"] == "failed"
                    assert "レート制限" in final_data["error"]["detail"]
                    assert final_data["error"]["retryable"] is True

    def test_poll_response_includes_heartbeat_and_stage_timestamps(self):
        with TemporaryDirectory() as tmpdir:
            app = _make_app(
                FileDiscoveryJobRepository(tmpdir),
                MockSearchClient(_default_results()),
            )
            with _patch_ssrf(), _patch_fetch_html(), _patch_classify(), _patch_analyze(), _patch_validate_candidates():
                client = TestClient(app)
                headers = {"X-Insight-User": "guest:testuser03"}
                start_resp = client.post(
                    "/api/discovery/jobs",
                    headers=headers,
                    json={
                        "brand_url": "https://example.com",
                        "api_key": "test-key",
                        "provider": "anthropic",
                    },
                )
                job_id = start_resp.json()["job_id"]

                resp = client.get(f"/api/discovery/jobs/{job_id}", headers=headers)
                assert resp.status_code == 200
                data = resp.json()
                assert data["heartbeat_at"]
                assert data["stage_started_at"]
                assert data["last_progress_at"]

    def test_stage_stall_is_failed_even_while_heartbeat_is_alive(self):
        with TemporaryDirectory() as tmpdir:
            with patch.dict(
                "os.environ",
                {
                    "DISCOVERY_OVERALL_JOB_TIMEOUT_SEC": "30",
                    "DISCOVERY_STALE_THRESHOLD_SEC": "300",
                    "DISCOVERY_QUEUED_STALL_TIMEOUT_SEC": "0.2",
                },
            ):
                app = _make_app(FileDiscoveryJobRepository(tmpdir))

                async def _slow_pipeline(*args, **kwargs):
                    await asyncio.sleep(1.0)
                    raise AssertionError("stage stall guard should fail the job before completion")

                with patch("web.app.routers.discovery_routes.run_discovery_pipeline", new=_slow_pipeline):
                    client = TestClient(app)
                    headers = {"X-Insight-User": "guest:testuser04"}
                    start_resp = client.post(
                        "/api/discovery/jobs",
                        headers=headers,
                        json={
                            "brand_url": "https://example.com",
                            "api_key": "test-key",
                            "provider": "anthropic",
                        },
                    )
                    job_id = start_resp.json()["job_id"]

                    final_data = _poll_until_terminal(client, job_id, headers=headers)
                    assert final_data["status"] == "failed"
                    assert final_data["stage"] == "failed"
                    assert "進行していません" in final_data["error"]["detail"]
                    assert final_data["error"]["retryable"] is True
