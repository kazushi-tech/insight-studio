"""Reject newly added Google Ads or Todokukun implementation surface.

Historical planning documents and regression assertions are intentionally out of
scope.  The gate examines only added lines in executable/configuration surfaces,
so the frozen integration cannot quietly re-enter a feature branch.
"""

from __future__ import annotations

import argparse
from pathlib import PurePosixPath
import re
import subprocess


FROZEN = re.compile(r"(?:とどくくん|todokukun|google[ _-]?ads|google_ads|adwords)", re.IGNORECASE)
SCOPED_ROOTS = ("src/", "api/", "backends/ads-insights/", "backends/market-lens-ai/")
SCOPED_FILES = {"package.json", "package-lock.json", "vercel.json", "render.yaml"}
EXCLUDED_PARTS = {"tests", "test", "docs", "plans", "fixtures", "output", "bq_reports"}


def _is_scoped(path: str) -> bool:
    normalized = path.replace("\\", "/")
    if normalized in SCOPED_FILES:
        return True
    if not normalized.startswith(SCOPED_ROOTS):
        return False
    parts = set(PurePosixPath(normalized).parts)
    return not bool(parts & EXCLUDED_PARTS)


def _diff(base_ref: str) -> str:
    if not base_ref or set(base_ref) == {"0"}:
        base_ref = "HEAD^"
    command = ["git", "diff", "--unified=0", "--no-ext-diff", f"{base_ref}...HEAD", "--"]
    completed = subprocess.run(
        command,
        check=False,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )
    if completed.returncode == 0:
        return completed.stdout
    raise RuntimeError(completed.stderr.strip() or f"git diff failed for {base_ref}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-ref", required=True)
    args = parser.parse_args()

    try:
        diff = _diff(args.base_ref)
    except RuntimeError as exc:
        print(f"::error::{exc}")
        return 2

    current_path = ""
    violations: list[tuple[str, str]] = []
    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            current_path = line[6:]
            continue
        if not current_path or not _is_scoped(current_path):
            continue
        if line.startswith("+") and not line.startswith("+++") and FROZEN.search(line[1:]):
            violations.append((current_path, line[1:].strip()))

    if violations:
        print("::error::frozen Todokukun / Google Ads surface was added")
        for path, line in violations:
            print(f"- {path}: {line[:180]}")
        return 1

    print("Frozen-integration diff gate passed (0 added implementation lines).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
