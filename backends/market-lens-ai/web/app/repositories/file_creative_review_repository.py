"""File-based implementation of CreativeReviewRepository for Pack A alpha."""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from .creative_review_repository import (
    CreativeReviewRepository,
    CreativeReviewRun,
    ExportRecord,
    ReviewOutput,
    RunStatus,
)

_RUN_ID_RE = re.compile(r"^[0-9a-f]{12}$")


class FileCreativeReviewRepository(CreativeReviewRepository):
    """Stores creative review data as files.

    Layout:
        base_dir/<run_id>/run.json
        base_dir/<run_id>/output.json
        base_dir/<run_id>/exports/<export_id>.<format>   (metadata only)
        base_dir/<run_id>/exports/<export_id>.meta.json
    """

    def __init__(self, base_dir: str | Path = "data/creative_reviews") -> None:
        self._base = Path(base_dir)
        self._base.mkdir(parents=True, exist_ok=True)

    def _run_dir(self, run_id: str) -> Path:
        if not _RUN_ID_RE.match(run_id):
            raise ValueError(f"Invalid run_id format: {run_id}")
        return self._base / run_id

    # --- Review Run ---

    def save_run(self, run: CreativeReviewRun) -> None:
        d = self._run_dir(run.run_id)
        d.mkdir(parents=True, exist_ok=True)
        (d / "run.json").write_text(
            run.model_dump_json(indent=2), encoding="utf-8",
        )

    def load_run(self, run_id: str) -> Optional[CreativeReviewRun]:
        d = self._run_dir(run_id)
        run_path = d / "run.json"
        if not run_path.exists():
            return None
        raw = json.loads(run_path.read_text(encoding="utf-8"))
        return CreativeReviewRun(**raw)

    def update_run_status(
        self, run_id: str, status: RunStatus, completed_at: Optional[datetime] = None,
    ) -> bool:
        run = self.load_run(run_id)
        if run is None:
            return False
        run.status = status
        if completed_at is not None:
            run.completed_at = completed_at
        self.save_run(run)
        return True

    def list_runs(self, *, limit: int = 50, offset: int = 0) -> list[CreativeReviewRun]:
        runs: list[CreativeReviewRun] = []
        if not self._base.exists():
            return runs
        for sub in sorted(self._base.iterdir(), reverse=True):
            run_path = sub / "run.json"
            if run_path.exists():
                raw = json.loads(run_path.read_text(encoding="utf-8"))
                runs.append(CreativeReviewRun(**raw))
        return runs[offset : offset + limit]

    def delete_run(self, run_id: str) -> bool:
        d = self._run_dir(run_id)
        if not d.exists():
            return False
        shutil.rmtree(d)
        return True

    # --- Review Output ---

    def save_output(self, output: ReviewOutput) -> None:
        d = self._run_dir(output.run_id)
        d.mkdir(parents=True, exist_ok=True)
        (d / "output.json").write_text(
            output.model_dump_json(indent=2), encoding="utf-8",
        )

    def load_output(self, run_id: str) -> Optional[ReviewOutput]:
        d = self._run_dir(run_id)
        output_path = d / "output.json"
        if not output_path.exists():
            return None
        raw = json.loads(output_path.read_text(encoding="utf-8"))
        return ReviewOutput(**raw)

    # --- Export Record ---

    def save_export(self, record: ExportRecord) -> None:
        d = self._run_dir(record.run_id) / "exports"
        d.mkdir(parents=True, exist_ok=True)
        meta_path = d / f"{record.export_id}.meta.json"
        meta_path.write_text(
            record.model_dump_json(indent=2), encoding="utf-8",
        )

    def list_exports(self, run_id: str) -> list[ExportRecord]:
        d = self._run_dir(run_id) / "exports"
        if not d.exists():
            return []
        records: list[ExportRecord] = []
        for f in sorted(d.iterdir()):
            if f.name.endswith(".meta.json"):
                raw = json.loads(f.read_text(encoding="utf-8"))
                records.append(ExportRecord(**raw))
        return records
