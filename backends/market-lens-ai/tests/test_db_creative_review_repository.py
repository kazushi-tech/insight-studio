"""Tests for DbCreativeReviewRepository — in-memory SQLite."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from web.app.db.engine import get_engine, get_session, create_tables
from web.app.db.tables import assets as assets_table
from web.app.repositories.db_creative_review_repository import DbCreativeReviewRepository
from web.app.repositories.creative_review_repository import (
    CreativeReviewRun,
    ExportRecord,
    ReviewOutput,
    RunStatus,
    ExportFormat,
)


@pytest.fixture()
def db_parts():
    """Return (session_factory, engine) for in-memory SQLite."""
    engine = get_engine("sqlite:///:memory:")
    create_tables(engine)
    sf = get_session(engine)
    return sf, engine


@pytest.fixture()
def repo(db_parts):
    sf, _ = db_parts
    return DbCreativeReviewRepository(session_factory=sf)


@pytest.fixture()
def _seed_asset(db_parts):
    """Insert a dummy asset row so FK constraints are satisfied."""
    sf, _ = db_parts
    with sf() as session:
        with session.begin():
            session.execute(
                assets_table.insert().values(
                    id="asset0000001",
                    file_name="banner.png",
                    mime_type="image/png",
                    size_bytes=512,
                    asset_type="banner",
                    created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                )
            )


def _make_run(
    run_id: str = "run000000001",
    asset_id: str = "asset0000001",
    review_type: str = "banner_review",
    **kwargs,
) -> CreativeReviewRun:
    return CreativeReviewRun(
        run_id=run_id,
        asset_id=asset_id,
        review_type=review_type,
        **kwargs,
    )


# ── Save / Load Run ──────────────────────────────────────────

class TestSaveRun:
    def test_save_and_load(self, repo, _seed_asset):
        run = _make_run()
        repo.save_run(run)
        loaded = repo.load_run("run000000001")
        assert loaded is not None
        assert loaded.run_id == "run000000001"
        assert loaded.review_type == "banner_review"
        assert loaded.status == RunStatus.pending

    def test_save_with_brand_info(self, repo, _seed_asset):
        run = _make_run(brand_info="Acme Corp guidelines")
        repo.save_run(run)
        loaded = repo.load_run("run000000001")
        assert loaded.brand_info == "Acme Corp guidelines"

    def test_save_with_operator_memo(self, repo, _seed_asset):
        run = _make_run(operator_memo="Check CTA placement")
        repo.save_run(run)
        loaded = repo.load_run("run000000001")
        assert loaded.operator_memo == "Check CTA placement"

    def test_save_ad_lp_review(self, repo, _seed_asset):
        run = _make_run(review_type="ad_lp_review", lp_url="https://example.com/lp")
        repo.save_run(run)
        loaded = repo.load_run("run000000001")
        assert loaded.review_type == "ad_lp_review"
        assert loaded.lp_url == "https://example.com/lp"


class TestLoadRun:
    def test_nonexistent_returns_none(self, repo):
        assert repo.load_run("000000000000") is None


# ── Update Status ─────────────────────────────────────────────

class TestUpdateRunStatus:
    def test_update_to_running(self, repo, _seed_asset):
        run = _make_run()
        repo.save_run(run)
        result = repo.update_run_status("run000000001", RunStatus.running)
        assert result is True
        loaded = repo.load_run("run000000001")
        assert loaded.status == RunStatus.running

    def test_update_to_completed_with_timestamp(self, repo, _seed_asset):
        run = _make_run()
        repo.save_run(run)
        ts = datetime(2026, 3, 15, 12, 0, 0, tzinfo=timezone.utc)
        result = repo.update_run_status("run000000001", RunStatus.completed, completed_at=ts)
        assert result is True
        loaded = repo.load_run("run000000001")
        assert loaded.status == RunStatus.completed

    def test_update_to_failed(self, repo, _seed_asset):
        run = _make_run()
        repo.save_run(run)
        repo.update_run_status("run000000001", RunStatus.failed)
        loaded = repo.load_run("run000000001")
        assert loaded.status == RunStatus.failed

    def test_update_nonexistent_returns_false(self, repo):
        result = repo.update_run_status("000000000000", RunStatus.running)
        assert result is False


# ── List Runs ─────────────────────────────────────────────────

class TestListRuns:
    def test_empty_initially(self, repo):
        assert repo.list_runs() == []

    def test_returns_saved_runs(self, repo, _seed_asset):
        for i in range(3):
            run = _make_run(
                run_id=f"run00000000{i}",
                created_at=datetime(2026, 1, i + 1, tzinfo=timezone.utc),
            )
            repo.save_run(run)
        result = repo.list_runs()
        assert len(result) == 3

    def test_ordered_by_created_at_desc(self, repo, _seed_asset):
        t1 = datetime(2026, 1, 1, tzinfo=timezone.utc)
        t2 = datetime(2026, 6, 1, tzinfo=timezone.utc)
        repo.save_run(_make_run(run_id="run000000001", created_at=t1))
        repo.save_run(_make_run(run_id="run000000002", created_at=t2))
        result = repo.list_runs()
        assert result[0].run_id == "run000000002"
        assert result[1].run_id == "run000000001"

    def test_limit_and_offset(self, repo, _seed_asset):
        for i in range(5):
            repo.save_run(_make_run(
                run_id=f"run00000000{i}",
                created_at=datetime(2026, 1, i + 1, tzinfo=timezone.utc),
            ))
        result = repo.list_runs(limit=2, offset=1)
        assert len(result) == 2


# ── Delete Run ────────────────────────────────────────────────

class TestDeleteRun:
    def test_delete_existing(self, repo, _seed_asset):
        repo.save_run(_make_run())
        assert repo.delete_run("run000000001") is True
        assert repo.load_run("run000000001") is None

    def test_delete_nonexistent(self, repo):
        assert repo.delete_run("000000000000") is False

    def test_delete_cascades_output_and_exports(self, repo, _seed_asset):
        repo.save_run(_make_run())
        repo.save_output(ReviewOutput(
            run_id="run000000001",
            output_json={"score": 85},
        ))
        repo.save_export(ExportRecord(
            run_id="run000000001",
            format=ExportFormat.html,
            file_path="/tmp/report.html",
        ))
        repo.delete_run("run000000001")
        assert repo.load_output("run000000001") is None
        assert repo.list_exports("run000000001") == []


# ── Save / Load Output ───────────────────────────────────────

class TestSaveOutput:
    def test_save_and_load(self, repo, _seed_asset):
        repo.save_run(_make_run())
        output = ReviewOutput(
            run_id="run000000001",
            output_json={"overall_score": 85, "findings": [{"id": "F1", "text": "Good CTA"}]},
            model_used="gemini-2.0-flash",
        )
        repo.save_output(output)
        loaded = repo.load_output("run000000001")
        assert loaded is not None
        assert loaded.output_json == {"overall_score": 85, "findings": [{"id": "F1", "text": "Good CTA"}]}
        assert loaded.model_used == "gemini-2.0-flash"

    def test_json_roundtrip_complex(self, repo, _seed_asset):
        repo.save_run(_make_run())
        complex_json = {
            "scores": {"visual": 90, "copy": 75},
            "nested": {"a": {"b": [1, 2, 3]}},
            "unicode": "日本語テスト",
        }
        repo.save_output(ReviewOutput(run_id="run000000001", output_json=complex_json))
        loaded = repo.load_output("run000000001")
        assert loaded.output_json == complex_json


class TestLoadOutput:
    def test_nonexistent_returns_none(self, repo):
        assert repo.load_output("000000000000") is None


# ── Save / List Exports ──────────────────────────────────────

class TestSaveExport:
    def test_save_and_list(self, repo, _seed_asset):
        repo.save_run(_make_run())
        record = ExportRecord(
            run_id="run000000001",
            format=ExportFormat.pdf,
            file_path="/tmp/report.pdf",
            file_size_bytes=2048,
        )
        repo.save_export(record)
        exports = repo.list_exports("run000000001")
        assert len(exports) == 1
        assert exports[0].format == ExportFormat.pdf
        assert exports[0].file_path == "/tmp/report.pdf"
        assert exports[0].file_size_bytes == 2048

    def test_multiple_exports(self, repo, _seed_asset):
        repo.save_run(_make_run())
        for fmt in [ExportFormat.html, ExportFormat.pdf, ExportFormat.pptx]:
            repo.save_export(ExportRecord(
                run_id="run000000001",
                format=fmt,
                file_path=f"/tmp/report.{fmt.value}",
            ))
        exports = repo.list_exports("run000000001")
        assert len(exports) == 3


class TestListExports:
    def test_empty_for_nonexistent_run(self, repo):
        assert repo.list_exports("000000000000") == []
