"""Deterministic, evidence-bound decision rules for customer reports.

The rules deliberately describe only measured changes.  They never infer why a
change happened and never turn site traffic into an advertising claim.  AI may
rephrase these statements later, but it must not add unsupported conclusions.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping, Sequence


_MEASURED = frozenset({"measured", "measured_zero"})
_PREFERRED_METRIC_ORDER = (
    "conversions",
    "sessions",
    "users",
    "page_views",
    "searches",
    "engagement_seconds",
    "avg_daily_users",
    "avg_daily_sessions",
    "avg_daily_page_views",
)


@dataclass(frozen=True)
class DecisionBundle:
    conclusions: tuple[dict[str, Any], ...]
    actions: tuple[dict[str, Any], ...]
    caveats: tuple[str, ...]


def _decimal(value: Any) -> Decimal | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None
    return number if number.is_finite() else None


def _format_number(value: Any) -> str:
    number = _decimal(value)
    if number is None:
        return "データなし"
    if number == number.to_integral_value():
        return f"{int(number):,}"
    return f"{float(number):,.1f}".rstrip("0").rstrip(".")


def _metric_rank(metric: Mapping[str, Any]) -> tuple[int, str]:
    key = str(metric.get("key") or "")
    try:
        rank = _PREFERRED_METRIC_ORDER.index(key)
    except ValueError:
        rank = len(_PREFERRED_METRIC_ORDER)
    return rank, key


def _metric_availability(report: Mapping[str, Any]) -> dict[str, str]:
    availability = report.get("availability")
    if not isinstance(availability, Mapping):
        return {}
    items = availability.get("metrics")
    if not isinstance(items, Sequence) or isinstance(items, (str, bytes)):
        return {}
    return {
        str(item.get("key")): str(item.get("status"))
        for item in items
        if isinstance(item, Mapping) and item.get("key")
    }


def _statement_for_metric(metric: Mapping[str, Any], status: str) -> tuple[dict[str, Any], dict[str, Any]]:
    key = str(metric["key"])
    label = str(metric.get("label") or key)
    evidence_key = str(metric["evidence_key"])
    value = _decimal(metric.get("value"))
    comparison = metric.get("comparison") if isinstance(metric.get("comparison"), Mapping) else {}
    comparison_status = str(comparison.get("status") or "not_available")
    percent = _decimal(comparison.get("percent_change"))

    conclusion: dict[str, Any]
    action: dict[str, Any]
    if comparison_status == "available" and percent is not None:
        if percent >= Decimal("10"):
            conclusion = {
                "kind": "measured_increase",
                "title": f"{label}が前の期間より増えています",
                "body": f"{label}は前の期間と比べて{_format_number(abs(percent))}%増えました。変化の要因までは、このデータだけでは判断できません。",
                "severity": "positive",
                "confidence": "high",
                "evidence_keys": [evidence_key],
            }
            action = {
                "priority": "medium",
                "title": f"{label}が増えた内訳を確認する",
                "reason": "伸びを再現できるか判断するため、流入元やページなどの内訳を確認します。",
                "confidence": "medium",
                "timeframe": "今週",
                "success_metric": label,
                "evidence_keys": [evidence_key],
            }
        elif percent <= Decimal("-10"):
            conclusion = {
                "kind": "measured_decrease",
                "title": f"{label}が前の期間より減っています",
                "body": f"{label}は前の期間と比べて{_format_number(abs(percent))}%減りました。変化の要因までは、このデータだけでは判断できません。",
                "severity": "attention",
                "confidence": "high",
                "evidence_keys": [evidence_key],
            }
            action = {
                "priority": "high",
                "title": f"{label}が減った内訳を確認する",
                "reason": "どの流入元やページで変化したかを分けて、対応が必要な箇所を見つけます。",
                "confidence": "medium",
                "timeframe": "今週",
                "success_metric": label,
                "evidence_keys": [evidence_key],
            }
        else:
            conclusion = {
                "kind": "measured_stable",
                "title": f"{label}に大きな変化はありません",
                "body": f"{label}の前期間比は{_format_number(percent)}%で、今回の基準では大きな増減は確認されませんでした。",
                "severity": "neutral",
                "confidence": "high",
                "evidence_keys": [evidence_key],
            }
            action = {
                "priority": "low",
                "title": f"{label}を次の期間も確認する",
                "reason": "一時的な変動か継続傾向かを判断するため、同じ条件で比較を続けます。",
                "confidence": "high",
                "timeframe": "次回レポート時",
                "success_metric": label,
                "evidence_keys": [evidence_key],
            }
    elif comparison_status == "baseline_zero" and value is not None:
        conclusion = {
            "kind": "measured_from_zero",
            "title": f"{label}が前の期間の0から確認できました",
            "body": f"前の期間は0でしたが、今回は{_format_number(value)}を確認しました。0を基準にした増加率は算出していません。",
            "severity": "positive",
            "confidence": "high",
            "evidence_keys": [evidence_key],
        }
        action = {
            "priority": "medium",
            "title": f"{label}が生まれた内訳を確認する",
            "reason": "新しく確認できた動きを維持できるか判断するため、内訳を確認します。",
            "confidence": "medium",
            "timeframe": "今週",
            "success_metric": label,
            "evidence_keys": [evidence_key],
        }
    elif status == "measured_zero":
        conclusion = {
            "kind": "measured_zero",
            "title": f"今回は{label}が確認されませんでした",
            "body": f"計測された結果は0でした。未設定や取得失敗とは区別して表示しています。",
            "severity": "attention",
            "confidence": "high",
            "evidence_keys": [evidence_key],
        }
        action = {
            "priority": "high" if key == "conversions" else "medium",
            "title": f"{label}につながる導線を確認する",
            "reason": "計測結果が0のため、対象期間と利用者の動きを順に確認します。",
            "confidence": "medium",
            "timeframe": "今週",
            "success_metric": label,
            "evidence_keys": [evidence_key],
        }
    else:
        conclusion = {
            "kind": "measured_current_period",
            "title": f"今回は{label}を確認できました",
            "body": f"対象期間の{label}は{_format_number(value)}です。比較期間がないため、増減傾向までは判断できません。",
            "severity": "neutral",
            "confidence": "high",
            "evidence_keys": [evidence_key],
        }
        action = {
            "priority": "low",
            "title": f"次の期間も{label}を確認する",
            "reason": "同じ条件で比較できるデータを増やし、継続的な変化かを判断します。",
            "confidence": "high",
            "timeframe": "次回レポート時",
            "success_metric": label,
            "evidence_keys": [evidence_key],
        }
    return conclusion, action


def derive_report_decisions(report: Mapping[str, Any]) -> DecisionBundle:
    """Return at most three deterministic conclusions and actions.

    Every returned statement cites an evidence key already present in the
    canonical report.  When nothing measurable exists, no unsupported
    statement is fabricated; a customer-facing caveat explains the hold.
    """
    availability = _metric_availability(report)
    evidence_keys = {
        str(item.get("key"))
        for item in report.get("evidence", ())
        if isinstance(item, Mapping) and item.get("key")
    }
    metrics = [
        item
        for item in report.get("metrics", ())
        if isinstance(item, Mapping)
        and availability.get(str(item.get("key"))) in _MEASURED
        and str(item.get("evidence_key") or "") in evidence_keys
    ]
    metrics.sort(key=_metric_rank)

    conclusions: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []
    for metric in metrics[:3]:
        conclusion, action = _statement_for_metric(
            metric,
            availability[str(metric["key"])],
        )
        conclusions.append(conclusion)
        actions.append(action)

    caveats = [
        "このレポートはサイト内で計測された動きを示します。施策との因果関係や費用対効果は、このデータだけでは判断できません。"
    ]
    if not conclusions:
        caveats.append(
            "判断に使える計測値がありません。計測設定、対象期間、データ取得状態を確認してください。"
        )
    elif all(
        str(metric.get("comparison", {}).get("status")) == "not_available"
        for metric in metrics[:3]
    ):
        caveats.append(
            "比較できる期間のデータがないため、増減傾向はまだ判断できません。"
        )

    return DecisionBundle(tuple(conclusions), tuple(actions), tuple(caveats))
