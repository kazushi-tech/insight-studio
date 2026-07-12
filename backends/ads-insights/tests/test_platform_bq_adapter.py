from __future__ import annotations

from datetime import date
import sys
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.platform import bq_adapter


def test_probe_reports_latest_date_and_observed_conversion_events(monkeypatch):
    monkeypatch.setattr(
        bq_adapter,
        "list_tables",
        lambda dataset_id, project: ["events_20260710", "events_intraday_20260711", "other"],
    )
    monkeypatch.setattr(
        bq_adapter,
        "run_query",
        lambda sql, project: pd.DataFrame([
            {
                "event_name": "generate_lead",
                "observed_count": 3,
                "last_observed_at": date(2026, 7, 10),
            }
        ]),
    )

    result = bq_adapter.test_ga4_bigquery_data_source({
        "source_type": "ga4_bigquery",
        "gcp_project_id": "customer-project",
        "dataset_id": "analytics_123",
        "safe_config": {"conversion_events": ["generate_lead", "purchase"]},
    })

    assert result["connected"] is True
    assert result["latest_data_date"] == "2026-07-10"
    assert result["conversion_event_status"] == "measured"
    assert result["conversion_events"] == [
        {
            "name": "generate_lead",
            "status": "measured",
            "last_observed_at": "2026-07-10",
        },
        {"name": "purchase", "status": "no_period_data", "last_observed_at": None},
    ]


def test_probe_distinguishes_missing_configuration_from_no_tables(monkeypatch):
    monkeypatch.setattr(bq_adapter, "list_tables", lambda dataset_id, project: ["events_20260710"])
    configured = bq_adapter.test_ga4_bigquery_data_source({
        "source_type": "ga4_bigquery",
        "gcp_project_id": "customer-project",
        "dataset_id": "analytics_123",
        "safe_config": {},
    })
    assert configured["connected"] is True
    assert configured["conversion_event_status"] == "not_configured"

    monkeypatch.setattr(bq_adapter, "list_tables", lambda dataset_id, project: [])
    missing = bq_adapter.test_ga4_bigquery_data_source({
        "source_type": "ga4_bigquery",
        "gcp_project_id": "customer-project",
        "dataset_id": "analytics_123",
        "safe_config": {},
    })
    assert missing["connected"] is False
    assert missing["latest_data_date"] is None
