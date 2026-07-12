from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.report_periods import (
    ReportPeriod,
    data_freshness,
    previous_period,
    timezone_boundaries,
)


def test_month_uses_previous_calendar_month_across_year_boundary():
    comparison, policy = previous_period(
        ReportPeriod(date(2026, 1, 1), date(2026, 1, 31)),
        "month",
    )
    assert comparison.as_dict() == {"start": "2025-12-01", "end": "2025-12-31"}
    assert policy == "previous_month"


def test_week_uses_previous_seven_days():
    comparison, policy = previous_period(
        ReportPeriod(date(2026, 7, 6), date(2026, 7, 12)),
        "week",
    )
    assert comparison.as_dict() == {"start": "2026-06-29", "end": "2026-07-05"}
    assert policy == "previous_week"


def test_custom_uses_immediately_preceding_equal_day_count():
    comparison, policy = previous_period(
        ReportPeriod(date(2026, 7, 10), date(2026, 7, 12)),
        "custom",
    )
    assert comparison.as_dict() == {"start": "2026-07-07", "end": "2026-07-09"}
    assert policy == "previous_equal_days"


def test_timezone_boundaries_follow_project_timezone_and_dst():
    start, end = timezone_boundaries(
        ReportPeriod(date(2026, 3, 8), date(2026, 3, 8)),
        "America/New_York",
    )
    assert start.utcoffset() == timedelta(hours=-5)
    assert end.utcoffset() == timedelta(hours=-4)


def test_invalid_timezone_is_rejected():
    with pytest.raises(ValueError, match="unsupported timezone"):
        timezone_boundaries(ReportPeriod(date(2026, 1, 1), date(2026, 1, 1)), "Mars/Olympus")


def test_freshness_distinguishes_delayed_from_unknown():
    now = datetime(2026, 7, 12, tzinfo=timezone.utc)
    assert data_freshness(None, now=now)["status"] == "unknown"
    assert data_freshness(now - timedelta(days=3), now=now)["status"] == "delayed"
    assert data_freshness(now - timedelta(hours=12), now=now)["status"] == "fresh"
