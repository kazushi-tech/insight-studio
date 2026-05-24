from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
import json
import os
import re
from typing import Any
from urllib.parse import urlparse


SECRET_KEY_RE = re.compile(r"(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)", re.I)


def is_ai_debug_enabled() -> bool:
    return str(os.getenv("AI_ANALYSIS_DEBUG") or os.getenv("INSIGHT_STUDIO_AI_DEBUG") or "").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _safe_number(value: Any) -> float | int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value if value == value else None
    try:
        text = str(value).replace(",", "").strip()
        if not text:
            return None
        parsed = float(text)
        if parsed != parsed:
            return None
        return int(parsed) if parsed.is_integer() else parsed
    except Exception:
        return None


def _rate(current: float | int | None, base: float | int | None) -> float | None:
    if current is None or base in (None, 0):
        return None
    try:
        return round((float(current) - float(base)) / float(base) * 100, 1)
    except Exception:
        return None


def _direction(rate: float | None) -> str | None:
    if rate is None:
        return None
    if rate > 0:
        return "up"
    if rate < 0:
        return "down"
    return "flat"


def _percent(value: float | int | None) -> float | None:
    if value is None:
        return None
    try:
        return round(float(value) * 100, 1)
    except Exception:
        return None


def _round_float(value: float | int | None, digits: int = 1) -> float | None:
    if value is None:
        return None
    try:
        return round(float(value), digits)
    except Exception:
        return None


def _date_value(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _date_text(value: Any) -> str:
    parsed = _date_value(value)
    return parsed.isoformat() if parsed else str(value or "")


def _date_suffix(value: Any) -> str:
    parsed = _date_value(value)
    return parsed.strftime("%Y%m%d") if parsed else str(value or "").replace("-", "")


def _safe_identifier(value: str) -> str:
    text = str(value or "").strip()
    if not re.match(r"^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?$", text):
        raise ValueError("dataset_id contains unsupported characters")
    return text


def _url_path(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = urlparse(text)
        if not parsed.scheme or not parsed.netloc:
            return text
        path = parsed.path or "/"
        return f"{path}?{parsed.query}" if parsed.query else path
    except Exception:
        return text


def question_needs_pv_spike_diagnostic(question: str) -> bool:
    """PV最大日・急増要因を聞かれたときだけBigQuery診断を走らせる。"""
    text = str(question or "").lower()
    metric_hit = any(k in text for k in ("pv", "ページビュー", "page view", "アクセス"))
    peak_hit = any(k in text for k in ("一番", "最大", "高かった", "多かった", "ピーク"))
    cause_hit = any(k in text for k in ("原因", "理由", "急増", "伸びた", "増えた"))
    return metric_hit and (peak_hit or cause_hit)


def _period_to_range(periods: list[str] | None, labels: list[str] | None) -> dict[str, Any]:
    if periods:
        first = str(periods[0])
        last = str(periods[-1])
        month_match = re.match(r"^(\d{4})-(\d{2})$", first)
        last_month_match = re.match(r"^(\d{4})-(\d{2})$", last)
        if month_match and last_month_match:
            y1, m1 = int(month_match.group(1)), int(month_match.group(2))
            y2, m2 = int(last_month_match.group(1)), int(last_month_match.group(2))
            end_day = calendar.monthrange(y2, m2)[1]
            return {"start": f"{y1:04d}-{m1:02d}-01", "end": f"{y2:04d}-{m2:02d}-{end_day:02d}", "timezone": "Asia/Tokyo"}
        return {"start": first, "end": last, "timezone": "Asia/Tokyo"}
    if labels:
        return {"start": str(labels[0]), "end": str(labels[-1]), "timezone": "Asia/Tokyo"}
    return {"start": "", "end": "", "timezone": "Asia/Tokyo"}


def _range_to_suffixes(date_range: dict[str, Any]) -> tuple[str, str]:
    start = _date_suffix(date_range.get("start"))
    end = _date_suffix(date_range.get("end"))
    if not re.match(r"^\d{8}$", start) or not re.match(r"^\d{8}$", end):
        raise ValueError("dateRange must include YYYY-MM-DD start/end")
    return start, end


def _rows_from_dataframe(df: Any) -> list[dict[str, Any]]:
    if df is None:
        return []
    if hasattr(df, "to_dict"):
        return df.to_dict(orient="records")
    if isinstance(df, list):
        return [row for row in df if isinstance(row, dict)]
    return []


def _normalise_daily_pv_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        value = _safe_number(row.get("page_views") if "page_views" in row else row.get("pageViews"))
        if value is None:
            continue
        out.append({"date": _date_text(row.get("date") or row.get("event_date")), "pageViews": int(value)})
    return sorted(out, key=lambda r: r["date"])


def _axis_label(axis: str, row: dict[str, Any]) -> str:
    if axis == "sourceMedium":
        if row.get("sourceMedium"):
            return str(row.get("sourceMedium"))
        return f"{row.get('source') or '(not set)'} / {row.get('medium') or '(not set)'}"
    if axis == "landingPage":
        return str(row.get("landingPage") or row.get("landing_page") or "(not set)")
    if axis == "campaign":
        return str(row.get("campaign") or "(not set)")
    if axis == "device":
        return str(row.get("device") or row.get("device_category") or "(not set)")
    return str(row.get("label") or "(not set)")


def _build_breakdown_rows(
    axis: str,
    rows: list[dict[str, Any]],
    *,
    peak_page_views: int | float,
) -> list[dict[str, Any]]:
    prepared = []
    for row in rows:
        peak_value = _safe_number(row.get("peakDayPageViews") if "peakDayPageViews" in row else row.get("peak_day_page_views"))
        previous_value = _safe_number(row.get("previousDayPageViews") if "previousDayPageViews" in row else row.get("previous_day_page_views"))
        if peak_value is None:
            continue
        previous_value = previous_value or 0
        delta = float(peak_value) - float(previous_value)
        item: dict[str, Any] = {
            "peakDayPageViews": int(peak_value),
            "previousDayPageViews": int(previous_value),
            "delta": int(delta) if delta.is_integer() else round(delta, 1),
            "deltaRate": _rate(peak_value, previous_value),
            "shareOfPeakDay": _percent(float(peak_value) / float(peak_page_views)) if peak_page_views else None,
        }
        if axis == "sourceMedium":
            item["source"] = row.get("source")
            item["medium"] = row.get("medium")
            item["sourceMedium"] = _axis_label(axis, row)
        elif axis == "landingPage":
            item["landingPage"] = _axis_label(axis, row)
        elif axis == "campaign":
            campaign_label = _axis_label(axis, row)
            item["campaign"] = campaign_label
            if campaign_label.strip().lower() in {"(organic)", "organic"}:
                item["interpretation"] = "広告キャンペーン名ではなく、自然検索流入のcampaign属性として扱ってください。"
        elif axis == "device":
            item["device"] = _axis_label(axis, row)
        else:
            item["label"] = _axis_label(axis, row)
        prepared.append(item)

    denominator = sum(max(float(row.get("delta") or 0), 0) for row in prepared)
    for row in prepared:
        row["contributionToIncrease"] = _percent(max(float(row.get("delta") or 0), 0) / denominator) if denominator > 0 else None

    return sorted(prepared, key=lambda r: (r.get("delta") or 0, r.get("peakDayPageViews") or 0), reverse=True)[:10]


def _normalise_session_landing_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """BigQuery集計済み行、またはテスト用page_viewイベント行を日別LP行へ寄せる。"""
    if not rows:
        return []
    if any("event_timestamp" in row or "page_location" in row for row in rows):
        return _session_landing_rows_from_pageview_events(rows)

    out: list[dict[str, Any]] = []
    for row in rows:
        event_date = _date_text(row.get("event_date") or row.get("date"))
        landing_url = row.get("landingPageUrl") or row.get("landing_page_url") or row.get("landing_page")
        if not event_date or not landing_url:
            continue
        page_views = _safe_number(row.get("page_views") if "page_views" in row else row.get("peakDayPageViews"))
        sessions = _safe_number(
            row.get("sessions_with_pageviews")
            if "sessions_with_pageviews" in row
            else row.get("landing_sessions")
            if "landing_sessions" in row
            else row.get("sessions")
        )
        out.append({
            "date": event_date,
            "landingPageUrl": str(landing_url),
            "landingPageTitle": row.get("landingPageTitle") or row.get("landing_page_title"),
            "pageViews": int(page_views or 0),
            "landingSessions": int(sessions or 0),
            "missingSessionIdPageViews": int(_safe_number(row.get("missing_session_id_page_views")) or 0),
            "unknownLandingPagePageViews": int(_safe_number(row.get("unknown_landing_page_page_views")) or 0),
        })
    return out


def _session_landing_rows_from_pageview_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    pageviews = []
    missing_by_date: dict[str, int] = {}
    unknown_by_date: dict[str, int] = {}

    for row in events:
        if row.get("event_name") and row.get("event_name") != "page_view":
            continue
        event_date = _date_text(row.get("event_date") or row.get("date"))
        user_id = row.get("user_pseudo_id")
        session_id = row.get("ga_session_id")
        page_location = row.get("page_location") or row.get("landing_page_url") or row.get("landingPageUrl")
        if not user_id or session_id in (None, ""):
            missing_by_date[event_date] = missing_by_date.get(event_date, 0) + 1
            continue
        if not page_location:
            unknown_by_date[event_date] = unknown_by_date.get(event_date, 0) + 1
            continue
        pageviews.append({
            "date": event_date,
            "eventTimestamp": int(_safe_number(row.get("event_timestamp")) or 0),
            "sessionKey": f"{user_id}-{session_id}",
            "pageLocation": str(page_location),
            "pageTitle": row.get("page_title"),
        })

    landing_by_session: dict[str, dict[str, Any]] = {}
    for row in sorted(pageviews, key=lambda item: (item["sessionKey"], item["eventTimestamp"])):
        landing_by_session.setdefault(row["sessionKey"], {
            "landingPageUrl": row["pageLocation"],
            "landingPageTitle": row.get("pageTitle"),
        })

    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    sessions_by_key: dict[tuple[str, str], set[str]] = {}
    for row in pageviews:
        landing = landing_by_session.get(row["sessionKey"])
        if not landing:
            continue
        key = (row["date"], landing["landingPageUrl"])
        item = grouped.setdefault(key, {
            "date": row["date"],
            "landingPageUrl": landing["landingPageUrl"],
            "landingPageTitle": landing.get("landingPageTitle"),
            "pageViews": 0,
            "landingSessions": 0,
            "missingSessionIdPageViews": missing_by_date.get(row["date"], 0),
            "unknownLandingPagePageViews": unknown_by_date.get(row["date"], 0),
        })
        item["pageViews"] += 1
        sessions_by_key.setdefault(key, set()).add(row["sessionKey"])

    for key, sessions in sessions_by_key.items():
        grouped[key]["landingSessions"] = len(sessions)

    return sorted(grouped.values(), key=lambda item: (item["date"], -item["pageViews"], item["landingPageUrl"]))


def build_session_landing_page_diagnostic(
    rows: list[dict[str, Any]],
    *,
    peak_date: Any,
    previous_date: Any | None,
    date_range: dict[str, Any] | None = None,
    caveats: list[str] | None = None,
) -> dict[str, Any] | None:
    """セッション内の最初のpage_viewをLPとして、日別PVをLPへ帰属する。"""
    normalised = _normalise_session_landing_rows(rows)
    peak_text = _date_text(peak_date)
    previous_text = _date_text(previous_date) if previous_date else None
    target_rows = [row for row in normalised if row.get("date") in {peak_text, previous_text}]
    if not peak_text or not target_rows:
        return None

    by_url: dict[str, dict[str, Any]] = {}
    missing_by_date: dict[str, int] = {}
    unknown_by_date: dict[str, int] = {}
    for row in target_rows:
        event_date = row.get("date")
        missing_by_date[event_date] = max(missing_by_date.get(event_date, 0), int(row.get("missingSessionIdPageViews") or 0))
        unknown_by_date[event_date] = max(unknown_by_date.get(event_date, 0), int(row.get("unknownLandingPagePageViews") or 0))
        url = row.get("landingPageUrl")
        if not url:
            continue
        item = by_url.setdefault(url, {
            "landingPageUrl": url,
            "landingPagePath": _url_path(url),
            "landingPageTitle": row.get("landingPageTitle"),
            "peakDayPageViews": 0,
            "previousDayPageViews": 0,
            "peakDayLandingSessions": 0,
            "previousDayLandingSessions": 0,
        })
        if not item.get("landingPageTitle") and row.get("landingPageTitle"):
            item["landingPageTitle"] = row.get("landingPageTitle")
        if event_date == peak_text:
            item["peakDayPageViews"] += int(row.get("pageViews") or 0)
            item["peakDayLandingSessions"] += int(row.get("landingSessions") or 0)
        elif previous_text and event_date == previous_text:
            item["previousDayPageViews"] += int(row.get("pageViews") or 0)
            item["previousDayLandingSessions"] += int(row.get("landingSessions") or 0)

    peak_total = sum(int(row.get("peakDayPageViews") or 0) for row in by_url.values())
    previous_total = sum(int(row.get("previousDayPageViews") or 0) for row in by_url.values())
    positive_delta_total = sum(
        max(int(row.get("peakDayPageViews") or 0) - int(row.get("previousDayPageViews") or 0), 0)
        for row in by_url.values()
    )

    top_pages = []
    for row in by_url.values():
        peak_value = int(row.get("peakDayPageViews") or 0)
        previous_value = int(row.get("previousDayPageViews") or 0)
        delta = peak_value - previous_value
        sessions = int(row.get("peakDayLandingSessions") or 0)
        row["delta"] = delta
        row["deltaRate"] = _rate(peak_value, previous_value)
        row["shareOfPeakDayPageViews"] = _percent(peak_value / peak_total) if peak_total else None
        row["contributionToIncrease"] = _percent(max(delta, 0) / positive_delta_total) if positive_delta_total else None
        row["landingSessionsDelta"] = sessions - int(row.get("previousDayLandingSessions") or 0)
        row["avgPageViewsPerLandingSession"] = _round_float(peak_value / sessions) if sessions else None
        top_pages.append(row)

    caveat_list = list(caveats or [])
    caveat_list.append(
        "セッションLPは user_pseudo_id + ga_session_id ごとの最初の page_view.page_location で定義しています。"
    )
    caveat_list.append(
        "peakDayLandingSessions は、対象日にpage_viewを発生させた当該セッションLP起点のセッション数です。セッション開始日ではなくpage_view発生日に帰属しています。"
    )
    if missing_by_date.get(peak_text, 0) or (previous_text and missing_by_date.get(previous_text, 0)):
        caveat_list.append("一部page_viewはga_session_idまたはuser_pseudo_idがなく、セッションLPに帰属できません。")
    if unknown_by_date.get(peak_text, 0) or (previous_text and unknown_by_date.get(previous_text, 0)):
        caveat_list.append("一部page_viewはpage_locationがなく、セッションLPに帰属できません。")

    return {
        "method": "ga4_session_first_page_view",
        "sessionKeyMethod": "user_pseudo_id + ga_session_id",
        "landingPageDefinition": "first page_view.page_location in each GA4 session",
        "dateAttribution": "page_view event date attributed to the session's first page_view",
        "comparisonWindow": {
            "peakDate": peak_text,
            "previousDate": previous_text,
            "dateRangeStart": (date_range or {}).get("start") or "",
            "dateRangeEnd": (date_range or {}).get("end") or "",
        },
        "topLandingPages": sorted(
            top_pages,
            key=lambda item: (item.get("delta") or 0, item.get("peakDayPageViews") or 0),
            reverse=True,
        )[:10],
        "totals": {
            "peakDayPageViewsAttributedToKnownLandingPage": peak_total,
            "peakDayLandingSessions": sum(int(row.get("peakDayLandingSessions") or 0) for row in by_url.values()),
            "previousDayPageViewsAttributedToKnownLandingPage": previous_total if previous_text else None,
            "previousDayLandingSessions": sum(int(row.get("previousDayLandingSessions") or 0) for row in by_url.values()) if previous_text else None,
            "unknownLandingPagePageViews": unknown_by_date.get(peak_text, 0),
            "missingSessionIdPageViews": missing_by_date.get(peak_text, 0),
        },
        "caveats": list(dict.fromkeys([c for c in caveat_list if c])),
    }


def build_pv_spike_diagnostic_context(
    daily_rows: list[dict[str, Any]],
    breakdowns: dict[str, list[dict[str, Any]]] | None = None,
    *,
    date_range: dict[str, Any] | None = None,
    caveats: list[str] | None = None,
    session_landing_page_rows: list[dict[str, Any]] | None = None,
    session_landing_page_caveats: list[str] | None = None,
) -> dict[str, Any]:
    """PV最大日診断をPython側で確定する。AIにはこの結果を読ませるだけにする。"""
    daily = _normalise_daily_pv_rows(daily_rows)
    base_caveats = list(caveats or [])
    if not daily:
        return {
            "metric": "page_views",
            "dateRange": date_range or {"start": "", "end": "", "timezone": "Asia/Tokyo"},
            "peak": {},
            "breakdowns": {"sourceMedium": [], "landingPage": [], "campaign": [], "device": []},
            "sessionLandingPageDiagnostic": None,
            "caveats": base_caveats + ["日別PVデータを取得できなかったため、PV最大日を確定できません。"],
        }

    peak_idx, peak_row = max(enumerate(daily), key=lambda item: item[1]["pageViews"])
    peak_value = peak_row["pageViews"]
    previous_value = daily[peak_idx - 1]["pageViews"] if peak_idx > 0 else None
    period_avg = round(sum(row["pageViews"] for row in daily) / len(daily), 1)

    window_start = max(0, peak_idx - 7)
    seven_rows = daily[window_start:peak_idx]
    seven_avg = round(sum(row["pageViews"] for row in seven_rows) / len(seven_rows), 1) if seven_rows else None

    previous_delta = peak_value - previous_value if previous_value is not None else None
    period_delta = round(peak_value - period_avg, 1)
    seven_delta = round(peak_value - seven_avg, 1) if seven_avg is not None else None

    raw_breakdowns = breakdowns or {}
    computed_breakdowns = {
        axis: _build_breakdown_rows(
            axis,
            raw_breakdowns.get(axis) or [],
            peak_page_views=peak_value,
        )
        for axis in ("sourceMedium", "landingPage", "campaign", "device")
    }

    if not computed_breakdowns["sourceMedium"]:
        base_caveats.append("source / medium別PVの差分データは取得できませんでした。流入元を原因として断定できません。")
    if not computed_breakdowns["landingPage"]:
        base_caveats.append("LP別PVの差分データは取得できませんでした。ページ起点の原因は断定できません。")
    if not computed_breakdowns["campaign"]:
        base_caveats.append("campaign別PVデータがこのコンテキストにはありません。広告キャンペーン起点の判断はできません。")
    elif any(str(row.get("campaign") or "").strip().lower() in {"(organic)", "organic"} for row in computed_breakdowns["campaign"]):
        base_caveats.append("campaign属性の (organic) は広告キャンペーン施策名ではありません。自然検索流入のcampaign属性として扱い、広告施策が実施されたと断定しないでください。")
    if not computed_breakdowns["device"]:
        base_caveats.append("device別PVの差分データは取得できませんでした。デバイス起点の原因は断定できません。")
    if any(computed_breakdowns.values()):
        base_caveats.append("breakdownsのcontributionToIncreaseは各分解軸内のプラス差分合計に対するシェアです。")
    base_caveats.append("広告配信、SNS投稿、メルマガ、外部掲載などの施策実施有無はGA4 BigQueryデータだけでは確認できません。")

    session_landing_page_diagnostic = None
    if session_landing_page_rows is not None:
        session_landing_page_diagnostic = build_session_landing_page_diagnostic(
            session_landing_page_rows,
            peak_date=peak_row["date"],
            previous_date=(daily[peak_idx - 1]["date"] if peak_idx > 0 else None),
            date_range=date_range or {
                "start": daily[0]["date"],
                "end": daily[-1]["date"],
                "timezone": "Asia/Tokyo",
            },
            caveats=session_landing_page_caveats,
        )
        if session_landing_page_diagnostic:
            base_caveats.extend(session_landing_page_diagnostic.get("caveats") or [])
            session_top = (session_landing_page_diagnostic.get("topLandingPages") or [{}])[0]
            page_location_top = (computed_breakdowns.get("landingPage") or [{}])[0]
            session_url = session_top.get("landingPageUrl")
            session_label = session_top.get("landingPagePath") or session_url
            page_location_label = page_location_top.get("landingPage")
            if session_url and page_location_label and str(session_url) != str(page_location_label):
                base_caveats.append(
                    f"page_location別PVでは {page_location_label} が上位ですが、セッションLPでは {session_label} が上位です。サイト内回遊により閲覧ページと入口ページが異なる可能性があります。"
                )
        else:
            base_caveats.append("セッションLP診断は取得できませんでした。page_location別PVをfallbackとして使用します。")

    return {
        "metric": "page_views",
        "dateRange": date_range or {
            "start": daily[0]["date"],
            "end": daily[-1]["date"],
            "timezone": "Asia/Tokyo",
        },
        "peak": {
            "date": peak_row["date"],
            "pageViews": peak_value,
            "previousDayPageViews": previous_value,
            "previousDayDelta": previous_delta,
            "previousDayDeltaRate": _rate(peak_value, previous_value),
            "periodAveragePageViews": period_avg,
            "periodAverageDelta": period_delta,
            "periodAverageDeltaRate": _rate(peak_value, period_avg),
            "sevenDayAveragePageViews": seven_avg,
            "sevenDayAverageDelta": seven_delta,
            "sevenDayAverageDeltaRate": _rate(peak_value, seven_avg),
        },
        "breakdowns": computed_breakdowns,
        "sessionLandingPageDiagnostic": session_landing_page_diagnostic,
        "caveats": list(dict.fromkeys(base_caveats)),
    }


def _daily_pv_sql(dataset_id: str) -> str:
    dataset = _safe_identifier(dataset_id)
    return f"""
SELECT
  FORMAT_DATE('%Y-%m-%d', PARSE_DATE('%Y%m%d', event_date)) AS date,
  COUNTIF(event_name = 'page_view') AS page_views
FROM `{dataset}.events_*`
WHERE _TABLE_SUFFIX BETWEEN @start_suffix AND @end_suffix
GROUP BY date
ORDER BY date
"""


def _breakdown_sql(dataset_id: str, axis: str) -> str:
    dataset = _safe_identifier(dataset_id)
    if axis == "sourceMedium":
        select_expr = """
  COALESCE((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'source'), traffic_source.source, '(not set)') AS source,
  COALESCE((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'medium'), traffic_source.medium, '(not set)') AS medium,
"""
        group_cols = "source, medium"
        out_cols = "source, medium, CONCAT(source, ' / ', medium) AS sourceMedium"
    elif axis == "landingPage":
        select_expr = """
  COALESCE((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location'), '(not set)') AS landingPage,
"""
        group_cols = "landingPage"
        out_cols = "landingPage"
    elif axis == "campaign":
        select_expr = """
  COALESCE(
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'manual_campaign_name'),
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'campaign'),
    traffic_source.name,
    '(not set)'
  ) AS campaign,
"""
        group_cols = "campaign"
        out_cols = "campaign"
    elif axis == "device":
        select_expr = """
  COALESCE(device.category, '(not set)') AS device,
"""
        group_cols = "device"
        out_cols = "device"
    else:
        raise ValueError(f"unsupported breakdown axis: {axis}")

    return f"""
WITH pv_events AS (
  SELECT
    event_date,
{select_expr}
    COUNT(1) AS page_views
  FROM `{dataset}.events_*`
  WHERE event_name = 'page_view'
    AND _TABLE_SUFFIX IN (@peak_suffix, @previous_suffix)
  GROUP BY event_date, {group_cols}
),
rolled AS (
  SELECT
    {group_cols},
    SUM(IF(event_date = @peak_suffix, page_views, 0)) AS peakDayPageViews,
    SUM(IF(event_date = @previous_suffix, page_views, 0)) AS previousDayPageViews
  FROM pv_events
  GROUP BY {group_cols}
)
SELECT
  {out_cols},
  peakDayPageViews,
  previousDayPageViews
FROM rolled
WHERE peakDayPageViews > 0
ORDER BY peakDayPageViews DESC
LIMIT 20
"""


def _session_landing_page_sql(dataset_id: str) -> str:
    dataset = _safe_identifier(dataset_id)
    return f"""
CREATE TEMP FUNCTION GetParamString(event_params ANY TYPE, param_name STRING)
AS ((SELECT ANY_VALUE(value.string_value) FROM UNNEST(event_params) WHERE key = param_name));

CREATE TEMP FUNCTION GetParamInt(event_params ANY TYPE, param_name STRING)
AS ((SELECT ANY_VALUE(value.int_value) FROM UNNEST(event_params) WHERE key = param_name));

WITH base AS (
  SELECT
    PARSE_DATE('%Y%m%d', event_date) AS event_date,
    event_timestamp,
    user_pseudo_id,
    GetParamInt(event_params, 'ga_session_id') AS ga_session_id,
    GetParamString(event_params, 'page_location') AS page_location,
    GetParamString(event_params, 'page_title') AS page_title,
    CONCAT(user_pseudo_id, '-', CAST(GetParamInt(event_params, 'ga_session_id') AS STRING)) AS session_key
  FROM `{dataset}.events_*`
  WHERE _TABLE_SUFFIX BETWEEN @start_suffix_with_buffer AND @end_suffix
    AND event_name = 'page_view'
),
missing_by_date AS (
  SELECT
    event_date,
    COUNTIF(user_pseudo_id IS NULL OR ga_session_id IS NULL) AS missing_session_id_page_views,
    COUNTIF(user_pseudo_id IS NOT NULL AND ga_session_id IS NOT NULL AND page_location IS NULL) AS unknown_landing_page_page_views
  FROM base
  WHERE event_date BETWEEN PARSE_DATE('%Y-%m-%d', @start_date) AND PARSE_DATE('%Y-%m-%d', @end_date)
  GROUP BY event_date
),
pageviews AS (
  SELECT *
  FROM base
  WHERE user_pseudo_id IS NOT NULL
    AND ga_session_id IS NOT NULL
    AND page_location IS NOT NULL
),
session_landing AS (
  SELECT
    session_key,
    ARRAY_AGG(
      STRUCT(
        page_location AS landing_page_url,
        page_title AS landing_page_title,
        event_timestamp AS landing_event_timestamp,
        event_date AS landing_event_date
      )
      ORDER BY event_timestamp ASC
      LIMIT 1
    )[OFFSET(0)] AS landing
  FROM pageviews
  GROUP BY session_key
),
attributed_pageviews AS (
  SELECT
    p.event_date,
    p.session_key,
    sl.landing.landing_page_url,
    sl.landing.landing_page_title
  FROM pageviews p
  JOIN session_landing sl
    USING (session_key)
  WHERE p.event_date BETWEEN PARSE_DATE('%Y-%m-%d', @start_date) AND PARSE_DATE('%Y-%m-%d', @end_date)
),
daily_landing_page AS (
  SELECT
    event_date,
    landing_page_url,
    ANY_VALUE(landing_page_title) AS landing_page_title,
    COUNT(*) AS page_views,
    COUNT(DISTINCT session_key) AS sessions_with_pageviews
  FROM attributed_pageviews
  GROUP BY event_date, landing_page_url
)
SELECT
  FORMAT_DATE('%Y-%m-%d', d.event_date) AS event_date,
  d.landing_page_url,
  d.landing_page_title,
  d.page_views,
  d.sessions_with_pageviews,
  COALESCE(m.missing_session_id_page_views, 0) AS missing_session_id_page_views,
  COALESCE(m.unknown_landing_page_page_views, 0) AS unknown_landing_page_page_views
FROM daily_landing_page d
LEFT JOIN missing_by_date m
  USING (event_date)
WHERE d.event_date IN (PARSE_DATE('%Y-%m-%d', @peak_date), PARSE_DATE('%Y-%m-%d', @previous_date))
ORDER BY d.event_date, d.page_views DESC
LIMIT 100
"""


def fetch_pv_spike_diagnostic_context(
    dataset_id: str,
    date_range: dict[str, Any],
    *,
    project: str | None = None,
    run_query_fn: Any | None = None,
) -> dict[str, Any]:
    """BigQueryからPVベースの最大日診断を取得する。

    run_query_fn はテスト用注入ポイントで、(sql, params, project) -> DataFrame/list を受け取る。
    """
    start_suffix, end_suffix = _range_to_suffixes(date_range)
    params = {"start_suffix": start_suffix, "end_suffix": end_suffix}

    if run_query_fn is None:
        from bq.client import PROJECT_ID, run_query_with_params

        def run_query_fn(sql: str, query_params: dict[str, Any], query_project: str | None = None):
            return run_query_with_params(sql, query_params, project=query_project or PROJECT_ID)

    daily_rows = _rows_from_dataframe(run_query_fn(_daily_pv_sql(dataset_id), params, project))
    base_diagnostic = build_pv_spike_diagnostic_context(daily_rows, {}, date_range=date_range)
    peak = base_diagnostic.get("peak") or {}
    peak_date = _date_value(peak.get("date"))
    if not peak_date:
        return base_diagnostic

    previous_date = peak_date - timedelta(days=1)
    breakdown_params = {
        "peak_suffix": peak_date.strftime("%Y%m%d"),
        "previous_suffix": previous_date.strftime("%Y%m%d"),
    }
    caveats = [
        "LP別PVは page_view の page_location を使ったページ別PVです。厳密なセッションのランディングページとは定義が異なる場合があります。"
    ]
    breakdowns: dict[str, list[dict[str, Any]]] = {}
    for axis in ("sourceMedium", "landingPage", "campaign", "device"):
        try:
            rows = _rows_from_dataframe(run_query_fn(_breakdown_sql(dataset_id, axis), breakdown_params, project))
            breakdowns[axis] = rows
        except Exception as exc:
            breakdowns[axis] = []
            caveats.append(f"{axis}別PVはBigQuery schema差異または権限のため取得できませんでした: {type(exc).__name__}")

    session_landing_page_rows: list[dict[str, Any]] | None = None
    session_landing_page_caveats: list[str] = []
    try:
        start_date = _date_value(date_range.get("start"))
        end_date = _date_value(date_range.get("end"))
        if start_date and end_date:
            session_params = {
                "start_suffix_with_buffer": (start_date - timedelta(days=1)).strftime("%Y%m%d"),
                "end_suffix": end_date.strftime("%Y%m%d"),
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "peak_date": peak_date.isoformat(),
                "previous_date": previous_date.isoformat(),
            }
            session_landing_page_rows = _rows_from_dataframe(
                run_query_fn(_session_landing_page_sql(dataset_id), session_params, project)
            )
        else:
            session_landing_page_rows = []
            session_landing_page_caveats.append("セッションLP診断に必要なdateRangeを日付として解釈できませんでした。")
    except Exception as exc:
        session_landing_page_rows = None
        caveats.append(
            f"セッションLP診断はBigQuery schema差異または権限のため取得できませんでした: {type(exc).__name__}。page_location別PVをfallbackとして使用します。"
        )

    return build_pv_spike_diagnostic_context(
        daily_rows,
        breakdowns,
        date_range=date_range,
        caveats=caveats,
        session_landing_page_rows=session_landing_page_rows,
        session_landing_page_caveats=session_landing_page_caveats,
    )


def _dataset_map(group: dict[str, Any]) -> dict[str, list[Any]]:
    out: dict[str, list[Any]] = {}
    for ds in group.get("datasets") or []:
        label = str(ds.get("label") or "")
        data = ds.get("data") if isinstance(ds.get("data"), list) else []
        if label:
            out[label] = data
    return out


def _find_group(groups: list[dict[str, Any]], *needles: str) -> dict[str, Any] | None:
    lowered = [n.lower() for n in needles]
    for group in groups:
        title = str(group.get("title") or "").lower()
        if all(n in title for n in lowered):
            return group
    return None


def _find_dataset(data_map: dict[str, list[Any]], *needles: str) -> tuple[str, list[Any]] | tuple[None, list[Any]]:
    lowered = [n.lower() for n in needles]
    for label, data in data_map.items():
        low = label.lower()
        if any(n in low for n in lowered):
            return label, data
    return None, []


def _daily_rows_from_pv_group(group: dict[str, Any] | None) -> tuple[list[dict[str, Any]], str | None]:
    if not group:
        return [], None
    labels = [str(x) for x in (group.get("labels") or [])]
    data_map = _dataset_map(group)
    pv_label, pv = _find_dataset(data_map, "pv", "page_view", "page views")
    _, users = _find_dataset(data_map, "user", "ユーザー")
    _, sessions = _find_dataset(data_map, "session", "セッション")
    rows = []
    for i, label in enumerate(labels):
        row: dict[str, Any] = {"date": label}
        if i < len(pv):
            row["page_views"] = _safe_number(pv[i])
        if i < len(users):
            row["users"] = _safe_number(users[i])
        if i < len(sessions):
            row["sessions"] = _safe_number(sessions[i])
        rows.append(row)
    return rows, pv_label


def _bar_rows(group: dict[str, Any] | None, label_key: str) -> list[dict[str, Any]]:
    if not group:
        return []
    labels = [str(x) for x in (group.get("labels") or [])]
    data_map = _dataset_map(group)
    rows: list[dict[str, Any]] = []
    for i, label in enumerate(labels[:20]):
        row: dict[str, Any] = {label_key: label}
        for ds_label, data in data_map.items():
            key = "sessions" if "セッション" in ds_label or "session" in ds_label.lower() else None
            if key is None and ("ユーザー" in ds_label or "user" in ds_label.lower()):
                key = "users"
            if key is None and ("pv" in ds_label.lower() or "PV" in ds_label):
                key = "page_views"
            if key and i < len(data):
                row[key] = _safe_number(data[i])
        rows.append(row)
    return rows


def _peak_day_breakdown(group: dict[str, Any] | None, peak_date: str | None, label_key: str) -> list[dict[str, Any]]:
    if not group or not peak_date:
        return []
    labels = [str(x) for x in (group.get("labels") or [])]
    if peak_date not in labels:
        return []
    idx = labels.index(peak_date)
    prev_idx = idx - 1 if idx > 0 else None
    rows = []
    for ds in group.get("datasets") or []:
        name = str(ds.get("label") or "")
        data = ds.get("data") if isinstance(ds.get("data"), list) else []
        value = _safe_number(data[idx]) if idx < len(data) else None
        prev = _safe_number(data[prev_idx]) if prev_idx is not None and prev_idx < len(data) else None
        rows.append({
            label_key: name,
            "value_on_peak_date": value,
            "previous_day_value": prev,
            "previous_day_rate": _rate(value, prev),
        })
    return sorted(rows, key=lambda r: r.get("value_on_peak_date") or 0, reverse=True)[:10]


def build_ai_analysis_context(payload: dict[str, Any], question: str, point_pack_md: str | None) -> dict[str, Any]:
    groups = payload.get("ai_chart_context") if isinstance(payload.get("ai_chart_context"), list) else []
    meta = payload.get("analysis_context_meta") if isinstance(payload.get("analysis_context_meta"), dict) else {}
    periods = meta.get("periods") if isinstance(meta.get("periods"), list) else []
    query_types = payload.get("bq_query_types") if isinstance(payload.get("bq_query_types"), list) else []

    pv_group = _find_group(groups, "pv")
    daily_rows, pv_label = _daily_rows_from_pv_group(pv_group)
    pv_values = [r.get("page_views") for r in daily_rows if r.get("page_views") is not None]
    max_row = max(daily_rows, key=lambda r: r.get("page_views") or -1, default=None)
    min_row = min([r for r in daily_rows if r.get("page_views") is not None], key=lambda r: r.get("page_views"), default=None)
    total = sum(float(v) for v in pv_values) if pv_values else None
    avg = round(total / len(pv_values), 1) if total is not None and pv_values else None

    peak_date = str(max_row.get("date")) if max_row else None
    peak_value = max_row.get("page_views") if max_row else None
    prev_value = None
    if peak_date:
        for i, row in enumerate(daily_rows):
            if row.get("date") == peak_date and i > 0:
                prev_value = daily_rows[i - 1].get("page_views")
                break
    prev_rate = _rate(peak_value, prev_value)
    avg_rate = _rate(peak_value, avg)

    source_bar = _bar_rows(_find_group(groups, "流入分析", "チャネル別"), "source_medium")
    landing_bar = _bar_rows(_find_group(groups, "lp分析", "セッション数"), "landing_page")
    device_bar = _bar_rows(_find_group(groups, "デバイス分析", "カテゴリ別"), "device")
    source_peak = _peak_day_breakdown(_find_group(groups, "流入分析", "top5"), peak_date, "source_medium")
    landing_peak = _peak_day_breakdown(_find_group(groups, "lp分析", "top5"), peak_date, "landing_page")
    device_peak = _peak_day_breakdown(_find_group(groups, "デバイス分析", "日別"), peak_date, "device")

    caveats = []
    if not daily_rows:
        caveats.append("日別PVのグラフデータが渡されていないため、最大日を確定できません。")
    if not source_peak:
        caveats.append("最大日のsource / medium別内訳は未取得、またはPVではなくセッション指標のみです。")
    if not landing_peak:
        caveats.append("最大日のランディングページ別内訳は未取得、またはPVではなくセッション指標のみです。")
    if not any(q in query_types for q in ("traffic", "landing", "device")):
        caveats.append("原因推定に必要な流入元・LP・デバイス分解クエリが一部不足している可能性があります。")
    caveats.append("広告配信、SNS投稿、メルマガなど外部施策の有無はGA4集計データだけでは確認できません。")

    findings = []
    if max_row:
        findings.append({
            "type": "spike",
            "title": "日別PVの最大日",
            "evidence": f"{peak_date} のPV数が {peak_value} で、日別PVテーブルの最大値です。",
            "metric": "page_views",
            "value": peak_value,
            "comparison": f"前日比 {prev_rate}%、月平均比 {avg_rate}%" if prev_rate is not None or avg_rate is not None else "比較値なし",
        })
    for row in (source_peak[:1] + landing_peak[:1] + device_peak[:1]):
        label = row.get("source_medium") or row.get("landing_page") or row.get("device")
        findings.append({
            "type": "comparison",
            "title": f"最大日の分解候補: {label}",
            "evidence": f"最大日に {row.get('value_on_peak_date')}、前日比 {row.get('previous_day_rate')}%。",
            "metric": "sessions",
            "value": row.get("value_on_peak_date"),
            "comparison": "PVではなくセッションベースの補助指標です。",
        })

    labels = [r["date"] for r in daily_rows]
    return {
        "question": question,
        "projectName": meta.get("projectName") or meta.get("caseName"),
        "propertyName": meta.get("propertyName"),
        "datasetId": meta.get("datasetId"),
        "dateRange": _period_to_range(periods, labels),
        "metricFocus": "page_views" if re.search(r"(pv|ページビュー|page\s*view)", question, re.I) else (pv_label or "unknown"),
        "chartContext": {
            "chartType": pv_group.get("chartType") if pv_group else None,
            "title": pv_group.get("title") if pv_group else None,
            "metric": "page_views",
            "dimension": "date",
        },
        "dataSummary": {
            "primaryMetric": "page_views",
            "total": int(total) if total is not None else None,
            "average": avg,
            "max": {"date": peak_date, "value": peak_value, "label": "最大PV日"} if max_row else None,
            "min": {"date": min_row.get("date"), "value": min_row.get("page_views"), "label": "最低PV日"} if min_row else None,
            "previousPeriodComparison": {
                "value": prev_value,
                "rate": prev_rate,
                "direction": _direction(prev_rate),
            },
            "averageComparison": {
                "value": avg,
                "rate": avg_rate,
                "direction": _direction(avg_rate),
            },
        },
        "tables": {
            "daily": daily_rows[:62],
            "sourceMedium": source_peak or source_bar[:10],
            "landingPage": landing_peak or landing_bar[:10],
            "campaign": [],
            "device": device_peak or device_bar[:10],
        },
        "detectedFindings": findings,
        "caveats": caveats,
        "pointPackSummary": {
            "chars": len(point_pack_md or ""),
            "queryTypes": query_types,
        },
    }


def apply_pv_spike_diagnostic_to_context(context: dict[str, Any], diagnostic: dict[str, Any]) -> dict[str, Any]:
    """BigQueryで確定したPV診断を既存AI contextへ合流する。"""
    if not diagnostic:
        return context
    peak = diagnostic.get("peak") if isinstance(diagnostic.get("peak"), dict) else {}
    breakdowns = diagnostic.get("breakdowns") if isinstance(diagnostic.get("breakdowns"), dict) else {}

    context["pvSpikeDiagnostic"] = diagnostic
    context["metricFocus"] = "page_views"
    context["dateRange"] = diagnostic.get("dateRange") or context.get("dateRange")

    data_summary = context.setdefault("dataSummary", {})
    data_summary["primaryMetric"] = "page_views"
    if peak.get("date"):
        data_summary["max"] = {"date": peak.get("date"), "value": peak.get("pageViews"), "label": "最大PV日"}
    if peak.get("periodAveragePageViews") is not None:
        data_summary["average"] = peak.get("periodAveragePageViews")
        data_summary["averageComparison"] = {
            "value": peak.get("periodAveragePageViews"),
            "rate": peak.get("periodAverageDeltaRate"),
            "direction": _direction(peak.get("periodAverageDeltaRate")),
        }
    data_summary["previousPeriodComparison"] = {
        "value": peak.get("previousDayPageViews"),
        "rate": peak.get("previousDayDeltaRate"),
        "direction": _direction(peak.get("previousDayDeltaRate")),
    }

    tables = context.setdefault("tables", {})
    for axis in ("sourceMedium", "landingPage", "campaign", "device"):
        values = breakdowns.get(axis)
        if isinstance(values, list):
            tables[axis] = values
    session_landing = diagnostic.get("sessionLandingPageDiagnostic") if isinstance(diagnostic.get("sessionLandingPageDiagnostic"), dict) else {}
    session_landing_pages = session_landing.get("topLandingPages") if isinstance(session_landing.get("topLandingPages"), list) else []
    if session_landing_pages:
        tables["sessionLandingPage"] = session_landing_pages

    findings = context.setdefault("detectedFindings", [])
    if peak.get("date"):
        findings.insert(0, {
            "type": "spike",
            "title": "BigQuery PV診断で確定した最大PV日",
            "evidence": (
                f"{peak.get('date')} のPV数は {peak.get('pageViews')}。"
                f"前日比 {peak.get('previousDayDeltaRate')}%、期間平均比 {peak.get('periodAverageDeltaRate')}%。"
            ),
            "metric": "page_views",
            "value": peak.get("pageViews"),
            "comparison": "BigQuery event_name='page_view' ベースでPython集計済み",
        })

    if session_landing_pages:
        top_session_lp = session_landing_pages[0]
        findings.append({
            "type": "comparison",
            "title": f"厳密セッションLP別PV増加寄与候補: {top_session_lp.get('landingPagePath') or top_session_lp.get('landingPageUrl')}",
            "evidence": (
                f"セッションLP定義では最大日PV {top_session_lp.get('peakDayPageViews')}、"
                f"前日PV {top_session_lp.get('previousDayPageViews')}、差分 {top_session_lp.get('delta')}、"
                f"寄与度 {top_session_lp.get('contributionToIncrease')}%。"
            ),
            "metric": "page_views",
            "value": top_session_lp.get("peakDayPageViews"),
            "comparison": "user_pseudo_id + ga_session_id ごとの最初のpage_viewをLPにした前日比較",
        })

    for axis, label_key in (
        ("sourceMedium", "sourceMedium"),
        ("landingPage", "landingPage"),
        ("campaign", "campaign"),
        ("device", "device"),
    ):
        top = (breakdowns.get(axis) or [])[:1]
        if top:
            row = top[0]
            findings.append({
                "type": "comparison",
                "title": f"PV増加寄与候補: {row.get(label_key)}",
                "evidence": (
                    f"最大日PV {row.get('peakDayPageViews')}、前日PV {row.get('previousDayPageViews')}、"
                    f"差分 {row.get('delta')}、寄与度 {row.get('contributionToIncrease')}%。"
                ),
                "metric": "page_views",
                "value": row.get("peakDayPageViews"),
                "comparison": f"{axis}別PVの前日比較",
            })

    merged_caveats = list(context.get("caveats") or []) + list(diagnostic.get("caveats") or [])
    context["caveats"] = list(dict.fromkeys([c for c in merged_caveats if c]))
    return context


def summarize_ai_context_for_log(context: dict[str, Any]) -> dict[str, Any]:
    tables = context.get("tables") if isinstance(context.get("tables"), dict) else {}
    diagnostic = context.get("pvSpikeDiagnostic") if isinstance(context.get("pvSpikeDiagnostic"), dict) else {}
    breakdowns = diagnostic.get("breakdowns") if isinstance(diagnostic.get("breakdowns"), dict) else {}
    session_landing = diagnostic.get("sessionLandingPageDiagnostic") if isinstance(diagnostic.get("sessionLandingPageDiagnostic"), dict) else {}
    return {
        "question": context.get("question"),
        "projectName": context.get("projectName"),
        "propertyName": context.get("propertyName"),
        "datasetId": context.get("datasetId"),
        "dateRange": context.get("dateRange"),
        "metricFocus": context.get("metricFocus"),
        "dataSummary": context.get("dataSummary"),
        "tableRows": {k: len(v) for k, v in tables.items() if isinstance(v, list)},
        "pvSpikePeak": diagnostic.get("peak"),
        "pvSpikeBreakdownRows": {k: len(v) for k, v in breakdowns.items() if isinstance(v, list)},
        "sessionLandingPageDiagnostic": {
            "method": session_landing.get("method"),
            "sessionKeyMethod": session_landing.get("sessionKeyMethod"),
            "landingPageDefinition": session_landing.get("landingPageDefinition"),
            "topLandingPages": (session_landing.get("topLandingPages") or [])[:3],
            "totals": session_landing.get("totals"),
        } if session_landing else None,
        "findings": len(context.get("detectedFindings") or []),
        "caveats": context.get("caveats"),
    }


def redact_for_log(value: Any, max_string: int = 4000) -> Any:
    if isinstance(value, dict):
        return {
            k: ("[REDACTED]" if SECRET_KEY_RE.search(str(k)) else redact_for_log(v, max_string=max_string))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [redact_for_log(v, max_string=max_string) for v in value[:20]]
    if isinstance(value, str):
        return value[:max_string]
    return value


def log_ai_debug(logger: Any, event: str, request_id: str, payload: dict[str, Any]) -> None:
    if not is_ai_debug_enabled():
        return
    try:
        logger.info("[ai-analysis-debug] %s %s %s", request_id, event, json.dumps(redact_for_log(payload), ensure_ascii=False, default=str))
    except Exception:
        logger.info("[ai-analysis-debug] %s %s <log serialization failed>", request_id, event)


def extract_json_object(raw: str) -> tuple[dict[str, Any] | None, str | None]:
    text = (raw or "").strip()
    if not text:
        return None, "empty_response"
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, flags=re.I)
    candidates = []
    if fence:
        candidates.append(fence.group(1).strip())
    candidates.append(text)
    first = text.find("{")
    last = text.rfind("}")
    if first >= 0 and last > first:
        candidates.append(text[first:last + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed, None
            return None, "json_root_not_object"
        except Exception as exc:
            last_error = str(exc)
    return None, last_error if "last_error" in locals() else "json_parse_failed"


def _text_from_structured(parsed: dict[str, Any]) -> str | None:
    for key in ("answer_markdown", "text", "message", "content", "markdown", "answer", "direct_answer"):
        val = parsed.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    parts = []
    if isinstance(parsed.get("direct_answer"), str):
        parts.append(f"## 結論\n{parsed['direct_answer'].strip()}")
    if isinstance(parsed.get("facts"), list) and parsed["facts"]:
        parts.append("## 数値根拠\n" + "\n".join(f"- {f.get('label', '根拠')}: {f.get('value', '')}（{f.get('evidence', '')}）" for f in parsed["facts"] if isinstance(f, dict)))
    if isinstance(parsed.get("hypotheses"), list) and parsed["hypotheses"]:
        parts.append("## 仮説\n" + "\n".join(f"- {h.get('title', '仮説')}: {h.get('reason', '')}" for h in parsed["hypotheses"] if isinstance(h, dict)))
    if isinstance(parsed.get("next_actions"), list) and parsed["next_actions"]:
        parts.append("## 次に見るべきこと\n" + "\n".join(f"- {x}" for x in parsed["next_actions"] if isinstance(x, str)))
    return "\n\n".join(parts).strip() or None


def normalize_ai_model_response(raw: str, *, context: dict[str, Any] | None = None) -> dict[str, Any]:
    raw_text = (raw or "").strip()
    if not raw_text:
        detail = "AIから回答が返りませんでした。時間を置いて再試行してください。"
        return {
            "ok": False,
            "error_code": "empty_ai_response",
            "detail": detail,
            "message": detail,
            "text": detail,
            "parse_status": "empty",
            "fallback_used": True,
        }

    parsed, parse_error = extract_json_object(raw_text)
    if parsed is not None:
        answer = _text_from_structured(parsed)
        if answer:
            result = {
                "ok": True,
                "text": answer,
                "answer_markdown": answer,
                "direct_answer": parsed.get("direct_answer"),
                "facts": parsed.get("facts") if isinstance(parsed.get("facts"), list) else [],
                "hypotheses": parsed.get("hypotheses") if isinstance(parsed.get("hypotheses"), list) else [],
                "next_actions": parsed.get("next_actions") if isinstance(parsed.get("next_actions"), list) else [],
                "confidence": parsed.get("confidence"),
                "caveats": parsed.get("caveats") if isinstance(parsed.get("caveats"), list) else [],
                "raw_response": raw_text,
                "parse_status": "json",
                "fallback_used": False,
            }
            if context:
                result["analysis_context"] = summarize_ai_context_for_log(context)
            return result
        parse_error = "json_missing_answer_markdown"

    result = {
        "ok": True,
        "text": raw_text,
        "answer_markdown": raw_text,
        "raw_response": raw_text,
        "parse_status": "raw_fallback",
        "parse_error": parse_error,
        "fallback_used": True,
        "fallback_notice": "形式整形に失敗したため、AIの生回答を表示しています。",
        "caveats": [],
    }
    if context:
        result["analysis_context"] = summarize_ai_context_for_log(context)
    return result


def ai_json_output_contract() -> str:
    return """
━━━ AI考察の最重要方針 ━━━
あなたはGA4、BigQuery、Google広告、Webマーケティングに詳しいシニア広告運用者です。
あなたに渡される数値は、Python / BigQueryで計算済みの確定値です。
あなたは数値を再計算しないでください。存在しない数値を補完しないでください。
数値・ランキング・平均との差分・前日比・構成比・寄与度は、必ず提供された AI_ANALYSIS_CONTEXT と要点パックに含まれる確定済みデータだけを根拠にしてください。
PV最大日や急増理由を聞かれた場合は、AI_ANALYSIS_CONTEXT.pvSpikeDiagnostic を最優先の根拠にしてください。
LP原因分析では、AI_ANALYSIS_CONTEXT.pvSpikeDiagnostic.sessionLandingPageDiagnostic がある場合、それを最優先してください。
これは単純なURL別PVではなく、user_pseudo_id + ga_session_id ごとの最初のpage_viewをLPとして定義し、そのLPから始まったセッション群が対象日のpage_viewにどれだけ寄与したかを示します。
page_location別PVとセッションLPは別物です。page_location別PVは「そのページが何回見られたか」、セッションLPは「そのページから始まったセッションがどれだけPVに寄与したか」です。
LP原因を述べるときは、必ず「厳密なセッションLP定義」または「page_location別PV」のどちらを使っているか明記してください。
原因は、breakdownsにある差分・構成比・寄与度から「仮説」として述べてください。
原因を断定できない場合は、断定できないと明記してください。
campaign が (organic) の場合、それは広告キャンペーン名ではなく、自然検索流入のcampaign属性として扱ってください。広告キャンペーン施策が実施されたと断定してはいけません。
sessionLandingPageDiagnostic がない場合のみ、従来の landingPage breakdown をfallbackとして使ってください。その場合のLP候補は page_view の page_location ベースであり、厳密なセッションLPではないと明記してください。

回答では以下を守ってください。
1. 最初に質問への結論を一文で答える
2. 数値根拠を明示する
3. 事実と仮説を分ける
4. 初心者にも分かる言葉で説明する
5. 原因を断定できない場合は、断定できないと明記する
6. 次に見るべき分析軸を提案する
7. 広告運用・サイト改善の打ち手があれば提案する
8. 存在しないデータ、渡されていないデータ、未確認の施策を捏造しない
9. 回答は日本語
10. 出力は必ず次のJSON形式だけにする。JSONの前後に文章を書かない。

answer_markdown は必ず次の見出し構成にしてください。
## 結論
## 数値根拠
## 原因として考えられること
## まだ断定できないこと
## 次に確認すべきこと
## 打ち手

{
  "answer_markdown": "ユーザーに表示するMarkdown本文",
  "direct_answer": "質問への短い結論",
  "facts": [
    {"label": "最大PV日", "value": "YYYY-MM-DD", "evidence": "日別PVテーブルで最大"}
  ],
  "hypotheses": [
    {"title": "仮説タイトル", "reason": "提供データに基づく理由", "confidence": "low|medium|high"}
  ],
  "next_actions": ["次に確認すべき分析軸"],
  "confidence": "low|medium|high",
  "caveats": ["断定できない理由やデータ不足"]
}
""".strip()
