"""Diff analyzer — detect headline, CTA, and design changes (Phase 7)."""

from __future__ import annotations

from ..schemas.watchlist_v2 import DiffResult


class DiffAnalyzer:
    """Compares snapshots and enriches DiffResult with change details."""

    def analyze(self, diff: DiffResult, new_snapshot: dict) -> DiffResult:
        """Analyze snapshot data and populate change categories."""
        headline_changes: list[str] = []
        cta_changes: list[str] = []
        design_changes: list[str] = []
        parts: list[str] = []

        headlines = new_snapshot.get("headlines", [])
        if headlines:
            headline_changes.append(f"Current headlines: {', '.join(headlines[:5])}")
            parts.append(f"{len(headlines)} headline(s) detected")

        ctas = new_snapshot.get("ctas", [])
        if ctas:
            cta_changes.append(f"Current CTAs: {', '.join(ctas[:5])}")
            parts.append(f"{len(ctas)} CTA(s) detected")

        title = new_snapshot.get("title", "")
        if title:
            design_changes.append(f"Page title: {title}")

        meta = new_snapshot.get("meta_description", "")
        if meta:
            design_changes.append(f"Meta description updated")

        summary = "; ".join(parts) if parts else "Content changed"

        return diff.model_copy(
            update={
                "headline_changes": headline_changes,
                "cta_changes": cta_changes,
                "design_changes": design_changes,
                "summary": summary,
            }
        )
