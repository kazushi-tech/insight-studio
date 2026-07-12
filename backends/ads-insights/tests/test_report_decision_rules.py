"""Deterministic customer decision-rule regression tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd


_PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PROJECT_ROOT))

from bq.reporter import build_dataframe_report_v2
from web.app.report_contract_v2 import build_report_v2
from web.app.report_decision_rules import derive_report_decisions


def _report(*, current: int | None, comparison: int | None, configured: bool = True) -> dict:
    return build_report_v2(
        report_id="traffic:2026-07",
        project_id="project-1",
        current_period="2026-07",
        comparison_period="2026-06",
        metrics=[
            {
                "key": "sessions",
                "label": "訪問数",
                "value": current,
                "comparison_value": comparison,
                "configured": configured,
                "comparison_configured": configured,
                "unit": "sessions",
                "evidence_key": "metric:sessions",
            }
        ],
        generated_at="2026-08-01T00:00:00+00:00",
    )


def test_decline_produces_evidence_bound_conclusion_and_action():
    decisions = derive_report_decisions(_report(current=80, comparison=100))

    assert decisions.conclusions[0]["kind"] == "measured_decrease"
    assert decisions.conclusions[0]["severity"] == "attention"
    assert decisions.actions[0]["priority"] == "high"
    assert decisions.conclusions[0]["evidence_keys"] == ["metric:sessions"]
    assert decisions.actions[0]["evidence_keys"] == ["metric:sessions"]
    assert "要因までは、このデータだけでは判断できません" in decisions.conclusions[0]["body"]


def test_zero_baseline_never_fabricates_an_infinite_rate():
    decisions = derive_report_decisions(_report(current=5, comparison=0))
    public_text = str(decisions)

    assert decisions.conclusions[0]["kind"] == "measured_from_zero"
    assert "増加率は算出していません" in decisions.conclusions[0]["body"]
    assert "inf" not in public_text.lower()
    assert "∞" not in public_text


def test_unmeasured_data_yields_a_hold_instead_of_a_claim():
    decisions = derive_report_decisions(_report(current=None, comparison=None, configured=False))

    assert decisions.conclusions == ()
    assert decisions.actions == ()
    assert any("判断に使える計測値がありません" in caveat for caveat in decisions.caveats)


def test_dataframe_adapter_embeds_at_most_three_validated_decisions():
    current = pd.DataFrame(
        {
            "event_date": ["20260731"],
            "period_users": [120],
            "period_sessions": [90],
            "period_page_views": [240],
            "period_conversions": [12],
        }
    )
    comparison = pd.DataFrame(
        {
            "event_date": ["20260630"],
            "period_users": [100],
            "period_sessions": [100],
            "period_page_views": [200],
            "period_conversions": [10],
        }
    )

    report = build_dataframe_report_v2(
        current,
        "campaign",
        "2026-07",
        comparison_df=comparison,
        comparison_period="2026-06",
        generated_at="2026-08-01T00:00:00+00:00",
    )
    evidence_keys = {item["key"] for item in report["evidence"]}

    assert len(report["conclusions"]) == 3
    assert len(report["actions"]) == 3
    assert all(set(item["evidence_keys"]) <= evidence_keys for item in report["conclusions"])
    assert all(set(item["evidence_keys"]) <= evidence_keys for item in report["actions"])
    public_text = str(report)
    assert "広告費" not in public_text
    assert "ROAS" not in public_text


def test_decision_rules_are_deterministic():
    report = _report(current=105, comparison=100)

    assert derive_report_decisions(report) == derive_report_decisions(report)
