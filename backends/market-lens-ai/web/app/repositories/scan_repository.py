"""Abstract interface for scan persistence."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from ..models import ScanResult


class ScanRepository(ABC):
    """Interface for scan result storage."""

    @abstractmethod
    def save(self, result: ScanResult) -> None: ...

    @abstractmethod
    def load(self, run_id: str) -> Optional[ScanResult]: ...

    @abstractmethod
    def list_all(self, owner_id: str) -> list[dict]: ...

    @abstractmethod
    def delete(self, run_id: str) -> bool: ...
