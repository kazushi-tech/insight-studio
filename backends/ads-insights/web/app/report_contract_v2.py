"""Pure builders for the canonical deterministic ``report.v2`` contract.

The builder performs no clock, filesystem, network, pandas, or model access.
Callers supply the generation timestamp and already-aggregated numeric values.
Its output conforms to ``docs/contracts/report.v2.schema.json``.
"""

from __future__ import annotations

import math
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone as datetime_timezone
from decimal import Decimal, InvalidOperation
from numbers import Number
from typing import Any, Mapping, Sequence


REPORT_VERSION = "report.v2"
AVAILABILITY_STATUSES = frozenset(
    {
        "measured",
        "measured_zero",
        "not_configured",
        "no_period_data",
        "unsupported",
        "query_failed",
    }
)
OVERALL_STATUSES = frozenset({"full", "partial", "unavailable", "failed"})
COMPARISON_POLICIES = frozenset(
    {"previous_month", "previous_week", "previous_equal_days", "none"}
)
FRESHNESS_STATUSES = frozenset({"fresh", "delayed", "unknown"})

_MISSING = object()


def _json_scalar(value: Any) -> Any:
    if hasattr(value, "item") and callable(value.item):
        try:
            value = value.item()
        except (TypeError, ValueError):
            pass
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return value


def _as_decimal(value: Any) -> Decimal | None:
    value = _json_scalar(value)
    if isinstance(value, bool) or not isinstance(value, Number):
        return None
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return result if result.is_finite() else None


def _normalize_date(value: Any, *, label: str) -> str:
    try:
        parsed = value if isinstance(value, date) else date.fromisoformat(str(value))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be an ISO date") from exc
    return parsed.isoformat()


def _normalize_period(value: Mapping[str, Any] | str, *, label: str) -> dict[str, str]:
    if isinstance(value, Mapping):
        start = _normalize_date(value.get("start"), label=f"{label}.start")
        end = _normalize_date(value.get("end"), label=f"{label}.end")
    else:
        text = str(value or "").strip()
        if len(text) == 7 and text[4] == "-":
            year, month = (int(part) for part in text.split("-"))
            start_date = date(year, month, 1)
            next_month = date(year + (month == 12), 1 if month == 12 else month + 1, 1)
            start, end = start_date.isoformat(), (next_month - timedelta(days=1)).isoformat()
        elif ":" in text:
            raw_start, raw_end = text.split(":", 1)
            start = _normalize_date(raw_start, label=f"{label}.start")
            end = _normalize_date(raw_end, label=f"{label}.end")
        else:
            start = end = _normalize_date(text, label=label)
    if start > end:
        raise ValueError(f"{label}.start must be on or before end")
    return {"start": start, "end": end}


def _normalize_datetime(value: Any, *, label: str) -> str:
    text = str(value or "").strip()
    if len(text) == 8 and text.isdigit():
        parsed = datetime.strptime(text, "%Y%m%d").replace(tzinfo=datetime_timezone.utc)
        return parsed.isoformat()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{label} must be an ISO date-time") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime_timezone.utc)
    return parsed.isoformat()


def build_measurement(
    value: Any = _MISSING,
    *,
    configured: bool = True,
    observation_present: bool = True,
    unsupported: bool = False,
    query_failed: bool = False,
    status: str | None = None,
) -> dict[str, Any]:
    """Resolve one numeric value to a canonical metric availability status."""
    if status is not None:
        legacy_status_map = {
            "no_data": "no_period_data",
            "not_applicable": "unsupported",
            "query_error": "query_failed",
        }
        resolved_status = legacy_status_map.get(str(status), str(status))
        if resolved_status not in AVAILABILITY_STATUSES:
            raise ValueError(f"unsupported availability status: {resolved_status}")
    elif query_failed:
        resolved_status = "query_failed"
    elif unsupported:
        resolved_status = "unsupported"
    elif not configured or not observation_present:
        resolved_status = "not_configured"
    elif value is _MISSING or value is None:
        resolved_status = "no_period_data"
    else:
        normalized = _json_scalar(value)
        numeric = _as_decimal(normalized)
        if isinstance(normalized, float) and not math.isfinite(normalized):
            resolved_status = "no_period_data"
        elif numeric == 0:
            resolved_status = "measured_zero"
        else:
            resolved_status = "measured"

    if resolved_status in {"measured", "measured_zero"}:
        normalized_value = _json_scalar(value)
        numeric = _as_decimal(normalized_value)
        if numeric is None:
            raise ValueError("measured metric values must be finite numbers")
        if resolved_status == "measured_zero" and numeric != 0:
            raise ValueError("measured_zero requires a numeric zero value")
    else:
        normalized_value = None
    return {"status": resolved_status, "value": normalized_value}


def build_observation_measurement(
    value: Any = _MISSING,
    *,
    configured: bool | None,
    observed_in_lookback: bool | None,
    lookback_days: int = 90,
) -> dict[str, Any]:
    """Apply the conversion-event lookback rule without inventing a zero.

    A zero is ``measured_zero`` only when the event was actually observed
    during the configured lookback window. A confirmed event setting without
    historic observation is ``no_period_data``; when neither the setting nor
    observation can be confirmed it is ``not_configured``.
    """
    if lookback_days != 90:
        raise ValueError("conversion observation lookback must be 90 days")
    numeric = _as_decimal(value)
    if numeric is not None and numeric > 0:
        return build_measurement(value)
    if numeric == 0 and observed_in_lookback is True:
        return build_measurement(value)
    if configured is True or observed_in_lookback is True:
        return {"status": "no_period_data", "value": None}
    return {"status": "not_configured", "value": None}


def build_change(
    current: Mapping[str, Any],
    comparison: Mapping[str, Any] | None,
) -> dict[str, Any]:
    """Build the schema comparison object and handle zero baselines safely."""
    if comparison is None:
        return {
            "value": None,
            "absolute_change": None,
            "percent_change": None,
            "status": "not_available",
        }
    measurable = {"measured", "measured_zero"}
    if current.get("status") not in measurable or comparison.get("status") not in measurable:
        return {
            "value": comparison.get("value"),
            "absolute_change": None,
            "percent_change": None,
            "status": "not_available",
        }
    current_number = _as_decimal(current.get("value"))
    comparison_number = _as_decimal(comparison.get("value"))
    if current_number is None or comparison_number is None:
        return {
            "value": comparison.get("value"),
            "absolute_change": None,
            "percent_change": None,
            "status": "not_available",
        }

    absolute = current_number - comparison_number
    absolute_value = _json_scalar(absolute)
    if comparison_number == 0:
        return {
            "value": _json_scalar(comparison_number),
            "absolute_change": absolute_value,
            "percent_change": 0.0 if current_number == 0 else None,
            "status": "available" if current_number == 0 else "baseline_zero",
        }
    percent = (absolute / abs(comparison_number)) * Decimal("100")
    return {
        "value": _json_scalar(comparison_number),
        "absolute_change": absolute_value,
        "percent_change": round(float(percent), 2),
        "status": "available",
    }


def _evidence_from_mapping(key: str, raw_value: Any) -> dict[str, Any]:
    raw = dict(raw_value) if isinstance(raw_value, Mapping) else {}
    source = str(raw.get("source") or "")
    query_type = str(raw.get("query_type") or (source.split(".", 1)[0] if source else "unknown"))
    return {
        "key": key,
        "query_type": query_type,
        "title": str(raw.get("title") or key),
        "chart": deepcopy(raw.get("chart")),
    }


def _normalize_evidence(
    evidence: Mapping[str, Any] | Sequence[Mapping[str, Any]] | None,
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    if evidence is None:
        return normalized
    if isinstance(evidence, Mapping):
        iterator = (
            _evidence_from_mapping(str(key), value)
            for key, value in evidence.items()
        )
    else:
        def _items():
            for raw_item in evidence:
                item = dict(raw_item)
                key = str(item.get("key") or item.get("evidence_key") or "").strip()
                if not key:
                    raise ValueError("each evidence item requires key")
                yield _evidence_from_mapping(key, item)
        iterator = _items()
    for item in iterator:
        key = item["key"]
        if key in seen:
            raise ValueError(f"duplicate evidence key: {key}")
        seen.add(key)
        normalized.append(item)
    return normalized


def _validate_statements(
    items: Sequence[Mapping[str, Any]],
    *,
    item_name: str,
    evidence_keys: set[str],
    action: bool = False,
) -> list[dict[str, Any]]:
    if len(items) > 3:
        raise ValueError(f"{item_name} may contain at most 3 items")
    normalized: list[dict[str, Any]] = []
    for index, raw_item in enumerate(items):
        item = deepcopy(dict(raw_item))
        fields = (
            ("priority", "title", "reason", "confidence", "timeframe", "success_metric", "evidence_keys")
            if action
            else ("kind", "title", "body", "severity", "confidence", "evidence_keys")
        )
        required = set(fields)
        missing_fields = [field for field in sorted(required) if not item.get(field)]
        if missing_fields:
            raise ValueError(f"{item_name}[{index}] missing: {', '.join(missing_fields)}")
        references = item["evidence_keys"]
        if isinstance(references, (str, bytes)):
            raise ValueError(f"{item_name}[{index}].evidence_keys must be an array")
        refs = [str(key) for key in references]
        if not refs:
            raise ValueError(f"{item_name}[{index}].evidence_keys must not be empty")
        missing = [key for key in refs if key not in evidence_keys]
        if missing:
            raise ValueError(
                f"{item_name}[{index}] references unknown evidence_keys: {', '.join(missing)}"
            )
        if item["confidence"] not in {"high", "medium", "low"}:
            raise ValueError(f"{item_name}[{index}] has invalid confidence")
        if not action and item["severity"] not in {"positive", "neutral", "attention", "critical"}:
            raise ValueError(f"{item_name}[{index}] has invalid severity")
        if action and item["priority"] not in {"high", "medium", "low"}:
            raise ValueError(f"{item_name}[{index}] has invalid priority")
        item["evidence_keys"] = refs
        normalized.append({key: item[key] for key in fields})
    return normalized


def _resolve_overall_status(metric_statuses: Sequence[str]) -> str:
    measured = sum(status in {"measured", "measured_zero"} for status in metric_statuses)
    if metric_statuses and measured == len(metric_statuses):
        return "full"
    if measured:
        return "partial"
    if any(status == "query_failed" for status in metric_statuses):
        return "failed"
    return "unavailable"


def _normalize_freshness(value: Any) -> dict[str, Any]:
    if value is None:
        status, observed = "unknown", None
    elif isinstance(value, str):
        status, observed = value, None
    elif isinstance(value, Mapping):
        status = str(value.get("status") or "unknown")
        observed = value.get("last_observed_at")
    else:
        raise ValueError("data_freshness must be an object or status string")
    if status not in FRESHNESS_STATUSES:
        raise ValueError(f"unsupported data freshness status: {status}")
    return {
        "status": status,
        "last_observed_at": (
            _normalize_datetime(observed, label="data_freshness.last_observed_at")
            if observed is not None
            else None
        ),
    }


def build_report_v2(
    *,
    report_id: str,
    project_id: str,
    current_period: Mapping[str, Any] | str,
    metrics: Sequence[Mapping[str, Any]],
    comparison_period: Mapping[str, Any] | str | None = None,
    comparison_policy: str | None = None,
    timezone: str = "Asia/Tokyo",
    data_freshness: Any = None,
    conclusions: Sequence[Mapping[str, Any]] = (),
    actions: Sequence[Mapping[str, Any]] = (),
    evidence: Mapping[str, Any] | Sequence[Mapping[str, Any]] | None = None,
    caveats: Sequence[Any] = (),
    generated_at: str | None = None,
    overall_status: str | None = None,
) -> dict[str, Any]:
    """Build an exact ``report.v2`` payload matching the repository schema."""
    if not str(report_id).strip() or not str(project_id).strip():
        raise ValueError("report_id and project_id are required")
    if not str(timezone).strip():
        raise ValueError("timezone is required")
    if generated_at is None:
        raise ValueError("generated_at is required")

    current_scope = _normalize_period(current_period, label="current_period")
    comparison_scope = (
        _normalize_period(comparison_period, label="comparison_period")
        if comparison_period is not None
        else None
    )
    resolved_policy = comparison_policy or (
        "previous_month" if comparison_scope is not None else "none"
    )
    if resolved_policy not in COMPARISON_POLICIES:
        raise ValueError(f"unsupported comparison_policy: {resolved_policy}")
    if comparison_scope is None and resolved_policy != "none":
        raise ValueError("comparison_policy must be none without comparison_period")

    evidence_items = _normalize_evidence(evidence)
    evidence_by_key = {item["key"]: item for item in evidence_items}
    built_metrics: list[dict[str, Any]] = []
    availability_items: list[dict[str, Any]] = []
    metric_statuses: list[str] = []
    seen_metric_keys: set[str] = set()

    for raw_metric in metrics:
        metric = dict(raw_metric)
        key = str(metric.get("key") or "").strip()
        if not key:
            raise ValueError("metric key is required")
        if key in seen_metric_keys:
            raise ValueError(f"duplicate metric key: {key}")
        seen_metric_keys.add(key)

        current = build_measurement(
            metric.get("value", _MISSING),
            configured=bool(metric.get("configured", True)),
            observation_present=bool(metric.get("observation_present", True)),
            unsupported=bool(metric.get("unsupported", False)),
            query_failed=bool(metric.get("query_failed", False)),
            status=metric.get("status"),
        )
        comparison = None
        if comparison_scope is not None:
            comparison = build_measurement(
                metric.get("comparison_value", _MISSING),
                configured=bool(metric.get("comparison_configured", metric.get("configured", True))),
                observation_present=bool(metric.get("comparison_observation_present", True)),
                unsupported=bool(metric.get("comparison_unsupported", metric.get("unsupported", False))),
                query_failed=bool(metric.get("comparison_query_failed", False)),
                status=metric.get("comparison_status"),
            )

        label = str(metric.get("label") or key)
        source = str(metric.get("source") or "")
        evidence_key = str(metric.get("evidence_key") or f"metric:{key}")
        if evidence_key not in evidence_by_key:
            evidence_item = {
                "key": evidence_key,
                "query_type": str(
                    metric.get("query_type")
                    or (source.split(".", 1)[0] if source else "unknown")
                ),
                "title": label,
                "chart": deepcopy(metric.get("chart")),
            }
            evidence_items.append(evidence_item)
            evidence_by_key[evidence_key] = evidence_item

        built_metrics.append(
            {
                "key": key,
                "label": label,
                "value": current["value"],
                "unit": str(metric.get("unit") or ""),
                "aggregation": str(metric.get("aggregation") or "sum"),
                "comparison": build_change(current, comparison),
                "evidence_key": evidence_key,
            }
        )
        observed = metric.get("last_observed_at")
        availability_items.append(
            {
                "key": key,
                "status": current["status"],
                "reason": str(metric["reason"]) if metric.get("reason") is not None else None,
                "last_observed_at": (
                    _normalize_datetime(observed, label=f"metrics.{key}.last_observed_at")
                    if observed is not None
                    else None
                ),
            }
        )
        metric_statuses.append(current["status"])

    resolved_overall = overall_status or _resolve_overall_status(metric_statuses)
    if resolved_overall not in OVERALL_STATUSES:
        raise ValueError(f"unsupported overall_status: {resolved_overall}")

    known_evidence_keys = set(evidence_by_key)
    built_conclusions = _validate_statements(
        conclusions,
        item_name="conclusions",
        evidence_keys=known_evidence_keys,
    )
    built_actions = _validate_statements(
        actions,
        item_name="actions",
        evidence_keys=known_evidence_keys,
        action=True,
    )

    return {
        "schema_version": REPORT_VERSION,
        "report_id": str(report_id),
        "project_id": str(project_id),
        "scope": {
            "current_period": current_scope,
            "comparison_period": comparison_scope,
            "comparison_policy": resolved_policy,
            "timezone": str(timezone),
            "data_freshness": _normalize_freshness(data_freshness),
        },
        "availability": {
            "overall": resolved_overall,
            "metrics": availability_items,
        },
        "metrics": built_metrics,
        "conclusions": built_conclusions,
        "actions": built_actions,
        "evidence": evidence_items,
        "caveats": [str(item) for item in caveats],
        "generated_at": _normalize_datetime(generated_at, label="generated_at"),
    }


def combine_reports_v2(
    reports: Mapping[str, Mapping[str, Any]],
    *,
    report_id: str,
    project_id: str | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Combine per-query report.v2 payloads without metric/evidence collisions."""
    items = [
        (str(query_type), dict(report))
        for query_type, report in reports.items()
        if isinstance(report, Mapping) and report.get("schema_version") == REPORT_VERSION
    ]
    if not items:
        raise ValueError("at least one report.v2 payload is required")
    base = items[0][1]
    base_scope = deepcopy(base.get("scope") or {})
    base_scope_without_freshness = {
        key: value for key, value in base_scope.items() if key != "data_freshness"
    }
    resolved_project_id = str(project_id or base.get("project_id") or "").strip()
    if not str(report_id).strip() or not resolved_project_id:
        raise ValueError("report_id and project_id are required")

    metrics: list[dict[str, Any]] = []
    availability_metrics: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []
    conclusions: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []
    caveats: list[str] = []
    overall_statuses: list[str] = []
    freshness_statuses: list[str] = []
    freshness_observed: list[str] = []

    for query_type, report in items:
        report_scope = deepcopy(report.get("scope") or {})
        if {
            key: value for key, value in report_scope.items() if key != "data_freshness"
        } != base_scope_without_freshness:
            raise ValueError("combined report scopes must match")
        if str(report.get("project_id") or "") != resolved_project_id:
            raise ValueError("combined report projects must match")
        prefix = query_type.strip() or "unknown"
        evidence_map: dict[str, str] = {}
        for raw_evidence in report.get("evidence") or []:
            item = deepcopy(dict(raw_evidence))
            old_key = str(item.get("key") or "")
            new_key = f"{prefix}:{old_key}"
            evidence_map[old_key] = new_key
            item["key"] = new_key
            evidence.append(item)

        availability_by_key = {
            str(item.get("key") or ""): dict(item)
            for item in (report.get("availability") or {}).get("metrics") or []
        }
        for raw_metric in report.get("metrics") or []:
            metric = deepcopy(dict(raw_metric))
            old_key = str(metric.get("key") or "")
            new_key = f"{prefix}.{old_key}"
            metric["key"] = new_key
            old_evidence_key = str(metric.get("evidence_key") or "")
            metric["evidence_key"] = evidence_map.get(
                old_evidence_key,
                f"{prefix}:{old_evidence_key}",
            )
            metrics.append(metric)
            availability = deepcopy(availability_by_key.get(old_key) or {})
            availability["key"] = new_key
            availability_metrics.append(availability)

        for target, source in (
            (conclusions, report.get("conclusions") or []),
            (actions, report.get("actions") or []),
        ):
            for raw_statement in source:
                statement = deepcopy(dict(raw_statement))
                statement["evidence_keys"] = [
                    evidence_map.get(str(key), f"{prefix}:{key}")
                    for key in statement.get("evidence_keys") or []
                ]
                target.append(statement)
        for caveat in report.get("caveats") or []:
            text = str(caveat)
            if text not in caveats:
                caveats.append(text)
        overall_statuses.append(str((report.get("availability") or {}).get("overall") or "unavailable"))
        freshness = report_scope.get("data_freshness") or {}
        freshness_statuses.append(str(freshness.get("status") or "unknown"))
        if freshness.get("last_observed_at"):
            freshness_observed.append(str(freshness["last_observed_at"]))

    if overall_statuses and all(status == "full" for status in overall_statuses):
        overall = "full"
    elif any(status in {"full", "partial"} for status in overall_statuses):
        overall = "partial"
    elif overall_statuses and all(status == "failed" for status in overall_statuses):
        overall = "failed"
    else:
        overall = "unavailable"

    if freshness_statuses and all(status == "fresh" for status in freshness_statuses):
        combined_freshness_status = "fresh"
    elif any(status == "delayed" for status in freshness_statuses):
        combined_freshness_status = "delayed"
    else:
        combined_freshness_status = "unknown"
    base_scope["data_freshness"] = {
        "status": combined_freshness_status,
        "last_observed_at": max(freshness_observed) if freshness_observed else None,
    }

    generated_values = [
        str(report.get("generated_at") or "")
        for _, report in items
        if str(report.get("generated_at") or "")
    ]
    resolved_generated_at = generated_at or max(generated_values)
    return {
        "schema_version": REPORT_VERSION,
        "report_id": str(report_id),
        "project_id": resolved_project_id,
        "scope": base_scope,
        "availability": {
            "overall": overall,
            "metrics": availability_metrics,
        },
        "metrics": metrics,
        "conclusions": conclusions[:3],
        "actions": actions[:3],
        "evidence": evidence,
        "caveats": caveats,
        "generated_at": _normalize_datetime(resolved_generated_at, label="generated_at"),
    }
