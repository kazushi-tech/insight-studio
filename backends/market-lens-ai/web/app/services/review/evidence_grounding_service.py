"""Evidence grounding validation — ensures proposals are grounded in allowed sources."""

from __future__ import annotations

from dataclasses import dataclass, field

from ...schemas.review_result import EvidenceType, ReviewResult

ALLOWED_EVIDENCE_TYPES = frozenset(e.value for e in EvidenceType)

# Vague source patterns that indicate ungrounded evidence
VAGUE_SOURCE_PATTERNS = [
    "一般的に",
    "通常",
    "普通は",
    "業界では",
    "ベストプラクティス",
    "研究によると",
    "データで証明",
    "専門家によれば",
]


@dataclass
class GroundingIssue:
    severity: str  # "error" | "warning" | "info"
    field: str
    message: str


@dataclass
class GroundingReport:
    valid: bool = True
    issues: list[GroundingIssue] = field(default_factory=list)

    def add(self, severity: str, field_name: str, message: str) -> None:
        self.issues.append(GroundingIssue(severity=severity, field=field_name, message=message))
        if severity == "error":
            self.valid = False


def validate_evidence_grounding(result: ReviewResult) -> GroundingReport:
    """Check that evidence meets the evidence-policy.md requirements.

    Severity levels (from evidence-policy.md):
    - error: forbidden claim usage, evidence array empty → reject
    - warning: improvement without evidence → recommend fix
    - info: evidence_source too brief → inform
    """
    report = GroundingReport()

    # 1. Evidence array must not be empty
    if not result.evidence:
        report.add("error", "evidence", "evidence array is empty — review must be rejected")
        return report

    # 2. All evidence_type values must be from allowed set
    for i, ev in enumerate(result.evidence):
        if ev.evidence_type.value not in ALLOWED_EVIDENCE_TYPES:
            report.add(
                "error",
                f"evidence[{i}].evidence_type",
                f"Unknown evidence type: {ev.evidence_type}",
            )

    # 3. Check for vague source patterns in evidence_source
    for i, ev in enumerate(result.evidence):
        for pattern in VAGUE_SOURCE_PATTERNS:
            if pattern in ev.evidence_source:
                report.add(
                    "error",
                    f"evidence[{i}].evidence_source",
                    f"Vague source expression detected: '{pattern}' in '{ev.evidence_source}'",
                )

    # 4. Check that improvements have at least some related evidence (advisory)
    evidence_texts = {ev.evidence_text for ev in result.evidence}
    if result.improvements and not evidence_texts:
        report.add(
            "warning",
            "improvements",
            "Improvements exist but no evidence texts found to support them",
        )

    # 5. Brief evidence_source check (info level)
    for i, ev in enumerate(result.evidence):
        if len(ev.evidence_source) < 5:
            report.add(
                "info",
                f"evidence[{i}].evidence_source",
                f"Evidence source is very brief: '{ev.evidence_source}'",
            )

    return report
