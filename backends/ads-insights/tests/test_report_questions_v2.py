"""Evidence-bound report question contract tests."""

from __future__ import annotations

import sys
from pathlib import Path


_PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PROJECT_ROOT))

from web.app.reporting.questions import answer_report_question


def _report() -> dict:
    return {
        "schema_version": "report.v2",
        "availability": {
            "metrics": [
                {"key": "users", "status": "measured", "reason": None, "last_observed_at": None},
                {"key": "goals", "status": "not_configured", "reason": None, "last_observed_at": None},
            ]
        },
        "metrics": [
            {
                "key": "users",
                "label": "利用者数",
                "value": 120,
                "unit": "人",
                "comparison": {
                    "status": "available",
                    "value": 100,
                    "absolute_change": 20,
                    "percent_change": 20,
                },
                "evidence_key": "metric:users",
            },
            {
                "key": "goals",
                "label": "成果数",
                "value": None,
                "unit": "件",
                "comparison": {"status": "not_available"},
                "evidence_key": "metric:goals",
            },
        ],
        "evidence": [
            {"key": "metric:users", "title": "期間全体の利用者数"},
            {"key": "metric:goals", "title": "成果イベント"},
        ],
    }


def test_supported_answer_has_only_known_evidence_keys():
    report = _report()
    answer = answer_report_question(report, "利用者数はどうなっていますか")
    assert answer["answerable"] is True
    assert "120人" in answer["text"]
    assert "20%増" in answer["text"]
    assert answer["citations"] == [
        {"evidence_key": "metric:users", "title": "期間全体の利用者数"}
    ]
    known = {item["key"] for item in report["evidence"]}
    assert {item["evidence_key"] for item in answer["citations"]} <= known


def test_unsupported_or_unmeasured_question_fails_closed():
    for question in ("ROASはどうですか", "広告費は回収できましたか", "なぜ増えましたか"):
        answer = answer_report_question(_report(), question)
        assert answer["answerable"] is False
        assert answer["text"] == "このデータだけでは判断できません"
        assert answer["citations"] == []

    report = _report()
    report["availability"]["metrics"][0]["status"] = "query_failed"
    answer = answer_report_question(report, "利用者数を教えて")
    assert answer["answerable"] is False
    assert answer["text"] == "このデータだけでは判断できません"


def test_empty_or_legacy_inputs_never_generate_a_claim():
    assert answer_report_question(_report(), "")["answerable"] is False
    assert answer_report_question({"schema_version": "report.v1"}, "利用者数は？") == {
        "answerable": False,
        "text": "このデータだけでは判断できません",
        "confidence": "low",
        "citations": [],
        "reason": "unsupported_report_schema",
    }
