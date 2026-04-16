"""Tests for DbAssetRepository — in-memory SQLite."""

from __future__ import annotations

import time
from datetime import datetime, timezone

import pytest

from web.app.db.engine import get_engine, get_session, create_tables
from web.app.db.tables import assets as assets_table
from web.app.repositories.db_asset_repository import DbAssetRepository
from web.app.schemas.creative_asset import CreativeAssetMetadata


@pytest.fixture()
def repo():
    """Create a DbAssetRepository backed by in-memory SQLite."""
    engine = get_engine("sqlite:///:memory:")
    create_tables(engine)
    sf = get_session(engine)
    return DbAssetRepository(session_factory=sf)


def _make_meta(
    asset_id: str = "aabbccdd0011",
    file_name: str = "test.png",
    mime_type: str = "image/png",
    size_bytes: int = 1024,
    **kwargs,
) -> CreativeAssetMetadata:
    return CreativeAssetMetadata(
        asset_id=asset_id,
        file_name=file_name,
        mime_type=mime_type,
        size_bytes=size_bytes,
        **kwargs,
    )


class TestSave:
    def test_save_and_load_metadata(self, repo):
        meta = _make_meta()
        repo.save(meta, b"PNG_DATA")
        loaded = repo.load_metadata("aabbccdd0011")
        assert loaded is not None
        assert loaded.asset_id == "aabbccdd0011"
        assert loaded.file_name == "test.png"
        assert loaded.mime_type == "image/png"
        assert loaded.size_bytes == 1024

    def test_save_and_load_data(self, repo):
        meta = _make_meta()
        data = b"\x89PNG_BINARY_DATA"
        repo.save(meta, data)
        loaded = repo.load_data("aabbccdd0011")
        assert loaded == data

    def test_save_with_dimensions(self, repo):
        meta = _make_meta(width=800, height=600)
        repo.save(meta, b"x")
        loaded = repo.load_metadata("aabbccdd0011")
        assert loaded.width == 800
        assert loaded.height == 600

    def test_save_with_asset_type(self, repo):
        meta = _make_meta(asset_type="screenshot")
        repo.save(meta, b"x")
        loaded = repo.load_metadata("aabbccdd0011")
        assert loaded.asset_type.value == "screenshot"


class TestLoadMetadata:
    def test_nonexistent_returns_none(self, repo):
        assert repo.load_metadata("000000000000") is None


class TestLoadData:
    def test_nonexistent_returns_none(self, repo):
        assert repo.load_data("000000000000") is None

    def test_large_binary_data(self, repo):
        meta = _make_meta(size_bytes=1_000_000)
        big_data = b"\x00" * 1_000_000
        repo.save(meta, big_data)
        loaded = repo.load_data("aabbccdd0011")
        assert loaded == big_data
        assert len(loaded) == 1_000_000


class TestDelete:
    def test_delete_existing(self, repo):
        meta = _make_meta()
        repo.save(meta, b"data")
        assert repo.delete("aabbccdd0011") is True
        assert repo.load_metadata("aabbccdd0011") is None
        assert repo.load_data("aabbccdd0011") is None

    def test_delete_nonexistent(self, repo):
        assert repo.delete("000000000000") is False

    def test_delete_removes_from_list(self, repo):
        meta = _make_meta()
        repo.save(meta, b"data")
        repo.delete("aabbccdd0011")
        assert repo.list_all() == []


class TestListAll:
    def test_empty_initially(self, repo):
        assert repo.list_all() == []

    def test_returns_all_saved(self, repo):
        for i in range(3):
            aid = f"aabbccdd00{i:02d}"
            meta = _make_meta(asset_id=aid, file_name=f"file{i}.png")
            repo.save(meta, b"x")
        result = repo.list_all()
        assert len(result) == 3

    def test_ordered_by_created_at_desc(self, repo):
        t1 = datetime(2026, 1, 1, tzinfo=timezone.utc)
        t2 = datetime(2026, 6, 1, tzinfo=timezone.utc)
        meta1 = _make_meta(asset_id="aabbccdd0001", created_at=t1)
        meta2 = _make_meta(asset_id="aabbccdd0002", created_at=t2)
        repo.save(meta1, b"x")
        repo.save(meta2, b"y")
        result = repo.list_all()
        assert result[0].asset_id == "aabbccdd0002"
        assert result[1].asset_id == "aabbccdd0001"


class TestDuplicateId:
    def test_duplicate_id_raises(self, repo):
        meta = _make_meta()
        repo.save(meta, b"data1")
        with pytest.raises(Exception):
            repo.save(meta, b"data2")
