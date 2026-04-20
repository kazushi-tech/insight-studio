"""
案件ログインの TOTP 2FA 動作テスト.

scenarios:
  - totp_enabled: false の案件 → パスワードだけで成功 (既存互換)
  - totp_enabled: true の案件:
      * パスワード正しい + TOTP 無し → ok=false, totp_required=true (status 200)
      * パスワード正しい + TOTP 正しい → ok=true, auth_token + device_trust_token 発行
      * パスワード正しい + TOTP 間違い → 401
      * パスワード正しい + 有効 device_trust_token → TOTP スキップで成功
      * valid_window=1 境界 (±30 秒) が受理される

Usage:
    python -m pytest tests/test_cases_login_totp.py -v
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

# APP_PASSWORD / DATA_PROVIDER must be set before importing backend_api
os.environ.setdefault("APP_PASSWORD", "test-secret-pw-42")
os.environ.setdefault("DATA_PROVIDER", "mock")

import bcrypt
import httpx
import pyotp
import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.backend_api import (  # noqa: E402
    app,
    _login_failures,
    _device_trust_tokens,
)


_TEST_CASE_PASSWORD = "case-pw-42"
_TEST_CASE_PASSWORD_HASH = bcrypt.hashpw(
    _TEST_CASE_PASSWORD.encode("utf-8"), bcrypt.gensalt()
).decode("utf-8")
_TEST_TOTP_SECRET = pyotp.random_base32()


def _fake_cases(*, totp_enabled: bool, totp_secret: str | None = None) -> list:
    return [
        {
            "case_id": "test_case",
            "name": "テスト案件",
            "description": "",
            "dataset_id": "test_dataset",
            "password_hash": _TEST_CASE_PASSWORD_HASH,
            "totp_secret": totp_secret if totp_secret is not None else _TEST_TOTP_SECRET,
            "totp_enabled": totp_enabled,
            "is_active": True,
            "is_internal": False,
        },
        {
            "case_id": "no_totp_case",
            "name": "No TOTP Case",
            "description": "",
            "dataset_id": "other_dataset",
            "password_hash": _TEST_CASE_PASSWORD_HASH,
            "totp_secret": "",
            "totp_enabled": False,
            "is_active": True,
            "is_internal": False,
        },
    ]


@pytest.fixture(autouse=True)
def _reset_rate_and_tokens():
    _login_failures.clear()
    _device_trust_tokens.clear()
    yield
    _login_failures.clear()
    _device_trust_tokens.clear()


@pytest.fixture()
def totp_enabled_cases():
    cases = _fake_cases(totp_enabled=True)
    with patch("web.app.backend_api._load_cases_master", return_value=cases):
        yield cases


@pytest.fixture()
def totp_disabled_cases():
    cases = _fake_cases(totp_enabled=False)
    with patch("web.app.backend_api._load_cases_master", return_value=cases):
        yield cases


async def _post_login(client: httpx.AsyncClient, payload: dict) -> httpx.Response:
    return await client.post("/api/cases/login", json=payload)


class TestCaseLoginNoTotp:
    @pytest.mark.anyio
    async def test_password_only_success_when_totp_disabled(self, totp_disabled_cases):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            resp = await _post_login(c, {"case_id": "test_case", "password": _TEST_CASE_PASSWORD})
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert "token" in body
        assert "device_trust_token" in body


class TestCaseLoginTotpRequired:
    @pytest.mark.anyio
    async def test_missing_totp_returns_totp_required(self, totp_enabled_cases):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            resp = await _post_login(c, {"case_id": "test_case", "password": _TEST_CASE_PASSWORD})
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is False
        assert body["totp_required"] is True
        assert body["case_id"] == "test_case"
        assert "token" not in body

    @pytest.mark.anyio
    async def test_wrong_password_returns_401(self, totp_enabled_cases):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            resp = await _post_login(c, {"case_id": "test_case", "password": "wrong"})
        assert resp.status_code == 401

    @pytest.mark.anyio
    async def test_correct_totp_returns_tokens(self, totp_enabled_cases):
        code = pyotp.TOTP(_TEST_TOTP_SECRET).now()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            resp = await _post_login(c, {
                "case_id": "test_case",
                "password": _TEST_CASE_PASSWORD,
                "totp_code": code,
            })
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert body["token"]
        assert body["device_trust_token"]
        assert body["device_trust_ttl_seconds"] > 0

    @pytest.mark.anyio
    async def test_wrong_totp_returns_401(self, totp_enabled_cases):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            resp = await _post_login(c, {
                "case_id": "test_case",
                "password": _TEST_CASE_PASSWORD,
                "totp_code": "000000",
            })
        assert resp.status_code == 401
        body = resp.json()
        assert body["ok"] is False
        assert body.get("totp_required") is True

    @pytest.mark.anyio
    async def test_trust_token_skips_totp(self, totp_enabled_cases):
        # First login to obtain trust token
        code = pyotp.TOTP(_TEST_TOTP_SECRET).now()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            first = await _post_login(c, {
                "case_id": "test_case",
                "password": _TEST_CASE_PASSWORD,
                "totp_code": code,
            })
            trust_token = first.json()["device_trust_token"]

            # Second login with trust token but NO TOTP
            second = await _post_login(c, {
                "case_id": "test_case",
                "password": _TEST_CASE_PASSWORD,
                "device_trust_token": trust_token,
            })
        assert second.status_code == 200
        body = second.json()
        assert body["ok"] is True
        assert body["token"]

    @pytest.mark.anyio
    async def test_trust_token_not_cross_case(self):
        # Two TOTP-enabled cases: trust token for case A must not skip TOTP for case B.
        other_secret = pyotp.random_base32()
        cases = [
            {
                "case_id": "case_a",
                "name": "Case A",
                "dataset_id": "ds_a",
                "password_hash": _TEST_CASE_PASSWORD_HASH,
                "totp_secret": _TEST_TOTP_SECRET,
                "totp_enabled": True,
                "is_active": True,
            },
            {
                "case_id": "case_b",
                "name": "Case B",
                "dataset_id": "ds_b",
                "password_hash": _TEST_CASE_PASSWORD_HASH,
                "totp_secret": other_secret,
                "totp_enabled": True,
                "is_active": True,
            },
        ]
        with patch("web.app.backend_api._load_cases_master", return_value=cases):
            code_a = pyotp.TOTP(_TEST_TOTP_SECRET).now()
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
                first = await _post_login(c, {
                    "case_id": "case_a",
                    "password": _TEST_CASE_PASSWORD,
                    "totp_code": code_a,
                })
                assert first.status_code == 200
                trust_a = first.json()["device_trust_token"]

                # Use case_a's trust token against case_b → TOTP still required
                resp = await _post_login(c, {
                    "case_id": "case_b",
                    "password": _TEST_CASE_PASSWORD,
                    "device_trust_token": trust_a,
                })
            body = resp.json()
            assert body["ok"] is False
            assert body["totp_required"] is True

    @pytest.mark.anyio
    async def test_valid_window_accepts_30s_drift(self, totp_enabled_cases):
        # Generate a code 30 seconds in the past — valid_window=1 should still accept
        import time as _t
        totp = pyotp.TOTP(_TEST_TOTP_SECRET)
        past_code = totp.at(_t.time() - 30)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            resp = await _post_login(c, {
                "case_id": "test_case",
                "password": _TEST_CASE_PASSWORD,
                "totp_code": past_code,
            })
        assert resp.status_code == 200
        assert resp.json()["ok"] is True


class TestCaseLoginLockout:
    @pytest.mark.anyio
    async def test_totp_failures_count_toward_lockout(self, totp_enabled_cases):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            for _ in range(5):
                await _post_login(c, {
                    "case_id": "test_case",
                    "password": _TEST_CASE_PASSWORD,
                    "totp_code": "000000",
                })
            # 6th attempt should be 429 even with correct code
            code = pyotp.TOTP(_TEST_TOTP_SECRET).now()
            resp = await _post_login(c, {
                "case_id": "test_case",
                "password": _TEST_CASE_PASSWORD,
                "totp_code": code,
            })
        assert resp.status_code == 429
