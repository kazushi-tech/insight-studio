"""Tests for file-backed asset repository."""

from __future__ import annotations

import pytest

from web.app.repositories.file_asset_repository import FileAssetRepository
from web.app.schemas.creative_asset import CreativeAssetMetadata


# -- Helpers ------------------------------------------------------------------

def _make_metadata(**overrides) -> CreativeAssetMetadata:
    defaults = dict(
        file_name="test_banner.png",
        mime_type="image/png",
        size_bytes=1024,
        width=300,
        height=250,
    )
    defaults.update(overrides)
    return CreativeAssetMetadata(**defaults)


PNG_1PX = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
)


# -- Tests --------------------------------------------------------------------

class TestFileAssetRepository:
    def test_save_and_load_metadata(self, tmp_path):
        repo = FileAssetRepository(base_dir=tmp_path / "assets")
        meta = _make_metadata()
        repo.save(meta, PNG_1PX)

        loaded = repo.load_metadata(meta.asset_id)
        assert loaded is not None
        assert loaded.asset_id == meta.asset_id
        assert loaded.file_name == "test_banner.png"
        assert loaded.mime_type == "image/png"

    def test_save_and_load_data(self, tmp_path):
        repo = FileAssetRepository(base_dir=tmp_path / "assets")
        meta = _make_metadata()
        repo.save(meta, PNG_1PX)

        data = repo.load_data(meta.asset_id)
        assert data == PNG_1PX

    def test_delete(self, tmp_path):
        repo = FileAssetRepository(base_dir=tmp_path / "assets")
        meta = _make_metadata()
        repo.save(meta, PNG_1PX)

        assert repo.delete(meta.asset_id) is True
        assert repo.load_metadata(meta.asset_id) is None
        assert repo.delete(meta.asset_id) is False

    def test_list_all(self, tmp_path):
        repo = FileAssetRepository(base_dir=tmp_path / "assets")
        m1 = _make_metadata(file_name="a.png")
        m2 = _make_metadata(file_name="b.png")
        repo.save(m1, PNG_1PX)
        repo.save(m2, PNG_1PX)

        all_assets = repo.list_all()
        assert len(all_assets) == 2

    def test_load_missing_returns_none(self, tmp_path):
        repo = FileAssetRepository(base_dir=tmp_path / "assets")
        assert repo.load_metadata("000000000000") is None
        assert repo.load_data("000000000000") is None

    def test_invalid_asset_id_raises(self, tmp_path):
        repo = FileAssetRepository(base_dir=tmp_path / "assets")
        with pytest.raises(ValueError, match="Invalid asset_id"):
            repo.load_metadata("bad-id")

    def test_jpeg_extension(self, tmp_path):
        repo = FileAssetRepository(base_dir=tmp_path / "assets")
        meta = _make_metadata(file_name="photo.jpg", mime_type="image/jpeg")
        repo.save(meta, b"\xff\xd8\xff\xe0")

        asset_dir = tmp_path / "assets" / meta.asset_id
        assert (asset_dir / "original.jpg").exists()
