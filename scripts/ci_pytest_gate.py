"""Run a backend's complete pytest suite behind an explicit collection floor.

The collection gate prevents an accidental test-discovery regression from looking
like a fast green build.  Coverage is always collected; no test file selection is
performed by this helper.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import subprocess
import sys


COLLECTION_RE = re.compile(r"(?P<count>\d+)\s+tests?\s+collected", re.IGNORECASE)


def _run(
    command: list[str],
    cwd: Path,
    *,
    capture: bool = False,
    echo_capture: bool = True,
) -> subprocess.CompletedProcess[str]:
    print(f"::group::{' '.join(command)}")
    completed = subprocess.run(
        command,
        cwd=cwd,
        env={**os.environ, "PYTHONHASHSEED": "0", "PYTHONDONTWRITEBYTECODE": "1"},
        check=False,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
    )
    if capture and echo_capture and completed.stdout:
        print(completed.stdout, end="" if completed.stdout.endswith("\n") else "\n")
    print("::endgroup::")
    return completed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cwd", type=Path, required=True)
    parser.add_argument("--minimum", type=int, required=True)
    parser.add_argument("--coverage-source", action="append", default=[])
    parser.add_argument("--coverage-xml", type=Path, required=True)
    args = parser.parse_args()

    cwd = args.cwd.resolve()
    if not cwd.is_dir():
        parser.error(f"backend directory does not exist: {cwd}")

    collection = _run(
        [sys.executable, "-m", "pytest", "--collect-only", "-q"],
        cwd,
        capture=True,
        echo_capture=False,
    )
    if collection.returncode != 0:
        if collection.stdout:
            print(collection.stdout)
        print("::error::pytest collection failed")
        return collection.returncode

    matches = list(COLLECTION_RE.finditer(collection.stdout or ""))
    if not matches:
        if collection.stdout:
            print(collection.stdout)
        print("::error::could not read the pytest collection count")
        return 2

    count = int(matches[-1].group("count"))
    print(f"Collected {count} tests; required minimum is {args.minimum}.")
    if count < args.minimum:
        print(f"::error::test collection regressed from the required floor ({count} < {args.minimum})")
        return 3

    coverage_xml = args.coverage_xml.resolve()
    coverage_xml.parent.mkdir(parents=True, exist_ok=True)
    command = [sys.executable, "-m", "pytest", "-q"]
    for source in args.coverage_source:
        command.append(f"--cov={source}")
    command.extend(
        [
            "--cov-branch",
            "--cov-report=term-missing:skip-covered",
            f"--cov-report=xml:{coverage_xml}",
        ]
    )
    return _run(command, cwd).returncode


if __name__ == "__main__":
    raise SystemExit(main())
