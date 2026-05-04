"""Repository package — factory functions for backend selection."""

from __future__ import annotations

from .asset_repository import AssetRepository
from .creative_review_repository import CreativeReviewRepository
from .file_asset_repository import FileAssetRepository
from .file_creative_review_repository import FileCreativeReviewRepository


def create_asset_repository(backend: str = "file") -> AssetRepository:
    """Create an AssetRepository for the given backend ('file' or 'db')."""
    if backend in ("db", "database"):
        try:
            from .db_asset_repository import DbAssetRepository
            return DbAssetRepository()
        except Exception as exc:
            import logging
            logging.getLogger("market-lens.repositories").warning(
                "DB asset repository unavailable (%s), falling back to file backend", exc
            )
    return FileAssetRepository()


def create_review_repository(backend: str = "file") -> CreativeReviewRepository:
    """Create a CreativeReviewRepository for the given backend ('file' or 'db')."""
    if backend in ("db", "database"):
        try:
            from .db_creative_review_repository import DbCreativeReviewRepository
            return DbCreativeReviewRepository()
        except Exception as exc:
            import logging
            logging.getLogger("market-lens.repositories").warning(
                "DB review repository unavailable (%s), falling back to file backend", exc
            )
    return FileCreativeReviewRepository()
