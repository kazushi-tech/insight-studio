"""Tests for file-based scan result storage."""

from __future__ import annotations

import pytest

from web.app import storage
from web.app.models import ExtractedData, ScanResult


# ---------------------------------------------------------------------------
# Fixture: redirect DATA_DIR to a temp path so tests are isolated
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _isolate_storage(tmp_path, monkeypatch):
    """Redirect storage.DATA_DIR to a temporary directory for each test."""
    scans_dir = tmp_path / "scans"
    scans_dir.mkdir()
    monkeypatch.setattr(storage, "DATA_DIR", scans_dir)


# ---------------------------------------------------------------------------
# save + load round-trip
# ---------------------------------------------------------------------------

class TestSaveAndLoad:
    def test_basic_round_trip(self):
        result = ScanResult(
            run_id="abc123def456",
            urls=["https://example.com"],
            status="completed",
            report_md="# Test Report",
            extracted=[ExtractedData(url="https://example.com", title="Example")],
        )
        storage.save(result)

        loaded = storage.load("abc123def456")
        assert loaded is not None
        assert loaded.run_id == "abc123def456"
        assert loaded.status == "completed"
        assert loaded.report_md == "# Test Report"
        assert len(loaded.extracted) == 1
        assert loaded.extracted[0].title == "Example"
        assert loaded.urls == ["https://example.com"]

    def test_load_nonexistent_returns_none(self):
        assert storage.load("aabbccdd0066") is None

    def test_report_md_file_written(self, tmp_path, monkeypatch):
        scans_dir = tmp_path / "scans2"
        scans_dir.mkdir()
        monkeypatch.setattr(storage, "DATA_DIR", scans_dir)

        result = ScanResult(run_id="aabbccdd0011", urls=[], status="completed", report_md="# Hello")
        path = storage.save(result)
        assert (path / "report.md").exists()
        assert (path / "report.md").read_text(encoding="utf-8") == "# Hello"

    def test_no_report_file_when_empty(self, tmp_path, monkeypatch):
        scans_dir = tmp_path / "scans3"
        scans_dir.mkdir()
        monkeypatch.setattr(storage, "DATA_DIR", scans_dir)

        result = ScanResult(run_id="aabbccdd0022", urls=[], status="pending")
        path = storage.save(result)
        assert not (path / "report.md").exists()


# ---------------------------------------------------------------------------
# list_scans
# ---------------------------------------------------------------------------

class TestListScans:
    def test_empty_when_no_scans(self):
        assert storage.list_scans("test-owner") == []

    def test_returns_two_items_after_two_saves(self):
        for i in range(2):
            r = ScanResult(
                run_id=f"aabbccdd0{i:03d}",
                urls=[f"https://example.com/{i}"],
                status="completed",
                owner_id="test-owner",
            )
            storage.save(r)

        scans = storage.list_scans("test-owner")
        assert len(scans) == 2

    def test_list_contains_expected_fields(self):
        r = ScanResult(run_id="aabbccdd0033", urls=["https://example.com"], status="completed", owner_id="test-owner")
        storage.save(r)

        scans = storage.list_scans("test-owner")
        assert len(scans) == 1
        item = scans[0]
        assert item["run_id"] == "aabbccdd0033"
        assert item["status"] == "completed"
        assert "created_at" in item
        assert "urls" in item


# ---------------------------------------------------------------------------
# delete
# ---------------------------------------------------------------------------

class TestDelete:
    def test_delete_removes_scan(self):
        r = ScanResult(run_id="aabbccdd0044", urls=["https://example.com"], status="completed")
        storage.save(r)

        assert storage.load("aabbccdd0044") is not None
        result = storage.delete("aabbccdd0044")
        assert result is True
        assert storage.load("aabbccdd0044") is None

    def test_delete_nonexistent_returns_false(self):
        assert storage.delete("aabbccdd0055") is False


# ---------------------------------------------------------------------------
# Path traversal protection
# ---------------------------------------------------------------------------

class TestPathTraversal:
    def test_load_rejects_traversal(self):
        with pytest.raises(ValueError, match="Invalid run_id"):
            storage.load("../../../etc")

    def test_delete_rejects_traversal(self):
        with pytest.raises(ValueError, match="Invalid run_id"):
            storage.delete("../../passwd")

    def test_rejects_non_hex_run_id(self):
        with pytest.raises(ValueError, match="Invalid run_id"):
            storage.load("not-valid-id!")

    def test_rejects_too_short_run_id(self):
        with pytest.raises(ValueError, match="Invalid run_id"):
            storage.load("abc")

    def test_rejects_too_long_run_id(self):
        with pytest.raises(ValueError, match="Invalid run_id"):
            storage.load("a" * 20)
