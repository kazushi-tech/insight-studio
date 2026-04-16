"""Commentary guardrail — detects forbidden expressions and destructive commentary."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ...schemas.review_result import ReviewResult

# Forbidden claim patterns (from evidence-policy.md)
FORBIDDEN_PATTERNS: list[tuple[str, str]] = [
    # (regex_pattern, description)
    (r"必ず効果が出", "効果の断定"),
    (r"確実に.{0,10}(改善|向上|増加)", "効果の断定"),
    (r"CVR\s*が\s*上がります", "効果の断定"),
    (r"クリック率が\s*(改善|向上)\s*します", "効果の断定"),
    (r"必ず.{0,10}(上がる|伸びる|増える)", "効果の断定"),
    (r"業界では.{0,20}常識", "未確認の業界常識"),
    (r"一般的に.{0,20}(最も|もっとも)効果的", "未確認の業界常識"),
    (r"ベストプラクティスとして.{0,20}(すべき|べき)", "未確認のベストプラクティス"),
    (r"研究によると(?!.*出典)", "出所不明の引用"),
    (r"データで証明されている", "出所不明の引用"),
    (r"専門家によれば(?!.*氏|.*名)", "出所不明の引用"),
    (r"(そのまま|丸ごと).{0,10}(コピー|真似|パクり)", "競合表現の転用"),
]

# Destructive commentary patterns
DESTRUCTIVE_PATTERNS: list[tuple[str, str]] = [
    (r"全く(ダメ|駄目|使えない|話にならない)", "全否定表現"),
    (r"最悪", "全否定表現"),
    (r"やり直し(た方がいい|すべき|てください)", "全否定に近い表現"),
    (r"素人(が作った|レベル|感丸出し)", "侮辱的表現"),
    (r"センスが(ない|悪い|ゼロ)", "侮辱的表現"),
]


@dataclass
class GuardrailViolation:
    severity: str  # "error" | "warning"
    field: str
    matched_text: str
    category: str


@dataclass
class GuardrailReport:
    clean: bool = True
    violations: list[GuardrailViolation] = field(default_factory=list)

    def add(self, severity: str, field_name: str, matched: str, category: str) -> None:
        self.violations.append(
            GuardrailViolation(
                severity=severity,
                field=field_name,
                matched_text=matched,
                category=category,
            )
        )
        if severity == "error":
            self.clean = False


def check_commentary_guardrails(result: ReviewResult) -> GuardrailReport:
    """Scan all text fields in review output for forbidden / destructive expressions."""
    report = GuardrailReport()

    # Collect text fields to scan
    texts_to_scan: list[tuple[str, str]] = []

    texts_to_scan.append(("summary", result.summary))

    for i, gp in enumerate(result.good_points):
        texts_to_scan.append((f"good_points[{i}].point", gp.point))
        texts_to_scan.append((f"good_points[{i}].reason", gp.reason))

    for i, k in enumerate(result.keep_as_is):
        texts_to_scan.append((f"keep_as_is[{i}].point", k.point))
        texts_to_scan.append((f"keep_as_is[{i}].reason", k.reason))

    for i, imp in enumerate(result.improvements):
        texts_to_scan.append((f"improvements[{i}].point", imp.point))
        texts_to_scan.append((f"improvements[{i}].reason", imp.reason))
        texts_to_scan.append((f"improvements[{i}].action", imp.action))

    for i, t in enumerate(result.test_ideas):
        texts_to_scan.append((f"test_ideas[{i}].hypothesis", t.hypothesis))
        texts_to_scan.append((f"test_ideas[{i}].expected_impact", t.expected_impact))

    for i, rs in enumerate(result.rubric_scores):
        texts_to_scan.append((f"rubric_scores[{i}].comment", rs.comment))

    # Scan for forbidden patterns
    for field_name, text in texts_to_scan:
        for pattern, category in FORBIDDEN_PATTERNS:
            m = re.search(pattern, text)
            if m:
                report.add("error", field_name, m.group(0), category)

        for pattern, category in DESTRUCTIVE_PATTERNS:
            m = re.search(pattern, text)
            if m:
                report.add("error", field_name, m.group(0), category)

    return report
