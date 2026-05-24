import os
import sys
from pathlib import Path

import pytest


RUN_LIVE_BQ_DIAGNOSTIC = os.getenv("RUN_LIVE_BQ_DIAGNOSTIC") == "1"
DATASET_ID = os.getenv("AI_EXPLORER_BQ_DIAGNOSTIC_DATASET_ID", "").strip()
PROJECT_ID = os.getenv("AI_EXPLORER_BQ_DIAGNOSTIC_PROJECT_ID", "").strip() or None
START_DATE = os.getenv("AI_EXPLORER_BQ_DIAGNOSTIC_START_DATE", "2026-05-01")
END_DATE = os.getenv("AI_EXPLORER_BQ_DIAGNOSTIC_END_DATE", "2026-05-31")

pytestmark = pytest.mark.skipif(
    not RUN_LIVE_BQ_DIAGNOSTIC or not DATASET_ID,
    reason=(
        "Set RUN_LIVE_BQ_DIAGNOSTIC=1 and "
        "AI_EXPLORER_BQ_DIAGNOSTIC_DATASET_ID to run BigQuery-only diagnostic smoke."
    ),
)

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.ai_analysis import fetch_pv_spike_diagnostic_context  # noqa: E402


def test_bigquery_session_landing_page_diagnostic_without_gemini_call():
    diagnostic = fetch_pv_spike_diagnostic_context(
        DATASET_ID,
        {"start": START_DATE, "end": END_DATE, "timezone": "Asia/Tokyo"},
        project=PROJECT_ID,
    )

    session_diag = diagnostic.get("sessionLandingPageDiagnostic")
    assert session_diag, "sessionLandingPageDiagnostic must be generated; no Gemini call is made in this smoke."
    assert session_diag["method"] == "ga4_session_first_page_view"
    assert session_diag["sessionKeyMethod"] == "user_pseudo_id + ga_session_id"
    assert session_diag["landingPageDefinition"] == "first page_view.page_location in each GA4 session"
    assert session_diag["topLandingPages"]

    totals = session_diag["totals"]
    assert "missingSessionIdPageViews" in totals
    assert "unknownLandingPagePageViews" in totals
    assert diagnostic.get("sessionLandingPageDiagnostic") is not None
    assert not any("fallback" in caveat for caveat in diagnostic.get("caveats", []))
