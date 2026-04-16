"""Scan result persistence."""

from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path
from typing import Optional

from .models import ScanResult

DATA_DIR = Path("data/scans")

# run_id must be a safe hex string (no path traversal)
_SAFE_RUN_ID = re.compile(r"^[a-f0-9]{12}$")


def _validate_run_id(run_id: str) -> None:
    """Raise ValueError if run_id contains unsafe characters."""
    if not _SAFE_RUN_ID.match(run_id):
        raise ValueError(f"Invalid run_id: {run_id!r}")


def _run_dir(run_id: str) -> Path:
    _validate_run_id(run_id)
    return DATA_DIR / run_id


def save(result: ScanResult) -> Path:
    d = _run_dir(result.run_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / "scan.json").write_text(
        result.model_dump_json(indent=2), encoding="utf-8"
    )
    if result.report_md:
        (d / "report.md").write_text(result.report_md, encoding="utf-8")
    return d


def load(run_id: str) -> Optional[ScanResult]:
    p = _run_dir(run_id) / "scan.json"
    if not p.exists():
        return None
    return ScanResult.model_validate_json(p.read_text(encoding="utf-8"))


def list_scans(owner_id: str) -> list[dict]:
    if not DATA_DIR.exists():
        return []
    scans = []
    for d in sorted(DATA_DIR.iterdir(), reverse=True):
        meta_path = d / "scan.json"
        if meta_path.exists():
            data = json.loads(meta_path.read_text(encoding="utf-8"))
            if data.get("owner_id") != owner_id:
                continue
            scans.append({
                "run_id": data.get("run_id", d.name),
                "created_at": data.get("created_at", ""),
                "status": data.get("status", "unknown"),
                "urls": data.get("urls", []),
            })
    return scans


def delete(run_id: str) -> bool:
    d = _run_dir(run_id)
    if d.exists():
        shutil.rmtree(d)
        return True
    return False
