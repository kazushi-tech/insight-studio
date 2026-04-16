"""Discovery pipeline budget tracker.

Records per-stage elapsed time and warns when budget consumption crosses
the 70 % threshold, giving operators early notice of timeout risk.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from threading import Lock

logger = logging.getLogger("discovery.metrics")

# In-memory ring buffer for recent pipeline summaries (admin/health)
_MAX_RECENT = 20
_recent_summaries: deque[dict] = deque(maxlen=_MAX_RECENT)
_recent_warnings: deque[float] = deque(maxlen=200)  # timestamps of BUDGET_PRESSURE events
_lock = Lock()

_PRESSURE_WINDOW_SEC = 3600.0  # 1 hour


class PipelineBudgetTracker:
    """Track budget consumption across discovery pipeline stages."""

    def __init__(self, overall_budget: float, job_id: str = ""):
        self.overall_budget = overall_budget
        self.job_id = job_id
        self.start_time = time.monotonic()
        self.stages: list[dict] = []
        self._current_stage: str | None = None
        self._stage_start: float = 0.0

    def begin_stage(self, name: str) -> None:
        """Record stage start."""
        self._current_stage = name
        self._stage_start = time.monotonic()

    def end_stage(self, name: str | None = None) -> dict | None:
        """Record stage end and emit structured log."""
        stage_name = name or self._current_stage
        if not stage_name:
            return None
        elapsed = time.monotonic() - self._stage_start
        total_elapsed = time.monotonic() - self.start_time
        remaining = self.overall_budget - total_elapsed

        record = {
            "stage": stage_name,
            "elapsed_s": round(elapsed, 1),
            "total_elapsed_s": round(total_elapsed, 1),
            "remaining_s": round(remaining, 1),
            "budget_used_pct": round((total_elapsed / self.overall_budget) * 100, 1)
            if self.overall_budget > 0
            else 0.0,
        }
        self.stages.append(record)

        if record["budget_used_pct"] >= 70:
            logger.warning(
                "BUDGET_PRESSURE job=%s stage=%s used=%.1f%% remaining=%.1fs",
                self.job_id,
                stage_name,
                record["budget_used_pct"],
                remaining,
            )
            with _lock:
                _recent_warnings.append(time.time())
        else:
            logger.info(
                "STAGE_COMPLETE job=%s stage=%s elapsed=%.1fs remaining=%.1fs (%.1f%%)",
                self.job_id,
                stage_name,
                elapsed,
                remaining,
                record["budget_used_pct"],
            )

        self._current_stage = None
        return record

    def summary(self) -> dict:
        """Return a pipeline summary dict and store it in the ring buffer."""
        total = time.monotonic() - self.start_time
        result = {
            "job_id": self.job_id,
            "overall_budget_s": self.overall_budget,
            "total_elapsed_s": round(total, 1),
            "remaining_s": round(self.overall_budget - total, 1),
            "stages": list(self.stages),
        }
        with _lock:
            _recent_summaries.append(result)
        return result


def get_health_snapshot() -> dict:
    """Return a snapshot for the /api/health endpoint."""
    now = time.time()
    with _lock:
        last_run = _recent_summaries[-1] if _recent_summaries else None
        warning_count = sum(
            1 for ts in _recent_warnings if now - ts < _PRESSURE_WINDOW_SEC
        )
    return {
        "last_run": last_run,
        "recent_budget_warnings": warning_count,
    }
