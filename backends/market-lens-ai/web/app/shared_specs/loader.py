"""YAML loader for shared evaluation specs.

Specs are loaded once per process and cached. Call ``clear_cache()`` in tests
that mutate spec files on disk.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

_SPEC_DIR = Path(__file__).parent


@dataclass(frozen=True)
class EvaluationAxis:
    key: str
    label: str
    description: str
    primary_sources: tuple[str, ...]
    strong_required: tuple[dict, ...]
    strong_boost: tuple[dict, ...]
    weak_any: tuple[dict, ...]
    weak_all: tuple[dict, ...]
    defer_any: tuple[dict, ...]
    defer_all: tuple[dict, ...]


@dataclass(frozen=True)
class TrustTier:
    level: str
    label: str
    weight: int
    description: str
    signal_fields: tuple[str, ...]
    example_markers: tuple[str, ...]


@dataclass(frozen=True)
class KeywordIntent:
    key: str
    label: str
    description: str
    expected_cvr_band: str
    typical_funnel_stage: str
    match_hints: tuple[str, ...]
    examples: tuple[str, ...]


@dataclass(frozen=True)
class EvidenceRule:
    key: str
    display: str
    description: str
    raw: dict = field(default_factory=dict, hash=False, compare=False)


def _read_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"Spec root must be a mapping: {path}")
    return data


def _as_tuple(value: Any) -> tuple:
    if value is None:
        return ()
    if isinstance(value, (list, tuple)):
        return tuple(value)
    return (value,)


@lru_cache(maxsize=1)
def load_evaluation_axes() -> tuple[EvaluationAxis, ...]:
    data = _read_yaml(_SPEC_DIR / "evaluation_axes.yaml")
    axes = []
    for entry in data.get("axes", []):
        strong = entry.get("strong_conditions") or {}
        weak = entry.get("weak_conditions") or {}
        defer = entry.get("defer_when") or {}
        axes.append(
            EvaluationAxis(
                key=entry["key"],
                label=entry["label"],
                description=entry.get("description", ""),
                primary_sources=tuple(entry.get("primary_sources", ())),
                strong_required=_as_tuple(strong.get("required")),
                strong_boost=_as_tuple(strong.get("boost")),
                weak_any=_as_tuple(weak.get("any")),
                weak_all=_as_tuple(weak.get("all")),
                defer_any=_as_tuple(defer.get("any")),
                defer_all=_as_tuple(defer.get("all")),
            )
        )
    if not axes:
        raise ValueError("evaluation_axes.yaml has no axes entries")
    return tuple(axes)


@lru_cache(maxsize=1)
def load_trust_hierarchy() -> tuple[TrustTier, ...]:
    data = _read_yaml(_SPEC_DIR / "trust_hierarchy.yaml")
    tiers = []
    for entry in data.get("tiers", []):
        tiers.append(
            TrustTier(
                level=entry["level"],
                label=entry["label"],
                weight=int(entry.get("weight", 0)),
                description=entry.get("description", ""),
                signal_fields=tuple(entry.get("signal_fields", ())),
                example_markers=tuple(entry.get("example_markers", ())),
            )
        )
    if not tiers:
        raise ValueError("trust_hierarchy.yaml has no tiers")
    return tuple(tiers)


@lru_cache(maxsize=1)
def load_keyword_intent() -> tuple[KeywordIntent, ...]:
    data = _read_yaml(_SPEC_DIR / "keyword_intent.yaml")
    categories = []
    for entry in data.get("categories", []):
        categories.append(
            KeywordIntent(
                key=entry["key"],
                label=entry["label"],
                description=entry.get("description", ""),
                expected_cvr_band=entry.get("expected_cvr_band", ""),
                typical_funnel_stage=entry.get("typical_funnel_stage", ""),
                match_hints=tuple(entry.get("match_hints", ())),
                examples=tuple(entry.get("examples", ())),
            )
        )
    if not categories:
        raise ValueError("keyword_intent.yaml has no categories")
    return tuple(categories)


@lru_cache(maxsize=1)
def load_evidence_labels() -> tuple[EvidenceRule, ...]:
    data = _read_yaml(_SPEC_DIR / "evidence_labels.yaml")
    rules = []
    for entry in data.get("labels", []):
        rules.append(
            EvidenceRule(
                key=entry["key"],
                display=entry["display"],
                description=entry.get("description", ""),
                raw=dict(entry),
            )
        )
    if not rules:
        raise ValueError("evidence_labels.yaml has no labels")
    return tuple(rules)


def clear_cache() -> None:
    load_evaluation_axes.cache_clear()
    load_trust_hierarchy.cache_clear()
    load_keyword_intent.cache_clear()
    load_evidence_labels.cache_clear()
