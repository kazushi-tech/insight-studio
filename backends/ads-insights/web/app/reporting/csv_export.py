"""Evidence-only CSV export with spreadsheet formula injection protection."""

from __future__ import annotations

import csv
import io
from numbers import Number
from typing import Any, Mapping


def _safe_cell(value: Any) -> Any:
    if isinstance(value, bool) or isinstance(value, Number) or value is None:
        return value
    text = str(value)
    if text.startswith(("\t", "\r", "\n")) or text.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


def report_numeric_evidence_csv(report: Mapping[str, Any]) -> str:
    """Export only metric/evidence numbers; narrative and actions are excluded."""
    buffer = io.StringIO(newline="")
    fieldnames = [
        "metric_key",
        "label",
        "value",
        "unit",
        "aggregation",
        "comparison_value",
        "absolute_change",
        "percent_change",
        "comparison_status",
        "evidence_key",
    ]
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, lineterminator="\n")
    writer.writeheader()
    metrics = report.get("metrics") if isinstance(report, Mapping) else None
    if isinstance(metrics, list):
        for metric in metrics:
            if not isinstance(metric, Mapping):
                continue
            value = metric.get("value")
            comparison = metric.get("comparison") if isinstance(metric.get("comparison"), Mapping) else {}
            numeric_values = (
                value,
                comparison.get("value"),
                comparison.get("absolute_change"),
                comparison.get("percent_change"),
            )
            if not any(isinstance(item, Number) and not isinstance(item, bool) for item in numeric_values):
                continue
            row = {
                "metric_key": metric.get("key"),
                "label": metric.get("label"),
                "value": value,
                "unit": metric.get("unit"),
                "aggregation": metric.get("aggregation"),
                "comparison_value": comparison.get("value"),
                "absolute_change": comparison.get("absolute_change"),
                "percent_change": comparison.get("percent_change"),
                "comparison_status": comparison.get("status"),
                "evidence_key": metric.get("evidence_key"),
            }
            writer.writerow({key: _safe_cell(item) for key, item in row.items()})
    return buffer.getvalue()
