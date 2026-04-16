"""BigQuery レポート オーケストレーター

クエリ選択 → SQL実行 → DataFrame → Markdown レポート生成の
一連のフローを管理する。

使用例:
    python -m bq.reporter --query pv --dataset analytics_311324674 --period 2025-12
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# プロジェクトルートを sys.path に追加
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PROJECT_ROOT))
_SKILLS_DIR = _PROJECT_ROOT / ".agent" / "skills"
sys.path.insert(0, str(_SKILLS_DIR))

import pandas as pd

from bq.client import run_query, list_datasets, PROJECT_ID


# ---------------------------------------------------------------------------
# Markdown エスケープヘルパー
# ---------------------------------------------------------------------------

def _escape_markdown_cell(value) -> str:
    """Markdown テーブルセル内の `|` をエスケープする。

    None / NaN → 空文字列、数値はそのまま文字列化、
    文字列セル中の `|` を `\\|` に置換する。
    """
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    s = str(value)
    return s.replace("|", "\\|")


def _escape_df_for_markdown(df: pd.DataFrame) -> pd.DataFrame:
    """DataFrame の全 object 列について `|` をエスケープしたコピーを返す。

    数値列はそのまま維持し、見た目を壊さない。
    元の DataFrame は変更しない。
    """
    out = df.copy()
    for col in out.columns:
        if out[col].dtype == object:
            out[col] = out[col].apply(_escape_markdown_cell)
    return out
from bq.queries import get_query, list_query_types, QUERIES
from bq.ga4_extract import ga4_to_extract_result
from _shared.output_format import write_report
from _shared.env_loader import load_env


def _summarize(df: pd.DataFrame, query_type: str, period: str) -> str:
    """クエリタイプ別にDataFrameから集計サマリーMarkdownを生成する。V2.8: 指標大幅強化。"""
    lines: list[str] = []

    if query_type == "pv":
        # 日別に集計
        if "event_date" in df.columns:
            daily = df.groupby("event_date").agg(
                users=("users", "sum"),
                sessions=("sessions", "sum"),
                page_views=("page_views", "sum"),
            ).reset_index()
            total_users = int(daily["users"].sum())
            total_sessions = int(daily["sessions"].sum())
            total_pv = int(daily["page_views"].sum())
            avg_pv_per_day = round(daily["page_views"].mean(), 1)
            avg_users_per_day = round(daily["users"].mean(), 1)
            avg_sessions_per_day = round(daily["sessions"].mean(), 1)
            days = len(daily)
            pv_per_session = round(total_pv / total_sessions, 2) if total_sessions else 0
            lines.append("## 主要KPIサマリー")
            lines.append(f"- **期間日数**: {days}日")
            lines.append(f"- **合計ユーザー数**: {total_users:,}")
            lines.append(f"- **合計セッション数**: {total_sessions:,}")
            lines.append(f"- **合計PV数**: {total_pv:,}")
            lines.append(f"- **1日あたり平均PV**: {avg_pv_per_day:,}")
            lines.append(f"- **1日あたり平均ユーザー数**: {avg_users_per_day:,}")
            lines.append(f"- **1日あたり平均セッション数**: {avg_sessions_per_day:,}")
            lines.append(f"- **PV/セッション比（回遊深度）**: {pv_per_session}")
            # ピーク日（最大PV日）
            peak_day = daily.loc[daily["page_views"].idxmax()]
            lines.append(f"- **ピーク日**: {peak_day['event_date']}（PV: {int(peak_day['page_views']):,}）")
            # 最低PV日
            min_day = daily.loc[daily["page_views"].idxmin()]
            lines.append(f"- **最低PV日**: {min_day['event_date']}（PV: {int(min_day['page_views']):,}）")
            # 前半/後半トレンド比
            if days >= 4:
                mid = days // 2
                first_half_pv = int(daily.iloc[:mid]["page_views"].mean())
                second_half_pv = int(daily.iloc[mid:]["page_views"].mean())
                trend_ratio = round(second_half_pv / first_half_pv, 2) if first_half_pv else 0
                trend_label = "↗ 上昇" if trend_ratio > 1.05 else ("↘ 下降" if trend_ratio < 0.95 else "→ 横ばい")
                lines.append(f"- **前半/後半PVトレンド**: {trend_label}（比率: {trend_ratio}）")
            lines.append("")
            # 日別推移
            lines.append("## 日別推移")
            try:
                lines.append(_escape_df_for_markdown(daily).to_markdown(index=False))
            except ImportError:
                lines.append(daily.to_string(index=False))
            lines.append("")
        # Top ページ
        if "page_title" in df.columns and "page_views" in df.columns:
            top_pages = df.groupby(["page_title"]).agg(
                page_views=("page_views", "sum"),
                sessions=("sessions", "sum"),
            ).sort_values("page_views", ascending=False).head(15).reset_index()
            lines.append("## ページ別PVランキング（Top 15）")
            try:
                lines.append(_escape_df_for_markdown(top_pages).to_markdown(index=False))
            except ImportError:
                lines.append(top_pages.to_string(index=False))
            lines.append("")

    elif query_type == "traffic":
        # V3.3: 日別明細前提で再集計
        by_channel = df.groupby(["source", "medium"], as_index=False).agg({
            "sessions": "sum", "users": "sum", "page_views": "sum",
        }).sort_values("sessions", ascending=False)
        total_sessions = int(by_channel["sessions"].sum())
        total_users = int(by_channel["users"].sum())
        total_pv = int(by_channel["page_views"].sum())
        lines.append("## 主要KPIサマリー")
        lines.append(f"- **合計セッション数**: {total_sessions:,}")
        lines.append(f"- **合計ユーザー数**: {total_users:,}")
        lines.append(f"- **合計PV数**: {total_pv:,}")
        pv_per_session = round(total_pv / total_sessions, 2) if total_sessions else 0
        lines.append(f"- **PV/セッション比（回遊深度）**: {pv_per_session}")
        lines.append(f"- **流入経路数**: {len(by_channel)}")
        # オーガニック/有料比率
        if "medium" in by_channel.columns:
            organic_sess = int(by_channel[by_channel["medium"].str.contains("organic", case=False, na=False)]["sessions"].sum())
            paid_sess = int(by_channel[by_channel["medium"].str.contains("cpc|paid|ppc", case=False, na=False)]["sessions"].sum())
            other_sess = total_sessions - organic_sess - paid_sess
            org_pct = round(organic_sess / total_sessions * 100, 1) if total_sessions else 0
            paid_pct = round(paid_sess / total_sessions * 100, 1) if total_sessions else 0
            lines.append(f"- **オーガニック流入**: {organic_sess:,}（{org_pct}%）")
            lines.append(f"- **有料流入**: {paid_sess:,}（{paid_pct}%）")
            lines.append(f"- **その他流入**: {other_sess:,}")
        lines.append("")
        # チャネル別構成比（Top 3 詳細含む）
        lines.append("## トップ3チャネル詳細")
        for i, (_, row) in enumerate(by_channel.head(3).iterrows()):
            s = int(row.get("sessions", 0))
            u = int(row.get("users", 0))
            pv = int(row.get("page_views", 0))
            pct = round(s / total_sessions * 100, 1) if total_sessions else 0
            ch = _escape_markdown_cell(f"{row.get('source', '')} / {row.get('medium', '')}")
            lines.append(f"**{i+1}. {ch}** — セッション: {s:,}（{pct}%）, ユーザー: {u:,}, PV: {pv:,}")
        lines.append("")
        lines.append("## チャネル別セッション構成比")
        lines.append("| source / medium | セッション | 構成比 | ユーザー | PV |")
        lines.append("|---|---:|---:|---:|---:|")
        for _, row in by_channel.head(20).iterrows():
            s = int(row.get("sessions", 0))
            u = int(row.get("users", 0))
            pv = int(row.get("page_views", 0))
            pct = round(s / total_sessions * 100, 1) if total_sessions else 0
            lines.append(f"| {_escape_markdown_cell(row.get('source', ''))} / {_escape_markdown_cell(row.get('medium', ''))} | {s:,} | {pct}% | {u:,} | {pv:,} |")
        lines.append("")
        # V3.3: 日別推移セクション
        if "event_date" in df.columns:
            daily_total = df.groupby("event_date", as_index=False).agg({"sessions": "sum"}).sort_values("event_date")
            if len(daily_total) >= 2:
                lines.append("## 日別セッション推移")
                try:
                    lines.append(_escape_df_for_markdown(daily_total).to_markdown(index=False))
                except ImportError:
                    lines.append(daily_total.to_string(index=False))
                lines.append("")

    elif query_type == "cv":
        if "event_count" in df.columns:
            total_cv = int(df["event_count"].sum())
            total_unique = int(df["unique_users"].sum()) if "unique_users" in df.columns else 0
            cv_per_user = round(total_cv / total_unique, 2) if total_unique else 0
            lines.append("## 主要KPIサマリー")
            lines.append(f"- **合計CV件数**: {total_cv:,}")
            lines.append(f"- **合計CVユニークユーザー数**: {total_unique:,}")
            lines.append(f"- **1ユーザーあたりCV数**: {cv_per_user}")
            # 日別CVトレンド（前半/後半比）
            if "event_date" in df.columns:
                daily_cv = df.groupby("event_date")["event_count"].sum().sort_index()
                days = len(daily_cv)
                if days >= 4:
                    mid = days // 2
                    first_half = daily_cv.iloc[:mid].mean()
                    second_half = daily_cv.iloc[mid:].mean()
                    cv_trend = round(second_half / first_half, 2) if first_half else 0
                    cv_trend_label = "↗ 上昇" if cv_trend > 1.05 else ("↘ 下降" if cv_trend < 0.95 else "→ 横ばい")
                    lines.append(f"- **日別CVトレンド**: {cv_trend_label}（前半平均: {round(first_half, 1)}, 後半平均: {round(second_half, 1)}）")
            lines.append("")
        if "event_name" in df.columns:
            by_event = df.groupby("event_name").agg(
                event_count=("event_count", "sum"),
                unique_users=("unique_users", "sum") if "unique_users" in df.columns else ("event_count", "count"),
            ).sort_values("event_count", ascending=False).reset_index()
            # 最多CVイベント詳細
            if len(by_event) > 0:
                top_ev = by_event.iloc[0]
                lines.append(f"### 最多CVイベント: {top_ev['event_name']}")
                lines.append(f"- CV数: {int(top_ev['event_count']):,}, ユニークユーザー: {int(top_ev['unique_users']):,}")
                lines.append("")
            lines.append("## イベント別CV数")
            try:
                lines.append(_escape_df_for_markdown(by_event).to_markdown(index=False))
            except ImportError:
                lines.append(by_event.to_string(index=False))
            lines.append("")

    elif query_type == "search":
        # V3.3: 日別明細前提で再集計
        by_term = df.groupby("search_term", as_index=False).agg({
            "search_count": "sum", "unique_searchers": "sum",
        }).sort_values("search_count", ascending=False)
        total_searches = int(by_term["search_count"].sum())
        total_searchers = int(by_term["unique_searchers"].sum())
        lines.append("## 主要KPIサマリー")
        lines.append(f"- **合計検索回数**: {total_searches:,}")
        lines.append(f"- **検索ユニークユーザー数**: {total_searchers:,}")
        lines.append(f"- **ユニーク検索キーワード数**: {len(by_term)}")
        if total_searchers:
            lines.append(f"- **1ユーザーあたり平均検索回数**: {round(total_searches / total_searchers, 1)}")
        lines.append("")
        lines.append("## 頻出検索キーワード（Top 20）")
        try:
            lines.append(_escape_df_for_markdown(by_term.head(20)).to_markdown(index=False))
        except ImportError:
            lines.append(by_term.head(20).to_string(index=False))
        lines.append("")
        # V3.3: 日別推移セクション
        if "event_date" in df.columns:
            daily_total = df.groupby("event_date", as_index=False).agg({"search_count": "sum"}).sort_values("event_date")
            if len(daily_total) >= 2:
                lines.append("## 日別検索回数推移")
                try:
                    lines.append(_escape_df_for_markdown(daily_total).to_markdown(index=False))
                except ImportError:
                    lines.append(daily_total.to_string(index=False))
                lines.append("")

    elif query_type == "anomaly":
        lines.append("## 主要KPIサマリー")
        if "users" in df.columns:
            lines.append(f"- **ユーザー数 平均**: {round(df['users'].mean(), 1)}")
            lines.append(f"- **セッション数 平均**: {round(df['sessions'].mean(), 1)}")
            lines.append(f"- **PV数 平均**: {round(df['page_views'].mean(), 1)}")
            lines.append("")
        # Z-scoreが±2を超える異常日を抽出
        anomaly_cols = [c for c in df.columns if c.endswith("_zscore")]
        anomalies = []
        for _, row in df.iterrows():
            for col in anomaly_cols:
                if pd.notna(row[col]) and abs(row[col]) >= 2:
                    metric = col.replace("_zscore", "")
                    anomalies.append({
                        "日付": row.get("event_date", ""),
                        "指標": metric,
                        "Z-score": round(row[col], 2),
                        "実測値": row.get(metric, ""),
                        "7日平均": round(row.get(f"{metric}_7d_avg", 0), 1),
                    })
        anomaly_count = len(anomalies)
        lines.append(f"- **異常検出日数**: {anomaly_count}件")
        if anomalies:
            # 重度分布
            severe = [a for a in anomalies if abs(a["Z-score"]) >= 3]
            moderate = [a for a in anomalies if 2 <= abs(a["Z-score"]) < 3]
            lines.append(f"- **重度（|Z| ≥ 3）**: {len(severe)}件")
            lines.append(f"- **中度（2 ≤ |Z| < 3）**: {len(moderate)}件")
            # 最大異常値の詳細
            max_anomaly = max(anomalies, key=lambda a: abs(a["Z-score"]))
            lines.append(f"- **最大異常**: {max_anomaly['日付']} {max_anomaly['指標']} (Z={max_anomaly['Z-score']}, 実測={max_anomaly['実測値']})")
            lines.append("")
            lines.append("## 異常検知結果（|Z-score| ≥ 2）")
            adf = pd.DataFrame(anomalies)
            try:
                lines.append(_escape_df_for_markdown(adf).to_markdown(index=False))
            except ImportError:
                lines.append(adf.to_string(index=False))
        else:
            lines.append("")
            lines.append("## 異常検知結果")
            lines.append("- 期間内にZ-score ±2を超える異常値は検出されませんでした。")
        lines.append("")

    elif query_type == "landing":
        # V3.3: 日別明細前提で再集計
        by_lp = df.groupby("landing_page", as_index=False).agg({
            "sessions": "sum",
            "avg_pages_per_session": "mean",
        })
        if "bounce_sessions" in df.columns:
            bounce_agg = df.groupby("landing_page", as_index=False).agg({"bounce_sessions": "sum", "sessions": "sum"})
            by_lp["bounce_rate"] = bounce_agg["bounce_sessions"] / bounce_agg["sessions"]
        elif "bounce_rate" in df.columns:
            br_agg = df.groupby("landing_page", as_index=False).agg({"bounce_rate": "mean"})
            by_lp["bounce_rate"] = br_agg["bounce_rate"]
        else:
            by_lp["bounce_rate"] = 0
        by_lp = by_lp.sort_values("sessions", ascending=False)
        total_sessions = int(by_lp["sessions"].sum())
        avg_bounce = round(by_lp["bounce_rate"].mean() * 100, 1) if "bounce_rate" in by_lp.columns else 0
        lines.append("## 主要KPIサマリー")
        lines.append(f"- **合計LP流入セッション数**: {total_sessions:,}")
        lines.append(f"- **全LP平均直帰率**: {avg_bounce}%")
        lines.append(f"- **LP数**: {len(by_lp)}")
        # トップ3 LP詳細
        if len(by_lp) >= 1:
            lines.append("")
            lines.append("### トップ3 LP詳細")
            for i, (_, row) in enumerate(by_lp.head(3).iterrows()):
                s = int(row.get("sessions", 0))
                br = round(row.get("bounce_rate", 0) * 100, 1)
                ap = round(row.get("avg_pages_per_session", 0), 2)
                lines.append(f"**{i+1}. {_escape_markdown_cell(row.get('landing_page', ''))}**")
                lines.append(f"   セッション: {s:,}, 直帰率: {br}%, 回遊深度: {ap}")
        # 最悪直帰率LP（セッション10以上）
        if "bounce_rate" in by_lp.columns and "sessions" in by_lp.columns:
            enough_traffic = by_lp[by_lp["sessions"] >= 10]
            if len(enough_traffic) > 0:
                worst = enough_traffic.loc[enough_traffic["bounce_rate"].idxmax()]
                lines.append(f"- **最悪直帰率LP**（セッション10以上）: {_escape_markdown_cell(worst.get('landing_page', ''))}（直帰率: {round(worst['bounce_rate'] * 100, 1)}%, セッション: {int(worst['sessions']):,}）")
        lines.append("")
        # 直帰率が高いLP
        if "bounce_rate" in by_lp.columns:
            high_bounce = by_lp[by_lp["bounce_rate"] >= 0.6].sort_values("sessions", ascending=False).head(10)
            if len(high_bounce) > 0:
                lines.append("## 直帰率60%以上のLP（改善候補）")
                display_df = high_bounce[["landing_page", "sessions", "bounce_rate"]].copy()
                display_df["bounce_rate"] = display_df["bounce_rate"].apply(lambda x: f"{round(x * 100, 1)}%")
                try:
                    lines.append(_escape_df_for_markdown(display_df).to_markdown(index=False))
                except ImportError:
                    lines.append(display_df.to_string(index=False))
                lines.append("")
        lines.append("## LP別セッション数ランキング（Top 15）")
        display_all = by_lp.head(15).copy()
        if "bounce_rate" in display_all.columns:
            display_all["bounce_rate"] = display_all["bounce_rate"].apply(lambda x: f"{round(x * 100, 1)}%")
        if "avg_pages_per_session" in display_all.columns:
            display_all["avg_pages_per_session"] = display_all["avg_pages_per_session"].apply(lambda x: round(x, 2))
        try:
            lines.append(_escape_df_for_markdown(display_all).to_markdown(index=False))
        except ImportError:
            lines.append(display_all.to_string(index=False))
        lines.append("")
        # V3.3: 日別推移セクション
        if "event_date" in df.columns:
            daily_total = df.groupby("event_date", as_index=False).agg({"sessions": "sum"}).sort_values("event_date")
            if len(daily_total) >= 2:
                lines.append("## 日別LP流入セッション推移")
                try:
                    lines.append(_escape_df_for_markdown(daily_total).to_markdown(index=False))
                except ImportError:
                    lines.append(daily_total.to_string(index=False))
                lines.append("")
        # V3.3 Phase 8: LP品質ランキング
        if "sessions" in by_lp.columns and "bounce_rate" in by_lp.columns and "avg_pages_per_session" in by_lp.columns:
            by_lp_q = by_lp.copy()
            by_lp_q["quality_raw"] = by_lp_q["sessions"] * (1 - by_lp_q["bounce_rate"]) * by_lp_q["avg_pages_per_session"]
            max_q = by_lp_q["quality_raw"].max()
            if max_q > 0:
                by_lp_q["quality_score"] = (by_lp_q["quality_raw"] / max_q * 100).round(1)
                top5 = by_lp_q.sort_values("quality_score", ascending=False).head(5)
                lines.append("## LP品質ランキング（Top 5）")
                lines.append("*品質スコア = sessions × (1 - bounce_rate) × avg_pages を正規化*")
                lines.append("")
                for i, (_, row) in enumerate(top5.iterrows()):
                    lines.append(f"**{i+1}. {_escape_markdown_cell(row.get('landing_page', ''))}**")
                    lines.append(f"   品質スコア: {row['quality_score']}, セッション: {int(row['sessions']):,}, 直帰率: {round(row['bounce_rate'] * 100, 1)}%")
                lines.append("")
                # 改善優先LP（高流入かつ低品質）
                high_traffic_low_q = by_lp_q[by_lp_q["sessions"] >= by_lp_q["sessions"].quantile(0.7)].sort_values("quality_score").head(5)
                if len(high_traffic_low_q) > 0:
                    lines.append("## 改善優先LP（高流入 × 低品質）")
                    for i, (_, row) in enumerate(high_traffic_low_q.iterrows()):
                        lines.append(f"**{i+1}. {_escape_markdown_cell(row.get('landing_page', ''))}**")
                        lines.append(f"   品質スコア: {row['quality_score']}, セッション: {int(row['sessions']):,}, 直帰率: {round(row['bounce_rate'] * 100, 1)}%")
                    lines.append("")

    elif query_type == "device":
        # V3.3: 日別明細前提で再集計（既にgroupby済みのデータも対応）
        total_sessions = int(df["sessions"].sum()) if "sessions" in df.columns else 0
        total_users = int(df["users"].sum()) if "users" in df.columns else 0
        total_pv = int(df["page_views"].sum()) if "page_views" in df.columns else 0
        lines.append("## 主要KPIサマリー")
        lines.append(f"- **合計セッション数**: {total_sessions:,}")
        lines.append(f"- **合計ユーザー数**: {total_users:,}")
        lines.append(f"- **合計PV数**: {total_pv:,}")
        # デバイスカテゴリ別比率
        if "device_category" in df.columns:
            by_cat = df.groupby("device_category")["sessions"].sum()
            for cat in ["mobile", "desktop", "tablet"]:
                if cat in by_cat.index:
                    cnt = int(by_cat[cat])
                    pct = round(cnt / total_sessions * 100, 1) if total_sessions else 0
                    lines.append(f"- **{cat}**: {cnt:,}（{pct}%）")
            # デバイス別PV/セッション比
            by_device_pv = df.groupby("device_category").agg(
                sessions=("sessions", "sum"),
                page_views=("page_views", "sum"),
            )
            lines.append("")
            lines.append("### デバイス別回遊深度（PV/セッション）")
            for cat, row in by_device_pv.iterrows():
                ratio = round(row["page_views"] / row["sessions"], 2) if row["sessions"] else 0
                lines.append(f"- {cat}: {ratio}")
        lines.append("")
        # デバイスカテゴリ別テーブル
        if "device_category" in df.columns:
            by_device = df.groupby("device_category").agg(
                sessions=("sessions", "sum"),
                users=("users", "sum"),
                page_views=("page_views", "sum"),
            ).sort_values("sessions", ascending=False).reset_index()
            lines.append("## デバイスカテゴリ別")
            lines.append("| デバイス | セッション | 構成比 | ユーザー | PV |")
            lines.append("|---|---:|---:|---:|---:|")
            for _, row in by_device.iterrows():
                s = int(row["sessions"])
                pct = round(s / total_sessions * 100, 1) if total_sessions else 0
                lines.append(f"| {_escape_markdown_cell(row['device_category'])} | {s:,} | {pct}% | {int(row['users']):,} | {int(row['page_views']):,} |")
            lines.append("")
        # OS別
        if "os" in df.columns:
            by_os = df.groupby("os").agg(sessions=("sessions", "sum")).sort_values("sessions", ascending=False).head(10).reset_index()
            lines.append("## OS別セッション数（Top 10）")
            try:
                lines.append(_escape_df_for_markdown(by_os).to_markdown(index=False))
            except ImportError:
                lines.append(by_os.to_string(index=False))
            lines.append("")
        # V3.3: 日別推移セクション
        if "event_date" in df.columns:
            daily_total = df.groupby("event_date", as_index=False).agg({"sessions": "sum"}).sort_values("event_date")
            if len(daily_total) >= 2:
                lines.append("## 日別セッション推移")
                try:
                    lines.append(_escape_df_for_markdown(daily_total).to_markdown(index=False))
                except ImportError:
                    lines.append(daily_total.to_string(index=False))
                lines.append("")

    elif query_type == "hourly":
        lines.append("## 主要KPIサマリー")
        if "page_views" in df.columns:
            total_pv = int(df["page_views"].sum())
            peak_hour = df.loc[df["page_views"].idxmax()]
            low_hour = df.loc[df["page_views"].idxmin()]
            lines.append(f"- **合計PV**: {total_pv:,}")
            lines.append(f"- **ピーク時間帯**: {int(peak_hour['hour_of_day'])}時（PV: {int(peak_hour['page_views']):,}）")
            lines.append(f"- **低アクセス時間帯**: {int(low_hour['hour_of_day'])}時（PV: {int(low_hour['page_views']):,}）")
            # ピーク3時間帯
            top3 = df.nlargest(3, "page_views")
            peak3_str = ", ".join([f"{int(r['hour_of_day'])}時({int(r['page_views']):,})" for _, r in top3.iterrows()])
            lines.append(f"- **ピーク3時間帯**: {peak3_str}")
            # 日中(9-18時) / 夜間(19-8時) PV比率
            daytime = df[(df["hour_of_day"] >= 9) & (df["hour_of_day"] <= 18)]["page_views"].sum()
            nighttime = total_pv - daytime
            day_pct = round(daytime / total_pv * 100, 1) if total_pv else 0
            lines.append(f"- **日中PV比率（9〜18時）**: {day_pct}%（日中: {int(daytime):,}, 夜間: {int(nighttime):,}）")
            lines.append("")
        lines.append("## 時間帯別データ")
        try:
            lines.append(_escape_df_for_markdown(df).to_markdown(index=False))
        except ImportError:
            lines.append(df.to_string(index=False))
        lines.append("")

    elif query_type == "user_attr":
        total_sessions = int(df["sessions"].sum()) if "sessions" in df.columns else 0
        total_users = int(df["users"].sum()) if "users" in df.columns else 0
        lines.append("## 主要KPIサマリー")
        lines.append(f"- **合計セッション数**: {total_sessions:,}")
        lines.append(f"- **合計ユーザー数**: {total_users:,}")
        # 新規ユーザー比率詳細
        if "user_type" in df.columns:
            new_users = int(df[df["user_type"] == "new"]["users"].sum())
            ret_users = int(df[df["user_type"] == "returning"]["users"].sum())
            new_pct = round(new_users / total_users * 100, 1) if total_users else 0
            lines.append(f"- **新規ユーザー比率**: {new_pct}%（新規: {new_users:,}, リピーター: {ret_users:,}）")
            # タイプ別セッション/人
            by_type = df.groupby("user_type").agg(users=("users", "sum"), sessions=("sessions", "sum"))
            for ut, row in by_type.iterrows():
                sess_per_user = round(row["sessions"] / row["users"], 2) if row["users"] else 0
                label = "新規" if ut == "new" else "リピーター"
                lines.append(f"- **{label} セッション/人**: {sess_per_user}")
        lines.append("")
        # 新規/リピーター テーブル
        if "user_type" in df.columns:
            by_type = df.groupby("user_type").agg(
                users=("users", "sum"),
                sessions=("sessions", "sum"),
            ).reset_index()
            lines.append("## 新規/リピーター比率")
            lines.append("| タイプ | ユーザー | 構成比 | セッション |")
            lines.append("|---|---:|---:|---:|")
            for _, row in by_type.iterrows():
                u = int(row["users"])
                pct = round(u / total_users * 100, 1) if total_users else 0
                label = "新規" if row["user_type"] == "new" else "リピーター"
                lines.append(f"| {_escape_markdown_cell(label)} | {u:,} | {pct}% | {int(row['sessions']):,} |")
            lines.append("")
        # 地域別Top 10 + 最多都市の構成比
        if "city" in df.columns:
            by_city = df.groupby("city").agg(
                sessions=("sessions", "sum"),
                users=("users", "sum"),
            ).sort_values("sessions", ascending=False).head(10).reset_index()
            if len(by_city) > 0:
                top_city = by_city.iloc[0]
                top_city_pct = round(int(top_city["sessions"]) / total_sessions * 100, 1) if total_sessions else 0
                lines.append(f"### 最多都市: {_escape_markdown_cell(top_city['city'])}（セッション構成比: {top_city_pct}%）")
                lines.append("")
            lines.append("## 地域別セッション数（Top 10）")
            try:
                lines.append(_escape_df_for_markdown(by_city).to_markdown(index=False))
            except ImportError:
                lines.append(by_city.to_string(index=False))
            lines.append("")

    elif query_type == "engagement":
        # V3.3: エンゲージメント時間分析
        lines.append("## 主要KPIサマリー")
        total_sec = df["total_engagement_sec"].sum() if "total_engagement_sec" in df.columns else 0
        avg_sec = df["avg_engagement_sec"].mean() if "avg_engagement_sec" in df.columns else 0
        total_engaged = int(df["engaged_users"].sum()) if "engaged_users" in df.columns else 0
        days = len(df)
        lines.append(f"- **期間日数**: {days}日")
        lines.append(f"- **合計エンゲージメント時間**: {round(total_sec):,}秒（{round(total_sec / 3600, 1)}時間）")
        lines.append(f"- **セッション平均エンゲージメント**: {round(avg_sec, 1)}秒")
        lines.append(f"- **エンゲージドユーザー数**: {total_engaged:,}")
        # ピーク日
        if "total_engagement_sec" in df.columns and days > 0:
            peak = df.loc[df["total_engagement_sec"].idxmax()]
            lines.append(f"- **ピーク日**: {peak['event_date']}（{round(float(peak['total_engagement_sec'])):,}秒）")
            low = df.loc[df["total_engagement_sec"].idxmin()]
            lines.append(f"- **最低日**: {low['event_date']}（{round(float(low['total_engagement_sec'])):,}秒）")
        # 前半後半トレンド
        if days >= 4:
            mid = days // 2
            sorted_df = df.sort_values("event_date")
            first_avg = sorted_df.iloc[:mid]["total_engagement_sec"].mean()
            second_avg = sorted_df.iloc[mid:]["total_engagement_sec"].mean()
            ratio = round(second_avg / first_avg, 2) if first_avg else 0
            trend = "↗ 上昇" if ratio > 1.05 else ("↘ 下降" if ratio < 0.95 else "→ 横ばい")
            lines.append(f"- **前半/後半トレンド**: {trend}（比率: {ratio}）")
        lines.append("")
        # 日別推移テーブル
        lines.append("## 日別エンゲージメント推移")
        display_df = df.sort_values("event_date").copy()
        if "total_engagement_sec" in display_df.columns:
            display_df["total_engagement_sec"] = display_df["total_engagement_sec"].apply(lambda x: round(x, 1))
        if "avg_engagement_sec" in display_df.columns:
            display_df["avg_engagement_sec"] = display_df["avg_engagement_sec"].apply(lambda x: round(x, 1))
        try:
            lines.append(_escape_df_for_markdown(display_df).to_markdown(index=False))
        except ImportError:
            lines.append(display_df.to_string(index=False))
        lines.append("")

    elif query_type == "auction_proxy":
        # V3.3: 推定オークション圧分析
        lines.append("## 主要KPIサマリー")
        lines.append("*注意: これはGA4データからの推定値です。実際のオークションデータにはGoogle Ads連携が必要です。*")
        lines.append("")
        # チャネルグループ別合計
        ch_agg = df.groupby("channel_group", as_index=False).agg({"sessions": "sum"}).sort_values("sessions", ascending=False)
        total_sess = int(ch_agg["sessions"].sum())
        paid = int(ch_agg[ch_agg["channel_group"] == "paid"]["sessions"].sum()) if "paid" in ch_agg["channel_group"].values else 0
        organic = int(ch_agg[ch_agg["channel_group"] == "organic"]["sessions"].sum()) if "organic" in ch_agg["channel_group"].values else 0
        paid_pct = round(paid / total_sess * 100, 1) if total_sess else 0
        org_pct = round(organic / total_sess * 100, 1) if total_sess else 0
        lines.append(f"- **合計セッション**: {total_sess:,}")
        lines.append(f"- **有料流入比率**: {paid_pct}%（{paid:,}セッション）")
        lines.append(f"- **オーガニック流入比率**: {org_pct}%（{organic:,}セッション）")
        # チャネル集中度（HHI的指標）
        if total_sess > 0:
            shares = ch_agg["sessions"] / total_sess
            hhi = round((shares ** 2).sum() * 10000)
            concentration = "高集中" if hhi > 5000 else ("中集中" if hhi > 2500 else "分散")
            lines.append(f"- **チャネル集中度**: {concentration}（HHI: {hhi}）")
        lines.append("")
        lines.append("## チャネルグループ別構成比")
        lines.append("| チャネル | セッション | 構成比 |")
        lines.append("|---|---:|---:|")
        for _, row in ch_agg.iterrows():
            s = int(row["sessions"])
            pct = round(s / total_sess * 100, 1) if total_sess else 0
            lines.append(f"| {_escape_markdown_cell(row['channel_group'])} | {s:,} | {pct}% |")
        lines.append("")
        # 日別推移
        if "event_date" in df.columns:
            daily_paid = df[df["channel_group"] == "paid"].groupby("event_date", as_index=False).agg({"sessions": "sum"}).rename(columns={"sessions": "paid_sessions"})
            daily_total = df.groupby("event_date", as_index=False).agg({"sessions": "sum"}).rename(columns={"sessions": "total_sessions"})
            daily = daily_total.merge(daily_paid, on="event_date", how="left").fillna(0).sort_values("event_date")
            daily["paid_ratio"] = (daily["paid_sessions"] / daily["total_sessions"] * 100).round(1)
            if len(daily) >= 2:
                lines.append("## 日別有料流入比率推移")
                try:
                    lines.append(_escape_df_for_markdown(daily).to_markdown(index=False))
                except ImportError:
                    lines.append(daily.to_string(index=False))
                lines.append("")

    else:
        # 未知のクエリタイプ → 基本的な統計
        lines.append("## 基本統計")
        numeric_cols = df.select_dtypes(include="number").columns.tolist()
        for col in numeric_cols[:5]:
            lines.append(f"- **{col}** — 合計: {df[col].sum():,.0f}, 平均: {df[col].mean():,.1f}")
        lines.append("")

    return "\n".join(lines) + "\n"


def generate_cross_summary(results: dict[str, dict]) -> str:
    """複数クエリタイプの結果を横断的に統合するサマリーを生成する。

    Args:
        results: {query_type: {"report_md": str, "dataframe": DataFrame, ...}} の辞書

    Returns:
        統合サマリーMarkdown文字列
    """
    lines: list[str] = ["# 統合サマリー", ""]

    # PV + CV → 推定CVR
    pv_data = results.get("pv", {})
    cv_data = results.get("cv", {})
    traffic_data = results.get("traffic", {})

    total_sessions = 0
    total_pv = 0
    total_cv = 0
    top_channel = ""

    if pv_data.get("dataframe") is not None:
        df_pv = pv_data["dataframe"]
        if "sessions" in df_pv.columns:
            total_sessions = int(df_pv["sessions"].sum())
        if "page_views" in df_pv.columns:
            total_pv = int(df_pv["page_views"].sum())

    if cv_data.get("dataframe") is not None:
        df_cv = cv_data["dataframe"]
        if "event_count" in df_cv.columns:
            total_cv = int(df_cv["event_count"].sum())

    if traffic_data.get("dataframe") is not None:
        df_traffic = traffic_data["dataframe"]
        if "sessions" in df_traffic.columns and len(df_traffic) > 0:
            top_row = df_traffic.loc[df_traffic["sessions"].idxmax()]
            top_channel = f"{_escape_markdown_cell(top_row.get('source', ''))} / {_escape_markdown_cell(top_row.get('medium', ''))}"
            if not total_sessions:
                total_sessions = int(df_traffic["sessions"].sum())

    lines.append("## 横断KPI")
    if total_sessions:
        lines.append(f"- **合計セッション数**: {total_sessions:,}")
    if total_pv:
        lines.append(f"- **合計PV数**: {total_pv:,}")
    if total_cv:
        lines.append(f"- **合計CV数**: {total_cv:,}")
    if total_sessions and total_cv:
        cvr = round(total_cv / total_sessions * 100, 2)
        lines.append(f"- **推定CVR（CV/セッション）**: {cvr}%")
    if top_channel:
        lines.append(f"- **最大流入元**: {top_channel}")
    lines.append("")

    # 各クエリタイプから主要KPIを1行ずつ抽出
    lines.append("## クエリタイプ別ハイライト")
    _QUERY_NAMES = {
        "pv": "PV分析", "traffic": "流入分析", "cv": "CV分析",
        "search": "検索クエリ", "anomaly": "異常検知", "landing": "LP分析",
        "device": "デバイス", "hourly": "時間帯", "user_attr": "ユーザー属性",
        "engagement": "エンゲージメント", "auction_proxy": "オークション圧（推定）",
    }
    for qt, data in results.items():
        df = data.get("dataframe")
        if df is None or df.empty:
            continue
        name = _QUERY_NAMES.get(qt, qt)
        highlight = f"データ {len(df)}行"

        if qt == "pv" and "page_views" in df.columns:
            highlight = f"PV: {int(df['page_views'].sum()):,}"
        elif qt == "traffic" and "sessions" in df.columns:
            highlight = f"セッション: {int(df['sessions'].sum()):,}, 経路数: {len(df)}"
        elif qt == "cv" and "event_count" in df.columns:
            highlight = f"CV: {int(df['event_count'].sum()):,}"
        elif qt == "anomaly":
            z_cols = [c for c in df.columns if c.endswith("_zscore")]
            anomaly_cnt = sum(1 for _, r in df.iterrows() for c in z_cols if pd.notna(r[c]) and abs(r[c]) >= 2)
            highlight = f"異常検出: {anomaly_cnt}件"
        elif qt == "landing" and "sessions" in df.columns:
            highlight = f"LP数: {len(df)}, 合計セッション: {int(df['sessions'].sum()):,}"
        elif qt == "device" and "sessions" in df.columns:
            highlight = f"合計セッション: {int(df['sessions'].sum()):,}"
        elif qt == "hourly" and "page_views" in df.columns:
            peak = df.loc[df["page_views"].idxmax()]
            highlight = f"ピーク: {int(peak['hour_of_day'])}時 (PV: {int(peak['page_views']):,})"
        elif qt == "engagement" and "total_engagement_sec" in df.columns:
            total_sec = df["total_engagement_sec"].sum()
            highlight = f"合計: {round(total_sec):,}秒, 平均: {round(df['avg_engagement_sec'].mean(), 1)}秒/セッション"
        elif qt == "auction_proxy" and "sessions" in df.columns:
            paid = int(df[df["channel_group"] == "paid"]["sessions"].sum()) if "channel_group" in df.columns else 0
            total = int(df["sessions"].sum())
            highlight = f"有料流入比率: {round(paid / total * 100, 1) if total else 0}%"

        lines.append(f"- **{name}**: {highlight}")

    lines.append("")
    return "\n".join(lines) + "\n"


def period_to_dates(period: str) -> tuple[str, str]:
    """期間文字列をBigQuery用の日付範囲に変換する。

    Args:
        period: "2025-12" (月次), "2025-12-26" (日次), or "2025-12-01:2025-12-31" (範囲) 形式

    Returns:
        (start_date, end_date) -- YYYYMMDD形式
    """
    if ":" in period:
        start, end = period.split(":")
        return start.replace("-", ""), end.replace("-", "")
    else:
        parts = period.split("-")
        if len(parts) == 3:
            # YYYY-MM-DD → 単日
            d = period.replace("-", "")
            return d, d
        # YYYY-MM → 月初〜月末
        import calendar
        year, month = int(parts[0]), int(parts[1])
        _, last_day = calendar.monthrange(year, month)
        return f"{year}{month:02d}01", f"{year}{month:02d}{last_day:02d}"


def run_report(
    query_type: str,
    dataset: str,
    period: str,
    output_dir: Path = Path("bq_reports"),
    project: str = PROJECT_ID,
) -> dict:
    """BigQuery レポート生成のメインフロー。

    Args:
        query_type: クエリタイプ（pv/traffic/cv/search/anomaly/landing）
        dataset: BigQuery データセットID
        period: 期間（YYYY-MM or start:end）
        output_dir: 出力ディレクトリ
        project: GCPプロジェクトID

    Returns:
        生成ファイルパスの辞書
    """
    load_env()
    results = {}

    start_date, end_date = period_to_dates(period)
    query_info = QUERIES[query_type]

    print(f"[bq-reporter] クエリタイプ: {query_info['name']}")
    print(f"[bq-reporter] データセット: {dataset}")
    print(f"[bq-reporter] 期間: {start_date} ~ {end_date}")

    # SQL 生成・実行
    sql = get_query(query_type, dataset, start_date, end_date)
    print(f"[bq-reporter] SQL 実行中...")
    try:
        df = run_query(sql, project)
    except Exception as e:
        err_name = type(e).__name__
        err_str = str(e)
        # DefaultCredentialsError は上位で処理（デモフォールバック等）
        if (err_name == "DefaultCredentialsError"
                or "credentials were not found" in err_str
                or "Could not automatically determine credentials" in err_str):
            raise
        # google.api_core.exceptions.Forbidden / PermissionDenied 等の認証エラー
        if "Forbidden" in err_name or "PermissionDenied" in err_name or "Unauthenticated" in err_name:
            print(f"[bq-reporter] BigQuery認証エラー: gcloud auth application-default login を実行してください")
            return results
        # google.api_core.exceptions.NotFound — データセット/テーブルが見つからない
        if "NotFound" in err_name:
            print(f"[bq-reporter] データセットが見つかりません: {dataset}. データセットIDを確認してください")
            return results
        # その他のエラー
        print(f"[bq-reporter] BigQueryクエリ実行エラー: {e}")
        return results
    print(f"[bq-reporter] 取得行数: {len(df)}")

    if df.empty:
        print("[bq-reporter] データが0件です。")
        return results

    # レポート出力（集計サマリー＋データ抜粋）
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / f"{query_type}_{period.replace(':', '_')}_report.md"

    body = f"# {query_info['name']}レポート（{period}）\n\n"
    body += f"## データ概要\n"
    body += f"- データセット: {dataset}\n"
    body += f"- 期間: {start_date} ~ {end_date}\n"
    body += f"- 取得行数: {len(df)}\n\n"

    # クエリタイプ別の集計サマリーを生成
    body += _summarize(df, query_type, period)

    # クエリタイプ別に参考データ行数を最適化
    _DATA_ROWS = {
        "anomaly": 0,    # 集計済みなので生データ不要
        "device": 0,     # 集計済みなので生データ不要
        "search": 30,    # 検索キーワードは多めに表示
    }
    data_rows = _DATA_ROWS.get(query_type, 20)
    if data_rows > 0:
        try:
            data_md = _escape_df_for_markdown(df.head(data_rows)).to_markdown(index=False)
        except ImportError:
            data_md = df.head(data_rows).to_string(index=False)
        body += f"\n## 参考データ（上位{data_rows}行）\n{data_md}\n"

    write_report(
        out_path=report_path,
        title=f"{query_info['name']}レポート（{period}）",
        skill="bq-reporter",
        model="bigquery",
        body=body,
        extra_meta={"dataset": dataset, "period": period, "query_type": query_type},
    )
    results["report"] = str(report_path)
    results["report_md"] = body          # Markdown本文（UI統合用）
    results["dataframe"] = df            # DataFrame（チャート生成用）
    results["query_info"] = query_info   # クエリメタ情報
    print(f"[bq-reporter] レポート出力: {report_path}")

    # CSV も出力
    csv_path = output_dir / f"{query_type}_{period.replace(':', '_')}_data.csv"
    df.to_csv(csv_path, index=False, encoding="utf-8-sig")
    results["csv"] = str(csv_path)
    print(f"[bq-reporter] CSV出力: {csv_path}")

    return results


def main():
    load_env()

    parser = argparse.ArgumentParser(description="bq-reporter: BigQueryレポート生成")
    parser.add_argument(
        "--query", required=True,
        choices=list(QUERIES.keys()),
        help="クエリタイプ（pv/traffic/cv/search/anomaly/landing）"
    )
    parser.add_argument("--dataset", required=True, help="BigQueryデータセットID")
    parser.add_argument("--period", required=True, help="期間（YYYY-MM or start:end）")
    parser.add_argument("--output", default="bq_reports", help="出力ディレクトリ")
    parser.add_argument("--project", default=PROJECT_ID, help="GCPプロジェクトID")
    parser.add_argument("--list", action="store_true", help="利用可能なクエリタイプ一覧")
    args = parser.parse_args()

    if args.list:
        print("利用可能なクエリタイプ:")
        for qt in list_query_types():
            print(f"  {qt['key']}: {qt['name']} -- {qt['description']}")
        return

    results = run_report(
        query_type=args.query,
        dataset=args.dataset,
        period=args.period,
        output_dir=Path(args.output),
        project=args.project,
    )

    print(f"\n[bq-reporter] 完了。生成ファイル:")
    for key, path in results.items():
        print(f"  {key}: {path}")


if __name__ == "__main__":
    main()
