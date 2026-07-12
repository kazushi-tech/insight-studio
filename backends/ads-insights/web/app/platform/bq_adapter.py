"""Minimal BigQuery connectivity probe for a persisted project data source."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Mapping

from bq.client import list_tables, run_query
from bq.queries import get_cv_event_names, normalize_dataset_ref


def test_ga4_bigquery_data_source(source: Mapping[str, Any]) -> dict[str, Any]:
    if str(source.get("source_type") or "") != "ga4_bigquery":
        return {"connected": False}
    project_id = str(source.get("gcp_project_id") or "").strip()
    dataset_ref = normalize_dataset_ref(str(source.get("dataset_id") or ""))
    if "." in dataset_ref:
        qualified_project, dataset_id = dataset_ref.split(".", 1)
        if project_id and qualified_project != project_id:
            return {"connected": False}
        project_id = qualified_project
    else:
        dataset_id = dataset_ref
    if not project_id:
        return {"connected": False}

    tables = list_tables(dataset_id, project=project_id)
    day_suffixes = sorted(
        str(table)[len("events_") :]
        for table in tables
        if str(table).startswith("events_")
        and len(str(table)) == len("events_") + 8
        and str(table)[len("events_") :].isdigit()
    )
    if not day_suffixes:
        return {
            "connected": False,
            "latest_data_date": None,
            "conversion_event_status": "not_configured",
            "conversion_events": [],
        }

    latest_suffix = day_suffixes[-1]
    latest_date = datetime.strptime(latest_suffix, "%Y%m%d").date()
    safe_config = source.get("safe_config")
    configured = (
        safe_config.get("conversion_events")
        if isinstance(safe_config, Mapping)
        else None
    )
    if not configured:
        return {
            "connected": True,
            "latest_data_date": latest_date.isoformat(),
            "conversion_event_status": "not_configured",
            "conversion_events": [],
        }

    event_names = get_cv_event_names(configured)
    start_suffix = (latest_date - timedelta(days=89)).strftime("%Y%m%d")
    event_list = ", ".join(f"'{name}'" for name in event_names)
    sql = f"""
    SELECT
      event_name,
      COUNT(1) AS observed_count,
      MAX(PARSE_DATE('%Y%m%d', event_date)) AS last_observed_at
    FROM `{project_id}.{dataset_id}.events_*`
    WHERE _TABLE_SUFFIX BETWEEN '{start_suffix}' AND '{latest_suffix}'
      AND event_name IN ({event_list})
    GROUP BY event_name
    """
    frame = run_query(sql, project=project_id)
    observed_by_name: dict[str, Mapping[str, Any]] = {}
    if frame is not None and not frame.empty:
        for row in frame.to_dict(orient="records"):
            observed_by_name[str(row.get("event_name") or "")] = row

    event_statuses = []
    for name in event_names:
        row = observed_by_name.get(name)
        last_observed = row.get("last_observed_at") if row else None
        event_statuses.append(
            {
                "name": name,
                "status": "measured" if row and int(row.get("observed_count") or 0) > 0 else "no_period_data",
                "last_observed_at": (
                    last_observed.isoformat()
                    if hasattr(last_observed, "isoformat")
                    else str(last_observed) if last_observed else None
                ),
            }
        )
    return {
        "connected": True,
        "latest_data_date": latest_date.isoformat(),
        "conversion_event_status": (
            "measured"
            if any(item["status"] == "measured" for item in event_statuses)
            else "no_period_data"
        ),
        "conversion_events": event_statuses,
    }
