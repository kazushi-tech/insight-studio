"""Runtime report payload validation and evidence integrity checks."""

from __future__ import annotations

import json
from datetime import date, datetime
from numbers import Number
from typing import Any, Mapping

from .errors import ReportTooLarge, ReportValidationError


MAX_REPORT_BYTES = 2_000_000
_TOP_LEVEL_KEYS = {
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
_METRIC_STATUSES = {
    "measured",
    "measured_zero",
    "not_configured",
    "no_period_data",
    "unsupported",
    "query_failed",
}


def canonical_size(payload: Mapping[str, Any]) -> int:
    try:
        encoded = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ReportValidationError("report must be valid JSON") from exc
    if len(encoded) > MAX_REPORT_BYTES:
        raise ReportTooLarge("report exceeds maximum size")
    return len(encoded)


def _require_object(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ReportValidationError(f"{label} must be an object")
    return value


def _require_array(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise ReportValidationError(f"{label} must be an array")
    return value


def _date_time(value: Any, label: str) -> None:
    if not isinstance(value, str) or not value:
        raise ReportValidationError(f"{label} must be an ISO date-time")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ReportValidationError(f"{label} must be an ISO date-time") from exc
    if parsed.tzinfo is None:
        raise ReportValidationError(f"{label} must include a timezone")


def _date(value: Any, label: str) -> None:
    if not isinstance(value, str):
        raise ReportValidationError(f"{label} must be an ISO date")
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ReportValidationError(f"{label} must be an ISO date") from exc


def _validate_statement(item: Any, label: str, evidence_keys: set[str]) -> None:
    statement = _require_object(item, label)
    if (
        not isinstance(statement.get("title"), str)
        or not statement.get("title")
        or statement.get("confidence") not in {"high", "medium", "low"}
    ):
        raise ReportValidationError(f"{label} is invalid")
    for optional_string in ("kind", "body"):
        if optional_string in statement and not isinstance(statement[optional_string], str):
            raise ReportValidationError(f"{label}.{optional_string} must be a string")
    if "severity" in statement and statement["severity"] not in {
        "positive",
        "neutral",
        "attention",
        "critical",
    }:
        raise ReportValidationError(f"{label}.severity is invalid")
    references = _require_array(statement.get("evidence_keys"), f"{label}.evidence_keys")
    if not references or any(
        not isinstance(key, str) or not key or key not in evidence_keys
        for key in references
    ):
        raise ReportValidationError(f"{label} references unknown evidence")


def validate_report_v2(payload: Mapping[str, Any], *, expected_project_id: str) -> int:
    """Validate the canonical report.v2 shape and all evidence references."""
    report = _require_object(payload, "report")
    size = canonical_size(report)
    if set(report) != _TOP_LEVEL_KEYS:
        raise ReportValidationError("report.v2 top-level fields do not match the contract")
    if report.get("schema_version") != "report.v2":
        raise ReportValidationError("schema_version must be report.v2")
    if not isinstance(report.get("project_id"), str) or report.get("project_id") != expected_project_id:
        raise ReportValidationError("report project_id does not match route project")
    if not isinstance(report.get("report_id"), str) or not report.get("report_id"):
        raise ReportValidationError("report_id is required")
    _date_time(report.get("generated_at"), "generated_at")

    scope = _require_object(report.get("scope"), "scope")
    if set(scope) != {
        "current_period",
        "comparison_period",
        "comparison_policy",
        "timezone",
        "data_freshness",
    }:
        raise ReportValidationError("scope fields do not match the contract")
    if scope.get("comparison_policy") not in {
        "previous_month",
        "previous_week",
        "previous_equal_days",
        "none",
    }:
        raise ReportValidationError("comparison_policy is invalid")
    if not scope.get("timezone"):
        raise ReportValidationError("scope.timezone is required")
    for key in ("current_period", "comparison_period"):
        period = scope.get(key)
        if period is None and key == "comparison_period":
            continue
        if not isinstance(period, Mapping) or set(period) != {"start", "end"}:
            raise ReportValidationError(f"scope.{key} is invalid")
        _date(period.get("start"), f"scope.{key}.start")
        _date(period.get("end"), f"scope.{key}.end")
        if period["start"] > period["end"]:
            raise ReportValidationError(f"scope.{key} start must be on or before end")
    freshness = _require_object(scope.get("data_freshness"), "scope.data_freshness")
    if set(freshness) != {"status", "last_observed_at"}:
        raise ReportValidationError("data freshness fields are invalid")
    if freshness.get("status") not in {"fresh", "delayed", "unknown"}:
        raise ReportValidationError("data freshness status is invalid")
    if freshness.get("last_observed_at") is not None:
        _date_time(freshness["last_observed_at"], "data_freshness.last_observed_at")

    availability = _require_object(report.get("availability"), "availability")
    if set(availability) != {"overall", "metrics"}:
        raise ReportValidationError("availability fields are invalid")
    if availability.get("overall") not in {"full", "partial", "unavailable", "failed"}:
        raise ReportValidationError("availability.overall is invalid")
    availability_rows = _require_array(availability.get("metrics"), "availability.metrics")
    availability_keys: set[str] = set()
    for row in availability_rows:
        item = _require_object(row, "availability metric")
        if set(item) != {"key", "status", "reason", "last_observed_at"}:
            raise ReportValidationError("availability metric fields are invalid")
        key = str(item.get("key") or "")
        if not key or key in availability_keys or item.get("status") not in _METRIC_STATUSES:
            raise ReportValidationError("availability metric is invalid")
        if item.get("reason") is not None and not isinstance(item.get("reason"), str):
            raise ReportValidationError("availability reason is invalid")
        availability_keys.add(key)
        if item.get("last_observed_at") is not None:
            _date_time(item["last_observed_at"], "availability.last_observed_at")

    metrics = _require_array(report.get("metrics"), "metrics")
    metric_keys: set[str] = set()
    metric_evidence_keys: set[str] = set()
    required_metric_fields = {
        "key",
        "label",
        "value",
        "unit",
        "aggregation",
        "comparison",
        "evidence_key",
    }
    for raw_metric in metrics:
        metric = _require_object(raw_metric, "metric")
        if set(metric) != required_metric_fields:
            raise ReportValidationError("metric fields are invalid")
        key = str(metric.get("key") or "")
        if (
            not key
            or key in metric_keys
            or not isinstance(metric.get("label"), str)
            or not metric.get("label")
            or not isinstance(metric.get("unit"), str)
            or not isinstance(metric.get("aggregation"), str)
            or not metric.get("aggregation")
        ):
            raise ReportValidationError("metric is invalid")
        if metric.get("value") is not None and (
            isinstance(metric.get("value"), bool) or not isinstance(metric.get("value"), Number)
        ):
            raise ReportValidationError("metric value must be numeric or null")
        comparison = _require_object(metric.get("comparison"), "metric.comparison")
        if set(comparison) != {"value", "absolute_change", "percent_change", "status"}:
            raise ReportValidationError("metric comparison fields are invalid")
        if comparison.get("status") not in {"available", "baseline_zero", "not_available"}:
            raise ReportValidationError("metric comparison status is invalid")
        for comparison_key in ("value", "absolute_change", "percent_change"):
            comparison_value = comparison.get(comparison_key)
            if comparison_value is not None and (
                isinstance(comparison_value, bool) or not isinstance(comparison_value, Number)
            ):
                raise ReportValidationError("metric comparison values must be numeric or null")
        metric_keys.add(key)
        metric_evidence_keys.add(str(metric.get("evidence_key") or ""))
    if metric_keys != availability_keys:
        raise ReportValidationError("metric and availability keys must match")

    evidence = _require_array(report.get("evidence"), "evidence")
    evidence_keys: set[str] = set()
    for raw_evidence in evidence:
        item = _require_object(raw_evidence, "evidence")
        if set(item) != {"key", "query_type", "title", "chart"}:
            raise ReportValidationError("evidence fields are invalid")
        key = str(item.get("key") or "")
        if (
            not key
            or key in evidence_keys
            or not isinstance(item.get("query_type"), str)
            or not item.get("query_type")
            or not isinstance(item.get("title"), str)
            or not item.get("title")
            or (item.get("chart") is not None and not isinstance(item.get("chart"), Mapping))
        ):
            raise ReportValidationError("evidence item is invalid")
        evidence_keys.add(key)
    if not metric_evidence_keys <= evidence_keys:
        raise ReportValidationError("metric evidence_key is missing")

    conclusions = _require_array(report.get("conclusions"), "conclusions")
    actions = _require_array(report.get("actions"), "actions")
    if len(conclusions) > 3 or len(actions) > 3:
        raise ReportValidationError("conclusions and actions may contain at most three items")
    for index, item in enumerate(conclusions):
        _validate_statement(item, f"conclusions[{index}]", evidence_keys)
    for index, item in enumerate(actions):
        _validate_statement(item, f"actions[{index}]", evidence_keys)
        action = _require_object(item, f"actions[{index}]")
        if (
            action.get("priority") not in {"high", "medium", "low"}
            or any(
                not isinstance(action.get(field), str) or not action.get(field)
                for field in ("reason", "timeframe", "success_metric")
            )
        ):
            raise ReportValidationError(f"actions[{index}] is invalid")
    if not all(isinstance(item, str) for item in _require_array(report.get("caveats"), "caveats")):
        raise ReportValidationError("caveats must contain strings")
    return size


def validate_import_payload(
    payload: Mapping[str, Any],
    *,
    source_schema: str,
    expected_project_id: str,
) -> int:
    """Validate imports without relabelling legacy data as report.v2."""
    normalized_schema = str(source_schema or "").strip()
    if normalized_schema == "report.v2":
        return validate_report_v2(payload, expected_project_id=expected_project_id)
    if normalized_schema not in {"report.v1", "legacy.v1", "insight_report_v1"}:
        raise ReportValidationError("unsupported source_schema")
    if payload.get("schema_version") == "report.v2":
        raise ReportValidationError("legacy imports cannot claim report.v2")
    return canonical_size(payload)
