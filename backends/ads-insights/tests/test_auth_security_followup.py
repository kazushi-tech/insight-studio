"""
認証・セキュリティ フォローアップテスト

B-1: ログイン入力バリデーション
B-2: ブルートフォース ロックアウト動作
B-3: デバッグ/バージョンエンドポイント マトリクス

Usage:
    python -m pytest tests/test_auth_security_followup.py -v
"""
import os
import sys
from pathlib import Path

# APP_PASSWORD must be set BEFORE importing backend_api (module-level check)
_TEST_PASSWORD = "test-secret-pw-42"
os.environ["APP_PASSWORD"] = _TEST_PASSWORD
# DATA_PROVIDER=mock so we don't need Excel files
os.environ["DATA_PROVIDER"] = "mock"

import pytest
import httpx

# Project root on sys.path so `web.app.backend_api` resolves
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.backend_api import app, _login_failures


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _clear_login_state():
    """Reset brute-force counter between every test."""
    _login_failures.clear()
    yield
    _login_failures.clear()


@pytest.fixture()
def enable_debug(monkeypatch):
    """Patch the module-level flag so debug endpoints return 200."""
    import web.app.backend_api as mod
    monkeypatch.setattr(mod, "_ENABLE_DEBUG_ENDPOINTS", True)


@pytest.fixture()
def disable_debug(monkeypatch):
    """Explicitly disable debug endpoints (the default)."""
    import web.app.backend_api as mod
    monkeypatch.setattr(mod, "_ENABLE_DEBUG_ENDPOINTS", False)


async def _login(client: httpx.AsyncClient, password: str | None = None, body=None) -> httpx.Response:
    """Send a POST to /api/auth/login with given body or password."""
    if body is not None:
        return await client.post("/api/auth/login", content=body if isinstance(body, (str, bytes)) else str(body), headers={"content-type": "application/json"})
    return await client.post("/api/auth/login", json={"password": password or _TEST_PASSWORD})


async def _get_token(client: httpx.AsyncClient) -> str:
    """Login with the correct password and return the bearer token."""
    resp = await _login(client, password=_TEST_PASSWORD)
    assert resp.status_code == 200, f"Login failed unexpectedly: {resp.text}"
    return resp.json()["token"]


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# B-1: Login input validation
# ---------------------------------------------------------------------------

class TestLoginValidation:
    """B-1: Various login payloads produce the correct status codes."""

    @pytest.mark.anyio
    async def test_correct_password_returns_200(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            resp = await _login(c, password=_TEST_PASSWORD)
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert "token" in data

    @pytest.mark.anyio
    async def test_wrong_password_returns_401(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            resp = await _login(c, password="wrong-password")
        assert resp.status_code == 401
        assert resp.json()["ok"] is False

    @pytest.mark.anyio
    async def test_null_password_returns_400(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            resp = await _login(c, body='{"password": null}')
        assert resp.status_code == 400

    @pytest.mark.anyio
    async def test_numeric_password_returns_400(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            resp = await _login(c, body='{"password": 123}')
        assert resp.status_code == 400

    @pytest.mark.anyio
    async def test_array_body_returns_400(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            resp = await _login(c, body="[]")
        assert resp.status_code == 400

    @pytest.mark.anyio
    async def test_string_body_returns_400(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            resp = await _login(c, body='"abc"')
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# B-2: Lockout behaviour
# ---------------------------------------------------------------------------

class TestLockoutBehaviour:
    """B-2: Brute-force protection locks after 5 failures, resets on success."""

    @pytest.mark.anyio
    async def test_five_failures_then_lockout(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            # First 5 wrong attempts should each return 401
            for i in range(5):
                resp = await _login(c, password="bad")
                assert resp.status_code == 401, f"Attempt {i+1} expected 401, got {resp.status_code}"

            # 6th attempt should be locked out → 429
            resp = await _login(c, password="bad")
            assert resp.status_code == 429

    @pytest.mark.anyio
    async def test_lockout_blocks_correct_password_too(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            for _ in range(5):
                await _login(c, password="bad")

            # Even with correct password, locked IP gets 429
            resp = await _login(c, password=_TEST_PASSWORD)
            assert resp.status_code == 429

    @pytest.mark.anyio
    async def test_successful_login_clears_failure_count(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            # 3 failures
            for _ in range(3):
                await _login(c, password="bad")

            # Successful login clears the counter
            resp = await _login(c, password=_TEST_PASSWORD)
            assert resp.status_code == 200

            # After reset, 5 more failures should be allowed before lockout
            for i in range(5):
                resp = await _login(c, password="bad")
                assert resp.status_code == 401, f"Post-reset attempt {i+1} expected 401"

            # 6th bad attempt after reset → lockout
            resp = await _login(c, password="bad")
            assert resp.status_code == 429


# ---------------------------------------------------------------------------
# B-3: Debug/version endpoint matrix
# ---------------------------------------------------------------------------

_DEBUG_ENDPOINTS = [
    "/api/version",
    "/api/debug/client_info",
    "/api/debug_where",
    "/api/debug/ls",
]


class TestDebugEndpointMatrix:
    """B-3: Debug endpoints respect ENABLE_DEBUG_ENDPOINTS flag and auth."""

    @pytest.mark.anyio
    @pytest.mark.parametrize("path", _DEBUG_ENDPOINTS)
    async def test_unauthenticated_returns_401(self, path, disable_debug):
        """Debug disabled + no token → auth middleware returns 401."""
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get(path)
        assert resp.status_code == 401

    @pytest.mark.anyio
    @pytest.mark.parametrize("path", _DEBUG_ENDPOINTS)
    async def test_authenticated_debug_disabled_returns_404(self, path, disable_debug):
        """Debug disabled + valid token → endpoint returns 404."""
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            token = await _get_token(c)
            resp = await c.get(path, headers=_auth_header(token))
        assert resp.status_code == 404

    @pytest.mark.anyio
    @pytest.mark.parametrize("path", _DEBUG_ENDPOINTS)
    async def test_authenticated_debug_enabled_returns_200(self, path, enable_debug):
        """Debug enabled + valid token → endpoint returns 200."""
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            token = await _get_token(c)
            resp = await c.get(path, headers=_auth_header(token))
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# B-4: /api/cases auth gating (plan: bigquery-bq-steady-pixel)
# ---------------------------------------------------------------------------

class TestApiCasesAuthGating:
    """/api/cases は Authorization ヘッダの有無で挙動を切り分ける."""

    @pytest.mark.anyio
    async def test_api_cases_without_auth_returns_200_without_dataset_id(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/cases")
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert isinstance(body["cases"], list)
        for case in body["cases"]:
            assert "dataset_id" not in case

    @pytest.mark.anyio
    async def test_api_cases_with_invalid_token_returns_401(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            resp = await c.get("/api/cases", headers=_auth_header("invalid_xxx"))
        assert resp.status_code == 401
        body = resp.json()
        assert body["ok"] is False
        assert body["error"].lower() == "unauthorized"

    @pytest.mark.anyio
    async def test_api_cases_with_valid_token_returns_dataset_id(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            token = await _get_token(c)
            resp = await c.get("/api/cases", headers=_auth_header(token))
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert isinstance(body["cases"], list)
        assert len(body["cases"]) > 0
        for case in body["cases"]:
            assert "dataset_id" in case
