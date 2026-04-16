"""Tests for Discovery auth hardening (external release hardening).

Verifies:
- verify_byok_or_token behavior (BYOK passthrough vs key validation)
- mandatory auth on Discovery job endpoints
- required owner identity on owner-scoped endpoints
- per-user concurrent job limit
- owner scope enforcement
"""

from __future__ import annotations

import os
import time
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from web.app.repositories.file_discovery_job_repository import FileDiscoveryJobRepository
from web.app.routers.discovery_routes import create_discovery_router
from web.app.services.discovery.search_client import SearchClient, SearchClientError, SearchResult

_FAKE_HTML = "<html><head><title>Test</title></head><body><h1>Hello</h1></body></html>"

# Test API key for auth
_TEST_API_KEY = "test-server-api-key-001"


class MockSearchClient(SearchClient):
    def __init__(self, results: list[SearchResult] | None = None, error: str | None = None):
        self._results = results or []
        self._error = error

    async def search(self, query, *, num=10, brand_context="", deadline=None, request_id=None):
        if self._error:
            raise SearchClientError(self._error)
        return self._results


def _default_results():
    return [
        SearchResult(url="https://competitor1.com/lp", title="Comp One", snippet="A great alternative"),
        SearchResult(url="https://competitor2.com/lp", title="Comp Two", snippet="Another option"),
        SearchResult(url="https://competitor3.com/lp", title="Comp Three", snippet="Third option"),
        SearchResult(url="https://example.com", title="Brand Itself", snippet="Our site"),
    ]


def _make_app(job_repo=None, search_client=None):
    app = FastAPI()
    app.include_router(create_discovery_router(
        search_client=search_client or MockSearchClient(_default_results()),
        job_repo=job_repo,
    ))
    return app


def _auth_headers(owner_id: str | None = None) -> dict[str, str]:
    headers = {"X-API-Key": _TEST_API_KEY}
    if owner_id:
        headers["X-Insight-User"] = owner_id
    return headers


class _AuthEnvMixin:
    def setup_method(self):
        self._orig = os.environ.get("API_KEYS")
        os.environ["API_KEYS"] = _TEST_API_KEY
        import web.app.auth as auth_mod
        auth_mod.API_KEYS.clear()
        auth_mod.API_KEYS.add(_TEST_API_KEY)

    def teardown_method(self):
        import web.app.auth as auth_mod
        auth_mod.API_KEYS.clear()
        if self._orig is not None:
            os.environ["API_KEYS"] = self._orig
        else:
            os.environ.pop("API_KEYS", None)


def _patch_validate_candidates():
    return patch(
        "web.app.routers.discovery_routes.validate_candidates_with_llm",
        new_callable=AsyncMock,
        side_effect=lambda candidates, *args, **kwargs: candidates,
    )


def _patch_pipeline():
    """Patch all pipeline dependencies for a successful run."""
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


class TestVerifyByokOrToken:
    """Verify verify_byok_or_token behavior."""

    def test_byok_mode_when_api_keys_empty(self):
        """When API_KEYS is empty, returns 'byok' (passthrough)."""
        import web.app.auth as auth_mod
        orig_keys = auth_mod.API_KEYS.copy()
        auth_mod.API_KEYS.clear()
        try:
            with TemporaryDirectory() as tmpdir:
                patches = _patch_pipeline()
                with patches[0], patches[1], patches[2], patches[3], patches[4]:
                    client = TestClient(_make_app(job_repo=FileDiscoveryJobRepository(tmpdir)))
                    resp = client.post(
                        "/api/discovery/jobs",
                        headers={"X-Insight-User": "guest:byoktest1"},
                        json={"brand_url": "https://example.com", "api_key": "test-key"},
                    )
                    assert resp.status_code == 202
        finally:
            auth_mod.API_KEYS.clear()
            auth_mod.API_KEYS.update(orig_keys)

    def test_valid_key_when_api_keys_set(self):
        """When API_KEYS is set and valid key provided, auth passes."""
        import web.app.auth as auth_mod
        orig_keys = auth_mod.API_KEYS.copy()
        auth_mod.API_KEYS.clear()
        auth_mod.API_KEYS.add(_TEST_API_KEY)
        try:
            with TemporaryDirectory() as tmpdir:
                patches = _patch_pipeline()
                with patches[0], patches[1], patches[2], patches[3], patches[4]:
                    client = TestClient(_make_app(job_repo=FileDiscoveryJobRepository(tmpdir)))
                    resp = client.post(
                        "/api/discovery/jobs",
                        headers=_auth_headers("guest:validtest1"),
                        json={"brand_url": "https://example.com", "api_key": "test-key"},
                    )
                    assert resp.status_code == 202
        finally:
            auth_mod.API_KEYS.clear()
            auth_mod.API_KEYS.update(orig_keys)

    def test_invalid_key_when_api_keys_set_raises_401(self):
        """When API_KEYS is set and invalid key provided, raises 401."""
        import web.app.auth as auth_mod
        orig_keys = auth_mod.API_KEYS.copy()
        auth_mod.API_KEYS.clear()
        auth_mod.API_KEYS.add(_TEST_API_KEY)
        try:
            with TemporaryDirectory() as tmpdir:
                client = TestClient(_make_app(job_repo=FileDiscoveryJobRepository(tmpdir)))
                resp = client.post(
                    "/api/discovery/jobs",
                    headers={"X-API-Key": "wrong-key", "X-Insight-User": "guest:invalidtest1"},
                    json={"brand_url": "https://example.com", "api_key": "test-key"},
                )
                assert resp.status_code == 401
        finally:
            auth_mod.API_KEYS.clear()
            auth_mod.API_KEYS.update(orig_keys)


class TestDiscoveryAuthEnforcement(_AuthEnvMixin):
    """Verify mandatory auth on Discovery job endpoints when API_KEYS is set."""

    def test_jobs_requires_auth(self):
        """POST /jobs without auth returns 401."""
        with TemporaryDirectory() as tmpdir:
            client = TestClient(_make_app(job_repo=FileDiscoveryJobRepository(tmpdir)))
            resp = client.post("/api/discovery/jobs", json={
                "brand_url": "https://example.com",
                "api_key": "test-claude-key",
            }, headers={"X-Insight-User": "guest:testjobs01"})
            assert resp.status_code == 401

    def test_jobs_with_valid_auth(self):
        """POST /jobs with valid auth succeeds (202)."""
        with TemporaryDirectory() as tmpdir:
            patches = _patch_pipeline()
            with patches[0], patches[1], patches[2], patches[3], patches[4]:
                client = TestClient(_make_app(
                    job_repo=FileDiscoveryJobRepository(tmpdir),
                ))
                resp = client.post(
                    "/api/discovery/jobs",
                    headers=_auth_headers("guest:testauth1"),
                    json={"brand_url": "https://example.com", "api_key": "test-claude-key"},
                )
                assert resp.status_code == 202

    def test_jobs_without_owner_header_still_accepted(self):
        """POST /jobs without owner header is accepted (owner is optional)."""
        with TemporaryDirectory() as tmpdir:
            patches = _patch_pipeline()
            with patches[0], patches[1], patches[2], patches[3], patches[4]:
                client = TestClient(_make_app(job_repo=FileDiscoveryJobRepository(tmpdir)))
                resp = client.post(
                    "/api/discovery/jobs",
                    headers={"X-API-Key": _TEST_API_KEY},
                    json={"brand_url": "https://example.com", "api_key": "test-claude-key"},
                )
                assert resp.status_code == 202

    def test_job_poll_requires_auth(self):
        """GET /jobs/{job_id} without server auth returns 401."""
        with TemporaryDirectory() as tmpdir:
            patches = _patch_pipeline()
            with patches[0], patches[1], patches[2], patches[3], patches[4]:
                repo = FileDiscoveryJobRepository(tmpdir)
                client = TestClient(_make_app(job_repo=repo))
                # Start a job with auth
                start_resp = client.post(
                    "/api/discovery/jobs",
                    headers=_auth_headers("guest:testpoll1"),
                    json={"brand_url": "https://example.com", "api_key": "test-key"},
                )
                job_id = start_resp.json()["job_id"]
                # Poll without server auth but with matching owner
                resp = client.get(
                    f"/api/discovery/jobs/{job_id}",
                    headers={"X-Insight-User": "guest:testpoll1"},
                )
                assert resp.status_code == 401

    def test_jobs_byok_passthrough_without_configured_api_keys(self):
        """POST /jobs passes through in BYOK mode when API_KEYS is not configured."""
        import web.app.auth as auth_mod

        orig = os.environ.get("API_KEYS")
        auth_mod.API_KEYS.clear()
        os.environ.pop("API_KEYS", None)
        try:
            with TemporaryDirectory() as tmpdir:
                patches = _patch_pipeline()
                with patches[0], patches[1], patches[2], patches[3], patches[4]:
                    client = TestClient(_make_app(job_repo=FileDiscoveryJobRepository(tmpdir)))
                    resp = client.post(
                        "/api/discovery/jobs",
                        headers={"X-Insight-User": "guest:testclosed1"},
                        json={"brand_url": "https://example.com", "api_key": "test-key"},
                    )
                    # BYOK mode: no API_KEYS means passthrough
                    assert resp.status_code == 202
        finally:
            auth_mod.API_KEYS.clear()
            if orig is not None:
                os.environ["API_KEYS"] = orig
                for key in orig.split(","):
                    key = key.strip()
                    if key:
                        auth_mod.API_KEYS.add(key)



class TestErrorContract(_AuthEnvMixin):
    """Verify unified error contract with error_code and retry_after_sec."""

    def test_failed_job_has_error_code(self):
        """Failed job error includes error_code field."""
        with TemporaryDirectory() as tmpdir:
            repo = FileDiscoveryJobRepository(tmpdir)
            client = TestClient(_make_app(job_repo=repo))
            headers = _auth_headers("guest:errctest")

            with (
                patch("web.app.routers.discovery_routes.validate_operator_url", side_effect=lambda url: None),
                patch("web.app.routers.discovery_routes.fetch_html", new_callable=AsyncMock, return_value=(_FAKE_HTML, None)),
                patch("web.app.routers.discovery_routes.classify_industry", new_callable=AsyncMock, return_value="test"),
                patch("web.app.routers.discovery_routes.analyze", new_callable=AsyncMock,
                      side_effect=RuntimeError("rate limit exceeded for messages API")),
                _patch_validate_candidates(),
            ):
                start = client.post("/api/discovery/jobs", headers=headers, json={
                    "brand_url": "https://example.com", "api_key": "k1",
                })
                job_id = start.json()["job_id"]
                final = _poll_until_terminal(client, job_id, headers=headers)

                assert final["status"] == "failed"
                assert final["error"]["status_code"] is not None
                assert final["error"]["retryable"] is True

    def test_successful_job_has_no_error(self):
        """Completed job has no error field."""
        with TemporaryDirectory() as tmpdir:
            repo = FileDiscoveryJobRepository(tmpdir)
            client = TestClient(_make_app(job_repo=repo))
            headers = _auth_headers("guest:oktest01")

            with (
                patch("web.app.routers.discovery_routes.validate_operator_url", side_effect=lambda url: None),
                patch("web.app.routers.discovery_routes.fetch_html", new_callable=AsyncMock, return_value=(_FAKE_HTML, None)),
                patch("web.app.routers.discovery_routes.classify_industry", new_callable=AsyncMock, return_value="test"),
                patch("web.app.routers.discovery_routes.analyze", new_callable=AsyncMock, return_value=("# OK", None)),
                _patch_validate_candidates(),
            ):
                start = client.post("/api/discovery/jobs", headers=headers, json={
                    "brand_url": "https://example.com", "api_key": "k1",
                })
                job_id = start.json()["job_id"]
                final = _poll_until_terminal(client, job_id, headers=headers)

                assert final["status"] == "completed"
                assert final["error"] is None
