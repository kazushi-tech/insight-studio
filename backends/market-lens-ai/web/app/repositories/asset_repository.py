"""Abstract interface for creative asset persistence."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from ..schemas.creative_asset import CreativeAssetMetadata


class AssetRepository(ABC):
    """Interface for creative asset storage — DB-ready contract."""

    @abstractmethod
    def save(self, metadata: CreativeAssetMetadata, data: bytes) -> None: ...

    @abstractmethod
    def load_metadata(self, asset_id: str) -> Optional[CreativeAssetMetadata]: ...

    @abstractmethod
    def load_data(self, asset_id: str) -> Optional[bytes]: ...

    @abstractmethod
    def delete(self, asset_id: str) -> bool: ...

    @abstractmethod
    def list_all(self) -> list[CreativeAssetMetadata]: ...
