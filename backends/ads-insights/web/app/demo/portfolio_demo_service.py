"""Response-contract builders for the isolated portfolio demo."""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from .portfolio_demo_fixture import (
    DATA_GAPS,
    DEMO_COMPARISON_PERIOD,
    DEMO_CURRENT_PERIOD,
    DEMO_DATASET_ID,
    DEMO_DATASET_LABEL,
    DEMO_DATA_SOURCE,
    DEMO_PERIODS,
    DEMO_SITE_DISPLAY_NAME,
    DEMO_SITE_URL,
    MONTH_OVER_MONTH,
    NEXT_ACTIONS,
    PERIOD_DATA,
    QUERY_TYPE_INFO,
    QUERY_TYPE_KEYS,
    QUERY_TYPES,
    TRAFFIC_SOURCES,
    chart_groups_for,
    period_metadata,
    report_markdown,
)


_CHART_ID_RE = re.compile(r"^chart_[0-9]{2}$")
_EVIDENCE_QUERY_ORDER = ("pv", "traffic", "cv", "landing", "engagement", "anomaly", "user_attr")
_AI_CITATION_REQUIREMENTS = (
    ("current_pv", DEMO_CURRENT_PERIOD, "pv", "サイト全体 — 主要指標"),
    ("comparison_pv", DEMO_COMPARISON_PERIOD, "pv", "サイト全体 — 主要指標"),
    ("current_inquiries", DEMO_CURRENT_PERIOD, "cv", "問い合わせ — 件数"),
    ("comparison_inquiries", DEMO_COMPARISON_PERIOD, "cv", "問い合わせ — 件数"),
    ("current_inquiry_rate", DEMO_CURRENT_PERIOD, "cv", "問い合わせ — 率"),
    ("comparison_inquiry_rate", DEMO_COMPARISON_PERIOD, "cv", "問い合わせ — 率"),
    ("current_traffic", DEMO_CURRENT_PERIOD, "traffic", "流入元 — 訪問"),
)


def datasets_response() -> dict[str, Any]:
    return {
        "ok": True,
        "datasets": [
            {
                "dataset_id": DEMO_DATASET_ID,
                "label": DEMO_DATASET_LABEL,
                "is_demo": True,
                "data_source": DEMO_DATA_SOURCE,
            }
        ],
        "is_demo": True,
        "data_source": DEMO_DATA_SOURCE,
    }


def query_types_response() -> dict[str, Any]:
    return {
        "ok": True,
        "query_types": deepcopy(list(QUERY_TYPES)),
        "is_demo": True,
        "data_source": DEMO_DATA_SOURCE,
    }


def periods_response(granularity: str = "monthly") -> tuple[dict[str, Any], int]:
    if granularity != "monthly":
        return (
            {
                "ok": False,
                "error": "validation_error",
                "message": "デモデータは月次（monthly）のみ利用できます。",
                "granularity": granularity,
                "available_granularities": ["monthly"],
                "is_demo": True,
                "data_source": DEMO_DATA_SOURCE,
            },
            400,
        )
    periods = [period_metadata(period) for period in DEMO_PERIODS]
    return (
        {
            "ok": True,
            "periods": [item for item in periods if item is not None],
            "granularity": granularity,
            "dataset_id": DEMO_DATASET_ID,
            "table_count": 0,
            "method": DEMO_DATA_SOURCE,
            "methods_tried": [],
            "message": "完全架空データから2期間を取得しました。",
            "is_demo": True,
            "data_source": DEMO_DATA_SOURCE,
        },
        200,
    )


def bq_status_response() -> dict[str, Any]:
    return {
        "ok": True,
        "connected": True,
        "is_demo": True,
        "data_source": DEMO_DATA_SOURCE,
        "dataset_id": DEMO_DATASET_ID,
        "dataset_label": DEMO_DATASET_LABEL,
        "message": "デモデータ利用中",
    }


def _query_info(query_type: str) -> dict[str, str]:
    info = QUERY_TYPE_INFO[query_type]
    return {"key": query_type, "name": info["name"]}


def _query_markdown(query_type: str, period: str) -> str:
    info = QUERY_TYPE_INFO[query_type]
    metadata = period_metadata(period)
    label = metadata["label"] if metadata else period
    return f"## {info['name']}（{label}）\n\n{DEMO_SITE_DISPLAY_NAME}の完全架空データです。"


def _row_count(groups: list[dict[str, Any]]) -> int:
    if not groups:
        return 0
    return max((len(group.get("labels") or []) for group in groups), default=0)


def _execution_summary(query_type: str, groups: list[dict[str, Any]], *, period_available: bool) -> dict[str, Any]:
    if not period_available or not groups:
        return {
            "query_type": query_type,
            "status": "no_data",
            "row_count": 0,
            "chart_group_count": 0,
            "message": "完全架空デモではこの項目を未計測として扱います。",
        }
    return {
        "query_type": query_type,
        "status": "success",
        "row_count": _row_count(groups),
        "chart_group_count": len(groups),
        "message": f"完全架空データから{len(groups)}件のグラフを生成しました。",
    }


def _chart_ids_by_query(groups: list[dict[str, Any]]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for index, group in enumerate(groups):
        query_type = str(group.get("queryType") or group.get("query_type") or "")
        result.setdefault(query_type, []).append(f"chart_{index + 1:02d}")
    return result


def _beginner_report(
    groups: list[dict[str, Any]],
    summary: list[dict[str, Any]],
    period: str,
) -> dict[str, Any]:
    chart_ids = _chart_ids_by_query(groups)
    recommended = [
        chart_ids[query_type][0]
        for query_type in ("pv", "traffic", "cv", "landing")
        if chart_ids.get(query_type)
    ]
    data_gaps = deepcopy(list(DATA_GAPS))
    for item in summary:
        if item.get("status") != "no_data":
            continue
        query_type = str(item.get("query_type") or "unknown")
        data_gaps.append(
            {
                "key": f"{query_type}_unmeasured",
                "label": f"{QUERY_TYPE_INFO.get(query_type, {}).get('name', query_type)}は未計測",
                "impact": "未計測を0件として扱わず、この項目の判断を保留します。",
            }
        )
    if period == DEMO_COMPARISON_PERIOD:
        return {
            "version": "beginner_report_v1",
            "summary_cards": [
                {
                    "type": "what_happened",
                    "title": "比較に使う基準値です",
                    "body": "利用者2,180、訪問2,760、見られた回数4,210を基準として確認します。",
                    "severity": "neutral",
                    "evidence_chart_ids": chart_ids.get("pv", [])[:1],
                },
                {
                    "type": "check_first",
                    "title": "問い合わせの基準値を確認します",
                    "body": "問い合わせは42件、問い合わせ率は1.52%です。この期間だけでは増減を判断しません。",
                    "severity": "neutral",
                    "evidence_chart_ids": chart_ids.get("cv", [])[:2],
                },
                {
                    "type": "data_gap",
                    "title": "電話経由の成果は判断保留です",
                    "body": "電話タップは未計測です。0件として扱いません。",
                    "severity": "warning",
                    "evidence_chart_ids": [],
                },
            ],
            "next_actions": [
                {
                    "priority": "P2",
                    "title": "次の対象期間と比較する",
                    "reason": "基準期間だけでは増減や改善効果を判断できないためです。",
                }
            ],
            "data_gaps": data_gaps[:5],
            "recommended_charts": [
                chart_id
                for query_type in ("pv", "cv")
                for chart_id in chart_ids.get(query_type, [])
            ][:3],
        }

    if period != DEMO_CURRENT_PERIOD:
        return {
            "version": "beginner_report_v1",
            "summary_cards": [
                {
                    "type": "data_gap",
                    "title": "選択した期間のデモデータはありません",
                    "body": "デモでは2026年6月と2026年5月だけを利用できます。",
                    "severity": "warning",
                    "evidence_chart_ids": [],
                }
            ],
            "next_actions": [],
            "data_gaps": data_gaps[:5],
            "recommended_charts": [],
        }

    return {
        "version": "beginner_report_v1",
        "summary_cards": [
            {
                "type": "what_happened",
                "title": "訪問と見られた回数は増えています",
                "body": "訪問は前月比+13.0%、見られた回数は+15.4%です。",
                "severity": "positive",
                "evidence_chart_ids": chart_ids.get("pv", [])[:1],
            },
            {
                "type": "check_first",
                "title": "まず流入元を確認します",
                "body": "もっとも多い流入元は google / organic の1,420訪問です。",
                "severity": "neutral",
                "evidence_chart_ids": chart_ids.get("traffic", [])[:1],
            },
            {
                "type": "so_what",
                "title": "問い合わせ率はほぼ横ばいです",
                "body": "1.52%から1.51%で、前月差は-0.02ポイントです。",
                "severity": "neutral",
                "evidence_chart_ids": chart_ids.get("cv", [])[:1],
            },
            {
                "type": "data_gap",
                "title": "電話経由の成果は判断保留です",
                "body": "電話タップは未計測です。0件として扱いません。",
                "severity": "warning",
                "evidence_chart_ids": [],
            },
        ],
        "next_actions": deepcopy(list(NEXT_ACTIONS)),
        "data_gaps": data_gaps[:5],
        "recommended_charts": recommended[:3],
    }


def single_generate_response(query_type: str, period: str) -> tuple[dict[str, Any], int]:
    if query_type not in QUERY_TYPE_KEYS:
        return (
            {
                "ok": False,
                "error": "validation_error",
                "message": f"未知のクエリタイプ: {query_type}",
                "is_demo": True,
                "data_source": DEMO_DATA_SOURCE,
            },
            400,
        )

    groups = chart_groups_for(query_type, period)
    metadata = period_metadata(period)
    if metadata is None or not groups:
        return (
            {
                "ok": False,
                "error": "no_data",
                "message": f"{query_type} のデモデータは未計測です（期間: {period}）。",
                "data_availability": "partial",
                "missing_reason": "未計測項目を0件として扱いません。",
                "period": period,
                "period_metadata": metadata,
                "available_periods": list(DEMO_PERIODS),
                "is_demo": True,
                "data_source": DEMO_DATA_SOURCE,
            },
            200,
        )

    execution = _execution_summary(query_type, groups, period_available=True)
    response = {
        "ok": True,
        "data_availability": "full",
        "missing_reason": "",
        "report_md": report_markdown(period),
        "chart_data": {"groups": groups},
        "beginner_report": _beginner_report(groups, [execution], period),
        "csv_path": "",
        "query_info": _query_info(query_type),
        "execution_summary": execution,
        "row_count": execution["row_count"],
        "period": period,
        "period_metadata": metadata,
        "dataset_id": DEMO_DATASET_ID,
        "site": {"name": DEMO_SITE_DISPLAY_NAME, "url": DEMO_SITE_URL},
        "is_demo": True,
        "data_source": DEMO_DATA_SOURCE,
    }
    return response, 200


def batch_generate_response(query_types: Any, period: str) -> tuple[dict[str, Any], int]:
    if not isinstance(query_types, list) or not query_types:
        return (
            {
                "ok": False,
                "error": "validation_error",
                "message": "クエリタイプを1つ以上指定してください",
                "is_demo": True,
                "data_source": DEMO_DATA_SOURCE,
            },
            400,
        )

    requested = [str(item) for item in query_types]
    valid = [item for item in requested if item in QUERY_TYPE_KEYS]
    if not valid:
        return (
            {
                "ok": False,
                "error": "validation_error",
                "message": "有効なクエリタイプがありません",
                "is_demo": True,
                "data_source": DEMO_DATA_SOURCE,
            },
            400,
        )

    if period not in DEMO_PERIODS:
        execution_summary = [
            {
                "query_type": query_type,
                "status": "no_data",
                "row_count": 0,
                "chart_group_count": 0,
                "message": f"デモで利用できる期間ではありません: {period}",
            }
            for query_type in valid
        ]
        return (
            {
                "ok": True,
                "data_availability": "partial",
                "missing_reason": "選択した期間のデモデータはありません。",
                "message": "デモでは2026-06と2026-05だけを利用できます。",
                "report_md": "",
                "chart_data": {},
                "beginner_report": _beginner_report([], execution_summary, period),
                "results": {},
                "skipped": [
                    {"query_type": query_type, "reason": "no_data"}
                    for query_type in valid
                ],
                "execution_summary": execution_summary,
                "query_count": 0,
                "period": period,
                "period_metadata": None,
                "available_periods": list(DEMO_PERIODS),
                "dataset_id": DEMO_DATASET_ID,
                "site": {"name": DEMO_SITE_DISPLAY_NAME, "url": DEMO_SITE_URL},
                "is_demo": True,
                "data_source": DEMO_DATA_SOURCE,
            },
            200,
        )

    metadata = period_metadata(period)
    all_groups: list[dict[str, Any]] = []
    execution_summary: list[dict[str, Any]] = []
    results: dict[str, dict[str, Any]] = {}
    skipped: list[dict[str, str]] = []

    # Preserve caller order exactly.  Unlike the normal threaded BQ path this
    # guarantees stable frontend chart IDs across repeated demo requests.
    for query_type in valid:
        groups = chart_groups_for(query_type, period)
        execution = _execution_summary(query_type, groups, period_available=metadata is not None)
        execution_summary.append(execution)
        if not groups:
            skipped.append({"query_type": query_type, "reason": "no_data"})
            continue
        all_groups.extend(groups)
        results[query_type] = {
            "report_md": _query_markdown(query_type, period),
            "query_info": _query_info(query_type),
        }

    for query_type in requested:
        if query_type in QUERY_TYPE_KEYS:
            continue
        execution_summary.append(
            {
                "query_type": query_type,
                "status": "error",
                "row_count": 0,
                "chart_group_count": 0,
                "message": f"未知のクエリタイプ: {query_type}",
            }
        )
        skipped.append({"query_type": query_type, "reason": "invalid_query_type"})

    has_gaps = bool(skipped)
    missing_reason = ""
    if has_gaps:
        missing_reason = "未計測の項目があります。未計測を0件として扱いません。"
    response = {
        "ok": True,
        "data_availability": "partial" if has_gaps else "full",
        "missing_reason": missing_reason,
        "report_md": report_markdown(period),
        "chart_data": {"groups": all_groups} if all_groups else {},
        "beginner_report": _beginner_report(all_groups, execution_summary, period),
        "results": results,
        "skipped": skipped,
        "execution_summary": execution_summary,
        "query_count": len(results),
        "period": period,
        "period_metadata": metadata,
        "dataset_id": DEMO_DATASET_ID,
        "site": {"name": DEMO_SITE_DISPLAY_NAME, "url": DEMO_SITE_URL},
        "is_demo": True,
        "data_source": DEMO_DATA_SOURCE,
    }
    return response, 200


def _validated_chart_refs(payload: dict[str, Any]) -> list[dict[str, str]]:
    pack = payload.get("chart_evidence_pack")
    charts = pack.get("charts") if isinstance(pack, dict) else None
    if not isinstance(charts, list):
        return []
    selected: list[dict[str, str]] = []
    for index, chart in enumerate(charts):
        if not isinstance(chart, dict):
            continue
        chart_id = str(chart.get("chart_id") or "")
        query_type = str(chart.get("query_type") or chart.get("queryType") or "")
        expected_chart_id = f"chart_{index + 1:02d}"
        if (
            not _CHART_ID_RE.fullmatch(chart_id)
            or chart_id != expected_chart_id
            or query_type not in _EVIDENCE_QUERY_ORDER
            or not _matches_canonical_chart(chart, query_type)
        ):
            continue
        selected.append(
            {
                "chart_id": chart_id,
                "query_type": query_type,
                "period_tag": str(chart.get("period_tag") or ""),
                "title": str(chart.get("title") or ""),
            }
        )
    return selected


def _claim_citations(payload: dict[str, Any]) -> dict[str, str]:
    validated = _validated_chart_refs(payload)
    by_signature = {
        (item["period_tag"], item["query_type"], item["title"]): item["chart_id"]
        for item in validated
    }
    return {
        key: by_signature[(period, query_type, title)]
        for key, period, query_type, title in _AI_CITATION_REQUIREMENTS
        if (period, query_type, title) in by_signature
    }


def _referenced_chart_ids(payload: dict[str, Any]) -> list[str]:
    citations = _claim_citations(payload)
    return [
        citations[key]
        for key, _period, _query_type, _title in _AI_CITATION_REQUIREMENTS
        if key in citations
    ]


def _matches_canonical_chart(chart: dict[str, Any], query_type: str) -> bool:
    """Accept chart ids only when their evidence matches the server fixture."""
    period = str(chart.get("period_tag") or "")
    if period not in DEMO_PERIODS:
        return False
    title = str(chart.get("title") or "")
    candidates = [
        group
        for group in chart_groups_for(query_type, period)
        if str(group.get("title") or "") == title
    ]
    return any(_matches_canonical_group_evidence(chart, group) for group in candidates)


def _matches_canonical_group_evidence(chart: dict[str, Any], group: dict[str, Any]) -> bool:
    labels = [str(label) for label in (group.get("labels") or [])]
    datasets = group.get("datasets") or []
    series = chart.get("series")
    if not isinstance(series, list) or len(series) != len(datasets):
        return False
    if str(chart.get("chart_type") or "") != str(group.get("chartType") or ""):
        return False
    if chart.get("label_count") != len(labels) or chart.get("series_count") != len(datasets):
        return False

    for actual, expected in zip(series, datasets):
        if not isinstance(actual, dict) or str(actual.get("label") or "") != str(expected.get("label") or ""):
            return False
        points = actual.get("points")
        values = expected.get("data") or []
        if not isinstance(points, list) or len(points) != len(labels) or len(values) != len(labels):
            return False
        for point, label, value in zip(points, labels, values):
            if not isinstance(point, dict):
                return False
            actual_label = str(point.get("rawLabel") if point.get("rawLabel") is not None else point.get("label") or "")
            if actual_label != label:
                return False
            try:
                if float(point.get("value")) != float(value):
                    return False
            except (TypeError, ValueError):
                return False
    return True


def ai_response(payload: dict[str, Any]) -> dict[str, Any]:
    citations = _claim_citations(payload)
    chart_ids = _referenced_chart_ids(payload)
    evidence_complete = len(citations) == len(_AI_CITATION_REQUIREMENTS)

    if evidence_complete:
        pv_refs = f"`{citations['comparison_pv']}`・`{citations['current_pv']}`"
        inquiry_refs = f"`{citations['comparison_inquiries']}`・`{citations['current_inquiries']}`"
        inquiry_rate_refs = f"`{citations['comparison_inquiry_rate']}`・`{citations['current_inquiry_rate']}`"
        traffic_ref = f"`{citations['current_traffic']}`"
        answer = f"""## 結論

訪問と見られた回数は増えています。一方、問い合わせ率はほぼ横ばいです。流入増加だけでなく、サービスページのCTAが分散している影響もある可能性があります。まずサービスページと流入元グラフを確認してください。

## 数値根拠

- 対象期間: 2026年6月（比較期間: 2026年5月）
- 訪問: 2,760 → 3,120（+13.0%）— {pv_refs}
- 見られた回数: 4,210 → 4,860（+15.4%）— {pv_refs}
- 問い合わせ: 42 → 47（+11.9%）— {inquiry_refs}
- 問い合わせ率: 1.52% → 1.51%（-0.02ポイント）— {inquiry_rate_refs}
- 主な流入元: google / organic 1,420訪問 — {traffic_ref}

## まだ断定できないこと

- 電話タップは未計測です。
- 電話経由の成果は判断保留です。未計測を0件として扱いません。
- CTAの分散が問い合わせ率へ与えた影響は、現時点では可能性がありますという段階です。

## 次に確認すべきこと

- `/ads/graphs` でサービスページと流入元のグラフを確認してください。

## 打ち手

1. /service の主要CTAを1つに絞る
2. コラムからサービスページへの内部リンクを追加する
3. 電話タップの計測設定を確認する
"""
        response_evidence = {
            "sessions": {
                "current": PERIOD_DATA[DEMO_CURRENT_PERIOD]["sessions"],
                "comparison": PERIOD_DATA[DEMO_COMPARISON_PERIOD]["sessions"],
                "change_percent": MONTH_OVER_MONTH["sessions_percent"],
                "chart_ids": [citations["comparison_pv"], citations["current_pv"]],
            },
            "page_views": {
                "current": PERIOD_DATA[DEMO_CURRENT_PERIOD]["page_views"],
                "comparison": PERIOD_DATA[DEMO_COMPARISON_PERIOD]["page_views"],
                "change_percent": MONTH_OVER_MONTH["page_views_percent"],
                "chart_ids": [citations["comparison_pv"], citations["current_pv"]],
            },
            "inquiries": {
                "current": PERIOD_DATA[DEMO_CURRENT_PERIOD]["inquiries"],
                "comparison": PERIOD_DATA[DEMO_COMPARISON_PERIOD]["inquiries"],
                "chart_ids": [citations["comparison_inquiries"], citations["current_inquiries"]],
            },
            "inquiry_rate": {
                "current": PERIOD_DATA[DEMO_CURRENT_PERIOD]["inquiry_rate"],
                "comparison": PERIOD_DATA[DEMO_COMPARISON_PERIOD]["inquiry_rate"],
                "chart_ids": [citations["comparison_inquiry_rate"], citations["current_inquiry_rate"]],
            },
            "top_source": {
                **deepcopy(TRAFFIC_SOURCES[0]),
                "chart_ids": [citations["current_traffic"]],
            },
        }
    else:
        available_refs = "、".join(f"`{chart_id}`" for chart_id in chart_ids) or "なし"
        answer = f"""## 結論

2026年6月と2026年5月の比較に必要な根拠グラフが揃っていないため、数値比較は表示しません。

## 確認できた根拠

- 検証済みchart ID: {available_refs}

## まだ断定できないこと

- 訪問、見られた回数、問い合わせ、問い合わせ率の増減は判断保留です。
- 電話タップは未計測です。未計測を0件として扱いません。

## 次に確認すべきこと

- `/ads/graphs` で2026年6月と2026年5月の主要指標、問い合わせ、流入元グラフを揃えてください。
"""
        response_evidence = {}

    response = {
        "ok": True,
        "text": answer,
        "answer_markdown": answer,
        "parse_status": DEMO_DATA_SOURCE,
        "fallback_used": False,
        "workflow": "demo_fixture_v1",
        "report_contract_version": "insight_report_v2",
        "generated_by": DEMO_DATA_SOURCE,
        "is_demo": True,
        "data_source": DEMO_DATA_SOURCE,
        "analysis_mode": "deterministic",
        "execution_mode": DEMO_DATA_SOURCE,
        "provider": DEMO_DATA_SOURCE,
        "model": None,
        "tokens_used": 0,
        "token_usage_status": "not_applicable",
        "llm_calls": 0,
        "referenced_chart_ids": chart_ids,
        "evidence_complete": evidence_complete,
        "period_metadata": {
            "period": DEMO_CURRENT_PERIOD,
            "comparison_period": DEMO_COMPARISON_PERIOD,
        },
        "analysis_context": {
            "site_name": DEMO_SITE_DISPLAY_NAME,
            "site_url": DEMO_SITE_URL,
            "period": DEMO_CURRENT_PERIOD,
            "comparison_period": DEMO_COMPARISON_PERIOD,
            "evidence": response_evidence,
            "limitations": [gap["label"] for gap in DATA_GAPS],
        },
        "review_status": {
            "verdict": "pass" if evidence_complete else "incomplete",
            "notes": [
                "完全架空fixtureの固定値と照合済み"
                if evidence_complete
                else "両期間の必要な根拠グラフが不足しているため数値比較を保留"
            ],
        },
        "agent_trace": [],
        "validation_warnings": [],
    }
    response["output_chars"] = len(answer)
    return response
