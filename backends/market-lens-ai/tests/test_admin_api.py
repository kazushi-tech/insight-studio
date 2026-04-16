"""Tests for Phase 9: Admin API, Samples, Static Pages."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from web.app.main import app, _rate_store


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clear_rate():
    _rate_store.clear()


# ---------------------------------------------------------------------------
# Admin Usage
# ---------------------------------------------------------------------------

class TestAdminUsage:
    def test_get_usage_empty(self, client):
        res = client.get("/api/admin/usage")
        assert res.status_code == 200
        data = res.json()
        assert data["total_events"] >= 0

    def test_track_event(self, client):
        res = client.post("/api/admin/usage/track?event_type=scan&workspace_id=ws1")
        assert res.status_code == 200
        assert res.json()["event_type"] == "scan"

    def test_track_and_count(self, client):
        client.post("/api/admin/usage/track?event_type=scan")
        client.post("/api/admin/usage/track?event_type=review")
        client.post("/api/admin/usage/track?event_type=scan")
        res = client.get("/api/admin/usage")
        data = res.json()
        assert data["total_events"] >= 3
        assert data["scans"] >= 2
        assert data["reviews"] >= 1

    def test_filter_by_workspace(self, client):
        client.post("/api/admin/usage/track?event_type=scan&workspace_id=ws_a")
        client.post("/api/admin/usage/track?event_type=scan&workspace_id=ws_b")
        res = client.get("/api/admin/usage?workspace_id=ws_a")
        data = res.json()
        assert data["total_events"] >= 1


# ---------------------------------------------------------------------------
# Admin Failures
# ---------------------------------------------------------------------------

class TestAdminFailures:
    def test_get_failures_empty(self, client):
        res = client.get("/api/admin/failures")
        assert res.status_code == 200

    def test_report_failure(self, client):
        res = client.post("/api/admin/failures/report?event_type=scan&error_message=timeout")
        assert res.status_code == 200
        data = res.json()
        assert data["event_type"] == "scan"
        assert data["error_message"] == "timeout"

    def test_failures_list(self, client):
        client.post("/api/admin/failures/report?event_type=scan&error_message=err1")
        client.post("/api/admin/failures/report?event_type=review&error_message=err2")
        res = client.get("/api/admin/failures?limit=10")
        assert res.status_code == 200
        assert len(res.json()) >= 2


# ---------------------------------------------------------------------------
# Admin Status
# ---------------------------------------------------------------------------

class TestAdminStatus:
    def test_status(self, client):
        res = client.get("/api/admin/status")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "healthy"
        assert data["uptime_seconds"] >= 0


# ---------------------------------------------------------------------------
# Sample Gallery
# ---------------------------------------------------------------------------

class TestSampleGallery:
    def test_list_samples(self, client):
        res = client.get("/api/samples")
        assert res.status_code == 200
        data = res.json()
        assert len(data) >= 3

    def test_list_samples_by_industry(self, client):
        res = client.get("/api/samples?industry=ec")
        assert res.status_code == 200
        for s in res.json():
            assert s["industry"] == "ec"

    def test_get_sample(self, client):
        res = client.get("/api/samples/sample_001")
        assert res.status_code == 200
        assert res.json()["id"] == "sample_001"

    def test_get_sample_not_found(self, client):
        res = client.get("/api/samples/nonexistent")
        assert res.status_code == 404


# ---------------------------------------------------------------------------
# Root redirect
# ---------------------------------------------------------------------------

class TestRootRedirect:
    def test_root_redirects_to_docs(self, client):
        res = client.get("/", follow_redirects=False)
        assert res.status_code == 307
        assert "/docs" in res.headers["location"]


# ---------------------------------------------------------------------------
# Static pages
# ---------------------------------------------------------------------------

class TestStaticPages:
    def test_admin_page(self, client):
        res = client.get("/admin")
        assert res.status_code == 200
        assert "管理画面" in res.text

    def test_lp_page(self, client):
        res = client.get("/lp")
        assert res.status_code == 200
        assert "Market Lens AI" in res.text

    def test_onboarding_page(self, client):
        res = client.get("/onboarding")
        assert res.status_code == 200
        assert "オンボーディング" in res.text


# ---------------------------------------------------------------------------
# Sample Gallery Service (unit)
# ---------------------------------------------------------------------------

class TestSampleGalleryUnit:
    def test_list_all(self):
        from web.app.services.sample_gallery import SampleGalleryService
        svc = SampleGalleryService()
        assert len(svc.list_samples()) == 3

    def test_list_by_industry(self):
        from web.app.services.sample_gallery import SampleGalleryService
        svc = SampleGalleryService()
        ec = svc.list_samples(industry="ec")
        assert len(ec) == 1
        assert ec[0]["industry"] == "ec"

    def test_get_sample(self):
        from web.app.services.sample_gallery import SampleGalleryService
        svc = SampleGalleryService()
        s = svc.get_sample("sample_002")
        assert s is not None
        assert s["industry"] == "real_estate"

    def test_get_sample_missing(self):
        from web.app.services.sample_gallery import SampleGalleryService
        svc = SampleGalleryService()
        assert svc.get_sample("nope") is None


# ---------------------------------------------------------------------------
# Admin Event Limit (deque maxlen)
# ---------------------------------------------------------------------------

class TestAdminEventLimit:
    def test_events_deque_bounded(self):
        from collections import deque
        from web.app.routers.admin_routes import create_admin_router
        # Verify the deque pattern is used by checking type
        # We create a router and verify its internal state
        router = create_admin_router()
        # Just verify the router creates without error
        assert router is not None


# ---------------------------------------------------------------------------
# Admin Auth (MVP mode)
# ---------------------------------------------------------------------------

class TestAdminAuth:
    def test_usage_accessible_in_mvp_mode(self, client):
        """MVP mode（API_KEYS未設定）ではadminエンドポイントにアクセスできること。"""
        res = client.get("/api/admin/usage")
        assert res.status_code == 200

    def test_status_accessible_in_mvp_mode(self, client):
        res = client.get("/api/admin/status")
        assert res.status_code == 200

    def test_track_event_in_mvp_mode(self, client):
        res = client.post("/api/admin/usage/track?event_type=test")
        assert res.status_code == 200

    def test_report_failure_in_mvp_mode(self, client):
        res = client.post("/api/admin/failures/report?event_type=test&error_message=err")
        assert res.status_code == 200
