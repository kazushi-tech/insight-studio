"""BQ DataFrameからChart.js用データを生成するヘルパー。

クエリタイプごとに異なるカラム構成に対応し、
フロントエンドのChart.jsで描画可能なJSON構造を返す。
"""

from __future__ import annotations

import re
import json
from typing import Any

import numpy as np
import pandas as pd


def _to_native(v):
    """numpy型をPythonネイティブ型に変換（JSON互換）。"""
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    if isinstance(v, np.bool_):
        return bool(v)
    return v


# Chart.js カラーパレット（GA4分析用）
# V3.9: alpha 0.18→0.55 で視認性改善（棒グラフ用）
_COLORS = [
    {"border": "rgba(37, 99, 235, 1)", "bg": "rgba(37, 99, 235, 0.55)"},      # blue
    {"border": "rgba(79, 70, 229, 1)", "bg": "rgba(79, 70, 229, 0.55)"},      # indigo
    {"border": "rgba(15, 118, 110, 1)", "bg": "rgba(15, 118, 110, 0.55)"},    # teal
    {"border": "rgba(220, 38, 38, 1)", "bg": "rgba(220, 38, 38, 0.55)"},      # red
    {"border": "rgba(180, 83, 9, 1)", "bg": "rgba(180, 83, 9, 0.55)"},        # amber
    {"border": "rgba(67, 56, 202, 1)", "bg": "rgba(67, 56, 202, 0.55)"},      # violet
]


def _color(i: int) -> dict:
    return _COLORS[i % len(_COLORS)]


def _safe_list(series: pd.Series) -> list:
    """pandas Series を JSON-safe な list に変換（NaN → None, numpy型 → Python型）。"""
    out = []
    for v in series:
        if pd.isna(v):
            out.append(None)
            continue
        native = _to_native(v)
        if isinstance(native, float) and not np.isfinite(native):
            out.append(None)
            continue
        out.append(native)
    return out


def _is_missing_label(value: Any) -> bool:
    """ランキング軸として読めないラベルを欠損扱いにする。"""
    if pd.isna(value):
        return True
    s = str(value).strip()
    return s == "" or s.lower() in {"none", "nan", "null"}


def _valid_label_mask(series: pd.Series) -> pd.Series:
    return ~series.map(_is_missing_label)


def _coverage_label(actual_count: int, limit: int) -> str:
    return f"上位{actual_count}件 / 最大{limit}件"


def _ranking_meta(
    query_type: str,
    *,
    limit: int,
    actual_count: int,
    source_row_count: int,
    missing_label_count: int = 0,
) -> dict[str, Any]:
    warnings: list[str] = []
    if actual_count < limit:
        warnings.append("low_sample")
    if missing_label_count:
        warnings.append("missing_label")

    return {
        "queryType": query_type,
        "limit": limit,
        "actualCount": actual_count,
        "sourceRowCount": source_row_count,
        "coverageLabel": _coverage_label(actual_count, limit),
        "warnings": warnings,
        "missingLabelCount": missing_label_count,
    }


def _with_meta(group: dict[str, Any], meta: dict[str, Any]) -> dict[str, Any]:
    return {**group, **meta}


def _short_url(value: Any) -> str:
    s = str(value)
    return s.split("//")[-1].split("?")[0] if "//" in s else s


def build_bq_chart_data(df: pd.DataFrame, query_type: str) -> dict[str, Any]:
    """BQ DataFrameからChart.js用データを生成する。

    Returns:
        {"groups": [{"title": str, "chartType": str, "labels": [...], "datasets": [...]}]}
    """
    if df is None or df.empty:
        return {"groups": []}

    builder = _BUILDERS.get(query_type)
    if builder is None:
        return {"groups": []}

    return {"groups": builder(df)}


# ========== PV分析 ==========
def _build_pv(df: pd.DataFrame) -> list[dict]:
    """日別PV・ユーザー・セッションの折れ線グラフ。"""
    # event_date ごとに集約
    agg = df.groupby("event_date", as_index=False).agg({
        "users": "sum",
        "sessions": "sum",
        "page_views": "sum",
    }).sort_values("event_date")

    labels = agg["event_date"].astype(str).tolist()
    metrics = [
        ("users", "ユーザー数"),
        ("sessions", "セッション数"),
        ("page_views", "PV数"),
    ]

    datasets = []
    for i, (col, label) in enumerate(metrics):
        if col in agg.columns:
            c = _color(i)
            datasets.append({
                "label": label,
                "data": _safe_list(agg[col]),
                "borderColor": c["border"],
                "backgroundColor": c["bg"],
                "tension": 0.3,
                "fill": False,
            })

    return [{"title": "PV分析 — 日別推移", "chartType": "line", "labels": labels, "datasets": datasets}]


# ========== 流入分析（V3.3: 既存ランキング + 日別推移） ==========
def _build_traffic(df: pd.DataFrame) -> list[dict]:
    """チャネル別セッション・ユーザーの横棒グラフ（上位15）+ 日別推移。"""
    groups = []
    limit = 15
    trend_limit = 5
    # 再集計: source/medium単位で集約（日別明細から）
    agg = df.groupby(["source", "medium"], as_index=False).agg({
        "sessions": "sum", "users": "sum", "page_views": "sum",
    }).sort_values("sessions", ascending=False)
    top = agg.head(limit).copy()
    top["channel"] = top["source"].astype(str) + " / " + top["medium"].astype(str)
    labels = top["channel"].tolist()
    meta = _ranking_meta("traffic", limit=limit, actual_count=len(top), source_row_count=len(agg))
    meta["selectionLabel"] = f"セッション数上位{len(top)}チャネルを表示"

    datasets = []
    for i, (col, label) in enumerate([("sessions", "セッション"), ("users", "ユーザー")]):
        if col in top.columns:
            c = _color(i)
            datasets.append({
                "label": label,
                "data": _safe_list(top[col]),
                "backgroundColor": c["bg"],
                "borderColor": c["border"],
                "borderWidth": 1,
            })
    groups.append(_with_meta({"title": f"流入分析 — セッション数上位{len(top)}チャネル", "chartType": "bar_horizontal", "labels": labels, "datasets": datasets}, meta))

    # V3.3: 上位チャネルの日別セッション推移
    if "event_date" in df.columns:
        top5_channels = top.head(trend_limit)
        df["channel"] = df["source"].astype(str) + " / " + df["medium"].astype(str)
        daily = df[df["channel"].isin(top5_channels["channel"].tolist())]
        if not daily.empty:
            pivot = daily.pivot_table(index="event_date", columns="channel", values="sessions", aggfunc="sum").fillna(0).sort_index()
            d_labels = [str(d) for d in pivot.index.tolist()]
            d_datasets = []
            for i, ch in enumerate(pivot.columns):
                c = _color(i)
                d_datasets.append({
                    "label": ch, "data": _safe_list(pivot[ch]),
                    "borderColor": c["border"], "backgroundColor": c["bg"],
                    "tension": 0.3, "fill": False,
                })
            trend_meta = _ranking_meta("traffic", limit=trend_limit, actual_count=len(top5_channels), source_row_count=len(agg))
            trend_meta["selectionLabel"] = f"セッション数上位{len(top5_channels)}チャネルを表示"
            groups.append(_with_meta({"title": f"流入分析 — セッション数上位{len(top5_channels)}チャネルの日別推移", "chartType": "line", "labels": d_labels, "datasets": d_datasets}, trend_meta))

    return groups


# ========== CV分析 ==========
def _build_cv(df: pd.DataFrame) -> list[dict]:
    """コンバージョンイベント別件数の日別推移。"""
    groups = []

    # イベント名ごとにグループ化
    events = df["event_name"].unique().tolist()

    # 日別推移（各イベント重ねて表示）
    pivot = df.pivot_table(index="event_date", columns="event_name", values="event_count", aggfunc="sum").fillna(0)
    pivot = pivot.sort_index()
    labels = [str(d) for d in pivot.index.tolist()]

    datasets = []
    for i, ev in enumerate(events):
        if ev in pivot.columns:
            c = _color(i)
            datasets.append({
                "label": ev,
                "data": _safe_list(pivot[ev]),
                "borderColor": c["border"],
                "backgroundColor": c["bg"],
                "tension": 0.3,
                "fill": False,
            })

    groups.append({"title": "CV分析 — イベント別日別推移", "chartType": "line", "labels": labels, "datasets": datasets})
    return groups


# ========== 検索クエリ分析（V3.3: 既存ランキング + 日別推移） ==========
def _build_search(df: pd.DataFrame) -> list[dict]:
    """検索キーワード上位20の棒グラフ + 日別推移。"""
    groups = []
    limit = 20
    trend_limit = 10
    valid_df = df[_valid_label_mask(df["search_term"])].copy()
    missing_label_count = int(len(df) - len(valid_df))
    if valid_df.empty:
        return groups

    # 再集計: search_term単位で集約
    agg = valid_df.groupby("search_term", as_index=False).agg({
        "search_count": "sum", "unique_searchers": "sum",
    }).sort_values("search_count", ascending=False)
    top = agg.head(limit)
    labels = top["search_term"].astype(str).tolist()
    meta = _ranking_meta(
        "search",
        limit=limit,
        actual_count=len(top),
        source_row_count=len(agg),
        missing_label_count=missing_label_count,
    )
    meta["selectionLabel"] = f"検索回数上位{len(top)}語を表示"

    c = _color(0)
    datasets = [{
        "label": "検索回数",
        "data": _safe_list(top["search_count"]),
        "backgroundColor": c["bg"],
        "borderColor": c["border"],
        "borderWidth": 1,
    }]
    groups.append(_with_meta({
        "title": f"検索クエリ — 検索回数上位{len(top)}語",
        "chartType": "bar_horizontal",
        "labels": labels,
        "datasets": datasets,
    }, meta))

    # V3.3: 上位キーワードの日別検索推移
    if "event_date" in df.columns:
        top10_terms = agg.head(trend_limit)["search_term"].tolist()
        daily = valid_df[valid_df["search_term"].isin(top10_terms)]
        if not daily.empty:
            pivot = daily.pivot_table(index="event_date", columns="search_term", values="search_count", aggfunc="sum").fillna(0).sort_index()
            d_labels = [str(d) for d in pivot.index.tolist()]
            d_datasets = []
            for i, term in enumerate(pivot.columns):
                c = _color(i)
                d_datasets.append({
                    "label": str(term), "data": _safe_list(pivot[term]),
                    "borderColor": c["border"], "backgroundColor": c["bg"],
                    "tension": 0.3, "fill": False,
                })
            trend_meta = _ranking_meta(
                "search",
                limit=trend_limit,
                actual_count=len(top10_terms),
                source_row_count=len(agg),
                missing_label_count=missing_label_count,
            )
            trend_meta["selectionLabel"] = f"検索回数上位{len(top10_terms)}語を表示"
            groups.append(_with_meta({
                "title": f"検索クエリ — 検索回数上位{len(top10_terms)}語の日別推移",
                "chartType": "line",
                "labels": d_labels,
                "datasets": d_datasets,
            }, trend_meta))

    return groups


# ========== 異常検知 ==========
def _build_anomaly(df: pd.DataFrame) -> list[dict]:
    """日別メトリクスとZ-scoreの折れ線グラフ。"""
    groups = []
    agg = df.sort_values("event_date")
    labels = agg["event_date"].astype(str).tolist()

    # メトリクス推移
    metric_datasets = []
    for i, (col, label) in enumerate([("users", "ユーザー"), ("sessions", "セッション"), ("page_views", "PV")]):
        if col in agg.columns:
            c = _color(i)
            metric_datasets.append({
                "label": label,
                "data": _safe_list(agg[col]),
                "borderColor": c["border"],
                "backgroundColor": c["bg"],
                "tension": 0.3,
                "fill": False,
            })
    groups.append({"title": "異常検知 — メトリクス推移", "chartType": "line", "labels": labels, "datasets": metric_datasets})

    # Z-score推移
    zscore_datasets = []
    for i, (col, label) in enumerate([("users_zscore", "Users Z"), ("sessions_zscore", "Sessions Z"), ("pv_zscore", "PV Z")]):
        if col in agg.columns:
            c = _color(i + 3)
            zscore_datasets.append({
                "label": label,
                "data": _safe_list(agg[col]),
                "borderColor": c["border"],
                "backgroundColor": c["bg"],
                "tension": 0.3,
                "fill": False,
            })
    if zscore_datasets:
        groups.append({"title": "異常検知 — Z-score", "chartType": "line", "labels": labels, "datasets": zscore_datasets})

    return groups


# ========== LP分析（V3.3: 既存ランキング + 日別推移） ==========
def _build_landing(df: pd.DataFrame) -> list[dict]:
    """ランディングページ上位20のセッション数と直帰率 + 日別推移。"""
    groups = []
    limit = 20
    trend_limit = 5
    valid_df = df[_valid_label_mask(df["landing_page"])].copy()
    missing_label_count = int(len(df) - len(valid_df))
    if valid_df.empty:
        return groups

    # 再集計: landing_page単位で集約
    agg = valid_df.groupby("landing_page", as_index=False).agg({
        "sessions": "sum",
        "avg_pages_per_session": "mean",
        "bounce_sessions": "sum" if "bounce_sessions" in df.columns else "count",
    }).sort_values("sessions", ascending=False)
    if "bounce_sessions" in agg.columns and "sessions" in agg.columns:
        agg["bounce_rate"] = agg["bounce_sessions"] / agg["sessions"]
    elif "bounce_rate" not in agg.columns:
        agg["bounce_rate"] = 0

    top = agg.head(limit).copy()
    meta = _ranking_meta(
        "landing",
        limit=limit,
        actual_count=len(top),
        source_row_count=len(agg),
        missing_label_count=missing_label_count,
    )
    meta["selectionLabel"] = f"セッション数上位{len(top)}LPを表示"
    # URLを短く表示（ドメイン部分を除去）
    top["short_page"] = top["landing_page"].apply(_short_url)
    labels = top["short_page"].tolist()

    # セッション数
    c0 = _color(0)
    groups.append(_with_meta({
        "title": f"LP分析 — セッション数上位{len(top)}LP",
        "chartType": "bar_horizontal",
        "labels": labels,
        "datasets": [{
            "label": "セッション",
            "data": _safe_list(top["sessions"]),
            "backgroundColor": c0["bg"],
            "borderColor": c0["border"],
            "borderWidth": 1,
        }],
    }, meta))

    # 直帰率（%変換）
    if "bounce_rate" in top.columns:
        c1 = _color(3)
        bounce_pct = [None if pd.isna(v) or not np.isfinite(float(v)) else round(float(v) * 100, 1) for v in top["bounce_rate"]]
        bounce_meta = {**meta, "selectionLabel": f"直帰率上位{len(top)}LPを表示"}
        finite_bounce = [v for v in bounce_pct if v is not None]
        if len(finite_bounce) > 1 and len(set(finite_bounce)) == 1:
            bounce_meta["warnings"] = [*bounce_meta.get("warnings", []), "flat_series"]
        bounce_rows = []
        for _, row in top.iterrows():
            sessions = None if pd.isna(row.get("sessions")) else int(row.get("sessions", 0))
            bounce_sessions = None if pd.isna(row.get("bounce_sessions")) else int(row.get("bounce_sessions", 0))
            bounce_rate = None if pd.isna(row.get("bounce_rate")) else round(float(row.get("bounce_rate", 0)) * 100, 1)
            bounce_rows.append({
                "label": str(row.get("short_page", row.get("landing_page", ""))),
                "sessions": sessions,
                "bounceSessions": bounce_sessions,
                "bounceRate": bounce_rate,
            })
        groups.append(_with_meta({
            "title": f"LP分析 — 直帰率上位{len(top)}LP",
            "chartType": "bar_horizontal",
            "labels": labels,
            "datasets": [{
                "label": "直帰率 (%)",
                "data": bounce_pct,
                "backgroundColor": c1["bg"],
                "borderColor": c1["border"],
                "borderWidth": 1,
            }],
            "rows": bounce_rows,
        }, bounce_meta))

    # V3.3: 上位LPの日別セッション推移
    if "event_date" in df.columns:
        top_pages = agg.head(trend_limit)["landing_page"].tolist()
        daily = valid_df[valid_df["landing_page"].isin(top_pages)]
        if not daily.empty:
            daily = daily.copy()
            daily["short_page"] = daily["landing_page"].apply(_short_url)
            pivot = daily.pivot_table(index="event_date", columns="short_page", values="sessions", aggfunc="sum").fillna(0).sort_index()
            d_labels = [str(d) for d in pivot.index.tolist()]
            d_datasets = []
            for i, page in enumerate(pivot.columns):
                c = _color(i)
                d_datasets.append({
                    "label": str(page), "data": _safe_list(pivot[page]),
                    "borderColor": c["border"], "backgroundColor": c["bg"],
                    "tension": 0.3, "fill": False,
                })
            trend_meta = _ranking_meta(
                "landing",
                limit=trend_limit,
                actual_count=len(top_pages),
                source_row_count=len(agg),
                missing_label_count=missing_label_count,
            )
            trend_meta["selectionLabel"] = f"セッション数上位{len(top_pages)}LPを表示"
            groups.append(_with_meta({
                "title": f"LP分析 — セッション数上位{len(top_pages)}LPの日別推移",
                "chartType": "line",
                "labels": d_labels,
                "datasets": d_datasets,
            }, trend_meta))

    return groups


# ========== デバイス分析（V3.3: 既存ランキング + 日別推移） ==========
def _build_device(df: pd.DataFrame) -> list[dict]:
    """デバイスカテゴリ別セッション・ユーザーの横棒グラフ + 日別推移。"""
    groups = []
    # デバイスカテゴリ別に集約（日別明細から再集計）
    agg = df.groupby("device_category", as_index=False).agg({
        "sessions": "sum",
        "users": "sum",
        "page_views": "sum",
    }).sort_values("sessions", ascending=False)

    labels = agg["device_category"].astype(str).tolist()

    datasets = []
    for i, (col, label) in enumerate([("sessions", "セッション"), ("users", "ユーザー"), ("page_views", "PV")]):
        if col in agg.columns:
            c = _color(i)
            datasets.append({
                "label": label,
                "data": _safe_list(agg[col]),
                "backgroundColor": c["bg"],
                "borderColor": c["border"],
                "borderWidth": 1,
            })

    groups.append({"title": "デバイス分析 — カテゴリ別", "chartType": "bar_horizontal", "labels": labels, "datasets": datasets})

    # OS別の内訳
    if "os" in df.columns:
        os_limit = 10
        os_valid_df = df[_valid_label_mask(df["os"])].copy()
        os_missing_label_count = int(len(df) - len(os_valid_df))
        os_agg = os_valid_df.groupby("os", as_index=False).agg({"sessions": "sum"}).sort_values("sessions", ascending=False)
        os_top = os_agg.head(os_limit)
        if not os_top.empty:
            os_meta = _ranking_meta(
                "device",
                limit=os_limit,
                actual_count=len(os_top),
                source_row_count=len(os_agg),
                missing_label_count=os_missing_label_count,
            )
            os_meta["selectionLabel"] = f"セッション数上位{len(os_top)}OSを表示"
            os_labels = os_top["os"].astype(str).tolist()
            c = _color(4)
            groups.append(_with_meta({
                "title": f"デバイス分析 — セッション数上位{len(os_top)}OS",
                "chartType": "bar_horizontal",
                "labels": os_labels,
                "datasets": [{
                    "label": "セッション",
                    "data": _safe_list(os_top["sessions"]),
                    "backgroundColor": c["bg"],
                    "borderColor": c["border"],
                    "borderWidth": 1,
                }],
            }, os_meta))

    # V3.3: デバイスカテゴリ別日別推移
    if "event_date" in df.columns:
        daily = df.groupby(["event_date", "device_category"], as_index=False).agg({"sessions": "sum"})
        if not daily.empty:
            pivot = daily.pivot_table(index="event_date", columns="device_category", values="sessions", aggfunc="sum").fillna(0).sort_index()
            d_labels = [str(d) for d in pivot.index.tolist()]
            d_datasets = []
            for i, cat in enumerate(pivot.columns):
                c = _color(i)
                d_datasets.append({
                    "label": str(cat), "data": _safe_list(pivot[cat]),
                    "borderColor": c["border"], "backgroundColor": c["bg"],
                    "tension": 0.3, "fill": False,
                })
            groups.append({"title": "デバイス分析 — 日別推移", "chartType": "line", "labels": d_labels, "datasets": d_datasets})

    return groups


# ========== 時間帯分析 ==========
def _build_hourly(df: pd.DataFrame) -> list[dict]:
    """時間帯別アクセス傾向の折れ線グラフ（0-23時）。"""
    agg = df.sort_values("hour_of_day")
    labels = [f"{int(h)}時" for h in agg["hour_of_day"]]

    metrics = [
        ("sessions", "セッション"),
        ("users", "ユーザー"),
        ("page_views", "PV"),
    ]
    datasets = []
    for i, (col, label) in enumerate(metrics):
        if col in agg.columns:
            c = _color(i)
            datasets.append({
                "label": label,
                "data": _safe_list(agg[col]),
                "borderColor": c["border"],
                "backgroundColor": c["bg"],
                "tension": 0.3,
                "fill": False,
            })

    return [{"title": "時間帯分析 — 時間別アクセス推移", "chartType": "line", "labels": labels, "datasets": datasets}]


# ========== ユーザー属性分析 ==========
def _build_user_attr(df: pd.DataFrame) -> list[dict]:
    """新規/リピーター比率と地域別セッション。"""
    groups = []

    # 新規/リピーター比率
    type_agg = df.groupby("user_type", as_index=False).agg({"users": "sum", "sessions": "sum"})
    type_labels = type_agg["user_type"].map({"new": "新規", "returning": "リピーター"}).fillna(type_agg["user_type"]).tolist()
    c0, c1 = _color(0), _color(3)
    groups.append({
        "title": "ユーザー属性 — 新規/リピーター",
        "chartType": "bar_horizontal",
        "labels": type_labels,
        "datasets": [
            {"label": "ユーザー", "data": _safe_list(type_agg["users"]), "backgroundColor": c0["bg"], "borderColor": c0["border"], "borderWidth": 1},
            {"label": "セッション", "data": _safe_list(type_agg["sessions"]), "backgroundColor": c1["bg"], "borderColor": c1["border"], "borderWidth": 1},
        ],
    })

    # 地域別（上位15都市）
    city_limit = 15
    city_valid_mask = _valid_label_mask(df["city"]) & (df["city"] != "(not set)")
    city_valid_df = df[city_valid_mask].copy()
    city_missing_label_count = int(len(df) - len(city_valid_df))
    city_agg = city_valid_df.groupby("city", as_index=False).agg({"sessions": "sum"}).sort_values("sessions", ascending=False)
    city_top = city_agg.head(city_limit)
    if not city_top.empty:
        city_meta = _ranking_meta(
            "user_attr",
            limit=city_limit,
            actual_count=len(city_top),
            source_row_count=len(city_agg),
            missing_label_count=city_missing_label_count,
        )
        city_meta["selectionLabel"] = f"セッション数上位{len(city_top)}地域を表示"
        c2 = _color(2)
        groups.append(_with_meta({
            "title": f"ユーザー属性 — セッション数上位{len(city_top)}地域",
            "chartType": "bar_horizontal",
            "labels": city_top["city"].astype(str).tolist(),
            "datasets": [{
                "label": "セッション",
                "data": _safe_list(city_top["sessions"]),
                "backgroundColor": c2["bg"],
                "borderColor": c2["border"],
                "borderWidth": 1,
            }],
        }, city_meta))

    return groups


# ========== V3.3: エンゲージメント時間分析 ==========
def _build_engagement(df: pd.DataFrame) -> list[dict]:
    """日別エンゲージメント時間の折れ線グラフ（合計/平均）。"""
    agg = df.sort_values("event_date")
    labels = agg["event_date"].astype(str).tolist()
    groups = []

    # 合計エンゲージメント秒
    if "total_engagement_sec" in agg.columns:
        c0 = _color(0)
        groups.append({
            "title": "エンゲージメント — 日別合計秒数",
            "chartType": "line",
            "labels": labels,
            "datasets": [{
                "label": "合計エンゲージメント(秒)",
                "data": _safe_list(agg["total_engagement_sec"]),
                "borderColor": c0["border"], "backgroundColor": c0["bg"],
                "tension": 0.3, "fill": False,
            }],
        })

    # 平均エンゲージメント秒
    if "avg_engagement_sec" in agg.columns:
        c1 = _color(1)
        groups.append({
            "title": "エンゲージメント — セッション平均秒数",
            "chartType": "line",
            "labels": labels,
            "datasets": [{
                "label": "平均エンゲージメント(秒)",
                "data": _safe_list(agg["avg_engagement_sec"]),
                "borderColor": c1["border"], "backgroundColor": c1["bg"],
                "tension": 0.3, "fill": False,
            }],
        })

    return groups


# ========== V3.3: 推定オークション圧分析 ==========
def _build_auction_proxy(df: pd.DataFrame) -> list[dict]:
    """日別チャネル別セッションシェアの積み上げ折れ線。"""
    groups = []

    # チャネル別合計
    ch_agg = df.groupby("channel_group", as_index=False).agg({"sessions": "sum"}).sort_values("sessions", ascending=False)
    labels_ch = ch_agg["channel_group"].astype(str).tolist()
    c0 = _color(0)
    groups.append({
        "title": "流入の競合影響チェック（推定） — チャネル別セッション構成",
        "chartType": "bar_horizontal",
        "labels": labels_ch,
        "datasets": [{
            "label": "セッション",
            "data": _safe_list(ch_agg["sessions"]),
            "backgroundColor": c0["bg"], "borderColor": c0["border"], "borderWidth": 1,
        }],
    })

    # 日別推移（チャネルグループ別）
    if "event_date" in df.columns:
        pivot = df.pivot_table(index="event_date", columns="channel_group", values="sessions", aggfunc="sum").fillna(0).sort_index()
        d_labels = [str(d) for d in pivot.index.tolist()]
        d_datasets = []
        for i, ch in enumerate(pivot.columns):
            c = _color(i)
            d_datasets.append({
                "label": str(ch), "data": _safe_list(pivot[ch]),
                "borderColor": c["border"], "backgroundColor": c["bg"],
                "tension": 0.3, "fill": False,
            })
        groups.append({"title": "流入の競合影響チェック（推定） — 日別チャネル推移", "chartType": "line", "labels": d_labels, "datasets": d_datasets})

    return groups


# ========== V3.3: LP品質ランキング ==========
def _build_lp_quality(df: pd.DataFrame, search_df: pd.DataFrame = None) -> list[dict]:
    """LP品質スコアのランキング棒グラフ。build_bq_chart_dataから直接呼ばれない特殊ビルダー。"""
    groups = []
    if df is None or df.empty or "landing_page" not in df.columns:
        return groups
    limit = 15
    valid_df = df[_valid_label_mask(df["landing_page"])].copy()
    missing_label_count = int(len(df) - len(valid_df))
    if valid_df.empty:
        return groups

    # landing_page単位で再集計
    agg = valid_df.groupby("landing_page", as_index=False).agg({
        "sessions": "sum",
        "avg_pages_per_session": "mean",
    })
    if "bounce_sessions" in valid_df.columns:
        b_agg = valid_df.groupby("landing_page", as_index=False).agg({"bounce_sessions": "sum", "sessions": "sum"})
        agg["bounce_rate"] = b_agg["bounce_sessions"] / b_agg["sessions"]
    elif "bounce_rate" in valid_df.columns:
        agg["bounce_rate"] = valid_df.groupby("landing_page", as_index=False)["bounce_rate"].mean()["bounce_rate"]
    else:
        agg["bounce_rate"] = 0.5  # デフォルト

    # 品質スコア: sessions * (1 - bounce_rate) * avg_pages_per_session を正規化
    agg["quality_raw"] = agg["sessions"] * (1 - agg["bounce_rate"]) * agg["avg_pages_per_session"]
    max_q = agg["quality_raw"].max()
    agg["quality_score"] = (agg["quality_raw"] / max_q * 100).round(1) if max_q > 0 else 0

    top15 = agg.sort_values("quality_score", ascending=False).head(limit).copy()
    top15["short_page"] = top15["landing_page"].apply(_short_url)
    meta = _ranking_meta(
        "landing",
        limit=limit,
        actual_count=len(top15),
        source_row_count=len(agg),
        missing_label_count=missing_label_count,
    )
    meta["selectionLabel"] = f"品質スコア上位{len(top15)}LPを表示"

    c0 = _color(2)
    groups.append(_with_meta({
        "title": f"LP品質ランキング — 品質スコア上位{len(top15)}LP",
        "chartType": "bar_horizontal",
        "labels": top15["short_page"].tolist(),
        "datasets": [{
            "label": "品質スコア",
            "data": _safe_list(top15["quality_score"]),
            "backgroundColor": c0["bg"], "borderColor": c0["border"], "borderWidth": 1,
        }],
    }, meta))

    return groups


# ビルダーレジストリ
_BUILDERS: dict[str, Any] = {
    "pv": _build_pv,
    "traffic": _build_traffic,
    "cv": _build_cv,
    "search": _build_search,
    "anomaly": _build_anomaly,
    "landing": _build_landing,
    "device": _build_device,
    "hourly": _build_hourly,
    "user_attr": _build_user_attr,
    "engagement": _build_engagement,
    "auction_proxy": _build_auction_proxy,
}


# ==============================================================================
# V3.9: AI向けチャート要約関数
# ==============================================================================

def summarize_chart_groups_for_ai(groups: list[dict]) -> str:
    """チャートグループからAI向けの軽量要約を生成する。

    Args:
        groups: フロントから送信される ai_chart_context（チャートグループのリスト）
            各グループは {title, chartType, labels, datasets, _periodTag} を持つ

    Returns:
        AIプロンプトに注入する Markdown 形式の要約テキスト
    """
    if not groups:
        return ""

    summary_lines = []
    summary_lines.append("━━━ グラフ要約（変動パターンの参考情報）━━━")

    for g in groups:
        title = g.get("title", "不明なグラフ")
        chart_type = g.get("chartType", "line")
        labels = g.get("labels", [])
        datasets = g.get("datasets", [])
        period_tag = g.get("_periodTag", "")

        if not labels or not datasets:
            continue

        # 期間タグがあれば追記
        period_info = f"（{period_tag}）" if period_tag else ""

        if chart_type == "line":
            # 時系列グラフ: ピーク・ボトム・大きな増減を検出
            for ds in datasets:
                ds_label = ds.get("label", "データ")
                data = ds.get("data", [])
                if not data or len(data) < 2:
                    continue

                # Noneを除外して有効なインデックスのみ
                valid = [(i, v) for i, v in enumerate(data) if v is not None]
                if len(valid) < 2:
                    continue

                # ピーク・ボトム検出
                max_idx, max_val = max(valid, key=lambda x: x[1])
                min_idx, min_val = min(valid, key=lambda x: x[1])

                # 大きな増減（30%以上）を検出
                significant_swings = []
                for i in range(1, len(valid)):
                    prev_idx, prev_val = valid[i-1]
                    curr_idx, curr_val = valid[i]
                    if prev_val != 0:
                        change_pct = abs((curr_val - prev_val) / prev_val) * 100
                        if change_pct >= 30:
                            direction = "増加" if curr_val > prev_val else "減少"
                            label_prev = labels[prev_idx] if prev_idx < len(labels) else "?"
                            label_curr = labels[curr_idx] if curr_idx < len(labels) else "?"
                            significant_swings.append(
                                f"{label_prev}→{label_curr}で**{change_pct:.0f}%{direction}**"
                            )

                # 要約文を構築
                peak_label = labels[max_idx] if max_idx < len(labels) else "?"
                bottom_label = labels[min_idx] if min_idx < len(labels) else "?"

                line = f"- **{title}**{period_info} — {ds_label}: "
                details = []
                details.append(f"ピーク={peak_label}({max_val:,.0f})")
                details.append(f"ボトム={bottom_label}({min_val:,.0f})")
                if significant_swings:
                    details.append(f"急変動: {', '.join(significant_swings[:3])}")
                line += ", ".join(details)
                summary_lines.append(line)

        elif chart_type == "bar_horizontal":
            # カテゴリ棒グラフ: 上位・下位・偏りを検出
            for ds in datasets:
                ds_label = ds.get("label", "データ")
                data = ds.get("data", [])
                if not data or len(data) < 2:
                    continue

                # Noneを除外
                valid = [(i, v) for i, v in enumerate(data) if v is not None]
                if len(valid) < 2:
                    continue

                # 上位・下位検出
                sorted_valid = sorted(valid, key=lambda x: x[1], reverse=True)
                top3 = sorted_valid[:3]
                bottom3 = sorted_valid[-3:]

                # 偏り（上位3件のシェア）を計算
                total = sum(v for _, v in valid)
                top3_share = sum(v for _, v in top3) / total * 100 if total > 0 else 0

                # 要約文を構築
                line = f"- **{title}**{period_info} — {ds_label}: "
                details = []

                top_labels = []
                for idx, val in top3:
                    label = labels[idx] if idx < len(labels) else "?"
                    top_labels.append(f"{label}({val:,.0f})")
                details.append(f"上位: {', '.join(top_labels)}")

                if top3_share >= 60:
                    details.append(f"上位3件で**{top3_share:.0f}%**を占める偏り")

                line += ", ".join(details)
                summary_lines.append(line)

    if len(summary_lines) == 1:
        # 要約なし（ヘッダーのみ）
        return ""

    summary_lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    return "\n".join(summary_lines)


def _as_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        if isinstance(value, str):
            value = value.strip().replace(",", "").replace("%", "")
        number = float(value)
    except Exception:
        return None
    if pd.isna(number):
        return None
    return number


def _fmt_ai_number(value: Any) -> str:
    number = _as_number(value)
    if number is None:
        return "未取得"
    if abs(number) >= 1000:
        return f"{number:,.0f}"
    if float(number).is_integer():
        return f"{number:.0f}"
    return f"{number:,.2f}".rstrip("0").rstrip(".")


def summarize_chart_evidence_pack_for_ai(pack: dict | None) -> str:
    """chart_evidence_pack をAIが引用しやすいMarkdownに圧縮する。"""
    if not isinstance(pack, dict):
        return ""
    charts = pack.get("charts") if isinstance(pack.get("charts"), list) else []
    if not charts:
        return ""

    lines = [
        "━━━ 数値根拠パック（AI回答で引用可能なグラフ数値）━━━",
        f"- evidence_version: {pack.get('version', 'chart_evidence_pack_v1')}",
        f"- scope: {pack.get('scope_label') or '全グラフ'}",
        f"- chart_count: {pack.get('chart_count', len(charts))}",
        "",
    ]

    for chart in charts[:24]:
        chart_id = chart.get("chart_id") or "chart_unknown"
        title = chart.get("title") or "不明なグラフ"
        chart_type = chart.get("chart_type") or chart.get("chartType") or "unknown"
        period = chart.get("period_tag") or chart.get("_periodTag") or ""
        lines.append(f"## {chart_id}: {title}")
        lines.append(f"- type: {chart_type}{f' / period: {period}' if period else ''}")
        if chart.get("selection_label"):
            lines.append(f"- selection: {chart.get('selection_label')}")

        for series in (chart.get("series") or [])[:8]:
            label = series.get("label") or "データ"
            latest = series.get("latest") or {}
            max_point = series.get("max") or {}
            min_point = series.get("min") or {}
            total = series.get("total")
            details = []
            if latest:
                aliases = latest.get("aliases") or []
                alias_text = f" aliases={','.join(map(str, aliases[:4]))}" if aliases else ""
                details.append(f"最新={latest.get('label', '?')} {_fmt_ai_number(latest.get('value'))}{alias_text}")
            if max_point:
                aliases = max_point.get("aliases") or []
                alias_text = f" aliases={','.join(map(str, aliases[:4]))}" if aliases else ""
                details.append(f"最大={max_point.get('label', '?')} {_fmt_ai_number(max_point.get('value'))}{alias_text}")
            if min_point:
                details.append(f"最小={min_point.get('label', '?')} {_fmt_ai_number(min_point.get('value'))}")
            if total is not None:
                details.append(f"合計={_fmt_ai_number(total)}")
            change = series.get("change_from_first")
            if isinstance(change, dict) and change.get("percent") is not None:
                details.append(
                    f"初回比={_fmt_ai_number(change.get('absolute'))} ({float(change.get('percent')):+.1f}%)"
                )
            lines.append(f"- {label}: " + " / ".join(details))

            swings = series.get("notable_swings") or []
            if swings:
                swing_text = []
                for swing in swings[:3]:
                    percent = _as_number(swing.get("percent"))
                    if percent is None:
                        continue
                    swing_text.append(
                        f"{swing.get('from_label', '?')}→{swing.get('to_label', '?')} {percent:+.1f}%"
                    )
                if swing_text:
                    lines.append(f"  - 急変動: {', '.join(swing_text)}")

        ranking = chart.get("ranking_top") or []
        if ranking:
            top_text = [
                f"{item.get('series_label', 'データ')}:{item.get('label', '?')}({_fmt_ai_number(item.get('value'))})"
                for item in ranking[:5]
            ]
            lines.append(f"- ranking_top: {', '.join(top_text)}")

        if chart.get("missing_values"):
            lines.append(f"- missing_values: {chart.get('missing_values')}")
        lines.append("")

    lines.append("※ 回答で数値を使う場合は、上記 chart_id または要点パック見出しを根拠として併記すること。")
    lines.append("※ 日付表記は 20260130 / 2026-01-30 / 2026年1月30日 / 1/30 を同じ日として正規化して解釈すること。")
    lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    return "\n".join(lines)


def _collect_evidence_terms(pack: dict | None) -> tuple[set[str], str]:
    if not isinstance(pack, dict):
        return set(), ""
    terms: set[str] = set()
    label_text: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if key in {"label", "title", "metric", "series_label", "selection_label"} and child:
                    label_text.append(str(child))
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)
        else:
            number = _as_number(value)
            if number is None:
                return
            terms.add(_fmt_ai_number(number).replace(",", ""))
            terms.add(_fmt_ai_number(number))
            if abs(number) < 1000:
                terms.add(f"{number:.1f}".rstrip("0").rstrip("."))

    walk(pack)
    return terms, " ".join(label_text)


def _collect_evidence_chart_ids(pack: dict | None) -> set[str]:
    if not isinstance(pack, dict):
        return set()
    charts = pack.get("charts")
    if not isinstance(charts, list):
        return set()
    return {
        str(chart.get("chart_id"))
        for chart in charts
        if isinstance(chart, dict) and chart.get("chart_id")
    }


def _normalize_evidence_value(value: Any) -> str:
    number = _as_number(value)
    if number is not None:
        normalized = _fmt_ai_number(number)
        return normalized.replace(",", "").strip()
    return str(value or "").replace(",", "").strip()


def _normalize_evidence_text(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "").strip().lower())


def _point_period_aliases(point: dict, fallback: str = "") -> set[str]:
    aliases = {
        _normalize_evidence_text(fallback),
        _normalize_evidence_text(point.get("label")),
        _normalize_evidence_text(point.get("rawLabel")),
    }
    for alias in point.get("aliases") or []:
        aliases.add(_normalize_evidence_text(alias))
    return {alias for alias in aliases if alias}


def _build_evidence_row_index(pack: dict | None) -> dict[str, list[dict[str, set[str] | str]]]:
    """Index chart evidence by chart_id/value for strict evidence_table checks."""
    if not isinstance(pack, dict):
        return {}
    charts = pack.get("charts")
    if not isinstance(charts, list):
        return {}
    index: dict[str, list[dict[str, set[str] | str]]] = {}

    def add_record(chart_id: str, metric: Any, value: Any, period: Any) -> None:
        normalized_value = _normalize_evidence_value(value)
        if not chart_id or not normalized_value:
            return
        index.setdefault(chart_id, []).append({
            "value": normalized_value,
            "metrics": {
                item for item in [
                    _normalize_evidence_text(metric),
                ] if item
            },
            "periods": {
                item for item in [
                    _normalize_evidence_text(period),
                    _normalize_evidence_text("対象期間"),
                    _normalize_evidence_text("全期間"),
                ] if item
            },
        })

    for chart in charts:
        if not isinstance(chart, dict):
            continue
        chart_id = str(chart.get("chart_id") or "")
        period_tag = chart.get("period_tag") or pack.get("scope_label") or ""
        title_metric = chart.get("title") or ""
        for series in chart.get("series") or []:
            if not isinstance(series, dict):
                continue
            metric = series.get("label") or title_metric
            for point in series.get("points") or []:
                if isinstance(point, dict):
                    add_record(chart_id, metric, point.get("value"), point.get("label") or period_tag)
                    if chart_id in index and index[chart_id]:
                        index[chart_id][-1]["periods"] = set(index[chart_id][-1]["periods"]) | _point_period_aliases(point, str(period_tag))
            for point_key in ("latest", "max", "min"):
                point = series.get(point_key)
                if isinstance(point, dict):
                    add_record(chart_id, metric, point.get("value"), point.get("label") or period_tag)
                    if chart_id in index and index[chart_id]:
                        index[chart_id][-1]["periods"] = set(index[chart_id][-1]["periods"]) | _point_period_aliases(point, str(period_tag))
            if series.get("total") is not None:
                add_record(chart_id, metric, series.get("total"), "合計")
        for row in chart.get("ranking_top") or []:
            if isinstance(row, dict):
                add_record(chart_id, row.get("series_label") or title_metric, row.get("value"), row.get("label") or period_tag)
    return index


def _evidence_row_matches(row: dict, index: dict[str, list[dict[str, set[str] | str]]]) -> bool:
    source = str(row.get("source") or "")
    if not source.startswith("chart_") or source not in index:
        return True
    value = _normalize_evidence_value(row.get("value"))
    if not value or not re.search(r"\d", value):
        return True
    candidates = [record for record in index.get(source, []) if record.get("value") == value]
    if not candidates:
        return False

    metric = _normalize_evidence_text(row.get("metric"))
    period = _normalize_evidence_text(row.get("period"))
    loose_periods = {
        _normalize_evidence_text(item)
        for item in ("", "対象期間", "期間内", "全期間", "最新", "直近", "合計")
    }

    def metric_ok(record: dict[str, set[str] | str]) -> bool:
        if not metric:
            return True
        metrics = record.get("metrics") if isinstance(record.get("metrics"), set) else set()
        return any(metric == item or metric in item or item in metric for item in metrics if item)

    def period_ok(record: dict[str, set[str] | str]) -> bool:
        if period in loose_periods:
            return True
        periods = record.get("periods") if isinstance(record.get("periods"), set) else set()
        return period in periods

    return any(metric_ok(record) and period_ok(record) for record in candidates)


def _extract_insight_report_json(text: str) -> dict | None:
    match = re.search(r"```insight-report\s*\n([\s\S]*?)\n```", str(text or ""))
    if not match:
        return None
    try:
        parsed = json.loads(match.group(1))
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def _strip_agent_trace_for_validation(text: str) -> str:
    """Remove verbose trace payloads before checking user-facing claims."""
    pattern = re.compile(r"```(insight-report|insight-meta)\s*\n([\s\S]*?)\n```")

    def _replace(match: re.Match) -> str:
        fence = match.group(1)
        try:
            parsed = json.loads(match.group(2))
        except Exception:
            return match.group(0)
        if not isinstance(parsed, dict):
            return match.group(0)
        if "agent_trace" in parsed:
            parsed = dict(parsed)
            parsed["agent_trace"] = [
                {
                    "stage": str(item.get("stage") or ""),
                    "label": str(item.get("label") or ""),
                    "status": str(item.get("status") or ""),
                    "mode": str(item.get("mode") or ""),
                }
                for item in parsed.get("agent_trace") or []
                if isinstance(item, dict)
            ]
        return f"```{fence}\n{json.dumps(parsed, ensure_ascii=False)}\n```"

    return pattern.sub(_replace, str(text or ""))


REQUIRED_AGENT_TRACE_STAGES = [
    "data_evidence_agent",
    "internal_research_agent",
    "beginner_explainer_agent",
    "adops_strategist_agent",
    "senior_adops_reviewer_agent",
    "consistency_agent",
    "review_agent",
    "final_editor_agent",
]


def validate_ai_insight_output(
    text: str,
    evidence_pack: dict | None = None,
    data_source: str = "bq",
    agent_trace: list[dict] | None = None,
    require_agent_trace: bool = False,
) -> dict:
    """AI最終文の危険な数値/広告KPI混入を軽量検査する。"""
    issues: list[str] = []
    content = str(text or "")
    claim_content = _strip_agent_trace_for_validation(content)
    evidence_terms, evidence_labels = _collect_evidence_terms(evidence_pack)
    evidence_chart_ids = _collect_evidence_chart_ids(evidence_pack)
    evidence_row_index = _build_evidence_row_index(evidence_pack)
    insight_report = _extract_insight_report_json(content)
    if agent_trace is None and insight_report and isinstance(insight_report.get("agent_trace"), list):
        agent_trace = insight_report.get("agent_trace")
    forbidden_metrics = ["CTR", "CPA", "CPC", "ROAS", "広告費", "インプレッション"]
    if data_source in ("bq", "cross"):
        for metric in forbidden_metrics:
            if metric not in claim_content or metric in evidence_labels:
                continue
            unsafe_mentions = []
            for match in re.finditer(re.escape(metric), claim_content):
                context = claim_content[max(0, match.start() - 48):match.end() + 48]
                safe_context = any(word in context for word in [
                    "未取得",
                    "不明",
                    "含まれない",
                    "取得できていない",
                    "断定しない",
                    "断定できない",
                    "分からない",
                    "わからない",
                    "必要",
                    "追加で必要",
                    "追加データ",
                    "追加連携",
                    "必要なデータ",
                    "不足",
                    "missing_data",
                    "unsupported_kpis",
                    "未取得KPI",
                    "入力にない",
                ])
                nearby_value_after_metric = claim_content[match.end():match.end() + 24]
                nearby_value_before_metric = claim_content[max(0, match.start() - 24):match.start()]
                has_metric_value = (
                    re.search(r"^\s*[:：はが]?\s*\d[\d,]*(?:\.\d+)?\s*(?:円|%|％|件|pt)?", nearby_value_after_metric)
                    or re.search(r"\d[\d,]*(?:\.\d+)?\s*(?:円|%|％|件|pt)?\s*$", nearby_value_before_metric)
                )
                if safe_context and not has_metric_value:
                    continue
                unsafe_mentions.append(metric)
            if unsafe_mentions:
                issues.append(f"GA4根拠に存在しない広告KPIに言及しています: {metric}")

    if evidence_terms:
        unsupported: list[str] = []
        pattern = re.compile(r"(?<![A-Za-z0-9_])(\d[\d,]*(?:\.\d+)?)(?:\s*(?:%|％|件|人|回|円|セッション|PV|pt))")
        for match in pattern.finditer(claim_content):
            raw = match.group(1)
            compact = raw.replace(",", "")
            if compact in {"0", "1", "2", "3"}:
                continue
            if compact not in evidence_terms and raw not in evidence_terms:
                unsupported.append(match.group(0))
        if unsupported:
            issues.append("数値根拠パックに存在しない数値があります: " + ", ".join(sorted(set(unsupported))[:6]))

    if evidence_chart_ids and not any(chart_id in content for chart_id in evidence_chart_ids):
        preview = ", ".join(sorted(evidence_chart_ids)[:5])
        issues.append(f"chart_id が引用されていません: {preview}")

    if evidence_chart_ids and insight_report:
        evidence_rows = insight_report.get("evidence_table")
        if not isinstance(evidence_rows, list) or not evidence_rows:
            issues.append("insight_report_v2.evidence_table が空です。")
        else:
            invalid_sources = sorted({
                str(row.get("source") or "")
                for row in evidence_rows
                if isinstance(row, dict)
                and str(row.get("source") or "").startswith("chart_")
                and str(row.get("source") or "") not in evidence_chart_ids
            })
            if invalid_sources:
                issues.append("根拠パックに存在しない chart_id があります: " + ", ".join(invalid_sources[:5]))
            unsupported_values = []
            for row in evidence_rows:
                if not isinstance(row, dict):
                    continue
                value = str(row.get("value") or "").replace(",", "").strip()
                if value and re.search(r"\d", value) and value not in evidence_terms:
                    unsupported_values.append(str(row.get("value")))
            if unsupported_values:
                issues.append("evidence_table に根拠パック外の値があります: " + ", ".join(sorted(set(unsupported_values))[:6]))
            mismatched_rows = []
            for row in evidence_rows:
                if isinstance(row, dict) and not _evidence_row_matches(row, evidence_row_index):
                    mismatched_rows.append(
                        f"{row.get('source')} / {row.get('metric')} / {row.get('value')} / {row.get('period')}"
                    )
            if mismatched_rows:
                issues.append("evidence_table の source/metric/value/period が根拠パックと一致しません: " + ", ".join(sorted(set(mismatched_rows))[:5]))

    if insight_report:
        required_arrays = ["executive_summary", "evidence_table", "interpretation", "actions", "limitations"]
        for key in required_arrays:
            if not isinstance(insight_report.get(key), list) or len(insight_report.get(key) or []) == 0:
                issues.append(f"insight_report_v2.{key} が空です。")
        review_status = insight_report.get("review_status")
        if not isinstance(review_status, dict) or str(review_status.get("verdict") or "").lower() != "pass":
            issues.append("review_status.verdict が pass ではありません。")
        quality_markers = ["初心者", "Senior", "シニア", "Consistency", "日付", "未取得"]
        if sum(1 for marker in quality_markers if marker in content) < 2:
            issues.append("初心者説明・シニアレビュー・整合性確認の記述が不足しています。")

    if require_agent_trace:
        if not isinstance(agent_trace, list) or not agent_trace:
            issues.append("agent_trace がありません。")
        else:
            stages = {
                str(item.get("stage") or "")
                for item in agent_trace
                if isinstance(item, dict)
            }
            missing_stages = [stage for stage in REQUIRED_AGENT_TRACE_STAGES if stage not in stages]
            if missing_stages:
                issues.append("agent_trace の必須ステージが不足しています: " + ", ".join(missing_stages))
            for item in agent_trace:
                if not isinstance(item, dict):
                    continue
                stage = str(item.get("stage") or "")
                missing_keys = [
                    key for key in ["stage", "label", "status", "mode", "summary", "checks", "issues", "excerpt"]
                    if key not in item
                ]
                if missing_keys:
                    issues.append(f"agent_trace.{stage or 'unknown'} のキーが不足しています: " + ", ".join(missing_keys))
                if item.get("mode") not in ("llm_stage", "deterministic_fallback"):
                    issues.append(f"agent_trace.{stage or 'unknown'} の mode が不正です。")
                if item.get("status") not in ("completed", "repaired"):
                    issues.append(f"agent_trace.{stage or 'unknown'} が未完了です。")

    required_markers = ["```insight-report", "evidence_table", "actions", "limitations"]
    missing_markers = [marker for marker in required_markers if marker not in content]
    if missing_markers:
        issues.append("insight_report_v2 の必須要素が不足しています: " + ", ".join(missing_markers))

    verdict = "pass" if len(issues) == 0 else "needs_review"
    if any("根拠パックに存在しない" in issue or "根拠パック外" in issue or "存在しない広告KPI" in issue for issue in issues):
        verdict = "fail"

    return {
        "ok": len(issues) == 0,
        "verdict": verdict,
        "issues": issues,
        "blocking_issues": issues,
    }
