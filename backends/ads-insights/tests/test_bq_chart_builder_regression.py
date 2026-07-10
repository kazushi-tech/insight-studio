"""BQ chart metadata and missing-value regressions."""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PROJECT_ROOT))

from web.app.bq_chart_builder import build_beginner_report, build_bq_chart_data


def test_build_bq_chart_data_adds_query_type_to_every_group(monkeypatch):
    source_groups = [
        {
            "title": "First chart",
            "chartType": "line",
            "labels": ["2026-07-01"],
            "datasets": [{"label": "Sessions", "data": [10]}],
        },
        {
            "title": "Second chart",
            "chartType": "bar",
            "labels": ["Organic"],
            "datasets": [{"label": "Users", "data": [7]}],
            "warnings": ["low_sample"],
        },
    ]
    monkeypatch.setitem(
        sys.modules[build_bq_chart_data.__module__]._BUILDERS,
        "regression_query",
        lambda _df: source_groups,
    )

    result = build_bq_chart_data(pd.DataFrame({"value": [1]}), "regression_query")

    assert [group["queryType"] for group in result["groups"]] == [
        "regression_query",
        "regression_query",
    ]
    assert [
        {key: value for key, value in group.items() if key != "queryType"}
        for group in result["groups"]
    ] == source_groups
    assert all("queryType" not in group for group in source_groups)


def test_search_uses_actual_coverage_instead_of_fixed_top20():
    df = pd.DataFrame({
        "search_term": ["alpha", "beta", "gamma"],
        "search_count": [10, 5, 2],
        "unique_searchers": [7, 4, 2],
    })

    group = build_bq_chart_data(df, "search")["groups"][0]

    assert "Top 20" not in group["title"]
    assert group["title"] == "検索クエリ — 検索回数上位3語"
    assert group["selectionLabel"] == "検索回数上位3語を表示"
    assert group["coverageLabel"] == "上位3件 / 最大20件"
    assert group["actualCount"] == 3
    assert group["limit"] == 20
    assert "low_sample" in group["warnings"]


def test_ranking_builders_report_actual_counts():
    landing_df = pd.DataFrame({
        "landing_page": ["/a", "/b"],
        "sessions": [20, 10],
        "avg_pages_per_session": [2.0, 1.5],
        "bounce_sessions": [4, 5],
    })
    device_df = pd.DataFrame({
        "device_category": ["mobile", "desktop"],
        "os": ["iOS", "Android"],
        "sessions": [12, 8],
        "users": [9, 6],
        "page_views": [30, 16],
    })
    user_df = pd.DataFrame({
        "user_type": ["new", "returning", "new"],
        "city": ["Tokyo", "Osaka", "Kyoto"],
        "sessions": [9, 5, 4],
        "users": [7, 3, 3],
    })

    landing_group = build_bq_chart_data(landing_df, "landing")["groups"][0]
    device_group = next(
        g for g in build_bq_chart_data(device_df, "device")["groups"]
        if g.get("coverageLabel")
    )
    user_group = next(
        g for g in build_bq_chart_data(user_df, "user_attr")["groups"]
        if g.get("coverageLabel")
    )

    assert landing_group["coverageLabel"] == "上位2件 / 最大20件"
    assert landing_group["title"] == "LP分析 — セッション数上位2LP"
    assert landing_group["selectionLabel"] == "セッション数上位2LPを表示"
    assert device_group["coverageLabel"] == "上位2件 / 最大10件"
    assert device_group["title"] == "デバイス分析 — セッション数上位2OS"
    assert device_group["selectionLabel"] == "セッション数上位2OSを表示"
    assert user_group["coverageLabel"] == "上位3件 / 最大15件"
    assert user_group["title"] == "ユーザー属性 — セッション数上位3地域"
    assert user_group["selectionLabel"] == "セッション数上位3地域を表示"


def test_missing_ranking_labels_are_excluded_and_warned():
    df = pd.DataFrame({
        "search_term": ["alpha", "", None, np.nan],
        "search_count": [10, 7, 5, 3],
        "unique_searchers": [8, 5, 3, 2],
    })

    group = build_bq_chart_data(df, "search")["groups"][0]

    assert group["labels"] == ["alpha"]
    assert group["missingLabelCount"] == 3
    assert "missing_label" in group["warnings"]


def test_flat_bounce_rate_ranking_reports_warning():
    df = pd.DataFrame({
        "landing_page": ["/a", "/b", "/c"],
        "sessions": [10, 8, 6],
        "avg_pages_per_session": [1.0, 1.0, 1.0],
        "bounce_sessions": [10, 8, 6],
    })

    group = next(
        g for g in build_bq_chart_data(df, "landing")["groups"]
        if g["title"].startswith("LP分析 — 直帰率")
    )

    assert group["datasets"][0]["data"] == [100.0, 100.0, 100.0]
    assert "flat_series" in group["warnings"]


def test_beginner_report_flags_cv_gap_and_recommends_evidence_charts():
    groups = [
        {
            "title": "PV分析 — 日別推移",
            "queryType": "pv",
            "chartType": "line",
            "labels": ["2026-07-01", "2026-07-02"],
            "datasets": [{"label": "PV数", "data": [100, 150]}],
        },
        {
            "title": "流入分析 — セッション数上位2チャネル",
            "queryType": "traffic",
            "chartType": "bar_horizontal",
            "labels": ["organic / google", "direct / none"],
            "datasets": [{"label": "セッション", "data": [80, 20]}],
        },
        {
            "title": "LP分析 — セッション数上位2LP",
            "queryType": "landing",
            "chartType": "bar_horizontal",
            "labels": ["/", "/service"],
            "datasets": [{"label": "セッション", "data": [60, 40]}],
        },
    ]
    summary = [
        {"query_type": "pv", "status": "success", "row_count": 2, "chart_group_count": 1},
        {"query_type": "traffic", "status": "success", "row_count": 2, "chart_group_count": 1},
        {"query_type": "landing", "status": "success", "row_count": 2, "chart_group_count": 1},
        {"query_type": "cv", "status": "no_data", "row_count": 0, "chart_group_count": 0},
    ]

    report = build_beginner_report(groups, summary)

    assert report["version"] == "beginner_report_v1"
    assert len(report["summary_cards"]) <= 5
    assert any(card["type"] == "what_happened" for card in report["summary_cards"])
    assert any(card["type"] == "data_gap" for card in report["summary_cards"])
    assert any(gap["key"] == "cv_missing" for gap in report["data_gaps"])
    assert report["recommended_charts"][:2] == ["chart_01", "chart_02"]
    assert report["next_actions"][0]["title"] == "CV計測を確認する"


def test_beginner_report_does_not_invent_ad_efficiency_kpis():
    groups = [
        {
            "title": "PV分析 — 日別推移",
            "queryType": "pv",
            "chartType": "line",
            "labels": ["2026-07-01", "2026-07-02"],
            "datasets": [{"label": "PV数", "data": [100, 90]}],
        },
    ]

    report = build_beginner_report(groups, [{"query_type": "pv", "status": "success"}])
    rendered = str(report)

    for forbidden in ["CPA", "ROAS", "CTR", "広告費"]:
        assert forbidden not in rendered
