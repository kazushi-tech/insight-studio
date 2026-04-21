"""File-backed Scan job repository."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ..schemas.scan_job import ScanJobError, ScanJobRecord, ScanJobStage, ScanJobStatus
from .scan_job_repository import ScanJobRepository

logger = logging.getLogger("market-lens.scan.job_repo")

_DEFAULT_BASE = Path("data/scan_jobs")


class FileScanJobRepository(ScanJobRepository):
    def __init__(self, base_dir: Path | str | None = None):
        self._base = Path(base_dir) if base_dir else _DEFAULT_BASE

    def _job_dir(self, job_id: str) -> Path:
        return self._base / job_id

    def _job_path(self, job_id: str) -> Path:
        return self._job_dir(job_id) / "job.json"

    def _result_path(self, job_id: str) -> Path:
        return self._job_dir(job_id) / "result.json"

    def save_job(self, record: ScanJobRecord) -> None:
        path = self._job_path(record.job_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(record.model_dump_json(indent=2), encoding="utf-8")

    def load_job(self, job_id: str) -> Optional[ScanJobRecord]:
        path = self._job_path(job_id)
        if not path.exists():
            return None
        try:
            return ScanJobRecord.model_validate_json(path.read_text(encoding="utf-8"))
        except Exception:
            logger.warning("Failed to load scan job record: %s", job_id)
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
            logger.warning("Failed to load scan job result: %s", job_id)
            return None

    def mark_stale_running_as_failed(self) -> int:
        """Mark any running/queued jobs as failed on startup (process crash recovery)."""
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
            if record.status in (ScanJobStatus.queued, ScanJobStatus.running):
                record.status = ScanJobStatus.failed
                record.stage = ScanJobStage.failed
                record.updated_at = now
                record.error = ScanJobError(
                    status_code=503,
                    detail="サーバーが再起動されたため、ジョブが中断されました。再試行してください。",
                    retryable=True,
                )
                self.save_job(record)
                count += 1
        return count
