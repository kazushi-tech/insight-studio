"""File-based implementation of ScanRepository."""

from __future__ import annotations

from typing import Optional

from .. import storage
from ..models import ScanResult
from .scan_repository import ScanRepository


class FileScanRepository(ScanRepository):
    """Delegates to the existing file-based storage module."""

    def save(self, result: ScanResult) -> None:
        storage.save(result)

    def load(self, run_id: str) -> Optional[ScanResult]:
        return storage.load(run_id)

    def list_all(self, owner_id: str) -> list[dict]:
        return storage.list_scans(owner_id)

    def delete(self, run_id: str) -> bool:
        return storage.delete(run_id)
