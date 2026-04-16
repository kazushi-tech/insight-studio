"""Abstract interface for creative review persistence.

Defines the repository contract for review runs, outputs, and export records.
Pack A uses file-backed implementation; Pack B swaps to DB.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

import uuid


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> datetime:
    from datetime import timezone
    return datetime.now(timezone.utc)


class RunStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class ExportFormat(str, Enum):
    html = "html"
    pdf = "pdf"
    pptx = "pptx"


class CreativeReviewRun(BaseModel):
    """Review execution unit — one operator action = one run."""

    run_id: str = Field(default_factory=_new_id)
    review_type: str = Field(pattern=r"^(banner_review|ad_lp_review)$")
    asset_id: str
    lp_url: Optional[str] = None
    status: RunStatus = RunStatus.pending
    operator_memo: str = ""
    brand_info: str = ""
    created_at: datetime = Field(default_factory=_now)
    completed_at: Optional[datetime] = None


class ReviewOutput(BaseModel):
    """Review result — output_json conforms to review-output.schema.json."""

    run_id: str
    output_json: dict
    model_used: Optional[str] = None
    created_at: datetime = Field(default_factory=_now)


class ExportRecord(BaseModel):
    """Export history entry."""

    export_id: str = Field(default_factory=_new_id)
    run_id: str
    format: ExportFormat
    file_path: str
    file_size_bytes: Optional[int] = None
    created_at: datetime = Field(default_factory=_now)


class CreativeReviewRepository(ABC):
    """Interface for creative review persistence — DB-ready contract.

    Pack A: file-backed implementation.
    Pack B: swap to PostgreSQL.
    """

    # --- Review Run ---

    @abstractmethod
    def save_run(self, run: CreativeReviewRun) -> None: ...

    @abstractmethod
    def load_run(self, run_id: str) -> Optional[CreativeReviewRun]: ...

    @abstractmethod
    def update_run_status(
        self, run_id: str, status: RunStatus, completed_at: Optional[datetime] = None,
    ) -> bool: ...

    @abstractmethod
    def list_runs(self, *, limit: int = 50, offset: int = 0) -> list[CreativeReviewRun]: ...

    @abstractmethod
    def delete_run(self, run_id: str) -> bool: ...

    # --- Review Output ---

    @abstractmethod
    def save_output(self, output: ReviewOutput) -> None: ...

    @abstractmethod
    def load_output(self, run_id: str) -> Optional[ReviewOutput]: ...

    # --- Export Record ---

    @abstractmethod
    def save_export(self, record: ExportRecord) -> None: ...

    @abstractmethod
    def list_exports(self, run_id: str) -> list[ExportRecord]: ...
