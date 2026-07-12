"""Generate deterministic OpenAPI evidence for both FastAPI services."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


MARKER = "__INSIGHT_STUDIO_OPENAPI__="
SERVICES = {
    "ads": {
        "cwd": "backends/ads-insights",
        "module": "web.app.backend_api",
    },
    "ml": {
        "cwd": "backends/market-lens-ai",
        "module": "web.app.main",
    },
}
FORBIDDEN_PATH_FRAGMENTS = ("google_ads", "google-ads", "todokukun")


def _load_spec(root: Path, cwd: str, module: str) -> dict:
    code = (
        "import json; "
        f"from {module} import app; "
        f"print({MARKER!r} + json.dumps(app.openapi(), sort_keys=True, separators=(',', ':')))"
    )
    env = {
        **os.environ,
        "ENVIRONMENT": "test",
        "APP_ENV": "test",
        "JWT_SECRET": "ci-openapi-contract-only",
    }
    completed = subprocess.run(
        [sys.executable, "-c", code],
        cwd=root / cwd,
        env=env,
        check=False,
        text=True,
        capture_output=True,
    )
    payload = next(
        (line[len(MARKER):] for line in completed.stdout.splitlines() if line.startswith(MARKER)),
        None,
    )
    if completed.returncode != 0 or payload is None:
        detail = completed.stderr.strip().splitlines()[-1:] or ["OpenAPI import produced no snapshot"]
        raise RuntimeError(f"{module}: {detail[0]}")
    return json.loads(payload)


def _assert_contract(service: str, spec: dict, required: dict[str, set[str]]) -> None:
    paths = spec.get("paths", {})
    for path, methods in required.items():
        missing = methods - set(paths.get(path, {}))
        if missing:
            raise AssertionError(f"{service}: missing {path} methods {sorted(missing)}")
    normalized_paths = "\n".join(paths).lower()
    for fragment in FORBIDDEN_PATH_FRAGMENTS:
        if fragment in normalized_paths:
            raise AssertionError(f"{service}: frozen integration path detected: {fragment}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--write-baseline",
        action="store_true",
        help="replace the committed full-spec hash baseline after an intentional API review",
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    contract_path = root / "docs" / "contracts" / "openapi.required.json"
    baseline_path = root / "docs" / "contracts" / "openapi.snapshot.sha256.json"

    manifest: dict[str, dict] = {}
    try:
        raw_contract = json.loads(contract_path.read_text(encoding="utf-8"))
        if set(raw_contract) != set(SERVICES):
            raise AssertionError("OpenAPI required contract must define exactly ads and ml")
        for service, config in SERVICES.items():
            spec = _load_spec(root, config["cwd"], config["module"])
            service_contract = raw_contract.get(service)
            if not isinstance(service_contract, dict):
                raise AssertionError(f"{service}: OpenAPI required contract must be an object")
            required = {
                str(path): {str(method).lower() for method in methods}
                for path, methods in service_contract.items()
                if isinstance(methods, list)
            }
            if len(required) != len(service_contract):
                raise AssertionError(f"{service}: every required path must contain a method list")
            _assert_contract(service, spec, required)
            serialized = json.dumps(spec, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
            output = output_dir / f"{service}.openapi.json"
            output.write_text(serialized, encoding="utf-8")
            manifest[service] = {
                "sha256": hashlib.sha256(serialized.encode("utf-8")).hexdigest(),
                "paths": len(spec.get("paths", {})),
                "schemas": len(spec.get("components", {}).get("schemas", {})),
            }
            print(f"{service}: {manifest[service]['paths']} paths, sha256={manifest[service]['sha256']}")

        if args.write_baseline:
            baseline_path.write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            print(f"OpenAPI baseline updated: {baseline_path.relative_to(root)}")
        else:
            baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
            if set(baseline) != set(SERVICES):
                raise AssertionError("OpenAPI snapshot baseline must define exactly ads and ml")
            for service in SERVICES:
                expected = baseline.get(service)
                actual = manifest[service]
                if not isinstance(expected, dict):
                    raise AssertionError(f"{service}: OpenAPI snapshot baseline must be an object")
                for field in ("sha256", "paths", "schemas"):
                    if expected.get(field) != actual[field]:
                        raise AssertionError(
                            f"{service}: full OpenAPI snapshot changed ({field}: "
                            f"expected {expected.get(field)!r}, got {actual[field]!r}); "
                            "review the generated artifact and run with --write-baseline only for an intentional contract change"
                        )
    except (OSError, RuntimeError, AssertionError, json.JSONDecodeError) as exc:
        print(f"::error::{exc}")
        return 1

    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
