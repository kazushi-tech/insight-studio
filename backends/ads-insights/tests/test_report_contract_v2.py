"""Regression tests for campaign analysis and the deterministic report.v2 contract."""

from __future__ import annotations

from copy import deepcopy
import json
import sys
from pathlib import Path

import pandas as pd
import pytest


_PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PROJECT_ROOT))

from bq import reporter
from bq.queries import QUERIES, get_query
from web.app.bq_chart_builder import _build_auction_proxy
from web.app.report_contract_v2 import (
    build_measurement,
    build_observation_measurement,
    build_report_v2,
    combine_reports_v2,
)


LEGACY_QUERY_TYPES = {
    "pv",
    "traffic",
    "cv",
    "search",
    "anomaly",
    "landing",
    "device",
    "hourly",
    "user_attr",
    "engagement",
    "auction_proxy",
}


def _metrics_by_key(report: dict) -> dict[str, dict]:
    return {metric["key"]: metric for metric in report["metrics"]}


def _availability_by_key(report: dict) -> dict[str, dict]:
    return {item["key"]: item for item in report["availability"]["metrics"]}


def _pv_frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "event_date": ["20260701", "20260702"],
            "users": [2, 2],
            "sessions": [3, 3],
            "page_views": [10, 20],
            "page_title": ["A", "B"],
            "page_sessions": [3, 3],
            "period_users": [3, 3],
            "period_sessions": [5, 5],
            "period_page_views": [30, 30],
        }
    )


def _campaign_frame(*, conversions: int = 5) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "event_date": ["20260701", "20260702", "20260702"],
            "campaign_name": ["summer", "summer", "newsletter"],
            "source": ["email", "email", "mail"],
            "medium": ["email", "email", "email"],
            "users": [3, 3, 2],
            "sessions": [3, 2, 2],
            "page_views": [8, 5, 4],
            "conversions": [conversions, 0, 0],
            "campaign_period_users": [4, 4, 2],
            "period_users": [6, 6, 6],
            "period_sessions": [7, 7, 7],
            "period_page_views": [17, 17, 17],
            "period_conversions": [conversions, conversions, conversions],
        }
    )


def test_query_registry_keeps_legacy_analyses_and_adds_campaign():
    assert set(QUERIES) == LEGACY_QUERY_TYPES | {"campaign"}
    assert len(QUERIES) == 12


def test_campaign_query_uses_ga4_fields_and_period_distinct_users():
    sql = get_query("campaign", "analytics_123", "20260701", "20260731")

    assert "collected_traffic_source.manual_campaign_name" in sql
    assert "COUNT(DISTINCT user_pseudo_id) AS campaign_period_users" in sql
    assert "COUNT(DISTINCT user_pseudo_id) AS period_users" in sql
    assert "period_sessions" in sql
    assert "period_conversions" in sql
    forbidden_fields = ("ad_click", "advertising_cost", "roas", "cost_per_click", "causal")
    assert all(field not in sql.lower() for field in forbidden_fields)


def test_query_accepts_case_specific_cv_events_and_iana_timezone():
    cv_sql = get_query(
        "cv",
        "analytics_123",
        "20260701",
        "20260731",
        cv_events=("qualified_lead", "trial_started"),
    )
    hourly_sql = get_query(
        "hourly",
        "analytics_123",
        "20260701",
        "20260731",
        timezone="America/New_York",
    )

    assert "'qualified_lead', 'trial_started'" in cv_sql
    assert '"America/New_York"' in hourly_sql
    with pytest.raises(ValueError, match="IANA timezone"):
        get_query("hourly", "analytics_123", "20260701", "20260731", timezone="not/a-zone")

def test_pv_query_exposes_period_distinct_separately_from_daily_users():
    sql = get_query("pv", "analytics_123", "20260701", "20260731")

    assert "COUNT(DISTINCT user_pseudo_id) AS daily_users" in sql
    assert "COUNT(DISTINCT user_pseudo_id) AS period_users" in sql
    assert "IF(daily_rank = 1, daily_users, NULL) AS users" in sql


@pytest.mark.parametrize(
    ("query_type", "period_column", "group_period_column"),
    [
        ("traffic", "period_users", "channel_period_users"),
        ("cv", "period_unique_users", "event_period_users"),
        ("search", "period_unique_searchers", "term_period_searchers"),
        ("device", "period_users", "device_period_users"),
        ("hourly", "period_users", None),
        ("user_attr", "period_users", "user_type_period_users"),
        ("engagement", "period_engaged_users", None),
    ],
)
def test_user_metrics_expose_period_distinct_columns(
    query_type: str,
    period_column: str,
    group_period_column: str | None,
):
    sql = get_query(query_type, "analytics_123", "20260701", "20260731")

    assert f"COUNT(DISTINCT user_pseudo_id) AS {period_column}" in sql
    if group_period_column:
        assert f"COUNT(DISTINCT user_pseudo_id) AS {group_period_column}" in sql


def test_pv_summary_uses_period_distinct_instead_of_daily_sum():
    markdown = reporter._summarize(_pv_frame(), "pv", "2026-07")

    assert "**期間内ユニークユーザー数**: 3" in markdown
    assert "**期間内セッション数**: 5" in markdown
    assert "**合計PV数**: 30" in markdown
    assert "**期間内ユニークユーザー数**: 4" not in markdown


def test_campaign_summary_uses_period_and_campaign_distinct_values():
    markdown = reporter._summarize(_campaign_frame(), "campaign", "2026-07")
    public_surface = "\n".join(
        [
            get_query("campaign", "analytics_123", "20260701", "20260731"),
            markdown,
            QUERIES["campaign"]["description"],
        ]
    )

    assert "**期間内ユニークユーザー数**: 6" in markdown
    assert "**期間内セッション数**: 7" in markdown
    assert "| summer | email / email | 4 | 5 | 13 | 5 |" in markdown
    assert all(term not in public_surface for term in ("費用", "広告クリック", "ROAS", "因果"))
    assert all(term not in public_surface.lower() for term in ("ad_click", "cost", "roas", "causal"))


def test_legacy_summaries_use_period_distinct_when_available():
    traffic = pd.DataFrame(
        {
            "event_date": ["20260701", "20260702"],
            "source": ["google", "google"],
            "medium": ["organic", "organic"],
            "users": [2, 2],
            "sessions": [2, 2],
            "page_views": [3, 4],
            "channel_period_users": [3, 3],
            "period_users": [3, 3],
        }
    )
    cv = pd.DataFrame(
        {
            "event_date": ["20260701", "20260702"],
            "event_name": ["purchase", "purchase"],
            "event_count": [2, 1],
            "unique_users": [2, 2],
            "event_period_users": [3, 3],
            "period_unique_users": [3, 3],
        }
    )
    search = pd.DataFrame(
        {
            "event_date": ["20260701", "20260702"],
            "search_term": ["report", "report"],
            "search_count": [2, 2],
            "unique_searchers": [2, 2],
            "term_period_searchers": [3, 3],
            "period_unique_searchers": [3, 3],
        }
    )

    traffic_md = reporter._summarize(traffic, "traffic", "2026-07")
    cv_md = reporter._summarize(cv, "cv", "2026-07")
    search_md = reporter._summarize(search, "search", "2026-07")

    assert "**期間内ユニークユーザー数**: 3" in traffic_md
    assert "ユーザー: 3" in traffic_md
    assert "**合計CVユニークユーザー数**: 3" in cv_md
    assert "CV数: 3, ユニークユーザー: 3" in cv_md
    assert "**検索ユニークユーザー数**: 3" in search_md


def test_cross_summary_includes_campaign_highlight():
    markdown = reporter.generate_cross_summary(
        {"campaign": {"dataframe": _campaign_frame(), "report_md": "# campaign"}}
    )

    assert "**キャンペーン**: セッション: 7, CV: 5" in markdown


def test_auction_proxy_public_copy_is_only_traffic_concentration_reference():
    frame = pd.DataFrame(
        {
            "event_date": ["20260701", "20260701"],
            "channel_group": ["paid", "organic"],
            "sessions": [2, 8],
        }
    )
    prompt_path = _PROJECT_ROOT / "web" / "app" / "prompts" / "bq_query_hints.json"
    prompt = json.loads(prompt_path.read_text(encoding="utf-8"))["auction_proxy"]
    public_copy = "\n".join(
        [
            QUERIES["auction_proxy"]["name"],
            QUERIES["auction_proxy"]["description"],
            reporter._summarize(frame, "auction_proxy", "2026-07"),
            reporter.generate_cross_summary(
                {"auction_proxy": {"dataframe": frame, "report_md": "# reference"}}
            ),
            *[group["title"] for group in _build_auction_proxy(frame)],
            prompt["name"],
            prompt["hint"],
            prompt["inference_hint"],
        ]
    )

    assert "流入集中の参考値" in public_copy
    assert all(term not in public_copy for term in ("競合影響", "オークション", "Google Ads連携"))


def test_report_v2_has_exact_canonical_shape_and_distinguishes_zero():
    report = build_report_v2(
        report_id="campaign:2026-07",
        project_id="example-project",
        current_period="2026-07",
        metrics=[
            {"key": "conversions", "value": 0, "unit": "events"},
            {"key": "users", "value": None, "configured": False, "unit": "users"},
        ],
        generated_at="2026-08-01T00:00:00+00:00",
    )
    assert set(report) == {
        "schema_version",
        "report_id",
        "project_id",
        "scope",
        "availability",
        "metrics",
        "conclusions",
        "actions",
        "evidence",
        "caveats",
        "generated_at",
    }
    assert report["schema_version"] == "report.v2"
    assert report["project_id"] == "example-project"
    assert report["scope"] == {
        "current_period": {"start": "2026-07-01", "end": "2026-07-31"},
        "comparison_period": None,
        "comparison_policy": "none",
        "timezone": "Asia/Tokyo",
        "data_freshness": {"status": "unknown", "last_observed_at": None},
    }
    assert report["availability"] == {
        "overall": "partial",
        "metrics": [
            {
                "key": "conversions",
                "status": "measured_zero",
                "reason": None,
                "last_observed_at": None,
            },
            {
                "key": "users",
                "status": "not_configured",
                "reason": None,
                "last_observed_at": None,
            },
        ],
    }
    metrics = _metrics_by_key(report)
    assert metrics["conversions"]["value"] == 0
    assert metrics["users"]["value"] is None
    assert set(metrics["conversions"]) == {
        "key",
        "label",
        "value",
        "unit",
        "aggregation",
        "comparison",
        "evidence_key",
    }
    assert set(metrics["conversions"]["comparison"]) == {
        "value",
        "absolute_change",
        "percent_change",
        "status",
    }
    assert all(set(item) == {"key", "query_type", "title", "chart"} for item in report["evidence"])
    serialized = json.dumps(report, ensure_ascii=False)
    assert '"no_data"' not in serialized
    assert '"not_applicable"' not in serialized


def test_report_v2_comparison_from_zero_has_no_fake_percent():
    report = build_report_v2(
        report_id="campaign:2026-07",
        project_id="example-project",
        current_period="2026-07",
        comparison_period="2026-06",
        metrics=[
            {
                "key": "conversions",
                "value": 5,
                "comparison_value": 0,
                "unit": "events",
            }
        ],
        generated_at="2026-08-01T00:00:00+00:00",
    )
    metric = _metrics_by_key(report)["conversions"]

    assert metric["comparison"] == {
        "value": 0,
        "absolute_change": 5,
        "percent_change": None,
        "status": "baseline_zero",
    }


def test_report_v2_builder_is_deterministic_and_does_not_mutate_inputs():
    metrics = [{"key": "sessions", "value": 10, "comparison_value": 8}]
    metadata = {"nested": {"labels": ["a"]}}
    original_metrics = deepcopy(metrics)
    original_metadata = deepcopy(metadata)

    first = build_report_v2(
        report_id="pv:2026-07",
        project_id="example-project",
        current_period="2026-07",
        comparison_period="2026-06",
        metrics=metrics,
        evidence=metadata,
        generated_at="2026-08-01T00:00:00+00:00",
    )
    second = build_report_v2(
        report_id="pv:2026-07",
        project_id="example-project",
        current_period="2026-07",
        comparison_period="2026-06",
        metrics=metrics,
        evidence=metadata,
        generated_at="2026-08-01T00:00:00+00:00",
    )

    assert first == second
    assert metrics == original_metrics
    assert metadata == original_metadata


def test_report_v2_validates_conclusion_and_action_evidence_keys():
    common = {
        "report_id": "traffic:2026-07",
        "project_id": "example-project",
        "current_period": "2026-07",
        "metrics": [{"key": "sessions", "value": 10, "evidence_key": "ev:sessions"}],
        "evidence": {"ev:sessions": {"source": "traffic.sessions"}},
        "generated_at": "2026-08-01T00:00:00+00:00",
    }
    report = build_report_v2(
        **common,
        conclusions=[
            {
                "kind": "traffic_change",
                "title": "流入あり",
                "body": "期間内に訪問が確認できました。",
                "severity": "positive",
                "confidence": "high",
                "evidence_keys": ["ev:sessions"],
            }
        ],
        actions=[
            {
                "title": "内訳を確認",
                "confidence": "high",
                "evidence_keys": ["ev:sessions"],
                "priority": "high",
                "reason": "流入を維持するため",
                "timeframe": "今週",
                "success_metric": "セッション数",
            }
        ],
    )

    assert report["conclusions"][0]["evidence_keys"] == ["ev:sessions"]
    with pytest.raises(ValueError, match="unknown evidence_keys"):
        build_report_v2(
            **common,
            conclusions=[
                {
                    "kind": "unsupported_claim",
                    "title": "根拠なし",
                    "body": "確認できません。",
                    "severity": "attention",
                    "confidence": "low",
                    "evidence_keys": ["ev:missing"],
                }
            ],
        )


def test_90_day_observation_distinguishes_zero_from_missing_setup():
    assert build_observation_measurement(
        0,
        configured=True,
        observed_in_lookback=True,
    ) == {"status": "measured_zero", "value": 0}
    assert build_observation_measurement(
        0,
        configured=False,
        observed_in_lookback=False,
    ) == {"status": "not_configured", "value": None}
    assert build_observation_measurement(
        0,
        configured=True,
        observed_in_lookback=False,
    ) == {"status": "no_period_data", "value": None}


def test_measurement_uses_only_canonical_availability_statuses():
    cases = [
        (build_measurement(3), "measured"),
        (build_measurement(0), "measured_zero"),
        (build_measurement(None, configured=False), "not_configured"),
        (build_measurement(None), "no_period_data"),
        (build_measurement(None, unsupported=True), "unsupported"),
        (build_measurement(None, query_failed=True), "query_failed"),
    ]

    assert all(measurement["status"] == expected for measurement, expected in cases)


def test_dataframe_adapter_uses_explicit_period_distinct_and_zero_baseline():
    current = _campaign_frame(conversions=5)
    comparison = _campaign_frame(conversions=0)

    report = reporter.build_dataframe_report_v2(
        current,
        "campaign",
        "2026-07",
        comparison_df=comparison,
        comparison_period="2026-06",
    )
    metrics = _metrics_by_key(report)

    assert metrics["users"]["aggregation"] == "distinct_period"
    assert metrics["users"]["value"] == 6
    assert _availability_by_key(report)["conversions"]["status"] == "measured"
    assert metrics["conversions"]["comparison"]["status"] == "baseline_zero"


def test_dataframe_adapter_never_sums_daily_distinct_users():
    daily_only = pd.DataFrame(
        {
            "event_date": ["20260701", "20260702"],
            "source": ["google", "google"],
            "medium": ["organic", "organic"],
            "users": [2, 2],
            "sessions": [2, 2],
            "page_views": [3, 4],
        }
    )

    report = reporter.build_dataframe_report_v2(daily_only, "traffic", "2026-07")

    assert _availability_by_key(report)["users"]["status"] == "not_configured"
    assert _metrics_by_key(report)["users"]["value"] is None


def test_run_report_keeps_legacy_keys_and_adds_report_v2(monkeypatch, tmp_path):
    monkeypatch.setattr(reporter, "run_query", lambda _sql, _project: _pv_frame())

    result = reporter.run_report(
        "pv",
        "analytics_123",
        "2026-07",
        output_dir=tmp_path,
        project="example-project",
    )

    assert {"report", "report_md", "dataframe", "query_info", "csv"} <= set(result)
    assert result["report_v2"]["schema_version"] == "report.v2"
    assert result["report_v2"]["project_id"] == "example-project"
    assert _metrics_by_key(result["report_v2"])["users"]["value"] == 3


def _empty_cv_frame() -> pd.DataFrame:
    return pd.DataFrame(
        columns=[
            "event_name",
            "event_count",
            "unique_users",
            "event_date",
            "event_period_users",
            "period_unique_users",
        ]
    )


def test_run_report_wires_previous_month_and_90_day_cv_observation(
    monkeypatch,
    tmp_path,
):
    calls: list[str] = []

    def fake_run_query(sql, _project):
        calls.append(sql)
        if len(calls) < 3:
            return _empty_cv_frame()
        return pd.DataFrame(
            {
                "event_name": ["qualified_lead"],
                "event_count": [1],
                "unique_users": [1],
                "event_date": ["20260615"],
                "event_period_users": [1],
                "period_unique_users": [1],
            }
        )

    monkeypatch.setattr(reporter, "run_query", fake_run_query)
    result = reporter.run_report(
        "cv",
        "analytics_123",
        "2026-07",
        output_dir=tmp_path,
        project="customer-gcp",
        report_project_id="project-a",
        cv_events=("qualified_lead",),
        timezone="Asia/Tokyo",
    )

    report = result["report_v2"]
    assert report["project_id"] == "project-a"
    assert report["scope"]["current_period"] == {
        "start": "2026-07-01",
        "end": "2026-07-31",
    }
    assert report["scope"]["comparison_period"] == {
        "start": "2026-06-01",
        "end": "2026-06-30",
    }
    assert report["scope"]["comparison_policy"] == "previous_month"
    availability = _availability_by_key(report)
    assert availability["conversions"]["status"] == "measured_zero"
    assert _metrics_by_key(report)["conversions"]["value"] == 0
    assert len(calls) == 3
    assert "20260503" in calls[2] and "20260731" in calls[2]


def test_run_report_cv_without_project_configuration_is_not_configured(
    monkeypatch,
    tmp_path,
):
    calls: list[str] = []

    def fake_run_query(sql, _project):
        calls.append(sql)
        return _empty_cv_frame()

    monkeypatch.setattr(reporter, "run_query", fake_run_query)
    result = reporter.run_report(
        "cv",
        "analytics_123",
        "2026-07-01:2026-07-07",
        output_dir=tmp_path,
        project="customer-gcp",
        report_project_id="project-a",
        cv_events=None,
    )

    report = result["report_v2"]
    assert report["scope"]["comparison_policy"] == "previous_week"
    assert _availability_by_key(report)["conversions"]["status"] == "not_configured"
    assert _metrics_by_key(report)["conversions"]["value"] is None
    assert len(calls) == 2


def test_explicit_custom_seven_day_range_is_not_mislabeled_as_week():
    current, comparison, policy = reporter.report_periods(
        "2026-07-02:2026-07-08",
        "custom",
    )

    assert current.as_dict() == {"start": "2026-07-02", "end": "2026-07-08"}
    assert comparison.as_dict() == {"start": "2026-06-25", "end": "2026-07-01"}
    assert policy == "previous_equal_days"


def test_run_report_query_failure_is_not_mislabeled_as_zero_or_no_data(
    monkeypatch,
    tmp_path,
):
    class Forbidden(Exception):
        pass

    monkeypatch.setattr(
        reporter,
        "run_query",
        lambda _sql, _project: (_ for _ in ()).throw(Forbidden("secret provider body")),
    )
    result = reporter.run_report(
        "cv",
        "analytics_123",
        "2026-07",
        output_dir=tmp_path,
        project="customer-gcp",
        report_project_id="project-a",
        cv_events=("qualified_lead",),
    )

    assert result["query_failed"] is True
    assert result["error_code"] == "bq_auth_error"
    assert result["report_v2"]["availability"]["overall"] == "failed"
    assert {
        item["status"] for item in result["report_v2"]["availability"]["metrics"]
    } == {"query_failed"}


def test_cv_lookback_failure_is_not_mislabeled_as_zero(monkeypatch, tmp_path):
    calls = 0

    def fake_run_query(_sql, _project):
        nonlocal calls
        calls += 1
        if calls <= 2:
            return _empty_cv_frame()
        raise RuntimeError("lookback unavailable")

    monkeypatch.setattr(reporter, "run_query", fake_run_query)
    result = reporter.run_report(
        "cv",
        "analytics_123",
        "2026-07",
        output_dir=tmp_path,
        project="customer-gcp",
        report_project_id="project-a",
        cv_events=("qualified_lead",),
    )

    assert _availability_by_key(result["report_v2"])["conversions"]["status"] == "query_failed"
    assert _metrics_by_key(result["report_v2"])["conversions"]["value"] is None


def test_combine_reports_v2_namespaces_metrics_evidence_and_keeps_one_scope():
    generated_at = "2026-07-12T00:00:00+00:00"
    pv = reporter.build_dataframe_report_v2(
        _pv_frame(),
        "pv",
        "2026-07",
        project_id="project-a",
        generated_at=generated_at,
    )
    campaign = reporter.build_dataframe_report_v2(
        _campaign_frame(),
        "campaign",
        "2026-07",
        project_id="project-a",
        generated_at=generated_at,
    )

    combined = combine_reports_v2(
        {"pv": pv, "campaign": campaign},
        report_id="batch:project-a:2026-07",
        project_id="project-a",
    )

    assert combined["schema_version"] == "report.v2"
    assert combined["scope"]["current_period"] == {
        "start": "2026-07-01",
        "end": "2026-07-31",
    }
    metric_keys = {item["key"] for item in combined["metrics"]}
    assert {"pv.users", "campaign.users", "campaign.conversions"} <= metric_keys
    evidence_keys = {item["key"] for item in combined["evidence"]}
    assert all(item["evidence_key"] in evidence_keys for item in combined["metrics"])
    assert len(combined["conclusions"]) <= 3
    assert len(combined["actions"]) <= 3
