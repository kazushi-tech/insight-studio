"""Portfolio demo authentication, data-contract, and isolation regressions."""

from __future__ import annotations

import json
import asyncio
import os
import secrets
import sys
import time
from copy import deepcopy
from pathlib import Path
from typing import Any

os.environ["APP_PASSWORD"] = "test-secret-pw-42"
os.environ["JWT_SECRET"] = "test-jwt-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
os.environ.setdefault("DATA_PROVIDER", "mock")

import bcrypt
import httpx
import jwt
import pandas as pd
import pytest


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import bq.auth as bq_auth  # noqa: E402
import bq.client as bq_client  # noqa: E402
import bq.queries as bq_queries  # noqa: E402
import bq.reporter as bq_reporter  # noqa: E402
from web.app import backend_api as api  # noqa: E402
from web.app.demo.portfolio_demo_fixture import (  # noqa: E402
    DEMO_CASE_ID,
    DEMO_COMPARISON_PERIOD,
    DEMO_CURRENT_PERIOD,
    DEMO_DATASET_ID,
    DEMO_DATA_SOURCE,
    DEMO_PERIODS,
    MONTH_OVER_MONTH,
    PERIOD_DATA,
    QUERY_TYPE_KEYS,
    TRAFFIC_SOURCES,
)


_DEMO_PASSWORD = secrets.token_urlsafe(18)
_NORMAL_PASSWORD = secrets.token_urlsafe(18)
_DEMO_PASSWORD_HASH = bcrypt.hashpw(
    _DEMO_PASSWORD.encode("utf-8"), bcrypt.gensalt(rounds=12)
).decode("utf-8")
_NORMAL_PASSWORD_HASH = bcrypt.hashpw(
    _NORMAL_PASSWORD.encode("utf-8"), bcrypt.gensalt(rounds=12)
).decode("utf-8")

_DEMO_CASE = {
    "case_id": DEMO_CASE_ID,
    "name": "Portfolio Demo",
    "description": "Synthetic portfolio fixture",
    "dataset_id": DEMO_DATASET_ID,
    "password_hash": _DEMO_PASSWORD_HASH,
    "totp_secret": "",
    "totp_enabled": False,
    "is_active": True,
    "is_internal": False,
    "is_demo": True,
}
_NORMAL_CASE = {
    "case_id": "normal_test_case",
    "name": "Normal Test Case",
    "description": "",
    "dataset_id": "analytics_normal_test",
    "password_hash": _NORMAL_PASSWORD_HASH,
    "totp_secret": "",
    "totp_enabled": False,
    "is_active": True,
    "is_internal": False,
}
_CASES = [_DEMO_CASE, _NORMAL_CASE]
_SUPPORTED_CHART_TYPES = {"line", "bar_horizontal", "doughnut", "area"}


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def _isolate_demo_registry_and_runtime(monkeypatch):
    api._login_failures.clear()
    api._bq_cache.clear()
    monkeypatch.setattr(api, "_load_cases_master", lambda: deepcopy(_CASES))
    yield
    api._login_failures.clear()
    api._bq_cache.clear()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _login_demo(client: httpx.AsyncClient) -> dict[str, Any]:
    response = await client.post("/api/cases/login", json={"password": _DEMO_PASSWORD})
    assert response.status_code == 200, response.text
    return response.json()


async def _login_normal(client: httpx.AsyncClient) -> dict[str, Any]:
    response = await client.post(
        "/api/cases/login",
        json={"case_id": _NORMAL_CASE["case_id"], "password": _NORMAL_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _evidence_pack(period_groups: list[tuple[str, list[dict[str, Any]]]]) -> dict[str, Any]:
    charts = []
    for period, groups in period_groups:
        for group in groups:
            labels = [str(label) for label in group.get("labels") or []]
            series = []
            for dataset in group.get("datasets") or []:
                points = [
                    {"label": label, "rawLabel": label, "aliases": [], "value": value}
                    for label, value in zip(labels, dataset.get("data") or [])
                ]
                values = [point["value"] for point in points]
                series.append(
                    {
                        "label": dataset.get("label"),
                        "point_count": len(points),
                        "missing_count": 0,
                        "points": points,
                        "latest": points[-1] if points else None,
                        "first": points[0] if points else None,
                        "total": sum(values),
                        "average": sum(values) / len(values) if values else None,
                        "max": max(points, key=lambda point: point["value"]) if points else None,
                        "min": min(points, key=lambda point: point["value"]) if points else None,
                        "change_from_first": None,
                        "notable_swings": [],
                        "top_points": points[:5],
                    }
                )
            charts.append(
                {
                    "chart_id": f"chart_{len(charts) + 1:02d}",
                    "title": group["title"],
                    "chart_type": group["chartType"],
                    "period_tag": period,
                    "query_type": group["queryType"],
                    "selection_label": group.get("selectionLabel", ""),
                    "label_count": len(labels),
                    "series_count": len(series),
                    "missing_values": 0,
                    "finite_values": sum(len(item["points"]) for item in series),
                    "series": series,
                    "ranking_top": [],
                    "warnings": [],
                }
            )
    return {
        "version": "chart_evidence_pack_v1",
        "scope_label": "demo",
        "chart_count": len(charts),
        "charts": charts,
    }


def _all_strings(value: Any):
    if isinstance(value, dict):
        for item in value.values():
            yield from _all_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _all_strings(item)
    elif isinstance(value, str):
        yield value


@pytest.mark.anyio
async def test_demo_password_login_is_totp_free_and_issues_scoped_jwt():
    assert _DEMO_PASSWORD_HASH.startswith("$2b$12$")
    assert _DEMO_PASSWORD_HASH != _NORMAL_PASSWORD_HASH

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        wrong = await client.post("/api/cases/login", json={"password": "wrong-demo-password"})
        result = await _login_demo(client)

    assert wrong.status_code == 401
    assert result["ok"] is True
    assert result["case_id"] == DEMO_CASE_ID
    assert result["dataset_id"] == DEMO_DATASET_ID
    assert result["is_demo"] is True
    assert result["data_source"] == DEMO_DATA_SOURCE
    assert "device_trust_token" not in result

    claims = jwt.decode(result["token"], os.environ["JWT_SECRET"], algorithms=["HS256"])
    assert claims["typ"] == "auth"
    assert claims["role"] == "case_user"
    assert claims["case_id"] == DEMO_CASE_ID
    assert claims["dataset_id"] == DEMO_DATASET_ID
    assert isinstance(claims["exp"], int)
    assert claims["jti"]
    assert "admin" not in claims.values()


@pytest.mark.anyio
@pytest.mark.parametrize(
    "invalid_case",
    [
        {**_DEMO_CASE, "is_demo": False},
        {**_DEMO_CASE, "dataset_id": "wrong_demo_dataset"},
        {**_DEMO_CASE, "case_id": "not_demo", "is_demo": True},
        {**_DEMO_CASE, "totp_enabled": True, "totp_secret": "NOT-A-REAL-SECRET"},
    ],
)
async def test_inconsistent_demo_registry_records_fail_closed(monkeypatch, invalid_case):
    monkeypatch.setattr(api, "_load_cases_master", lambda: [invalid_case, deepcopy(_NORMAL_CASE)])
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/cases/login",
            json={"case_id": invalid_case["case_id"], "password": _DEMO_PASSWORD},
        )

    assert response.status_code == 403
    assert "token" not in response.text


@pytest.mark.anyio
async def test_demo_jwt_is_revalidated_against_active_registry_and_dataset(monkeypatch):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = (await _login_demo(client))["token"]

        monkeypatch.setattr(
            api,
            "_load_cases_master",
            lambda: [{**deepcopy(_DEMO_CASE), "is_active": False}, deepcopy(_NORMAL_CASE)],
        )
        inactive = await client.get("/api/bq/datasets", headers=_auth(token))

        monkeypatch.setattr(
            api,
            "_load_cases_master",
            lambda: [{**deepcopy(_DEMO_CASE), "dataset_id": "changed_demo_scope"}, deepcopy(_NORMAL_CASE)],
        )
        changed = await client.get("/api/bq/datasets", headers=_auth(token))

    assert inactive.status_code == 403
    assert changed.status_code == 403
    assert changed.json()["error"]["category"] == "authorization"


@pytest.mark.anyio
async def test_demo_jwt_cannot_escape_case_dataset_or_admin_scope():
    expired = jwt.encode(
        {
            "typ": "auth",
            "role": "case_user",
            "case_id": DEMO_CASE_ID,
            "dataset_id": DEMO_DATASET_ID,
            "exp": int(time.time()) - 1,
            "jti": "expired-demo-test",
        },
        os.environ["JWT_SECRET"],
        algorithm="HS256",
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = (await _login_demo(client))["token"]
        unauthenticated = await client.get("/api/bq/datasets")
        expired_response = await client.get("/api/bq/datasets", headers=_auth(expired))
        other_case = await client.get(
            f"/api/cases/{_NORMAL_CASE['case_id']}/bq-status", headers=_auth(token)
        )
        wrong_dataset_periods = await client.get(
            "/api/bq/periods",
            params={"dataset_id": _NORMAL_CASE["dataset_id"]},
            headers=_auth(token),
        )
        project_qualified_demo_dataset = await client.get(
            "/api/bq/periods",
            params={"dataset_id": f"other-project.{DEMO_DATASET_ID}"},
            headers=_auth(token),
        )
        wrong_dataset_single = await client.post(
            "/api/bq/generate",
            json={"query_type": "pv", "dataset_id": _NORMAL_CASE["dataset_id"], "period": DEMO_CURRENT_PERIOD},
            headers=_auth(token),
        )
        wrong_dataset_batch = await client.post(
            "/api/bq/generate_batch",
            json={"query_types": ["pv"], "dataset_id": _NORMAL_CASE["dataset_id"], "period": DEMO_CURRENT_PERIOD},
            headers=_auth(token),
        )
        config = await client.post("/api/config", json={}, headers=_auth(token))
        totp_setup = await client.post(
            f"/api/cases/{DEMO_CASE_ID}/totp/setup", json={}, headers=_auth(token)
        )
        after_logout = await client.get("/api/bq/periods")

    assert unauthenticated.status_code == 401
    assert expired_response.status_code == 401
    assert other_case.status_code == 403
    assert wrong_dataset_periods.status_code == 403
    assert project_qualified_demo_dataset.status_code == 403
    assert wrong_dataset_single.status_code == 403
    assert wrong_dataset_batch.status_code == 403
    assert config.status_code == 403
    assert totp_setup.status_code == 403
    assert after_logout.status_code == 401


@pytest.mark.anyio
async def test_demo_fixture_contract_integrity_and_zero_external_calls(monkeypatch):
    def forbidden(*_args, **_kwargs):
        raise AssertionError("demo request reached an external, credential, AI, or customer-file path")

    for module, name in (
        (bq_auth, "setup_credentials"),
        (bq_client, "get_client"),
        (bq_client, "list_datasets"),
        (bq_client, "run_query"),
        (bq_reporter, "run_report"),
        (api, "_gemini_generate"),
        (api, "_gemini_generate_text"),
        (api, "_anthropic_generate"),
        (api, "fetch_pv_spike_diagnostic_context"),
        (api, "_resolve_gemini_api_key"),
        (api, "_is_client_key_required"),
        (api, "_safe_compare_path"),
        (api, "get_data_provider"),
    ):
        monkeypatch.setattr(module, name, forbidden)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        login = await _login_demo(client)
        headers = _auth(login["token"])
        cases = await client.get("/api/cases", headers=headers)
        status = await client.get(f"/api/cases/{DEMO_CASE_ID}/bq-status", headers=headers)
        datasets = await client.get("/api/bq/datasets", headers=headers)
        query_types = await client.get("/api/bq/query_types", headers=headers)
        periods = await client.get(
            "/api/bq/periods",
            params={"dataset_id": DEMO_DATASET_ID, "granularity": "monthly", "fresh": "true"},
            headers=headers,
        )
        single = await client.post(
            "/api/bq/generate",
            json={"query_type": "pv", "dataset_id": DEMO_DATASET_ID, "period": DEMO_CURRENT_PERIOD},
            headers=headers,
        )
        batch = await client.post(
            "/api/bq/generate_batch",
            json={"query_types": list(QUERY_TYPE_KEYS), "dataset_id": DEMO_DATASET_ID, "period": DEMO_CURRENT_PERIOD},
            headers=headers,
        )
        comparison_batch = await client.post(
            "/api/bq/generate_batch",
            json={"query_types": list(QUERY_TYPE_KEYS), "dataset_id": DEMO_DATASET_ID, "period": DEMO_COMPARISON_PERIOD},
            headers=headers,
        )
        repeat = await client.post(
            "/api/bq/generate_batch",
            json={"query_types": list(QUERY_TYPE_KEYS), "dataset_id": DEMO_DATASET_ID, "period": DEMO_CURRENT_PERIOD},
            headers=headers,
        )

        batch_body = batch.json()
        comparison_body = comparison_batch.json()
        evidence_pack = _evidence_pack(
            [
                (DEMO_CURRENT_PERIOD, batch_body["chart_data"]["groups"]),
                (DEMO_COMPARISON_PERIOD, comparison_body["chart_data"]["groups"]),
            ]
        )
        ai_response = await client.post(
            "/api/insights/neon/generate",
            json={
                "message": "成果を説明して",
                "data_source": "bq",
                "analysis_context_meta": {"datasetId": DEMO_DATASET_ID},
                "chart_evidence_pack": evidence_pack,
            },
            headers=headers,
        )

    assert cases.status_code == 200
    assert cases.json()["cases"] == [
        {
            "case_id": DEMO_CASE_ID,
            "name": _DEMO_CASE["name"],
            "description": _DEMO_CASE["description"],
            "is_internal": False,
            "status": "active",
            "dataset_id": DEMO_DATASET_ID,
            "is_demo": True,
            "data_source": DEMO_DATA_SOURCE,
        }
    ]
    assert status.json()["message"] == "デモデータ利用中"
    assert status.json()["data_source"] == DEMO_DATA_SOURCE
    assert datasets.json()["datasets"] == [
        {
            "dataset_id": DEMO_DATASET_ID,
            "label": "完全架空データ",
            "is_demo": True,
            "data_source": DEMO_DATA_SOURCE,
        }
    ]
    assert [item["key"] for item in query_types.json()["query_types"]] == list(QUERY_TYPE_KEYS)
    assert len(QUERY_TYPE_KEYS) == 12
    assert tuple(bq_queries.QUERIES) == QUERY_TYPE_KEYS
    assert [item["period_tag"] for item in periods.json()["periods"]] == list(DEMO_PERIODS)
    assert single.status_code == 200
    assert single.json()["period_metadata"]["period_tag"] == DEMO_CURRENT_PERIOD

    assert batch.status_code == 200
    assert batch_body["is_demo"] is True
    assert batch_body["data_source"] == DEMO_DATA_SOURCE
    assert batch_body["period"] == DEMO_CURRENT_PERIOD
    assert batch_body["chart_data"]["groups"] == repeat.json()["chart_data"]["groups"]
    assert {
        group["chartType"] for group in batch_body["chart_data"]["groups"]
    } <= _SUPPORTED_CHART_TYPES
    assert {
        group["chartType"] for group in comparison_body["chart_data"]["groups"]
    } <= _SUPPORTED_CHART_TYPES
    for body, expected_period in (
        (batch_body, DEMO_CURRENT_PERIOD),
        (comparison_body, DEMO_COMPARISON_PERIOD),
    ):
        assert body["period"] == expected_period
        assert [item["query_type"] for item in body["execution_summary"]] == list(QUERY_TYPE_KEYS)
        assert all(item["status"] == "success" for item in body["execution_summary"])
        assert body["data_availability"] == "full"
        assert body["missing_reason"] == ""
        assert body["skipped"] == []
        assert set(body["results"]) == set(QUERY_TYPE_KEYS)

        first_group_order = []
        for group in body["chart_data"]["groups"]:
            if group["queryType"] not in first_group_order:
                first_group_order.append(group["queryType"])
        assert first_group_order == list(QUERY_TYPE_KEYS)

    assert "電話タップは未計測" in json.dumps(batch_body["beginner_report"], ensure_ascii=False)

    traffic_group = next(group for group in batch_body["chart_data"]["groups"] if group["queryType"] == "traffic")
    assert sum(traffic_group["datasets"][0]["data"]) == 3120
    assert sum(item["sessions"] for item in TRAFFIC_SOURCES) == PERIOD_DATA[DEMO_CURRENT_PERIOD]["sessions"]

    current_raw_rate = 47 / 3120 * 100
    comparison_raw_rate = 42 / 2760 * 100
    assert round(current_raw_rate, 2) == PERIOD_DATA[DEMO_CURRENT_PERIOD]["inquiry_rate"]
    assert round(comparison_raw_rate, 2) == PERIOD_DATA[DEMO_COMPARISON_PERIOD]["inquiry_rate"]
    assert round(current_raw_rate - comparison_raw_rate, 2) == MONTH_OVER_MONTH["inquiry_rate_points"] == -0.02
    assert round(
        PERIOD_DATA[DEMO_CURRENT_PERIOD]["engagement_rate"]
        - PERIOD_DATA[DEMO_COMPARISON_PERIOD]["engagement_rate"],
        1,
    ) == MONTH_OVER_MONTH["engagement_rate_points"]

    all_response_strings = list(_all_strings(batch_body)) + list(_all_strings(ai_response.json()))
    urls = [text for text in all_response_strings if text.startswith("http://") or text.startswith("https://")]
    assert urls and all(".example" in url for url in urls)
    assert "こもれび工房（完全架空サイト）" in batch_body["report_md"]

    ai_body = ai_response.json()
    assert ai_response.status_code == 200
    assert ai_body["generated_by"] == DEMO_DATA_SOURCE
    assert ai_body["llm_calls"] == 0
    assert ai_body["tokens_used"] == 0
    assert ai_body["evidence_complete"] is True
    assert ai_body["referenced_chart_ids"] == [
        "chart_01",
        "chart_17",
        "chart_03",
        "chart_19",
        "chart_04",
        "chart_20",
        "chart_02",
    ]
    evidence_by_id = {chart["chart_id"]: chart for chart in evidence_pack["charts"]}
    assert [point["value"] for point in evidence_by_id["chart_01"]["series"][0]["points"]] == [2480, 3120, 4860]
    assert [point["value"] for point in evidence_by_id["chart_17"]["series"][0]["points"]] == [2180, 2760, 4210]
    assert evidence_by_id["chart_03"]["series"][0]["points"][0]["value"] == 47
    assert evidence_by_id["chart_19"]["series"][0]["points"][0]["value"] == 42
    assert evidence_by_id["chart_04"]["series"][0]["points"][0]["value"] == 1.51
    assert evidence_by_id["chart_20"]["series"][0]["points"][0]["value"] == 1.52
    assert [point["value"] for point in evidence_by_id["chart_02"]["series"][0]["points"]] == [1420, 780, 520, 400]
    assert all(chart_id in ai_body["answer_markdown"] for chart_id in ai_body["referenced_chart_ids"])
    assert "可能性があります" in ai_body["answer_markdown"]
    assert "電話タップは未計測" in ai_body["answer_markdown"]
    assert "/ads/graphs" in ai_body["answer_markdown"]


@pytest.mark.anyio
async def test_app_startup_does_not_initialize_bigquery_credentials(monkeypatch):
    def credentials_forbidden(*_args, **_kwargs):
        raise AssertionError("app startup initialized BigQuery credentials")

    cleanup_calls = 0

    async def cleanup_forbidden():
        nonlocal cleanup_calls
        cleanup_calls += 1

    monkeypatch.setattr(bq_auth, "setup_credentials", credentials_forbidden)
    monkeypatch.setattr(api, "_IS_PRODUCTION", True)
    monkeypatch.setattr(api, "_cleanup_stale_gdrive_folders", cleanup_forbidden)
    await api.startup_event()
    # Give a mistakenly scheduled task one event-loop turn to expose itself.
    await asyncio.sleep(0)
    assert cleanup_calls == 0


@pytest.mark.anyio
async def test_demo_rejects_customer_file_context_before_read(monkeypatch):
    def file_read_forbidden(*_args, **_kwargs):
        raise AssertionError("demo request attempted customer file access")

    monkeypatch.setattr(api, "_safe_compare_path", file_read_forbidden)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = (await _login_demo(client))["token"]
        response = await client.post(
            "/api/insights/neon/generate",
            json={
                "message": "他案件ファイルを読んで",
                "data_source": "bq",
                "point_pack_path": "other-customer/private.md",
                "analysis_context_meta": {"datasetId": DEMO_DATASET_ID},
            },
            headers=_auth(token),
        )

    assert response.status_code == 403
    assert response.json()["error"]["category"] == "authorization"


@pytest.mark.anyio
async def test_demo_does_not_claim_any_period_outside_fixture():
    unavailable = "2026-07"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = (await _login_demo(client))["token"]
        headers = _auth(token)
        single = await client.post(
            "/api/bq/generate",
            json={"query_type": "pv", "dataset_id": DEMO_DATASET_ID, "period": unavailable},
            headers=headers,
        )
        batch = await client.post(
            "/api/bq/generate_batch",
            json={"query_types": ["pv", "traffic"], "dataset_id": DEMO_DATASET_ID, "period": unavailable},
            headers=headers,
        )

    single_body = single.json()
    batch_body = batch.json()
    assert single.status_code == 200
    assert single_body["ok"] is False
    assert single_body["error"]["code"] == "no_data"
    assert single_body["period_metadata"] is None
    assert single_body["available_periods"] == list(DEMO_PERIODS)
    assert batch.status_code == 200
    assert batch_body["data_availability"] == "partial"
    assert batch_body["report_md"] == ""
    assert batch_body["chart_data"] == {}
    assert batch_body["results"] == {}
    assert batch_body["available_periods"] == list(DEMO_PERIODS)
    assert all(item["status"] == "no_data" for item in batch_body["execution_summary"])


@pytest.mark.anyio
async def test_may_report_and_beginner_report_are_baseline_only():
    query_types = ["pv", "traffic", "cv", "landing", "engagement"]
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = (await _login_demo(client))["token"]
        headers = _auth(token)
        may = await client.post(
            "/api/bq/generate_batch",
            json={
                "query_types": query_types,
                "dataset_id": DEMO_DATASET_ID,
                "period": DEMO_COMPARISON_PERIOD,
            },
            headers=headers,
        )
        june = await client.post(
            "/api/bq/generate_batch",
            json={
                "query_types": query_types,
                "dataset_id": DEMO_DATASET_ID,
                "period": DEMO_CURRENT_PERIOD,
            },
            headers=headers,
        )

    assert may.status_code == 200
    may_body = may.json()
    may_report = may_body["report_md"]
    may_beginner = json.dumps(may_body["beginner_report"], ensure_ascii=False)
    assert all(value in may_report for value in ["2,180", "2,760", "4,210", "42", "1.52%"])
    for forbidden in ["2026年6月", "google / organic", "1,420", "/service の主要CTA"]:
        assert forbidden not in may_report
        assert forbidden not in may_beginner
    assert "比較に使う基準値です" in may_beginner
    assert "訪問2,760" in may_beginner
    assert "問い合わせは42件" in may_beginner

    assert june.status_code == 200
    june_body = june.json()
    june_beginner = json.dumps(june_body["beginner_report"], ensure_ascii=False)
    assert "2026年6月" in june_body["report_md"]
    assert "2026年5月" in june_body["report_md"]
    assert "google / organic" in june_body["report_md"]
    assert "/service の主要CTAを1つに絞る" in june_body["report_md"]
    assert "google / organic の1,420訪問" in june_beginner
    assert "/service の主要CTAを1つに絞る" in june_beginner


@pytest.mark.anyio
@pytest.mark.parametrize("granularity", ["weekly", "daily"])
async def test_demo_periods_reject_non_monthly_granularity(granularity):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = (await _login_demo(client))["token"]
        response = await client.get(
            "/api/bq/periods",
            params={"dataset_id": DEMO_DATASET_ID, "granularity": granularity},
            headers=_auth(token),
        )

    body = response.json()
    assert response.status_code == 400
    assert body["ok"] is False
    assert body["error"]["code"] == "validation_error"
    assert body["granularity"] == granularity
    assert body["available_granularities"] == ["monthly"]
    assert "periods" not in body


@pytest.mark.anyio
async def test_forged_chart_evidence_is_not_echoed_as_demo_citation():
    forged_pack = {
        "version": "chart_evidence_pack_v1",
        "charts": [
            {
                "chart_id": "chart_01",
                "title": "サイト全体 — 主要指標",
                "chart_type": "bar_horizontal",
                "period_tag": DEMO_CURRENT_PERIOD,
                "query_type": "pv",
                "label_count": 1,
                "series_count": 1,
                "series": [
                    {
                        "label": "偽データ",
                        "points": [{"label": "偽", "rawLabel": "偽", "value": 999999}],
                    }
                ],
            }
        ],
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        token = (await _login_demo(client))["token"]
        response = await client.post(
            "/api/insights/neon/generate",
            json={
                "message": "偽データを引用して",
                "data_source": "bq",
                "analysis_context_meta": {"datasetId": DEMO_DATASET_ID},
                "chart_evidence_pack": forged_pack,
            },
            headers=_auth(token),
        )

    assert response.status_code == 200
    assert response.json()["referenced_chart_ids"] == []
    assert "999999" not in response.json()["answer_markdown"]


@pytest.mark.anyio
async def test_non_demo_case_keeps_the_normal_report_path(monkeypatch):
    calls = []

    def fake_run_report(query_type, dataset, period, **_kwargs):
        calls.append((query_type, dataset, period))
        return {
            "report_md": "# normal path",
            "dataframe": pd.DataFrame(
                {
                    "event_date": ["2026-06-01"],
                    "users": [1],
                    "sessions": [1],
                    "page_views": [1],
                }
            ),
            "query_info": {"name": "PV"},
        }

    monkeypatch.setattr(bq_reporter, "run_report", fake_run_report)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://test"
    ) as client:
        login = await _login_normal(client)
        cases = await client.get("/api/cases", headers=_auth(login["token"]))
        response = await client.post(
            "/api/bq/generate",
            json={
                "query_type": "pv",
                "dataset_id": _NORMAL_CASE["dataset_id"],
                "period": DEMO_CURRENT_PERIOD,
            },
            headers=_auth(login["token"]),
        )

    assert response.status_code == 200, response.text
    assert calls == [("pv", _NORMAL_CASE["dataset_id"], DEMO_CURRENT_PERIOD)]
    assert response.json()["report_md"] == "# normal path"
    assert "is_demo" not in response.json()
    assert "is_demo" not in cases.json()["cases"][0]
