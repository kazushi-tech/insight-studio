"""Validate hashed Python CI locks and detect stale source requirements."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
LOCK_ROOT = ROOT / ".github" / "requirements"
MANIFEST = LOCK_ROOT / "manifest.json"
LOCK_SOURCES = {
    "backends/ads-insights/requirements.lock": (
        ".github/requirements/known-good-constraints.txt",
        "backends/ads-insights/requirements.in",
        "backends/ads-insights/requirements.txt",
    ),
    "backends/market-lens-ai/requirements.lock": (
        ".github/requirements/known-good-constraints.txt",
        "backends/market-lens-ai/requirements.in",
        "backends/market-lens-ai/requirements.txt",
    ),
    ".github/requirements/ads-ci.lock": (
        ".github/requirements/known-good-constraints.txt",
        ".github/requirements/ads-ci.in",
        "backends/ads-insights/requirements.in",
    ),
    ".github/requirements/ml-ci.lock": (
        ".github/requirements/known-good-constraints.txt",
        ".github/requirements/ml-ci.in",
        "backends/market-lens-ai/requirements.in",
        "backends/market-lens-ai/requirements-dev.txt",
    ),
    ".github/requirements/security-schema-ci.lock": (
        ".github/requirements/known-good-constraints.txt",
        ".github/requirements/security-schema-ci.in",
        "backends/ads-insights/requirements.in",
        "backends/market-lens-ai/requirements.in",
        "backends/market-lens-ai/requirements-dev.txt",
    ),
}
PACKAGE_LINE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*==[^\s;\\]+(?:\s*;[^\\]+)?\s*\\?$", re.MULTILINE)
UNSAFE_SPECIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*(?:>=|<=|~=|!=|>|<|\s+@\s+)", re.MULTILINE)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _validate_lock(path: Path) -> int:
    text = path.read_text(encoding="utf-8")
    if UNSAFE_SPECIFIER.search(text):
        raise AssertionError(f"{path.relative_to(ROOT)} contains a non-exact requirement")
    starts = list(PACKAGE_LINE.finditer(text))
    if not starts:
        raise AssertionError(f"{path.relative_to(ROOT)} contains no exact packages")
    for index, match in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(text)
        block = text[match.start():end]
        if "--hash=sha256:" not in block:
            package = match.group(0).split("==", 1)[0]
            raise AssertionError(f"{path.relative_to(ROOT)}:{package} has no sha256 hash")
    return len(starts)


def _snapshot() -> dict[str, dict]:
    snapshot: dict[str, dict] = {}
    for lock_name, source_names in LOCK_SOURCES.items():
        lock_path = ROOT / lock_name
        package_count = _validate_lock(lock_path)
        snapshot[lock_name] = {
            "lock_sha256": _sha256(lock_path),
            "package_count": package_count,
            "sources": {
                name: _sha256(ROOT / name)
                for name in source_names
            },
        }
    return snapshot


def _validate_production_wrappers() -> None:
    expected = "--require-hashes\n-r requirements.lock\n"
    for relative in (
        "backends/ads-insights/requirements.txt",
        "backends/market-lens-ai/requirements.txt",
    ):
        actual = (ROOT / relative).read_text(encoding="utf-8").replace("\r\n", "\n")
        if actual != expected:
            raise AssertionError(f"{relative} must install only its exact hashed requirements.lock")


def _validate_vercel_frozen_manifests() -> None:
    """Keep Vercel's directly parseable manifest identical to the hashed lock."""
    for backend in ("ads-insights", "market-lens-ai"):
        directory = ROOT / "backends" / backend
        lock_path = directory / "requirements.lock"
        frozen_path = directory / "requirements.frozen.txt"
        if frozen_path.read_bytes() != lock_path.read_bytes():
            raise AssertionError(
                f"{frozen_path.relative_to(ROOT)} must be an exact mirror of "
                f"{lock_path.relative_to(ROOT)}"
            )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--write",
        action="store_true",
        help="rewrite the manifest after intentionally regenerating all locks",
    )
    args = parser.parse_args()
    try:
        _validate_production_wrappers()
        _validate_vercel_frozen_manifests()
        snapshot = _snapshot()
        if args.write:
            MANIFEST.write_text(
                json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            print(f"Wrote {MANIFEST.relative_to(ROOT)}")
            return 0
        expected = json.loads(MANIFEST.read_text(encoding="utf-8"))
        if snapshot != expected:
            raise AssertionError(
                "Python CI locks are missing, modified, or stale; regenerate every lock and run "
                "python scripts/check_python_locks.py --write"
            )
    except (AssertionError, FileNotFoundError, json.JSONDecodeError) as exc:
        print(f"::error::{exc}")
        return 1
    counts = ", ".join(
        f"{name}={details['package_count']}"
        for name, details in snapshot.items()
    )
    print(f"Exact hashed Python lock gate passed ({counts}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
