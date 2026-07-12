"""Calendar-correct comparison periods and project-timezone boundaries."""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


@dataclass(frozen=True)
class ReportPeriod:
    start: date
    end: date

    def __post_init__(self) -> None:
        if self.start > self.end:
            raise ValueError("period start must be on or before period end")

    @property
    def day_count(self) -> int:
        return (self.end - self.start).days + 1

    def as_dict(self) -> dict[str, str]:
        return {"start": self.start.isoformat(), "end": self.end.isoformat()}


def validate_timezone(name: str) -> ZoneInfo:
    value = str(name or "").strip()
    if not value:
        raise ValueError("timezone is required")
    try:
        return ZoneInfo(value)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("unsupported timezone") from exc


def previous_period(current: ReportPeriod, selection: str) -> tuple[ReportPeriod, str]:
    """Return the comparison range and the public comparison policy."""
    if selection == "month":
        if current.start.day != 1 or current.end.day != calendar.monthrange(current.end.year, current.end.month)[1]:
            raise ValueError("month selection must cover one complete calendar month")
        previous_end = current.start - timedelta(days=1)
        previous_start = previous_end.replace(day=1)
        return ReportPeriod(previous_start, previous_end), "previous_month"

    if selection == "week":
        if current.day_count != 7:
            raise ValueError("week selection must contain seven days")
        return (
            ReportPeriod(
                current.start - timedelta(days=7),
                current.end - timedelta(days=7),
            ),
            "previous_week",
        )

    if selection == "custom":
        previous_end = current.start - timedelta(days=1)
        previous_start = previous_end - timedelta(days=current.day_count - 1)
        return ReportPeriod(previous_start, previous_end), "previous_equal_days"

    raise ValueError("selection must be month, week, or custom")


def timezone_boundaries(period: ReportPeriod, timezone_name: str) -> tuple[datetime, datetime]:
    """Return inclusive-start/exclusive-end instants in the project timezone."""
    zone = validate_timezone(timezone_name)
    start = datetime.combine(period.start, time.min, tzinfo=zone)
    end_exclusive = datetime.combine(period.end + timedelta(days=1), time.min, tzinfo=zone)
    return start, end_exclusive


def data_freshness(
    last_observed_at: datetime | None,
    *,
    now: datetime,
    max_delay: timedelta = timedelta(days=2),
) -> dict[str, str | None]:
    if last_observed_at is None:
        return {"status": "unknown", "last_observed_at": None}
    if last_observed_at.tzinfo is None or now.tzinfo is None:
        raise ValueError("freshness timestamps must be timezone-aware")
    status = "fresh" if now - last_observed_at <= max_delay else "delayed"
    return {"status": status, "last_observed_at": last_observed_at.isoformat()}
