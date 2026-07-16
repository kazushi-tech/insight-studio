"""BQ periods and generate_batch execution summary regressions."""

import asyncio
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

os.environ.setdefault("APP_PASSWORD", "test-secret-pw-42")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx")
os.environ.setdefault("DATA_PROVIDER", "mock")

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import bq.client as bq_client  # noqa: E402
import bq.queries as bq_queries  # noqa: E402
import bq.reporter as bq_reporter  # noqa: E402
from web.app import backend_api as api  # noqa: E402
from web.app.report_contract_v2 import build_report_v2  # noqa: E402


def _json_body(response):
    return json.loads(response.body.decode("utf-8"))


def test_bq_periods_prefers_information_schema(monkeypatch):
    calls = []

    def fake_run_query(sql, project_id):
        calls.append((sql, project_id))
        assert "INFORMATION_SCHEMA.TABLES" in sql
        return pd.DataFrame({"day_suffix": ["20260520", "20260501", "20260430"]})

    api._bq_cache.clear()
    monkeypatch.setattr(bq_client, "PROJECT_ID", "demo-project")
    monkeypatch.setattr(bq_client, "run_query", fake_run_query)

    body = _json_body(api.api_bq_periods(dataset_id="analytics_123", granularity="monthly", fresh=True))

    assert body["ok"] is True
    assert body["method"] == "information_schema"
    assert body["table_count"] == 3
    assert [item["period_tag"] for item in body["periods"]] == ["2026-05", "2026-04"]
    assert len(calls) == 1


def test_bq_periods_empty_returns_diagnostics_without_manual_period(monkeypatch):
    def fake_run_query(sql, project_id):
        return pd.DataFrame({"day_suffix": []})

    api._bq_cache.clear()
    monkeypatch.setattr(bq_client, "PROJECT_ID", "demo-project")
    monkeypatch.setattr(bq_client, "run_query", fake_run_query)

    body = _json_body(api.api_bq_periods(dataset_id="analytics_123", granularity="monthly", fresh=True))

    assert body["ok"] is True
    assert body["periods"] == []
    assert body["table_count"] == 0
    assert "2026-05" not in json.dumps(body, ensure_ascii=False)
    assert body["dataset_id"] == "analytics_123"


def test_bq_periods_falls_back_to_qualified_tables(monkeypatch):
    calls = []

    def fake_run_query(sql, project_id):
        calls.append(sql)
        if "INFORMATION_SCHEMA.TABLES" in sql:
            raise RuntimeError("info schema unavailable")
        assert "`demo-project.analytics_123.__TABLES__`" in sql
        return pd.DataFrame({"day_suffix": ["20260501"]})

    api._bq_cache.clear()
    monkeypatch.setattr(bq_client, "PROJECT_ID", "demo-project")
    monkeypatch.setattr(bq_client, "run_query", fake_run_query)

    body = _json_body(api.api_bq_periods(dataset_id="analytics_123", granularity="monthly", fresh=True))

    assert body["method"] == "tables_legacy"
    assert body["periods"][0]["period_tag"] == "2026-05"
    assert len(calls) == 2


class _FakeRequest:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


def test_generate_batch_returns_execution_summary_for_every_query(monkeypatch):
    def fake_run_report(query_type, dataset, period, **_kwargs):
        if query_type == "search":
            return {
                "report_md": "# Search",
                "dataframe": pd.DataFrame({
                    "search_term": ["alpha", "beta"],
                    "search_count": [3, 1],
                    "unique_searchers": [2, 1],
                    "event_date": ["2026-05-01", "2026-05-02"],
                }),
                "query_info": {"name": "Search"},
            }
        if query_type == "traffic":
            return None
        return {
            "report_md": "# Empty chart",
            "dataframe": pd.DataFrame({"value": [1, 2, 3]}),
            "query_info": {"name": "Other"},
        }

    api._bq_cache.clear()
    monkeypatch.setattr(bq_queries, "QUERIES", {"search": {}, "traffic": {}, "custom_no_chart": {}})
    monkeypatch.setattr(bq_reporter, "run_report", fake_run_report)

    body = _json_body(asyncio.run(api.api_bq_generate_batch(_FakeRequest({
        "query_types": ["search", "traffic", "custom_no_chart"],
        "dataset_id": "analytics_123",
        "period": "2026-05",
    }))))

    summary = {item["query_type"]: item for item in body["execution_summary"]}
    assert body["ok"] is True
    assert body["data_availability"] == "partial"
    assert "traffic:no_data" in body["missing_reason"]
    assert summary["search"]["status"] == "success"
    assert summary["search"]["row_count"] == 2
    assert summary["search"]["chart_group_count"] >= 1
    assert summary["traffic"]["status"] == "no_data"
    assert summary["custom_no_chart"]["status"] == "no_chart"
    assert set(summary) == {"search", "traffic", "custom_no_chart"}


def test_generate_batch_treats_all_no_data_as_a_normal_partial_result(monkeypatch):
    def fake_run_report(query_type, dataset, period, **_kwargs):
        return None

    api._bq_cache.clear()
    monkeypatch.setattr(bq_queries, "QUERIES", {"cv": {}})
    monkeypatch.setattr(bq_reporter, "run_report", fake_run_report)

    response = asyncio.run(api.api_bq_generate_batch(_FakeRequest({
        "query_types": ["cv"],
        "dataset_id": "analytics_123",
        "period": "2026-05",
    })))
    body = _json_body(response)

    assert response.status_code == 200
    assert body["ok"] is True
    assert body["data_availability"] == "partial"
    assert body["execution_summary"][0]["status"] == "no_data"
    assert "データがない項目" in body["missing_reason"]


def test_generate_batch_mixed_valid_and_invalid_is_partial_in_request_order(monkeypatch):
    def fake_run_report(query_type, dataset, period, **_kwargs):
        return {
            "report_md": "# PV",
            "dataframe": pd.DataFrame({
                "event_date": ["20260501"],
                "users": [3],
                "sessions": [3],
                "page_views": [5],
                "period_users": [3],
                "period_sessions": [3],
                "period_page_views": [5],
            }),
            "query_info": {"name": "PV"},
        }

    api._bq_cache.clear()
    monkeypatch.setattr(bq_queries, "QUERIES", {"pv": {}})
    monkeypatch.setattr(bq_reporter, "run_report", fake_run_report)
    requested = ["unknown_before", "pv", "unknown_after"]

    response = asyncio.run(api.api_bq_generate_batch(_FakeRequest({
        "query_types": requested,
        "dataset_id": "analytics_123",
        "period": "2026-05",
    })))
    body = _json_body(response)

    assert response.status_code == 200
    assert body["ok"] is True
    assert body["data_availability"] == "partial"
    assert [item["query_type"] for item in body["execution_summary"]] == requested
    assert [item["status"] for item in body["execution_summary"]] == ["error", "success", "error"]
    assert "unknown_before:error" in body["missing_reason"]
    assert "unknown_after:error" in body["missing_reason"]


def test_generate_batch_mixed_invalid_and_failed_valid_is_failed_in_request_order(monkeypatch):
    def fake_run_report(query_type, dataset, period, **_kwargs):
        return {"query_failed": True, "error_code": "query_error"}

    api._bq_cache.clear()
    monkeypatch.setattr(bq_queries, "QUERIES", {"pv": {}})
    monkeypatch.setattr(bq_reporter, "run_report", fake_run_report)
    requested = ["pv", "unknown"]

    response = asyncio.run(api.api_bq_generate_batch(_FakeRequest({
        "query_types": requested,
        "dataset_id": "analytics_123",
        "period": "2026-05",
    })))
    body = _json_body(response)

    assert response.status_code == 502
    assert body["data_availability"] == "failed"
    assert [item["query_type"] for item in body["execution_summary"]] == requested
    assert [item["status"] for item in body["execution_summary"]] == ["error", "error"]


def test_bq_cache_parallel_get_put_is_bounded_and_consistent(monkeypatch):
    api._bq_cache.clear()
    monkeypatch.setattr(api, "_BQ_CACHE_MAX", 12)
    monkeypatch.setattr(api, "_BQ_CACHE_TTL", 3600)

    def churn(worker_id):
        observed = []
        for sequence in range(100):
            key = f"worker:{worker_id}"
            value = {"worker": worker_id, "sequence": sequence}
            api._bq_cache_put(key, value)
            cached = api._bq_cache_get(key, api._BQ_CACHE_TTL)
            if cached is not None:
                observed.append(cached[1])
        return observed

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(churn, range(8)))

    assert all(result for result in results)
    assert all(
        item["worker"] == worker_id
        for worker_id, result in enumerate(results)
        for item in result
    )
    assert len(api._bq_cache) == 8
    assert len(api._bq_cache) <= api._BQ_CACHE_MAX


def test_generate_batch_exposes_combined_report_v2_on_the_top_level(monkeypatch):
    child_report = build_report_v2(
        report_id="pv:2026-05",
        project_id="platform-admin",
        current_period={"start": "2026-05-01", "end": "2026-05-31"},
        comparison_period={"start": "2026-04-01", "end": "2026-04-30"},
        comparison_policy="previous_month",
        metrics=[
            {
                "key": "users",
                "label": "期間内利用者数",
                "value": 3,
                "comparison_value": 2,
                "unit": "users",
                "aggregation": "distinct_period",
                "source": "pv.period_users",
            }
        ],
        generated_at="2026-07-12T00:00:00+00:00",
    )

    def fake_run_report(query_type, dataset, period, **_kwargs):
        return {
            "report_v2": child_report,
            "dataframe": pd.DataFrame(
                {
                    "event_date": ["20260501"],
                    "users": [3],
                    "sessions": [3],
                    "page_views": [5],
                    "period_users": [3],
                    "period_sessions": [3],
                    "period_page_views": [5],
                }
            ),
            "query_info": {"name": "PV"},
        }

    api._bq_cache.clear()
    monkeypatch.setattr(bq_queries, "QUERIES", {"pv": {}})
    monkeypatch.setattr(bq_reporter, "run_report", fake_run_report)
    body = _json_body(asyncio.run(api.api_bq_generate_batch(_FakeRequest({
        "query_types": ["pv"],
        "dataset_id": "analytics_123",
        "period": "2026-05",
    }))))

    assert body["report_v2"]["schema_version"] == "report.v2"
    assert body["report_v2"]["project_id"] == "platform-admin"
    assert body["report_v2"]["metrics"][0]["key"] == "pv.users"
    assert body["results"]["pv"]["report_v2"] == child_report


def test_generate_batch_preserves_query_failed_report_contract(monkeypatch):
    failed_report = build_report_v2(
        report_id="pv:2026-05",
        project_id="platform-admin",
        current_period={"start": "2026-05-01", "end": "2026-05-31"},
        comparison_period={"start": "2026-04-01", "end": "2026-04-30"},
        comparison_policy="previous_month",
        metrics=[
            {
                "key": "users",
                "label": "期間内利用者数",
                "status": "query_failed",
                "comparison_status": "query_failed",
                "unit": "users",
                "aggregation": "distinct_period",
                "source": "pv.period_users",
            }
        ],
        generated_at="2026-07-12T00:00:00+00:00",
    )

    def fake_run_report(query_type, dataset, period, **_kwargs):
        return {
            "query_failed": True,
            "error_code": "query_error",
            "report_v2": failed_report,
        }

    api._bq_cache.clear()
    monkeypatch.setattr(bq_queries, "QUERIES", {"pv": {}})
    monkeypatch.setattr(bq_reporter, "run_report", fake_run_report)
    response = asyncio.run(api.api_bq_generate_batch(_FakeRequest({
        "query_types": ["pv"],
        "dataset_id": "analytics_123",
        "period": "2026-05",
    })))
    body = _json_body(response)

    assert response.status_code == 502
    assert body["error"]["code"] == "query_error"
    assert body["report_v2"]["availability"]["overall"] == "failed"
    assert body["report_v2"]["availability"]["metrics"][0]["status"] == "query_failed"


def test_bq_credentials_failure_is_service_unavailable_not_user_auth(monkeypatch):
    class DefaultCredentialsError(Exception):
        pass

    def fake_run_query(sql, project_id):
        raise DefaultCredentialsError("credentials were not found")

    api._bq_cache.clear()
    monkeypatch.setattr(bq_client, "PROJECT_ID", "demo-project")
    monkeypatch.setattr(bq_client, "run_query", fake_run_query)

    response = api.api_bq_periods(dataset_id="analytics_123", granularity="monthly", fresh=True)
    body = _json_body(response)

    assert response.status_code == 503
    assert body["error"]["code"] == "bq_credentials_missing"
    assert "再ログイン" not in body["message"]


def test_dataset_ref_validation_rejects_injection_and_bad_dates():
    from bq.queries import get_query, normalize_dataset_ref

    for bad_dataset in ["analytics_123;DROP", "demo.analytics_123.events_*", "bad-dataset"]:
        try:
            normalize_dataset_ref(bad_dataset)
        except ValueError:
            pass
        else:
            raise AssertionError(f"dataset should be rejected: {bad_dataset}")

    for start_date, end_date in [("2026-05-01", "20260531"), ("20260601", "20260501")]:
        try:
            get_query("pv", "analytics_123", start_date, end_date)
        except ValueError:
            pass
        else:
            raise AssertionError(f"dates should be rejected: {start_date} - {end_date}")


def test_pv_and_landing_queries_keep_session_level_counts():
    pv_sql = bq_queries.get_query("pv", "analytics_123", "20260501", "20260531")
    landing_sql = bq_queries.get_query("landing", "analytics_123", "20260501", "20260531")

    assert "ROW_NUMBER() OVER" in pv_sql
    assert "IF(daily_rank = 1, daily_users, NULL) AS users" in pv_sql
    assert "page_users" in pv_sql
    assert "session_rollup" in landing_sql
    assert "is_entrance" not in landing_sql
