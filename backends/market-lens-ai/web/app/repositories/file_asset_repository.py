"""File-based implementation of AssetRepository for alpha."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

from ..schemas.creative_asset import CreativeAssetMetadata
from .asset_repository import AssetRepository

_ASSET_ID_RE = re.compile(r"^[0-9a-f]{12}$")


class FileAssetRepository(AssetRepository):
    """Stores assets as files under a base directory.

    Layout:
        base_dir/<asset_id>/metadata.json
        base_dir/<asset_id>/original.<ext>
    """

    def __init__(self, base_dir: str | Path = "data/assets") -> None:
        self._base = Path(base_dir)
        self._base.mkdir(parents=True, exist_ok=True)

    def _asset_dir(self, asset_id: str) -> Path:
        if not _ASSET_ID_RE.match(asset_id):
            raise ValueError(f"Invalid asset_id format: {asset_id}")
        return self._base / asset_id

    def save(self, metadata: CreativeAssetMetadata, data: bytes) -> None:
        d = self._asset_dir(metadata.asset_id)
        d.mkdir(parents=True, exist_ok=True)
        # Write metadata
        meta_path = d / "metadata.json"
        meta_path.write_text(metadata.model_dump_json(indent=2), encoding="utf-8")
        # Write binary
        ext = _ext_from_mime(metadata.mime_type)
        (d / f"original{ext}").write_bytes(data)

    def load_metadata(self, asset_id: str) -> Optional[CreativeAssetMetadata]:
        d = self._asset_dir(asset_id)
        meta_path = d / "metadata.json"
        if not meta_path.exists():
            return None
        raw = json.loads(meta_path.read_text(encoding="utf-8"))
        return CreativeAssetMetadata(**raw)

    def load_data(self, asset_id: str) -> Optional[bytes]:
        d = self._asset_dir(asset_id)
        if not d.exists():
            return None
        for f in d.iterdir():
            if f.name.startswith("original"):
                return f.read_bytes()
        return None

    def delete(self, asset_id: str) -> bool:
        d = self._asset_dir(asset_id)
        if not d.exists():
            return False
        import shutil
        shutil.rmtree(d)
        return True

    def list_all(self) -> list[CreativeAssetMetadata]:
        results: list[CreativeAssetMetadata] = []
        if not self._base.exists():
            return results
        for sub in sorted(self._base.iterdir()):
            meta_path = sub / "metadata.json"
            if meta_path.exists():
                raw = json.loads(meta_path.read_text(encoding="utf-8"))
                results.append(CreativeAssetMetadata(**raw))
        return results


def _ext_from_mime(mime: str) -> str:
    mapping = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/gif": ".gif",
        "image/webp": ".webp",
    }
    return mapping.get(mime, ".bin")
