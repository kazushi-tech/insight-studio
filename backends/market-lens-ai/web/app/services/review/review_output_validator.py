"""Validates review output against the contract schema."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field

from ...schemas.review_result import ReviewResult
from .review_prompt_builder import BANNER_RUBRIC_IDS, LP_RUBRIC_IDS, LP_DEPENDENT_RUBRIC_IDS

logger = logging.getLogger("market-lens")

# Rubric ID sets keyed by review_type — single source of truth from prompt builder
RUBRIC_SETS: dict[str, set[str]] = {
    "banner_review": set(BANNER_RUBRIC_IDS),
    "ad_lp_review": set(LP_RUBRIC_IDS),
}


@dataclass
class ValidationIssue:
    severity: str  # "error" | "warning" | "info"
    message: str


@dataclass
class ValidationReport:
    valid: bool = True
    issues: list[ValidationIssue] = field(default_factory=list)

    def add(self, severity: str, message: str) -> None:
        self.issues.append(ValidationIssue(severity=severity, message=message))
        if severity == "error":
            self.valid = False


def _try_repair_json(text: str) -> str | None:
    """Attempt lightweight JSON repair for common LLM output issues.

    Handles:
    - Trailing commas before } or ]
    - Truncated response (unclosed brackets/braces)
    - Control characters inside strings

    Returns repaired text on success, None if repair is not possible.
    """
    # Remove control characters (except \n \r \t) that break JSON
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)

    # Remove trailing commas: ,  } or ,  ]
    cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)

    # Try parsing after trailing-comma fix
    try:
        return json.loads(cleaned) and cleaned
    except json.JSONDecodeError:
        pass

    # Truncation repair: count unmatched openers and close them
    # Walk through the string tracking nesting (ignoring chars inside strings)
    stack: list[str] = []
    in_string = False
    escape = False
    for ch in cleaned:
        if escape:
            escape = False
            continue
        if ch == "\\":
            if in_string:
                escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in ("{", "["):
            stack.append(ch)
        elif ch == "}" and stack and stack[-1] == "{":
            stack.pop()
        elif ch == "]" and stack and stack[-1] == "[":
            stack.pop()

    if not stack:
        return None  # balanced but still invalid — can't repair

    # If we're inside a string (odd quote count), close it
    quote_count = cleaned.count('"') - cleaned.count('\\"')
    suffix = ""
    if quote_count % 2 == 1:
        suffix += '"'

    # Close open structures in reverse order
    # First, handle dangling value context (remove trailing incomplete tokens)
    trimmed = cleaned.rstrip()
    # Remove trailing incomplete key-value pairs like  "key": "val
    trimmed = re.sub(r',\s*"[^"]*"?\s*:\s*"?[^"{}[\]]*$', "", trimmed)
    trimmed = re.sub(r',\s*$', "", trimmed)  # remove leftover trailing comma

    for opener in reversed(stack):
        suffix += "}" if opener == "{" else "]"

    repaired = trimmed + suffix
    # Final trailing comma cleanup
    repaired = re.sub(r",\s*([}\]])", r"\1", repaired)

    try:
        json.loads(repaired)
        logger.info("JSON repair succeeded (closed %d bracket(s))", len(stack))
        return repaired
    except json.JSONDecodeError:
        return None


def parse_review_json(raw: str) -> tuple[dict | None, str | None]:
    """Extract and parse JSON from LLM response text.

    The LLM may wrap JSON in markdown code fences — strip them first.
    Includes lightweight repair for common LLM malformations (trailing
    commas, truncated output).
    Returns (parsed_dict, error_message).
    """
    text = raw.strip()
    if not text:
        return None, "Empty LLM response"

    # Strip markdown code fences
    m = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if m:
        text = m.group(1).strip()
    else:
        # Fallback: extract outermost JSON object
        start = text.find('{')
        end = text.rfind('}')
        if start != -1 and end > start:
            text = text[start:end + 1]

    try:
        return json.loads(text), None
    except json.JSONDecodeError as e:
        original_err = str(e)

    # --- Repair attempt ---
    repaired = _try_repair_json(text)
    if repaired is not None:
        try:
            data = json.loads(repaired)
            logger.info("Using repaired JSON (original error: %s)", original_err)
            return data, None
        except json.JSONDecodeError:
            pass

    logger.warning("JSON parse failed (repair also failed), raw[:500]=%s", raw[:500])
    return None, f"JSON parse error: {original_err}"


def _strip_comment_keys(data: dict) -> dict:
    """Remove comment-like keys (e.g. '// ...') that LLMs sometimes inject."""
    return {k: v for k, v in data.items() if not k.startswith("//")}


def validate_review_output(data: dict) -> ValidationReport:
    """Validate a review output dict against the contract.

    Returns a ValidationReport with issues.
    """
    report = ValidationReport()
    data = _strip_comment_keys(data)

    # 1. Try Pydantic validation (structural)
    try:
        ReviewResult(**data)
    except Exception as e:
        report.add("error", f"Schema validation failed: {e}")
        return report

    # 2. Evidence must not be empty (unless keep_as_is/test_ideas which are now optional)
    if not data.get("evidence"):
        report.add("error", "evidence array is empty")

    # 3. good_points should come before improvements (ordering hint — not structural)
    # This is a review style check, not schema

    # 4. Check rubric_scores completeness and membership
    scores = data.get("rubric_scores", [])
    if len(scores) < 1:
        report.add("error", "rubric_scores is empty")
    else:
        review_type = data.get("review_type", "")
        expected = RUBRIC_SETS.get(review_type)
        lp_dependent = set(LP_DEPENDENT_RUBRIC_IDS)
        if expected is not None:
            actual_ids = {s["rubric_id"] for s in scores if isinstance(s, dict) and "rubric_id" in s}
            missing = expected - actual_ids
            unexpected = actual_ids - expected

            # Partition missing into LP-dependent (auto-fill) and required (error)
            missing_lp_dep = missing & lp_dependent
            missing_required = missing - lp_dependent

            # Auto-fill LP-dependent missing rubrics with score: null
            if missing_lp_dep:
                for rid in sorted(missing_lp_dep):
                    scores.append({
                        "rubric_id": rid,
                        "score": None,
                        "comment": "LPデータ取得制限により評価不能（AI出力に欠落していたため自動補完）",
                    })
                data["rubric_scores"] = scores
                report.add("warning", f"Auto-filled missing LP-dependent rubric IDs with score=null: {sorted(missing_lp_dep)}")

            if missing_required:
                report.add("error", f"Missing required rubric IDs: {sorted(missing_required)}")
            if unexpected:
                report.add("error", f"Unexpected rubric IDs: {sorted(unexpected)}")

        # 5. Warn if non-LP-dependent items have null scores
        lp_dependent = set(LP_DEPENDENT_RUBRIC_IDS)
        for s in scores:
            if not isinstance(s, dict):
                continue
            rid = s.get("rubric_id", "")
            if s.get("score") is None and rid not in lp_dependent:
                report.add("warning", f"Null score on non-LP-dependent rubric: {rid}")

    return report
