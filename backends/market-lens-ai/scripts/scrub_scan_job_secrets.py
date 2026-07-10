"""Remove legacy API-key fields from persisted Market Lens scan jobs.

The script never prints secret values. It preserves every other JSON field and
writes through a temporary file before replacing the original.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path
from typing import Any


SECRET_FIELDS = {"api_key", "search_api_key"}
DEFAULT_SCAN_ROOT = Path(__file__).resolve().parents[1] / "data" / "scan_jobs"


def scrub_secret_fields(value: Any) -> tuple[Any, int]:
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        removed = 0
        for key, item in value.items():
            if key in SECRET_FIELDS:
                removed += 1
                continue
            scrubbed_item, nested_removed = scrub_secret_fields(item)
            cleaned[key] = scrubbed_item
            removed += nested_removed
        return cleaned, removed

    if isinstance(value, list):
        cleaned_items = []
        removed = 0
        for item in value:
            scrubbed_item, nested_removed = scrub_secret_fields(item)
            cleaned_items.append(scrubbed_item)
            removed += nested_removed
        return cleaned_items, removed

    return value, 0


def atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


def scrub_scan_jobs(scan_root: Path, *, apply: bool) -> dict[str, int]:
    summary = {"scanned_files": 0, "modified_files": 0, "removed_fields": 0}
    if not scan_root.exists():
        return summary

    for path in sorted(scan_root.rglob("*.json")):
        summary["scanned_files"] += 1
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        cleaned, removed = scrub_secret_fields(payload)
        if removed == 0:
            continue

        summary["modified_files"] += 1
        summary["removed_fields"] += removed
        if apply:
            atomic_write_json(path, cleaned)

    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Scrub legacy API-key fields from scan job JSON files.")
    parser.add_argument("--root", type=Path, default=DEFAULT_SCAN_ROOT)
    parser.add_argument("--apply", action="store_true", help="Write sanitized JSON files. Without this flag, run a dry check.")
    args = parser.parse_args()

    root = args.root.resolve()
    summary = scrub_scan_jobs(root, apply=args.apply)
    print(json.dumps({"mode": "apply" if args.apply else "dry-run", **summary}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
