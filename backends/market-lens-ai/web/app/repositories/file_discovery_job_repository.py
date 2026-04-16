"""File-backed Discovery job repository."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ..schemas.discovery_job import (
    DiscoveryJobError,
    DiscoveryJobRecord,
    DiscoveryJobStage,
    DiscoveryJobStatus,
)
from .discovery_job_repository import DiscoveryJobRepository

logger = logging.getLogger("market-lens.discovery.job_repo")

_DEFAULT_BASE = Path("data/discovery_jobs")


class FileDiscoveryJobRepository(DiscoveryJobRepository):
    def __init__(self, base_dir: Path | str | None = None):
        self._base = Path(base_dir) if base_dir else _DEFAULT_BASE

    def _job_dir(self, job_id: str) -> Path:
        return self._base / job_id

    def _job_path(self, job_id: str) -> Path:
        return self._job_dir(job_id) / "job.json"

    def _result_path(self, job_id: str) -> Path:
        return self._job_dir(job_id) / "result.json"

    def save_job(self, record: DiscoveryJobRecord) -> None:
        path = self._job_path(record.job_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(record.model_dump_json(indent=2), encoding="utf-8")

    def load_job(self, job_id: str) -> Optional[DiscoveryJobRecord]:
        path = self._job_path(job_id)
        if not path.exists():
            return None
        try:
            return DiscoveryJobRecord.model_validate_json(path.read_text(encoding="utf-8"))
        except Exception:
            logger.warning("Failed to load job record: %s", job_id)
            return None

    def save_result(self, job_id: str, result: dict) -> None:
        path = self._result_path(job_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result, ensure_ascii=False, default=str, indent=2), encoding="utf-8")

    def load_result(self, job_id: str) -> Optional[dict]:
        path = self._result_path(job_id)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            logger.warning("Failed to load job result: %s", job_id)
            return None

    def mark_stale_running_as_failed(self) -> int:
        """Mark any running/queued jobs as failed on startup."""
        if not self._base.exists():
            return 0
        count = 0
        now = datetime.now(timezone.utc)
        for job_dir in self._base.iterdir():
            if not job_dir.is_dir():
                continue
            record = self.load_job(job_dir.name)
            if record is None:
                continue
            if record.status in (DiscoveryJobStatus.queued, DiscoveryJobStatus.running):
                record.status = DiscoveryJobStatus.failed
                record.stage = DiscoveryJobStage.failed
                record.message = "サーバー再起動によりジョブが中断されました"
                record.updated_at = now
                record.heartbeat_at = now
                record.stage_started_at = now
                record.last_progress_at = now
                record.error = DiscoveryJobError(
                    status_code=503,
                    detail="サーバー再起動によりジョブが中断されました。再実行してください。",
                    retryable=True,
                )
                self.save_job(record)
                count += 1
                logger.info("Marked stale job as failed: %s", job_dir.name)
        return count
