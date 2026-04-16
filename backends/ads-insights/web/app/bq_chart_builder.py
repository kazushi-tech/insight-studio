"""BQ DataFrameからChart.js用データを生成するヘルパー。

クエリタイプごとに異なるカラム構成に対応し、
フロントエンドのChart.jsで描画可能なJSON構造を返す。
"""

from __future__ import annotations

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
    return [None if pd.isna(v) else _to_native(v) for v in series]


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
    # 再集計: source/medium単位で集約（日別明細から）
    agg = df.groupby(["source", "medium"], as_index=False).agg({
        "sessions": "sum", "users": "sum", "page_views": "sum",
    }).sort_values("sessions", ascending=False)
    top = agg.head(15).copy()
    top["channel"] = top["source"].astype(str) + " / " + top["medium"].astype(str)
    labels = top["channel"].tolist()

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
    groups.append({"title": "流入分析 — チャネル別", "chartType": "bar_horizontal", "labels": labels, "datasets": datasets})

    # V3.3: Top5チャネルの日別セッション推移
    if "event_date" in df.columns:
        top5_channels = top.head(5)
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
            groups.append({"title": "流入分析 — Top5 日別推移", "chartType": "line", "labels": d_labels, "datasets": d_datasets})

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
    # 再集計: search_term単位で集約
    agg = df.groupby("search_term", as_index=False).agg({
        "search_count": "sum", "unique_searchers": "sum",
    }).sort_values("search_count", ascending=False)
    top = agg.head(20)
    labels = top["search_term"].astype(str).tolist()

    c = _color(0)
    datasets = [{
        "label": "検索回数",
        "data": _safe_list(top["search_count"]),
        "backgroundColor": c["bg"],
        "borderColor": c["border"],
        "borderWidth": 1,
    }]
    groups.append({"title": "検索クエリ — Top 20", "chartType": "bar_horizontal", "labels": labels, "datasets": datasets})

    # V3.3: Top10キーワードの日別検索推移
    if "event_date" in df.columns:
        top10_terms = agg.head(10)["search_term"].tolist()
        daily = df[df["search_term"].isin(top10_terms)]
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
            groups.append({"title": "検索クエリ — Top10 日別推移", "chartType": "line", "labels": d_labels, "datasets": d_datasets})

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
    # 再集計: landing_page単位で集約
    agg = df.groupby("landing_page", as_index=False).agg({
        "sessions": "sum",
        "avg_pages_per_session": "mean",
        "bounce_sessions": "sum" if "bounce_sessions" in df.columns else "count",
    }).sort_values("sessions", ascending=False)
    if "bounce_sessions" in agg.columns and "sessions" in agg.columns:
        agg["bounce_rate"] = agg["bounce_sessions"] / agg["sessions"]
    elif "bounce_rate" not in agg.columns:
        agg["bounce_rate"] = 0

    top = agg.head(20).copy()
    # URLを短く表示（ドメイン部分を除去）
    top["short_page"] = top["landing_page"].astype(str).apply(
        lambda u: u.split("//")[-1].split("?")[0] if "//" in u else u
    )
    labels = top["short_page"].tolist()

    # セッション数
    c0 = _color(0)
    groups.append({
        "title": "LP分析 — セッション数 Top 20",
        "chartType": "bar_horizontal",
        "labels": labels,
        "datasets": [{
            "label": "セッション",
            "data": _safe_list(top["sessions"]),
            "backgroundColor": c0["bg"],
            "borderColor": c0["border"],
            "borderWidth": 1,
        }],
    })

    # 直帰率（%変換）
    if "bounce_rate" in top.columns:
        c1 = _color(3)
        bounce_pct = [None if pd.isna(v) else round(float(v) * 100, 1) for v in top["bounce_rate"]]
        groups.append({
            "title": "LP分析 — 直帰率 Top 20",
            "chartType": "bar_horizontal",
            "labels": labels,
            "datasets": [{
                "label": "直帰率 (%)",
                "data": bounce_pct,
                "backgroundColor": c1["bg"],
                "borderColor": c1["border"],
                "borderWidth": 1,
            }],
        })

    # V3.3: Top5 LPの日別セッション推移
    if "event_date" in df.columns:
        top5_pages = agg.head(5)["landing_page"].tolist()
        daily = df[df["landing_page"].isin(top5_pages)]
        if not daily.empty:
            daily = daily.copy()
            daily["short_page"] = daily["landing_page"].astype(str).apply(
                lambda u: u.split("//")[-1].split("?")[0] if "//" in u else u
            )
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
            groups.append({"title": "LP分析 — Top5 日別推移", "chartType": "line", "labels": d_labels, "datasets": d_datasets})

    return groups


# ========== デバイス分析（V3.3: 既存ランキング + 日別推移） ==========
def _build_device(df: pd.DataFrame) -> list[dict]:
    """デバイスカテゴリ別セッション・ユーザーの横棒グラフ + 日別推移。"""
    # デバイスカテゴリ別に集約（日別明細から再集計）
    agg = df.groupby("device_category", as_index=False).agg({
        "sessions": "sum",
        "users": "sum",
        "page_views": "sum",
    }).sort_values("sessions", ascending=False)

    labels = agg["device_category"].astype(str).tolist()
    groups = []

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
    os_agg = df.groupby("os", as_index=False).agg({"sessions": "sum"}).sort_values("sessions", ascending=False).head(10)
    os_labels = os_agg["os"].astype(str).tolist()
    c = _color(4)
    groups.append({
        "title": "デバイス分析 — OS別 Top 10",
        "chartType": "bar_horizontal",
        "labels": os_labels,
        "datasets": [{
            "label": "セッション",
            "data": _safe_list(os_agg["sessions"]),
            "backgroundColor": c["bg"],
            "borderColor": c["border"],
            "borderWidth": 1,
        }],
    })

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
    city_agg = df.groupby("city", as_index=False).agg({"sessions": "sum"}).sort_values("sessions", ascending=False).head(15)
    city_agg = city_agg[city_agg["city"].notna() & (city_agg["city"] != "(not set)")]
    if not city_agg.empty:
        c2 = _color(2)
        groups.append({
            "title": "ユーザー属性 — 地域別 Top 15",
            "chartType": "bar_horizontal",
            "labels": city_agg["city"].astype(str).tolist(),
            "datasets": [{
                "label": "セッション",
                "data": _safe_list(city_agg["sessions"]),
                "backgroundColor": c2["bg"],
                "borderColor": c2["border"],
                "borderWidth": 1,
            }],
        })

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
        "title": "オークション圧 — チャネル別セッション構成",
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
        groups.append({"title": "オークション圧 — 日別チャネル推移", "chartType": "line", "labels": d_labels, "datasets": d_datasets})

    return groups


# ========== V3.3: LP品質ランキング ==========
def _build_lp_quality(df: pd.DataFrame, search_df: pd.DataFrame = None) -> list[dict]:
    """LP品質スコアのランキング棒グラフ。build_bq_chart_dataから直接呼ばれない特殊ビルダー。"""
    groups = []
    if df is None or df.empty or "landing_page" not in df.columns:
        return groups

    # landing_page単位で再集計
    agg = df.groupby("landing_page", as_index=False).agg({
        "sessions": "sum",
        "avg_pages_per_session": "mean",
    })
    if "bounce_sessions" in df.columns:
        b_agg = df.groupby("landing_page", as_index=False).agg({"bounce_sessions": "sum", "sessions": "sum"})
        agg["bounce_rate"] = b_agg["bounce_sessions"] / b_agg["sessions"]
    elif "bounce_rate" in df.columns:
        agg["bounce_rate"] = df.groupby("landing_page", as_index=False)["bounce_rate"].mean()["bounce_rate"]
    else:
        agg["bounce_rate"] = 0.5  # デフォルト

    # 品質スコア: sessions * (1 - bounce_rate) * avg_pages_per_session を正規化
    agg["quality_raw"] = agg["sessions"] * (1 - agg["bounce_rate"]) * agg["avg_pages_per_session"]
    max_q = agg["quality_raw"].max()
    agg["quality_score"] = (agg["quality_raw"] / max_q * 100).round(1) if max_q > 0 else 0

    top15 = agg.sort_values("quality_score", ascending=False).head(15).copy()
    top15["short_page"] = top15["landing_page"].astype(str).apply(
        lambda u: u.split("//")[-1].split("?")[0] if "//" in u else u
    )

    c0 = _color(2)
    groups.append({
        "title": "LP品質ランキング — Top 15",
        "chartType": "bar_horizontal",
        "labels": top15["short_page"].tolist(),
        "datasets": [{
            "label": "品質スコア",
            "data": _safe_list(top15["quality_score"]),
            "backgroundColor": c0["bg"], "borderColor": c0["border"], "borderWidth": 1,
        }],
    })

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
