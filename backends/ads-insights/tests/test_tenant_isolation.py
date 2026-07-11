"""Paid-pilot tenant isolation regressions for case-scoped BigQuery access."""

from __future__ import annotations

import os
import json
import sys
from pathlib import Path

os.environ.setdefault("APP_PASSWORD", "test-secret-pw-42")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx")
os.environ.setdefault("DATA_PROVIDER", "mock")

import bcrypt
import httpx
import jwt
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import bq.client as bq_client  # noqa: E402
import bq.queries as bq_queries  # noqa: E402
import bq.reporter as bq_reporter  # noqa: E402
from web.app import backend_api as api  # noqa: E402

_REAL_LOAD_CASES_MASTER = api._load_cases_master


_CASE_PASSWORD = "case-pw-tenant-test"
_PASSWORD_HASH = bcrypt.hashpw(_CASE_PASSWORD.encode(), bcrypt.gensalt()).decode()
_CASE_B_PASSWORD = "case-b-pw-tenant-test"
_CASE_B_PASSWORD_HASH = bcrypt.hashpw(_CASE_B_PASSWORD.encode(), bcrypt.gensalt()).decode()
_CASES = [
    {
        "case_id": "case_a",
        "name": "Case A",
        "dataset_id": "analytics_case_a",
        "password_hash": _PASSWORD_HASH,
        "totp_enabled": False,
        "is_active": True,
    },
    {
        "case_id": "case_b",
        "name": "Case B",
        "dataset_id": "analytics_case_b",
        "password_hash": _CASE_B_PASSWORD_HASH,
        "totp_enabled": False,
        "is_active": True,
    },
]


@pytest.fixture(autouse=True)
def _isolate_auth_and_cache(monkeypatch):
    api._login_failures.clear()
    api._rate_buckets.clear()
    api._bq_cache.clear()
    monkeypatch.setattr(api, "_load_cases_master", lambda: _CASES)
    yield
    api._login_failures.clear()
    api._rate_buckets.clear()
    api._bq_cache.clear()


async def _case_token(client: httpx.AsyncClient, case_id: str = "case_a") -> str:
    response = await client.post(
        "/api/cases/login",
        json={"case_id": case_id, "password": _CASE_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()["token"]


async def _admin_token(client: httpx.AsyncClient) -> str:
    response = await client.post(
        "/api/auth/login",
        json={"password": os.environ["APP_PASSWORD"]},
    )
    assert response.status_code == 200, response.text
    return response.json()["token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.anyio
async def test_admin_and_case_login_tokens_carry_explicit_roles_and_scope():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        admin_token = await _admin_token(client)
        case_token = await _case_token(client)

    admin_claims = jwt.decode(admin_token, os.environ["JWT_SECRET"], algorithms=["HS256"])
    case_claims = jwt.decode(case_token, os.environ["JWT_SECRET"], algorithms=["HS256"])

    assert admin_claims["role"] == "admin"
    assert "case_id" not in admin_claims
    assert case_claims["role"] == "case_user"
    assert case_claims["case_id"] == "case_a"
    assert case_claims["dataset_id"] == "analytics_case_a"


@pytest.mark.anyio
async def test_password_only_login_resolves_one_case_without_public_enumeration():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/cases/login",
            json={"password": _CASE_PASSWORD},
        )

    assert response.status_code == 200, response.text
    assert response.json()["case_id"] == "case_a"


@pytest.mark.anyio
async def test_password_only_login_rejects_ambiguous_password_and_counts_failure_once(monkeypatch):
    ambiguous_cases = [dict(_CASES[0]), {**_CASES[1], "password_hash": _PASSWORD_HASH}]
    monkeypatch.setattr(api, "_load_cases_master", lambda: ambiguous_cases)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        ambiguous = await client.post(
            "/api/cases/login",
            json={"password": _CASE_PASSWORD},
        )
        wrong = await client.post(
            "/api/cases/login",
            json={"password": "definitely-wrong"},
        )

    assert ambiguous.status_code == 409
    assert "複数" in ambiguous.json()["error"]
    assert wrong.status_code == 401
    assert sum(len(items) for items in api._login_failures.values()) == 1


@pytest.mark.anyio
async def test_cases_are_not_public_and_admin_sees_all_active_cases():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        anonymous = await client.get("/api/cases")
        admin_token = await _admin_token(client)
        admin = await client.get("/api/cases", headers=_auth(admin_token))

    assert anonymous.status_code == 401
    assert {case["case_id"] for case in admin.json()["cases"]} == {"case_a", "case_b"}


@pytest.mark.anyio
async def test_roleless_legacy_auth_token_is_not_promoted_to_admin():
    legacy_token = jwt.encode(
        {"typ": "auth", "exp": 4_102_444_800, "jti": "legacy"},
        os.environ["JWT_SECRET"],
        algorithm="HS256",
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        response = await client.get("/api/bq/datasets", headers=_auth(legacy_token))

    assert response.status_code == 401
    assert response.json()["error"] == "Unauthorized"


@pytest.mark.anyio
async def test_case_a_dataset_listing_never_enumerates_or_returns_case_b(monkeypatch):
    def listing_must_not_run():
        raise AssertionError("case users must not enumerate project datasets")

    monkeypatch.setattr(bq_client, "list_datasets", listing_must_not_run)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = await _case_token(client, "case_a")
        response = await client.get("/api/bq/datasets", headers=_auth(token))

    assert response.status_code == 200
    assert response.json()["datasets"] == [
        {"dataset_id": "analytics_case_a", "label": "GA4: analytics_case_a"}
    ]


@pytest.mark.anyio
async def test_case_a_cannot_request_case_b_periods_or_query(monkeypatch):
    def query_must_not_run(*args, **kwargs):
        raise AssertionError("cross-tenant query reached BigQuery")

    monkeypatch.setattr(bq_client, "run_query", query_must_not_run)
    monkeypatch.setattr(bq_reporter, "run_report", query_must_not_run)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = await _case_token(client, "case_a")
        periods = await client.get(
            "/api/bq/periods",
            params={"dataset_id": "analytics_case_b"},
            headers=_auth(token),
        )
        single = await client.post(
            "/api/bq/generate",
            json={
                "query_type": "pv",
                "dataset_id": "analytics_case_b",
                "period": "2026-05",
            },
            headers=_auth(token),
        )
        batch = await client.post(
            "/api/bq/generate_batch",
            json={
                "query_types": ["pv"],
                "dataset_id": "analytics_case_b",
                "period": "2026-05",
            },
            headers=_auth(token),
        )

    assert periods.status_code == 403
    assert single.status_code == 403
    assert batch.status_code == 403
    for response in (periods, single, batch):
        assert "outside authenticated case scope" in response.json()["detail"]


@pytest.mark.anyio
async def test_stale_case_token_is_rejected_after_server_dataset_scope_changes(monkeypatch):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = await _case_token(client, "case_a")
        changed_cases = [{**_CASES[0], "dataset_id": "analytics_case_a_v2"}, _CASES[1]]
        monkeypatch.setattr(api, "_load_cases_master", lambda: changed_cases)
        response = await client.get("/api/bq/datasets", headers=_auth(token))

    assert response.status_code == 403
    assert "sign in again" in response.json()["detail"]


@pytest.mark.anyio
async def test_case_query_without_client_dataset_uses_server_case_dataset(monkeypatch):
    called = []

    def fake_run_report(query_type, dataset, period):
        called.append((query_type, dataset, period))
        return {
            "report_md": "# scoped",
            "dataframe": pd.DataFrame({
                "event_date": ["2026-05-01"],
                "users": [1],
                "sessions": [1],
                "page_views": [1],
            }),
            "query_info": {"name": "PV"},
        }

    monkeypatch.setattr(bq_queries, "QUERIES", {"pv": {}})
    monkeypatch.setattr(bq_reporter, "run_report", fake_run_report)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = await _case_token(client, "case_a")
        response = await client.post(
            "/api/bq/generate",
            json={"query_type": "pv", "period": "2026-05"},
            headers=_auth(token),
        )

    assert response.status_code == 200, response.text
    assert called == [("pv", "analytics_case_a", "2026-05")]


@pytest.mark.anyio
async def test_case_token_only_sees_its_case_record():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = await _case_token(client, "case_a")
        response = await client.get("/api/cases", headers=_auth(token))

    assert response.status_code == 200
    assert [case["case_id"] for case in response.json()["cases"]] == ["case_a"]
    assert response.json()["cases"][0]["dataset_id"] == "analytics_case_a"


@pytest.mark.anyio
async def test_case_a_cannot_probe_case_b_bigquery_status():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = await _case_token(client, "case_a")
        response = await client.get("/api/cases/case_b/bq-status", headers=_auth(token))

    assert response.status_code == 403
    assert "outside authenticated case scope" in response.json()["detail"]


@pytest.mark.anyio
async def test_admin_retains_explicit_dataset_selection(monkeypatch):
    called = []

    def fake_run_report(query_type, dataset, period):
        called.append(dataset)
        return {
            "report_md": "# admin",
            "dataframe": pd.DataFrame({
                "event_date": ["2026-05-01"],
                "users": [1],
                "sessions": [1],
                "page_views": [1],
            }),
            "query_info": {"name": "PV"},
        }

    monkeypatch.setattr(bq_queries, "QUERIES", {"pv": {}})
    monkeypatch.setattr(bq_reporter, "run_report", fake_run_report)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = await _admin_token(client)
        response = await client.post(
            "/api/bq/generate",
            json={
                "query_type": "pv",
                "dataset_id": "analytics_case_b",
                "period": "2026-05",
            },
            headers=_auth(token),
        )

    assert response.status_code == 200, response.text
    assert called == ["analytics_case_b"]


@pytest.mark.anyio
async def test_admin_config_response_never_returns_raw_secrets(monkeypatch):
    monkeypatch.setattr(api, "_load_config", lambda: {
        "data_folder": "data",
        "gemini_api_key": "raw-gemini-secret",
        "service_token": "raw-service-token",
    })
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = await _admin_token(client)
        response = await client.get("/api/config", headers=_auth(token))

    assert response.status_code == 200
    config = response.json()["config"]
    assert config["data_folder"] == "data"
    assert config["has_gemini_api_key"] is True
    assert config["gemini_api_key_masked"] == "***"
    assert config["has_service_token"] is True
    assert "gemini_api_key" not in config
    assert "service_token" not in config
    assert "raw-gemini-secret" not in response.text
    assert "raw-service-token" not in response.text


@pytest.mark.anyio
async def test_case_neon_dataset_mismatch_is_rejected_before_ai_or_bq(monkeypatch):
    def must_not_run(*args, **kwargs):
        raise AssertionError("cross-tenant request reached BQ or AI execution")

    monkeypatch.setattr(api, "fetch_pv_spike_diagnostic_context", must_not_run)
    monkeypatch.setattr(api, "_gemini_generate", must_not_run)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = await _case_token(client, "case_a")
        response = await client.post(
            "/api/insights/neon/generate",
            json={
                "message": "分析して",
                "point_pack_md": "# pack",
                "data_source": "bq",
                "analysis_context_meta": {"datasetId": "analytics_case_b"},
            },
            headers=_auth(token),
        )

    assert response.status_code == 403
    assert "outside authenticated case scope" in response.json()["detail"]


@pytest.mark.anyio
async def test_case_neon_project_override_is_rejected_before_ai_or_bq(monkeypatch):
    def must_not_run(*args, **kwargs):
        raise AssertionError("cross-project request reached BQ or AI execution")

    monkeypatch.setattr(api, "fetch_pv_spike_diagnostic_context", must_not_run)
    monkeypatch.setattr(api, "_gemini_generate", must_not_run)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = await _case_token(client, "case_a")
        response = await client.post(
            "/api/insights/neon/generate",
            json={
                "message": "分析して",
                "point_pack_md": "# pack",
                "data_source": "bq",
                "bq_project_id": "attacker-project",
                "analysis_context_meta": {"datasetId": "analytics_case_a"},
            },
            headers=_auth(token),
        )

    assert response.status_code == 403
    assert "project is outside authenticated case scope" in response.json()["detail"]


@pytest.mark.anyio
async def test_case_neon_rejects_shared_point_pack_path_before_file_access(monkeypatch):
    def file_access_must_not_run(*args, **kwargs):
        raise AssertionError("case user reached shared point-pack filesystem")

    monkeypatch.setattr(api, "_safe_compare_path", file_access_must_not_run)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = await _case_token(client, "case_a")
        response = await client.post(
            "/api/insights/neon/generate",
            json={
                "message": "他案件を読んで",
                "point_pack_path": "other-client/secret.md",
                "data_source": "bq",
                "analysis_context_meta": {"datasetId": "analytics_case_a"},
            },
            headers=_auth(token),
        )

    assert response.status_code == 403
    assert "File-based point packs" in response.json()["detail"]


@pytest.mark.anyio
@pytest.mark.parametrize("data_source", ["excel", "cross"])
async def test_case_neon_rejects_non_bq_analysis_context_before_file_or_ai(
    monkeypatch, data_source
):
    def unsafe_work_must_not_run(*args, **kwargs):
        raise AssertionError("case user reached legacy file or AI work")

    monkeypatch.setattr(api, "_safe_compare_path", unsafe_work_must_not_run)
    monkeypatch.setattr(api, "_gemini_generate", unsafe_work_must_not_run)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = await _case_token(client, "case_a")
        response = await client.post(
            "/api/insights/neon/generate",
            json={
                "message": "分析して",
                "point_pack_md": "# inline",
                "data_source": data_source,
                "analysis_context_meta": {"datasetId": "analytics_case_a"},
            },
            headers=_auth(token),
        )

    assert response.status_code == 403
    assert "limited to its BigQuery" in response.json()["detail"]


@pytest.mark.anyio
async def test_case_rate_limit_uses_signed_case_not_rotating_client_header(monkeypatch):
    monkeypatch.setattr(api, "_RATE_LIMIT_MAX", 1)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = await _case_token(client, "case_a")
        first = await client.post(
            "/api/insights/neon/generate",
            json={"analysis_context_meta": {"datasetId": "analytics_case_b"}},
            headers={**_auth(token), "X-Client-ID": "attacker-1"},
        )
        second = await client.post(
            "/api/insights/neon/generate",
            json={"analysis_context_meta": {"datasetId": "analytics_case_b"}},
            headers={**_auth(token), "X-Client-ID": "attacker-2"},
        )

    assert first.status_code == 403
    assert second.status_code == 429


@pytest.mark.anyio
async def test_unauthenticated_login_rate_limit_uses_ip_not_client_header(monkeypatch):
    monkeypatch.setattr(api, "_RATE_LIMIT_MAX", 1)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        first = await client.post(
            "/api/cases/login",
            json={"password": "wrong"},
            headers={"X-Client-ID": "attacker-1"},
        )
        second = await client.post(
            "/api/cases/login",
            json={"password": "wrong"},
            headers={"X-Client-ID": "attacker-2"},
        )

    assert first.status_code == 401
    assert second.status_code == 429


@pytest.mark.anyio
async def test_case_and_admin_bruteforce_counters_are_separate_realms():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        case_failure = await client.post("/api/cases/login", json={"password": "wrong"})
        admin_success = await client.post(
            "/api/auth/login",
            json={"password": os.environ["APP_PASSWORD"]},
        )

    assert case_failure.status_code == 401
    assert admin_success.status_code == 200
    assert any(key.startswith("case:") for key in api._login_failures)
    assert not any(key.startswith("admin:") for key in api._login_failures)


def test_cases_config_is_env_first_and_production_fail_closed(monkeypatch):
    monkeypatch.setattr(api, "_load_cases_master", _REAL_LOAD_CASES_MASTER)
    monkeypatch.setattr(api, "_IS_PRODUCTION", True)
    monkeypatch.delenv("ADS_CASES_JSON", raising=False)
    assert api._load_cases_master() == []

    env_cases = [{"case_id": "env_case", "dataset_id": "analytics_env"}]
    monkeypatch.setenv("ADS_CASES_JSON", json.dumps(env_cases))
    assert api._load_cases_master() == env_cases

    duplicate_scope = [
        {"case_id": "env_a", "dataset_id": "analytics_shared", "is_active": True},
        {"case_id": "env_b", "dataset_id": "analyzedataplatform.analytics_shared", "is_active": True},
    ]
    monkeypatch.setenv("ADS_CASES_JSON", json.dumps(duplicate_scope))
    assert api._load_cases_master() == []

    internal_alias_scope = [
        {"case_id": "env_customer", "dataset_id": "analytics_shared", "is_active": True},
        {
            "case_id": "env_internal",
            "dataset_id": "analyzedataplatform.analytics_shared",
            "is_active": True,
            "is_internal": True,
        },
    ]
    monkeypatch.setenv("ADS_CASES_JSON", json.dumps(internal_alias_scope))
    assert api._load_cases_master() == internal_alias_scope

    duplicate_password_hash = [
        {"case_id": "env_a", "dataset_id": "analytics_a", "password_hash": "same-hash"},
        {"case_id": "env_b", "dataset_id": "analytics_b", "password_hash": "same-hash"},
    ]
    monkeypatch.setenv("ADS_CASES_JSON", json.dumps(duplicate_password_hash))
    assert api._load_cases_master() == []


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/gdrive/sync"),
        ("POST", "/api/gdrive/sync_files"),
        ("POST", "/api/gdrive/clear_all_folders"),
        ("POST", "/api/cross_source_map"),
        ("DELETE", "/api/cross_source_map"),
        ("GET", "/api/cross_source_map"),
        ("GET", "/api/cross_source_candidates"),
        ("POST", "/api/cases/case_b/totp/setup"),
        ("GET", "/api/config"),
        ("POST", "/api/config"),
        ("GET", "/api/folders"),
        ("GET", "/api/months"),
        ("POST", "/api/load"),
        ("POST", "/api/generate_insights"),
        ("POST", "/api/gdrive/download_folder"),
        ("POST", "/api/gdrive/process_and_generate"),
        ("GET", "/api/key_status"),
        ("GET", "/api/usage/budget"),
        ("GET", "/api/neon/clients"),
        ("POST", "/api/chat"),
        ("GET", "/api/not-yet-reviewed"),
    ],
)
async def test_case_users_are_blocked_from_admin_mutation_endpoints(method, path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = await _case_token(client, "case_a")
        response = await client.request(method, path, json={}, headers=_auth(token))

    assert response.status_code == 403
    assert response.json()["error"] == "Admin access required"
