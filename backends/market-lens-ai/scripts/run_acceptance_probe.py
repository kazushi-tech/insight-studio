"""Acceptance probe — run real Gemini banner reviews for human scoring.

This script uploads each banner fixture, runs a real Gemini review (NOT smoke mode),
validates the output shape, and saves results to acceptance_packet/reviews/.

Prerequisites:
  - GEMINI_API_KEY must be set (or passed via --api-key)
  - Backend must NOT be in SMOKE_MODE
  - .venv activated

Usage:
  .venv/Scripts/python scripts/run_acceptance_probe.py
  .venv/Scripts/python scripts/run_acceptance_probe.py --fixture 1
  .venv/Scripts/python scripts/run_acceptance_probe.py --api-key YOUR_KEY
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


async def run_single_probe(fixture_path: Path, output_dir: Path, api_key: str | None) -> dict:
    """Run a real Gemini banner review for one fixture and save the result.

    Uses the same validation path as production: prompt builder -> Gemini ->
    parse -> schema validate -> evidence grounding -> commentary guardrail.
    """
    from web.app.gemini_client import call_gemini  # noqa: E402
    from web.app.services.review.review_prompt_builder import build_banner_review_prompt  # noqa: E402
    from web.app.services.review.review_output_validator import parse_review_json, validate_review_output  # noqa: E402
    from web.app.services.review.evidence_grounding_service import validate_evidence_grounding  # noqa: E402
    from web.app.services.review.commentary_guardrail import check_commentary_guardrails  # noqa: E402
    from web.app.schemas.review_result import ReviewResult  # noqa: E402

    with open(fixture_path, "r", encoding="utf-8") as f:
        fixture = json.load(f)

    fixture_id = fixture["fixture_id"]
    asset = fixture.get("asset", {})
    print(f"[PROBE] {fixture_id}: Building prompt...")

    # Build the review prompt from fixture data — must pass asset_file_name
    prompt = build_banner_review_prompt(
        asset_file_name=asset.get("file_name", "unknown.png"),
        asset_width=asset.get("width"),
        asset_height=asset.get("height"),
        brand_info=fixture.get("brand_info", ""),
        operator_memo=fixture.get("operator_memo", ""),
    )

    print(f"[PROBE] {fixture_id}: Calling Gemini (real, not smoke)...")

    # Call real Gemini
    env_key = api_key or os.environ.get("GEMINI_API_KEY", "")
    if not env_key:
        return {
            "fixture_id": fixture_id,
            "status": "SKIPPED",
            "reason": "No GEMINI_API_KEY available",
        }

    try:
        raw_text, usage = await call_gemini(
            prompt=prompt,
            api_key=env_key,
        )
    except Exception as e:
        return {
            "fixture_id": fixture_id,
            "status": "ERROR",
            "reason": f"Gemini call failed: {e}",
        }

    # Parse and validate — production-equivalent path
    print(f"[PROBE] {fixture_id}: Parsing response...")
    try:
        data, parse_err = parse_review_json(raw_text)
        if parse_err or data is None:
            return {
                "fixture_id": fixture_id,
                "status": "PARSE_ERROR",
                "reason": f"JSON parse failed: {parse_err}",
                "raw_snippet": raw_text[:500] if raw_text else "empty",
            }

        # Schema validation (same as banner_review_service.py)
        report = validate_review_output(data)
        validation_notes = []
        if not report.valid:
            errors = "; ".join(i.message for i in report.issues if i.severity == "error")
            validation_notes.append(f"Schema errors: {errors}")

        # Pydantic model construction
        result_model = ReviewResult(**data)

        # Evidence grounding check
        grounding = validate_evidence_grounding(result_model)
        if not grounding.valid:
            g_errors = "; ".join(i.message for i in grounding.issues if i.severity == "error")
            validation_notes.append(f"Evidence grounding: {g_errors}")

        # Commentary guardrail check
        guardrail = check_commentary_guardrails(result_model)
        if not guardrail.clean:
            g_violations = "; ".join(
                f"{v.category}: '{v.matched_text}' in {v.field}"
                for v in guardrail.violations
                if v.severity == "error"
            )
            if g_violations:
                validation_notes.append(f"Commentary guardrail: {g_violations}")

        if not report.valid:
            status = "WARN"
            notes = " | ".join(validation_notes)
        elif validation_notes:
            status = "WARN"
            notes = " | ".join(validation_notes)
        else:
            status = "PASS"
            notes = "Shape valid, rubric complete, grounding OK, guardrails clean"

        parsed = data
    except Exception as e:
        parsed = {"raw": raw_text[:500] if raw_text else "empty"}
        status = "PARSE_ERROR"
        notes = str(e)

    # Save result
    output_file = output_dir / f"{fixture_id}_review.json"
    result_bundle = {
        "fixture_id": fixture_id,
        "fixture_file": fixture_path.name,
        "probe_date": datetime.now().isoformat(),
        "status": status,
        "notes": notes,
        "review_output": parsed,
        "usage": {
            "prompt_tokens": usage.prompt_tokens,
            "completion_tokens": usage.completion_tokens,
            "model": usage.model,
        },
    }
    output_file.write_text(json.dumps(result_bundle, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[PROBE] {fixture_id}: {status} -> {output_file.name}")
    return {"fixture_id": fixture_id, "status": status, "notes": notes}


async def main():
    parser = argparse.ArgumentParser(description="Run real Gemini banner reviews for acceptance scoring")
    parser.add_argument("--fixture", type=int, help="Run only fixture N (1-12)")
    parser.add_argument("--api-key", type=str, help="Gemini API key (overrides env)")
    args = parser.parse_args()

    # Ensure not in smoke mode
    if os.environ.get("SMOKE_MODE", "").strip() in ("1", "true", "yes"):
        print("ERROR: SMOKE_MODE is enabled. Disable it for real Gemini probes.")
        sys.exit(1)

    fixture_dir = PROJECT_ROOT / "tests" / "fixtures" / "creative_review"
    output_dir = PROJECT_ROOT / "tmp_review_assets" / "acceptance_packet" / "reviews"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Collect fixtures
    if args.fixture:
        fixtures = [fixture_dir / f"banner_review_input_{args.fixture:02d}.json"]
    else:
        fixtures = sorted(fixture_dir.glob("banner_review_input_*.json"))

    if not fixtures:
        print("No banner fixtures found.")
        sys.exit(1)

    print(f"Running acceptance probe for {len(fixtures)} fixture(s)...")
    print(f"Output: {output_dir}")
    print()

    results = []
    for fp in fixtures:
        if not fp.exists():
            print(f"SKIP: {fp} not found")
            continue
        r = await run_single_probe(fp, output_dir, args.api_key)
        results.append(r)

    # Summary
    print()
    print("=" * 60)
    print("ACCEPTANCE PROBE SUMMARY")
    print("=" * 60)
    total = len(results)
    passed = sum(1 for r in results if r["status"] == "PASS")
    warned = sum(1 for r in results if r["status"] == "WARN")
    errors = sum(1 for r in results if r["status"] in ("ERROR", "PARSE_ERROR"))
    skipped = sum(1 for r in results if r["status"] == "SKIPPED")

    for r in results:
        print(f"  {r['fixture_id']}: {r['status']}")

    print()
    print(f"Total: {total} | PASS: {passed} | WARN: {warned} | ERROR: {errors} | SKIPPED: {skipped}")

    # Save summary
    summary_file = output_dir / "probe_summary.json"
    summary_file.write_text(json.dumps({
        "probe_date": datetime.now().isoformat(),
        "total": total,
        "pass": passed,
        "warn": warned,
        "error": errors,
        "skipped": skipped,
        "results": results,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Summary saved: {summary_file}")


if __name__ == "__main__":
    asyncio.run(main())
