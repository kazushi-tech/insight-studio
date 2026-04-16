"""Tests for repository factory functions."""

from __future__ import annotations

from web.app.repositories import create_asset_repository, create_review_repository
from web.app.repositories.file_asset_repository import FileAssetRepository
from web.app.repositories.file_creative_review_repository import FileCreativeReviewRepository
from web.app.repositories.db_asset_repository import DbAssetRepository
from web.app.repositories.db_creative_review_repository import DbCreativeReviewRepository


class TestCreateAssetRepository:
    def test_file_backend(self, tmp_path):
        # FileAssetRepository uses default data/assets; just check type
        repo = create_asset_repository("file")
        assert isinstance(repo, FileAssetRepository)

    def test_db_backend(self):
        repo = create_asset_repository("db")
        assert isinstance(repo, DbAssetRepository)

    def test_default_is_file(self):
        repo = create_asset_repository()
        assert isinstance(repo, FileAssetRepository)


class TestCreateReviewRepository:
    def test_file_backend(self):
        repo = create_review_repository("file")
        assert isinstance(repo, FileCreativeReviewRepository)

    def test_db_backend(self):
        repo = create_review_repository("db")
        assert isinstance(repo, DbCreativeReviewRepository)

    def test_default_is_file(self):
        repo = create_review_repository()
        assert isinstance(repo, FileCreativeReviewRepository)
