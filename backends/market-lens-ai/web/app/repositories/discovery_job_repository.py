"""Abstract interface for Discovery job repository."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from ..schemas.discovery_job import DiscoveryJobRecord


class DiscoveryJobRepository(ABC):
    @abstractmethod
    def save_job(self, record: DiscoveryJobRecord) -> None: ...

    @abstractmethod
    def load_job(self, job_id: str) -> Optional[DiscoveryJobRecord]: ...

    @abstractmethod
    def save_result(self, job_id: str, result: dict) -> None: ...

    @abstractmethod
    def load_result(self, job_id: str) -> Optional[dict]: ...

    @abstractmethod
    def mark_stale_running_as_failed(self) -> int: ...
