"""Tests for PipelineBudgetTracker."""

from __future__ import annotations

import logging
import time
from unittest.mock import patch

from .pipeline_metrics import PipelineBudgetTracker, get_health_snapshot, _recent_summaries, _recent_warnings


def test_begin_end_stage_records_elapsed():
    tracker = PipelineBudgetTracker(overall_budget=100.0, job_id="test-1")
    tracker.begin_stage("search")
    time.sleep(0.05)
    record = tracker.end_stage("search")

    assert record is not None
    assert record["stage"] == "search"
    assert record["elapsed_s"] >= 0.0
    assert record["total_elapsed_s"] >= 0.0
    assert record["remaining_s"] <= 100.0
    assert 0 <= record["budget_used_pct"] <= 100


def test_budget_pressure_warning(caplog):
    tracker = PipelineBudgetTracker(overall_budget=0.1, job_id="test-pressure")
    tracker.begin_stage("slow")
    time.sleep(0.08)  # consume >70% of 0.1s budget
    with caplog.at_level(logging.WARNING, logger="discovery.metrics"):
        record = tracker.end_stage("slow")

    assert record is not None
    assert record["budget_used_pct"] >= 70
    assert "BUDGET_PRESSURE" in caplog.text


def test_summary_contains_all_stages():
    tracker = PipelineBudgetTracker(overall_budget=10.0, job_id="test-summary")
    for stage in ("brand_fetch", "classify_industry", "search", "fetch", "analyze"):
        tracker.begin_stage(stage)
        tracker.end_stage(stage)

    summary = tracker.summary()
    assert summary["job_id"] == "test-summary"
    assert summary["overall_budget_s"] == 10.0
    assert len(summary["stages"]) == 5
    stage_names = [s["stage"] for s in summary["stages"]]
    assert stage_names == ["brand_fetch", "classify_industry", "search", "fetch", "analyze"]


def test_cumulative_elapsed_increases():
    tracker = PipelineBudgetTracker(overall_budget=10.0, job_id="test-cumul")
    tracker.begin_stage("a")
    time.sleep(0.02)
    tracker.end_stage("a")
    tracker.begin_stage("b")
    time.sleep(0.02)
    tracker.end_stage("b")

    assert tracker.stages[1]["total_elapsed_s"] >= tracker.stages[0]["total_elapsed_s"]


def test_end_stage_without_begin_returns_none():
    tracker = PipelineBudgetTracker(overall_budget=10.0, job_id="test-none")
    assert tracker.end_stage() is None


def test_health_snapshot():
    _recent_summaries.clear()
    _recent_warnings.clear()

    tracker = PipelineBudgetTracker(overall_budget=10.0, job_id="test-health")
    tracker.begin_stage("a")
    tracker.end_stage("a")
    tracker.summary()

    snap = get_health_snapshot()
    assert snap["last_run"] is not None
    assert snap["last_run"]["job_id"] == "test-health"
    assert isinstance(snap["recent_budget_warnings"], int)
