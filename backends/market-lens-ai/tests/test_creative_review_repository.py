"""Tests for creative review repository (CR-A2.5)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from web.app.repositories.creative_review_repository import (
    CreativeReviewRun,
    ExportFormat,
    ExportRecord,
    ReviewOutput,
    RunStatus,
)
from web.app.repositories.file_creative_review_repository import (
    FileCreativeReviewRepository,
)


@pytest.fixture()
def repo(tmp_path) -> FileCreativeReviewRepository:
    return FileCreativeReviewRepository(base_dir=tmp_path / "reviews")


@pytest.fixture()
def sample_run() -> CreativeReviewRun:
    return CreativeReviewRun(
        run_id="aabbccddeeff",
        review_type="banner_review",
        asset_id="112233445566",
        status=RunStatus.pending,
        operator_memo="テスト用メモ",
        brand_info="テストブランド",
    )


@pytest.fixture()
def sample_output() -> ReviewOutput:
    return ReviewOutput(
        run_id="aabbccddeeff",
        output_json={
            "review_type": "banner_review",
            "summary": "テストサマリー",
            "good_points": [{"point": "良い", "reason": "理由"}],
            "keep_as_is": [{"point": "守る", "reason": "理由"}],
            "improvements": [{"point": "改善", "reason": "理由", "action": "アクション"}],
            "test_ideas": [{"hypothesis": "仮説", "variable": "変数", "expected_impact": "効果"}],
            "evidence": [{"evidence_type": "client_material", "evidence_source": "src", "evidence_text": "text"}],
            "target_hypothesis": "ターゲット",
            "message_angle": "訴求軸",
            "rubric_scores": [{"rubric_id": "visual", "score": 4, "comment": "コメント"}],
        },
        model_used="gemini-test",
    )


@pytest.fixture()
def sample_export() -> ExportRecord:
    return ExportRecord(
        export_id="ffeeddccbbaa",
        run_id="aabbccddeeff",
        format=ExportFormat.pdf,
        file_path="data/creative_reviews/aabbccddeeff/exports/ffeeddccbbaa.pdf",
        file_size_bytes=12345,
    )


class TestRunCRUD:
    def test_save_and_load(self, repo, sample_run):
        repo.save_run(sample_run)
        loaded = repo.load_run(sample_run.run_id)
        assert loaded is not None
        assert loaded.run_id == sample_run.run_id
        assert loaded.review_type == "banner_review"
        assert loaded.asset_id == "112233445566"
        assert loaded.status == RunStatus.pending

    def test_load_nonexistent(self, repo):
        assert repo.load_run("000000000000") is None

    def test_update_status(self, repo, sample_run):
        repo.save_run(sample_run)
        now = datetime.now(timezone.utc)
        result = repo.update_run_status(
            sample_run.run_id, RunStatus.completed, completed_at=now,
        )
        assert result is True
        loaded = repo.load_run(sample_run.run_id)
        assert loaded.status == RunStatus.completed
        assert loaded.completed_at is not None

    def test_update_status_nonexistent(self, repo):
        assert repo.update_run_status("000000000000", RunStatus.failed) is False

    def test_list_runs(self, repo, sample_run):
        repo.save_run(sample_run)
        run2 = CreativeReviewRun(
            run_id="bbccddeeff00",
            review_type="ad_lp_review",
            asset_id="112233445566",
            lp_url="https://example.com",
        )
        repo.save_run(run2)
        runs = repo.list_runs()
        assert len(runs) == 2

    def test_list_runs_pagination(self, repo, sample_run):
        repo.save_run(sample_run)
        run2 = CreativeReviewRun(
            run_id="bbccddeeff00",
            review_type="ad_lp_review",
            asset_id="112233445566",
        )
        repo.save_run(run2)
        page = repo.list_runs(limit=1, offset=0)
        assert len(page) == 1

    def test_delete_run(self, repo, sample_run):
        repo.save_run(sample_run)
        assert repo.delete_run(sample_run.run_id) is True
        assert repo.load_run(sample_run.run_id) is None

    def test_delete_nonexistent(self, repo):
        assert repo.delete_run("000000000000") is False

    def test_invalid_run_id(self, repo):
        with pytest.raises(ValueError, match="Invalid run_id"):
            repo.load_run("../etc/passwd")


class TestReviewOutput:
    def test_save_and_load_output(self, repo, sample_run, sample_output):
        repo.save_run(sample_run)
        repo.save_output(sample_output)
        loaded = repo.load_output(sample_run.run_id)
        assert loaded is not None
        assert loaded.run_id == sample_run.run_id
        assert loaded.output_json["summary"] == "テストサマリー"
        assert loaded.model_used == "gemini-test"

    def test_load_output_nonexistent(self, repo, sample_run):
        repo.save_run(sample_run)
        assert repo.load_output(sample_run.run_id) is None


class TestExportRecord:
    def test_save_and_list_exports(self, repo, sample_run, sample_export):
        repo.save_run(sample_run)
        repo.save_export(sample_export)
        exports = repo.list_exports(sample_run.run_id)
        assert len(exports) == 1
        assert exports[0].export_id == sample_export.export_id
        assert exports[0].format == ExportFormat.pdf
        assert exports[0].file_size_bytes == 12345

    def test_list_exports_empty(self, repo, sample_run):
        repo.save_run(sample_run)
        assert repo.list_exports(sample_run.run_id) == []

    def test_multiple_exports(self, repo, sample_run, sample_export):
        repo.save_run(sample_run)
        repo.save_export(sample_export)
        export2 = ExportRecord(
            export_id="aabbccddeef0",
            run_id=sample_run.run_id,
            format=ExportFormat.html,
            file_path="data/creative_reviews/aabbccddeeff/exports/aabbccddeef0.html",
        )
        repo.save_export(export2)
        exports = repo.list_exports(sample_run.run_id)
        assert len(exports) == 2


class TestModelFields:
    def test_run_defaults(self):
        run = CreativeReviewRun(
            review_type="banner_review", asset_id="aabbccddeeff",
        )
        assert len(run.run_id) == 12
        assert run.status == RunStatus.pending
        assert run.created_at is not None
        assert run.completed_at is None

    def test_export_defaults(self):
        record = ExportRecord(
            run_id="aabbccddeeff",
            format=ExportFormat.pptx,
            file_path="test.pptx",
        )
        assert len(record.export_id) == 12
        assert record.created_at is not None
        assert record.file_size_bytes is None

    def test_review_type_validation(self):
        with pytest.raises(Exception):
            CreativeReviewRun(
                review_type="invalid_type", asset_id="aabbccddeeff",
            )

    def test_export_format_enum(self):
        assert ExportFormat.html.value == "html"
        assert ExportFormat.pdf.value == "pdf"
        assert ExportFormat.pptx.value == "pptx"
