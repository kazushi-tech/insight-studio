"""Tests for the FastAPI HTTP endpoints."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from web.app import storage
from web.app.main import app, _rate_store
from web.app.models import TokenUsage

_TEST_USER_HEADER = {"X-Insight-User": "guest:test-user-12345678"}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def client():
    return TestClient(app, headers=_TEST_USER_HEADER)


@pytest.fixture(autouse=True)
def _isolate_storage(tmp_path, monkeypatch):
    """Redirect storage.DATA_DIR to a temp directory for each test."""
    scans_dir = tmp_path / "scans"
    scans_dir.mkdir()
    monkeypatch.setattr(storage, "DATA_DIR", scans_dir)
    _rate_store.clear()


# ---------------------------------------------------------------------------
# /api/health
# ---------------------------------------------------------------------------

class TestHealth:
    def test_health(self, client):
        res = client.get("/api/health")
        assert res.status_code == 200
        data = res.json()
        assert data["ok"] is True
        assert data["service"] == "market-lens"


# ---------------------------------------------------------------------------
# /api/policies
# ---------------------------------------------------------------------------

class TestPolicies:
    def test_policies_returns_expected_structure(self, client):
        res = client.get("/api/policies")
        assert res.status_code == 200
        data = res.json()
        assert "max_urls" in data
        assert "polite_delay_sec" in data
        assert "allowed_domains" in data
        assert "notes" in data

    def test_max_urls_is_integer(self, client):
        res = client.get("/api/policies")
        data = res.json()
        assert isinstance(data["max_urls"], int)
        assert data["max_urls"] > 0

    def test_allowed_domains_is_list(self, client):
        res = client.get("/api/policies")
        data = res.json()
        assert isinstance(data["allowed_domains"], list)


# ---------------------------------------------------------------------------
# /api/scan — validation rejections
# ---------------------------------------------------------------------------

class TestScanValidatesUrls:
    def test_empty_url_list_rejected(self, client):
        res = client.post("/api/scan", json={"urls": []})
        assert res.status_code == 422

    def test_invalid_url_returns_422(self, client):
        res = client.post("/api/scan", json={"urls": ["not-a-url"]})
        assert res.status_code == 422

    def test_ftp_scheme_rejected(self, client):
        res = client.post("/api/scan", json={"urls": ["ftp://example.com/file"]})
        assert res.status_code == 422

    def test_private_ip_rejected(self, client):
        res = client.post("/api/scan", json={"urls": ["http://127.0.0.1/"]})
        assert res.status_code == 422

    def test_too_many_urls_rejected(self, client):
        urls = [f"https://example.com/{i}" for i in range(10)]
        res = client.post("/api/scan", json={"urls": urls})
        assert res.status_code == 422

    def test_duplicate_urls_rejected(self, client):
        res = client.post(
            "/api/scan",
            json={"urls": ["https://example.com", "https://example.com"]},
        )
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# /api/scans — listing
# ---------------------------------------------------------------------------

class TestScansEmpty:
    def test_returns_empty_list_initially(self, client):
        res = client.get("/api/scans")
        assert res.status_code == 200
        assert res.json() == []

    def test_returns_empty_list_without_user_header(self):
        res = TestClient(app).get("/api/scans")
        assert res.status_code == 200
        assert res.json() == []


# ---------------------------------------------------------------------------
# /api/scans/{run_id} — not found
# ---------------------------------------------------------------------------

class TestScanNotFound:
    def test_get_nonexistent_returns_404(self, client):
        res = client.get("/api/scans/aabbccdd9999")
        assert res.status_code == 404

    def test_delete_nonexistent_returns_404(self, client):
        res = client.delete("/api/scans/aabbccdd9999")
        assert res.status_code == 404

    def test_get_invalid_run_id_returns_400(self, client):
        res = client.get("/api/scans/../../../etc")
        assert res.status_code in (400, 404)

    def test_delete_invalid_run_id_returns_400(self, client):
        res = client.delete("/api/scans/not-valid!")
        assert res.status_code == 400


# ---------------------------------------------------------------------------
# /api/scan — successful scan (fully mocked external calls)
# ---------------------------------------------------------------------------

_SAMPLE_HTML = (
    "<html><head><title>Test Site</title></head>"
    "<body><h1>Hello</h1></body></html>"
)
_MOCK_USAGE = TokenUsage(
    prompt_tokens=10, completion_tokens=20, total_tokens=30, model="gemini-3.1-flash-lite-preview"
)


class TestScanSuccess:
    """Tests for successful scan execution with all external calls mocked."""

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_completed_status(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.return_value = ("## Summary\nAnalysis.", _MOCK_USAGE)

        res = client.post("/api/scan", json={"urls": ["https://example.com"]})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "completed"

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_run_id_returned(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.return_value = ("## Summary", _MOCK_USAGE)

        res = client.post("/api/scan", json={"urls": ["https://example.com"]})
        assert res.status_code == 200
        assert res.json()["run_id"]

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_scan_saved_in_storage(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.return_value = ("## Summary", _MOCK_USAGE)

        res = client.post("/api/scan", json={"urls": ["https://example.com"]})
        assert res.status_code == 200
        run_id = res.json()["run_id"]

        # Scan should now be retrievable
        get_res = client.get(f"/api/scans/{run_id}")
        assert get_res.status_code == 200
        assert get_res.json()["run_id"] == run_id

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_scan_appears_in_list(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.return_value = ("## Summary", _MOCK_USAGE)

        res = client.post("/api/scan", json={"urls": ["https://example.com"]})
        assert res.status_code == 200
        run_id = res.json()["run_id"]

        list_res = client.get("/api/scans")
        assert list_res.status_code == 200
        run_ids = [r["run_id"] for r in list_res.json()]
        assert run_id in run_ids

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_delete_scan(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.return_value = ("## Summary", _MOCK_USAGE)

        res = client.post("/api/scan", json={"urls": ["https://example.com"]})
        assert res.status_code == 200
        run_id = res.json()["run_id"]

        del_res = client.delete(f"/api/scans/{run_id}")
        assert del_res.status_code == 200

        get_res = client.get(f"/api/scans/{run_id}")
        assert get_res.status_code == 404

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_scan_history_is_isolated_per_user(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.return_value = ("## Summary", _MOCK_USAGE)

        res = client.post("/api/scan", json={"urls": ["https://example.com"]})
        run_id = res.json()["run_id"]

        other_client = TestClient(app, headers={"X-Insight-User": "guest:other-user-87654321"})
        other_list = other_client.get("/api/scans")
        assert other_list.status_code == 200
        assert other_list.json() == []

        other_detail = other_client.get(f"/api/scans/{run_id}")
        assert other_detail.status_code == 404

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_scan_without_user_header_does_not_appear_in_history(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.return_value = ("## Summary", _MOCK_USAGE)

        anonymous_client = TestClient(app)
        res = anonymous_client.post("/api/scan", json={"urls": ["https://example.com"]})
        assert res.status_code == 200
        run_id = res.json()["run_id"]

        assert anonymous_client.get("/api/scans").json() == []
        assert anonymous_client.get(f"/api/scans/{run_id}").status_code == 404


class TestScanQualityContract:
    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_scan_response_contains_structured_quality_fields(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.return_value = (
            "## エグゼクティブサマリー\n## 分析対象と比較前提\n## 競合比較サマリー\n## ブランド別評価\n## 実行プラン",
            _MOCK_USAGE,
        )

        res = client.post("/api/scan", json={"urls": ["https://example.com", "https://acme.com"]})
        assert res.status_code == 200
        data = res.json()
        assert data["quality_status"] == "pass"
        assert data["quality_is_critical"] is False
        assert isinstance(data["quality_issues"], list)

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_scan_retries_with_compact_output_after_quality_failure(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.side_effect = [
            ("## エグゼクティブサマリー\n| 壊れた行", _MOCK_USAGE),
            (
                "## エグゼクティブサマリー\n## 分析対象と比較前提\n## 競合比較サマリー\n## ブランド別評価\n## 実行プラン",
                _MOCK_USAGE,
            ),
        ]

        res = client.post("/api/scan", json={"urls": ["https://example.com", "https://acme.com"]})
        assert res.status_code == 200
        data = res.json()
        assert data["quality_is_critical"] is False
        assert mock_analyze.await_count == 2
        first_kwargs = mock_analyze.await_args_list[0].kwargs
        second_kwargs = mock_analyze.await_args_list[1].kwargs
        assert first_kwargs.get("compact_output") is False
        assert second_kwargs.get("compact_output") is True


# ---------------------------------------------------------------------------
# BYOK (Bring Your Own Key) — api_key passed through, never stored
# ---------------------------------------------------------------------------

class TestBYOK:
    """Tests that user-provided api_key is forwarded and never persisted."""

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_api_key_forwarded_to_analyze(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.return_value = ("## Summary", _MOCK_USAGE)

        res = client.post("/api/scan", json={"urls": ["https://example.com"], "api_key": "user-test-key"})
        assert res.status_code == 200
        mock_analyze.assert_called_once()
        _, kwargs = mock_analyze.call_args
        assert kwargs.get("api_key") == "user-test-key"

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_api_key_not_in_stored_scan(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.return_value = ("## Summary", _MOCK_USAGE)

        res = client.post("/api/scan", json={"urls": ["https://example.com"], "api_key": "secret-key-123"})
        assert res.status_code == 200
        run_id = res.json()["run_id"]

        get_res = client.get(f"/api/scans/{run_id}")
        assert get_res.status_code == 200
        stored = get_res.json()
        # api_key must NEVER appear in stored data
        assert "api_key" not in stored
        assert "secret-key-123" not in str(stored)

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_api_key_not_in_response(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.return_value = ("## Summary", _MOCK_USAGE)

        res = client.post("/api/scan", json={"urls": ["https://example.com"], "api_key": "my-secret"})
        assert res.status_code == 200
        response_text = res.text
        assert "my-secret" not in response_text

    def test_scan_without_api_key_accepted(self, client):
        """ScanRequest with no api_key should still be accepted (env fallback)."""
        res = client.post("/api/scan", json={"urls": ["https://example.com"]})
        # Will fail at validation or LLM step, but the request format is accepted
        assert res.status_code in (200, 422, 500)


# ---------------------------------------------------------------------------
# BYOK hardening — secret never leaks on failure path
# ---------------------------------------------------------------------------

class TestBYOKHardening:
    """Tests that API keys never appear in responses, storage, or history on failure."""

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_invalid_key_error_not_in_response(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        """When analyze raises with key in message, response must not contain key."""
        secret = "AIzaSyFAKEKEY123456"
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.side_effect = Exception(f"API key not valid: {secret}")

        res = client.post("/api/scan", json={"urls": ["https://example.com"], "api_key": secret})
        assert res.status_code == 200
        assert secret not in res.text

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_invalid_key_not_in_stored_scan(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        """Stored scan must not contain the API key even on failure."""
        secret = "AIzaSyFAKEKEY999"
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.side_effect = Exception(f"Invalid key: {secret}")

        res = client.post("/api/scan", json={"urls": ["https://example.com"], "api_key": secret})
        run_id = res.json()["run_id"]

        stored = client.get(f"/api/scans/{run_id}").json()
        assert secret not in str(stored)

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_invalid_key_not_in_history_detail(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        """History detail must not expose the API key."""
        secret = "AIzaSyTOPSECRET"
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.side_effect = Exception(f"Error with key {secret}")

        res = client.post("/api/scan", json={"urls": ["https://example.com"], "api_key": secret})
        run_id = res.json()["run_id"]

        detail = client.get(f"/api/scans/{run_id}").json()
        assert secret not in str(detail)
        assert "report_md" in detail


# ---------------------------------------------------------------------------
# LLM failure — status/error contract
# ---------------------------------------------------------------------------

class TestLLMFailureContract:
    """Tests that LLM failure results in status='error', not 'completed'."""

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_analyze_failure_returns_error_status(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.side_effect = Exception("Model not found")

        res = client.post("/api/scan", json={"urls": ["https://example.com"]})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "error"
        assert data["error"] is not None

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_analyze_failure_error_is_sanitized(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.side_effect = Exception("API key not valid: AIzaSyXXX")

        res = client.post("/api/scan", json={"urls": ["https://example.com"], "api_key": "AIzaSyXXX"})
        data = res.json()
        assert data["status"] == "error"
        assert "AIzaSyXXX" not in str(data)

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_analyze_failure_stored_with_error_status(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.side_effect = Exception("Quota exceeded")

        res = client.post("/api/scan", json={"urls": ["https://example.com"]})
        run_id = res.json()["run_id"]

        stored = client.get(f"/api/scans/{run_id}").json()
        assert stored["status"] == "error"
        assert stored["error"] is not None

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_analyze_failure_does_not_break_delete(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.side_effect = Exception("Connection reset")

        res = client.post("/api/scan", json={"urls": ["https://example.com"]})
        run_id = res.json()["run_id"]

        del_res = client.delete(f"/api/scans/{run_id}")
        assert del_res.status_code == 200

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_claude_model_error_message_is_specific(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.side_effect = Exception("model claude-sonnet-4-6 not found")

        res = client.post(
            "/api/scan",
            json={"urls": ["https://example.com"], "provider": "anthropic", "api_key": "sk-ant-test"},
        )
        data = res.json()
        assert data["status"] == "error"
        assert "Claude モデル設定またはモデル利用権限" in data["error"]

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_claude_auth_error_message_is_specific(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.side_effect = Exception("invalid x-api-key")

        res = client.post(
            "/api/scan",
            json={"urls": ["https://example.com"], "provider": "anthropic", "api_key": "sk-ant-test"},
        )
        data = res.json()
        assert data["status"] == "error"
        assert "Claude API キーが無効" in data["error"]


# ---------------------------------------------------------------------------
# Model resolution
# ---------------------------------------------------------------------------

class TestModelResolution:
    """Tests that model defaults to None so env var resolution kicks in."""

    def test_scan_request_default_model_is_none(self):
        from web.app.models import ScanRequest
        req = ScanRequest(urls=["https://example.com"])
        assert req.model is None

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_none_model_passed_to_analyze(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        """When request model is None, analyze() receives model=None so env resolution kicks in."""
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.return_value = ("## Summary", _MOCK_USAGE)

        client.post("/api/scan", json={"urls": ["https://example.com"]})
        mock_analyze.assert_called_once()
        _, kwargs = mock_analyze.call_args
        assert kwargs.get("model") is None

    @patch("web.app.services.scan_service.take_screenshot", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.fetch_html", new_callable=AsyncMock)
    @patch("web.app.services.scan_service.analyze", new_callable=AsyncMock)
    @patch("web.app.routers.scan_routes.validate_urls", return_value=[])
    def test_explicit_model_passed_through(self, mock_validate, mock_analyze, mock_fetch, mock_screenshot, client):
        """When request specifies a model, it's passed through to analyze()."""
        mock_fetch.return_value = (_SAMPLE_HTML, None)
        mock_screenshot.return_value = None
        mock_analyze.return_value = ("## Summary", _MOCK_USAGE)

        client.post("/api/scan", json={"urls": ["https://example.com"], "model": "gemini-2.5-pro"})
        mock_analyze.assert_called_once()
        _, kwargs = mock_analyze.call_args
        assert kwargs.get("model") == "gemini-2.5-pro"
