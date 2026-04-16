"""GA4 DataFrame → ExtractResult 変換アダプター

BigQuery から取得した GA4 データを、既存の generate_reports.py で定義された
ExtractResult / ExtractMeta 形式に変換する。
"""

from __future__ import annotations

import sys
from pathlib import Path

# generate_reports.py を import するためにプロジェクトルートを追加
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PROJECT_ROOT))

import pandas as pd

from generate_reports import ExtractResult, ExtractMeta


def ga4_to_extract_result(
    df: pd.DataFrame,
    dataset: str,
    query_type: str,
) -> ExtractResult:
    """GA4 の BigQuery DataFrame を ExtractResult に変換する。

    Args:
        df: BigQuery クエリ結果の DataFrame
        dataset: データセット名
        query_type: クエリタイプ

    Returns:
        ExtractResult: generate_reports.py 互換の抽出結果
    """
    # GA4 データから主要 KPI を集計
    kpis = {
        "cost": None,  # GA4には費用データなし（Google Ads 連携時のみ）
        "impr": None,   # GA4には表示回数なし
        "click": None,  # GA4にはクリック数なし
        "cv": _safe_sum(df, "conversions") or _safe_sum(df, "event_count"),
        "ctr": None,
        "cvr": None,
        "cpa": None,
        "cpc": None,
    }

    # PV系指標があれば追加で格納
    if "page_views" in df.columns:
        kpis["impr"] = _safe_sum(df, "page_views")
    if "sessions" in df.columns:
        kpis["click"] = _safe_sum(df, "sessions")  # セッション数をクリックに対応付け
    if "users" in df.columns:
        pass  # ユーザー数は KPI_SPECS に定義なし

    meta = ExtractMeta(
        file=f"BigQuery:{dataset}",
        sheet=query_type,
        method="bigquery",
        refs={},
        rows=len(df),
        cols=len(df.columns),
        period=_detect_period(df),
        section=None,
    )

    key_totals = {
        "cost": kpis.get("cost"),
        "click": kpis.get("click"),
        "cv": kpis.get("cv"),
    }

    return ExtractResult(kpis=kpis, meta=meta, key_totals=key_totals)


def _safe_sum(df: pd.DataFrame, col: str) -> float | None:
    """列の合計を安全に計算する。"""
    if col not in df.columns:
        return None
    total = pd.to_numeric(df[col], errors="coerce").sum()
    if pd.isna(total):
        return None
    return float(total)


def _detect_period(df: pd.DataFrame) -> str | None:
    """DataFrame から期間を推定する。"""
    date_cols = ["event_date", "date"]
    for col in date_cols:
        if col in df.columns:
            dates = pd.to_datetime(df[col], format="%Y%m%d", errors="coerce").dropna()
            if len(dates) > 0:
                start = dates.min().strftime("%Y-%m-%d")
                end = dates.max().strftime("%Y-%m-%d")
                return f"{start} ~ {end}"
    return None
