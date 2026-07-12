"""Evidence-bound answers for follow-up questions about ``report.v2``.

The deterministic layer decides what can be said and which evidence supports
it.  A language model may rephrase this result later, but it may not add facts
or remove the structured evidence references.
"""

from __future__ import annotations

from typing import Any, Mapping


_UNSUPPORTED_OR_CAUSAL_TERMS = (
    "広告費",
    "費用対効果",
    "roas",
    "cpa",
    "cpc",
    "ctr",
    "表示回数",
    "インプレッション",
    "広告クリック",
    "なぜ",
    "原因",
    "因果",
    "広告の効果",
)

_NOT_ENOUGH = "このデータだけでは判断できません"


def _normalize(value: Any) -> str:
    return str(value or "").strip().casefold()


def _format_number(value: Any) -> str:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return "—"
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return f"{value:,}"


def _comparison_text(metric: Mapping[str, Any]) -> str:
    comparison = metric.get("comparison")
    if not isinstance(comparison, Mapping):
        return "前の期間との比較はできません。"
    status = comparison.get("status")
    if status == "baseline_zero":
        return "前の期間が0のため、比較率は算出できません。"
    percent = comparison.get("percent_change")
    if status != "available" or isinstance(percent, bool) or not isinstance(percent, (int, float)):
        return "前の期間との比較はできません。"
    if percent > 0:
        return f"前の期間より{_format_number(abs(percent))}%増えています。"
    if percent < 0:
        return f"前の期間より{_format_number(abs(percent))}%減っています。"
    return "前の期間と同じ水準です。"


def _not_enough_answer(*, reason: str) -> dict[str, Any]:
    return {
        "answerable": False,
        "text": _NOT_ENOUGH,
        "confidence": "low",
        "citations": [],
        "reason": reason,
    }

def answer_report_question(report: Mapping[str, Any], question: str) -> dict[str, Any]:
    """Return an answer whose every factual row has a known evidence key."""
    normalized_question = _normalize(question)
    if not normalized_question:
        return _not_enough_answer(reason="empty_question")
    if any(term in normalized_question for term in _UNSUPPORTED_OR_CAUSAL_TERMS):
        return _not_enough_answer(reason="unsupported_or_causal_question")
    if report.get("schema_version") != "report.v2":
        return _not_enough_answer(reason="unsupported_report_schema")

    evidence_rows = report.get("evidence")
    metrics = report.get("metrics")
    availability_rows = report.get("availability", {}).get("metrics")
    if not isinstance(evidence_rows, list) or not isinstance(metrics, list):
        return _not_enough_answer(reason="missing_evidence")

    evidence_by_key = {
        str(item.get("key")): item
        for item in evidence_rows
        if isinstance(item, Mapping) and item.get("key")
    }
    availability_by_key = {
        str(item.get("key")): item
        for item in availability_rows or []
        if isinstance(item, Mapping) and item.get("key")
    }
    measured_metrics = []
    for metric in metrics:
        if not isinstance(metric, Mapping):
            continue
        key = str(metric.get("key") or "")
        evidence_key = str(metric.get("evidence_key") or "")
        status = availability_by_key.get(key, {}).get("status")
        if (
            not key
            or evidence_key not in evidence_by_key
            or status not in {"measured", "measured_zero"}
        ):
            continue
        measured_metrics.append(metric)

    if not measured_metrics:
        return _not_enough_answer(reason="no_measured_metrics")

    matched = [
        metric
        for metric in measured_metrics
        if _normalize(metric.get("label")) in normalized_question
        or _normalize(metric.get("key")) in normalized_question
    ]
    selected = (matched or measured_metrics)[:3]
    statements: list[str] = []
    citations: list[dict[str, str]] = []
    seen_evidence: set[str] = set()
    for metric in selected:
        evidence_key = str(metric["evidence_key"])
        evidence = evidence_by_key[evidence_key]
        label = str(metric.get("label") or metric.get("key") or "指標")
        unit = str(metric.get("unit") or "")
        value = _format_number(metric.get("value"))
        statements.append(f"{label}は{value}{unit}です。{_comparison_text(metric)}")
        if evidence_key not in seen_evidence:
            citations.append(
                {
                    "evidence_key": evidence_key,
                    "title": str(evidence.get("title") or "根拠データ"),
                }
            )
            seen_evidence.add(evidence_key)

    if not statements or not citations:
        return _not_enough_answer(reason="no_supported_statement")
    return {
        "answerable": True,
        "text": " ".join(statements),
        "confidence": "high",
        "citations": citations,
        "reason": None,
    }
