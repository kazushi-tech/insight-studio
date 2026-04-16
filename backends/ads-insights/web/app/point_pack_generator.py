# point_pack_generator.py
# ReportDataからpoint-pack.mdを生成するモジュール
# 暗算禁止：すべての計算はコードで行う

from __future__ import annotations
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
import datetime as dt

from .report_data import ReportData, ExtractMeta
from .image_extractor import get_banner_info_table, extract_ad_titles_fallback


# KPI表示設定
KPI_DISPLAY = [
    ("cost", "費用"),
    ("impr", "表示回数"),
    ("click", "クリック"),
    ("cv", "CV"),
    ("revenue", "売上"),
    ("revenue_per_cv", "売上単価"),
    ("roas", "ROAS"),
    ("ctr", "CTR"),
    ("cvr", "CVR"),
    ("cpa", "CPA"),
    ("cpc", "CPC"),
]

# 媒体別KPI表示設定（主要KPIのみ）
MEDIA_KPI_DISPLAY = [
    ("cost", "費用"),
    ("impr", "表示回数"),
    ("click", "クリック"),
    ("cv", "CV"),
    ("ctr", "CTR"),
    ("cvr", "CVR"),
    ("cpa", "CPA"),
    ("cpc", "CPC"),
]


def fmt_value(v: Optional[float], pct: bool = False, kpi_key: Optional[str] = None) -> str:
    """
    数値フォーマット（KPI種類に応じた単位付き）
    
    Args:
        v: 数値
        pct: 増減率表示フラグ（従来通り）
        kpi_key: KPIキー（cost, impr, ctr など）
    
    Returns:
        フォーマット済み文字列
    """
    if v is None:
        return "-"
    
    # 増減率表示の場合（従来通り）
    if pct:
        return f"{v:.2%}"
    
    # KPI固有の単位表示
    if kpi_key == "cost":
        # 費用は円記号付き
        if abs(v) >= 1000:
            return f"¥{v:,.0f}"
        return f"¥{v:.0f}"

    elif kpi_key == "impr":
        # 表示回数は「回」付き
        return f"{v:,.0f}回"

    elif kpi_key == "click":
        # クリック数は「回」付き
        return f"{v:,.0f}回"

    elif kpi_key == "cv":
        # CV数は「件」付き
        return f"{v:,.0f}件"

    elif kpi_key == "conversion_value":
        # CV値は円記号付き
        if abs(v) >= 1000:
            return f"¥{v:,.0f}"
        return f"¥{v:.0f}"

    elif kpi_key == "revenue":
        # 売上は円記号付き
        if abs(v) >= 1000:
            return f"¥{v:,.0f}"
        return f"¥{v:.0f}"

    elif kpi_key in ("ctr", "cvr"):
        # CTR/CVRは100倍してパーセント表示 (0.05 → 5.00%)
        return f"{v * 100:.2f}%"

    elif kpi_key in ("cpa", "cpc"):
        # CPA/CPCは円記号付き
        if abs(v) >= 1000:
            return f"¥{v:,.0f}"
        return f"¥{v:.0f}"

    elif kpi_key == "revenue_per_cv":
        # 売上単価は円記号付き
        if abs(v) >= 1000:
            return f"¥{v:,.0f}"
        return f"¥{v:.0f}"

    elif kpi_key == "roas":
        # ROASはパーセント表示（既に100倍されている）
        return f"{v:.1f}%"

    # デフォルト（単位なし）
    if abs(v) >= 1000:
        return f"{v:,.0f}"
    return f"{v:.4g}"


def safe_div(a: Optional[float], b: Optional[float]) -> Optional[float]:
    """安全な除算（0除算はNone）"""
    if a is None or b is None:
        return None
    if b == 0:
        return None
    return a / b


def calc_delta(current: Optional[float], base: Optional[float]) -> Optional[float]:
    """差分計算"""
    if current is None or base is None:
        return None
    return current - base


def calc_pct_change(current: Optional[float], base: Optional[float]) -> Optional[float]:
    """増減率計算（差分 / base）"""
    if current is None or base is None:
        return None
    if base == 0:
        return None
    return (current - base) / base


def generate_comparison(current: ReportData, base: Optional[ReportData]) -> Dict[str, Dict[str, Any]]:
    """
    当月とベースの比較を計算
    """
    result: Dict[str, Dict[str, Any]] = {}
    
    for key, display in KPI_DISPLAY:
        cv = current.get_kpi(key)
        bv = base.get_kpi(key) if base else None
        dv = calc_delta(cv, bv)
        pv = calc_pct_change(cv, bv)
        
        result[key] = {
            "display": display,
            "current": cv,
            "base": bv,
            "delta": dv,
            "pct": pv,
            "evidence_current": current.evidence.get(key, ""),
            "evidence_base": base.evidence.get(key, "") if base else "",
        }
    
    return result


def generate_point_pack_md(
    current: ReportData,
    base: Optional[ReportData],
    client_name: str,
    base_label: str = "前月",
    lp_url: str = "",
    chart_paths: List[str] = [],
) -> str:
    """
    point-pack.md の本文を生成（単月比較版）
    
    暗算禁止: すべての数値はReportDataから取得、すべての計算はこの関数内で行う
    """
    month_tag = current.month_tag
    comparison = generate_comparison(current, base)

    # 期間タイプに応じたラベル
    period_type = getattr(current, "period_type", "monthly")
    period_label = "週次" if period_type == "weekly" else "月次"

    lines: List[str] = []

    # ヘッダー
    lines.append(f"# 要点パック（{month_tag} / {client_name}）")
    if period_type == "weekly":
        period_start = getattr(current, "period_start", "")
        period_end = getattr(current, "period_end", "")

        # period_start/endが空の場合、month_tagから抽出を試みる
        if not period_start or not period_end:
            if "_" in month_tag:
                # "2025-11-17_2025-11-23" 形式
                parts = month_tag.split("_")
                if len(parts) == 2:
                    period_start, period_end = parts[0], parts[1]

        if period_start and period_end:
            lines.append(f"> 📅 {period_label}レポート: {period_start} 〜 {period_end}")
    lines.append("")
    
    # 集計条件
    lines.append("## 集計条件")
    if lp_url:
        lines.append(f"- **対象LP**: [{lp_url}]({lp_url})")
    lines.append(f"- 当月ファイル: `{current.meta.file}`")
    lines.append(f"- 当月シート: `{current.meta.sheet}`")
    lines.append(f"- 抽出方式: `{current.meta.method}`")
    if base:
        lines.append(f"- {base_label}ファイル: `{base.meta.file}`")
        lines.append(f"- {base_label}シート: `{base.meta.sheet}`")
    else:
        lines.append(f"- {base_label}: 未指定")
    lines.append(f"- 抽出日時: `{current.extracted_at}`")
    lines.append("")
    
    # KPIサマリ表
    lines.append(f"## KPI比較（当月 vs {base_label}）")
    lines.append("")
    lines.append(f"| KPI | 当月 | {base_label} | 差分 | 増減率 |")
    lines.append("|------|------|------|------|------|")
    
    for key, display in KPI_DISPLAY:
        r = comparison[key]
        lines.append(
            f"| {display} | {fmt_value(r['current'], kpi_key=key)} | {fmt_value(r['base'], kpi_key=key)} | "
            f"{fmt_value(r['delta'], kpi_key=key)} | {fmt_value(r['pct'], pct=True)} |"
        )
    
    lines.append("")
    
    # 変化Top
    changes = [(key, r["pct"], r["display"]) for key, r in comparison.items() if r["pct"] is not None]
    up = sorted([(k, p, d) for k, p, d in changes if p > 0], key=lambda x: -x[1])[:5]
    down = sorted([(k, p, d) for k, p, d in changes if p < 0], key=lambda x: x[1])[:5]
    
    lines.append("## 変化Top")
    lines.append("")
    lines.append("### 上昇")
    if up:
        for k, p, d in up:
            lines.append(f"- {d}: {p:+.2%}")
    else:
        lines.append("- 該当なし")
    lines.append("")
    
    lines.append("### 下降")
    if down:
        for k, p, d in down:
            lines.append(f"- {d}: {p:+.2%}")
    else:
        lines.append("- 該当なし")
    lines.append("")
    
    # Evidence（抽出根拠）
    lines.append("## Evidence（抽出根拠）")
    lines.append("")
    lines.append("| KPI | 当月根拠 | 前月根拠 |")
    lines.append("|------|------|------|")
    
    for key, display in KPI_DISPLAY:
        r = comparison[key]
        lines.append(f"| {display} | {r['evidence_current']} | {r['evidence_base']} |")
    
    lines.append("")
    
    lines.append("")
    
    if chart_paths:
        lines.append("## 参考データ（グラフ）")
        for cp in chart_paths:
            lines.append(f"![]({cp})")
        lines.append("")

    # 監査情報
    lines.append("## 監査情報")
    lines.append("")
    lines.append(f"- 当月ファイルハッシュ: `{current.meta.file_hash}`")
    lines.append(f"- 当月ファイルサイズ: `{current.meta.file_size:,}` bytes")
    lines.append(f"- 当月ファイル更新: `{current.meta.file_modified}`")
    if base:
        lines.append(f"- {base_label}ファイルハッシュ: `{base.meta.file_hash}`")
        lines.append(f"- {base_label}ファイルサイズ: `{base.meta.file_size:,}` bytes")
        lines.append(f"- {base_label}ファイル更新: `{base.meta.file_modified}`")
    lines.append("")
    
    return "\n".join(lines)


def aggregate_multi_month_kpis(reports: List[Tuple[str, ReportData]]) -> ReportData:
    """
    複数月のKPIを合算して総計ReportDataを返す
    
    基本KPI（cost/impr/click/cv）は単純合計
    派生指標（ctr/cvr/cpa/cpc）は総計から再計算
    
    Args:
        reports: [(month_tag, ReportData), ...]
    
    Returns:
        総計ReportData
    """
    totals_kpis: Dict[str, float] = {
        'cost': 0.0,
        'impr': 0.0,
        'click': 0.0,
        'cv': 0.0,
        'conversion_value': 0.0,
        'revenue': 0.0,
    }

    # 基本KPIを合算
    for month, report in reports:
        for key in ['cost', 'impr', 'click', 'cv', 'conversion_value', 'revenue']:
            val = report.get_kpi(key)
            if val is not None:
                totals_kpis[key] += val
    
    # 総計ReportDataを作成
    totals_meta = ExtractMeta(
        file=f"aggregated_{len(reports)}_months",
        sheet="totals",
        method="aggregation",
        refs={},
        rows=len(reports),
        cols=0,
    )
    
    totals_report = ReportData(
        kpis=totals_kpis,
        meta=totals_meta,
        evidence={},
        month_tag=f"{reports[-1][0]}_to_{reports[0][0]}",
    )
    
    # 派生指標を計算
    totals_report.compute_derived_kpis()
    
    return totals_report


def format_period_label(month_tag: str, report: ReportData) -> str:
    """
    period_tagとReportDataから短い期間ラベルを生成

    Args:
        month_tag: 元のmonth_tag（例: "2025-11-17_2025-11-23"）
        report: ReportData

    Returns:
        短いラベル（例: "11/17-11/23"）
    """
    period_start = getattr(report, "period_start", "")
    period_end = getattr(report, "period_end", "")

    # period_start/endが設定されている場合
    if period_start and period_end:
        # YYYY-MM-DD形式から MM/DD形式に変換
        try:
            start_parts = period_start.split("-")
            end_parts = period_end.split("-")
            if len(start_parts) == 3 and len(end_parts) == 3:
                # 同じ年月の場合は日付だけ
                if start_parts[0:2] == end_parts[0:2]:
                    return f"{int(start_parts[1])}/{int(start_parts[2])}-{int(end_parts[2])}"
                # 異なる月の場合は月/日で表示
                else:
                    return f"{int(start_parts[1])}/{int(start_parts[2])}-{int(end_parts[1])}/{int(end_parts[2])}"
        except:
            pass

    # month_tagから抽出を試みる
    if "_" in month_tag and "-" in month_tag:
        # "2025-11-17_2025-11-23" 形式
        parts = month_tag.split("_")
        if len(parts) == 2:
            try:
                start = parts[0].split("-")
                end = parts[1].split("-")
                if len(start) == 3 and len(end) == 3:
                    # 同じ年月なら日付だけ
                    if start[0:2] == end[0:2]:
                        return f"{int(start[1])}/{int(start[2])}-{int(end[2])}"
                    else:
                        return f"{int(start[1])}/{int(start[2])}-{int(end[1])}/{int(end[2])}"
            except:
                pass

    # 月次の場合（YYYY-MM形式）
    if "-" in month_tag and len(month_tag.split("-")) == 2:
        try:
            parts = month_tag.split("-")
            return f"{parts[0]}/{int(parts[1])}"
        except:
            pass

    # それ以外はそのまま返す
    return month_tag


def generate_multi_month_point_pack_md(
    reports: List[Tuple[str, ReportData]],
    client_name: str,
    lp_url: str = "",
    chart_paths: List[str] = [],
    include_banners: bool = True,
) -> str:
    """
    複数月比較版 point-pack.md を生成

    Args:
        reports: [(month_tag, ReportData), ...] 新しい順
        client_name: クライアント名
        lp_url: LP URL
        chart_paths: グラフ画像パス
        include_banners: バナー画像を含めるかどうか

    Returns:
        Markdown本文
    """
    if not reports:
        return "# 要点パック\n\nデータがありません。"

    lines: List[str] = []

    # 期間タイプを判定（最初のレポートから）
    current_month = reports[0][0]
    num_periods = len(reports)
    # 期間タイプを判定（最初のレポートから）
    current_month = reports[0][0]
    num_periods = len(reports)
    num_months = len(reports) # Fix: define num_months as alias for num_periods or len(reports)
    period_type = getattr(reports[0][1], "period_type", "monthly")
    period_unit = "週" if period_type == "weekly" else "ヶ月"

    # ヘッダー
    lines.append(f"# 要点パック（{current_month} / {client_name}）")
    lines.append("")
    lines.append(f"> 📊 過去{num_periods}{period_unit}の推移を含む")
    lines.append("")

    # 総計を計算
    totals_report = aggregate_multi_month_kpis(reports)
    
    # 集計条件
    lines.append("## 集計条件")
    if lp_url:
        lines.append(f"- **対象LP**: [{lp_url}]({lp_url})")
    lines.append(f"- 対象期間: {reports[-1][0]} 〜 {reports[0][0]} ({num_months}ヶ月)")
    for month, report in reports[:3]:  # 最新3件のみ表示
        lines.append(f"- {month}: `{Path(report.meta.file).name}`")
    if num_months > 3:
        lines.append(f"- ... 他{num_months - 3}件")
    lines.append(f"- 抽出日時: `{reports[0][1].extracted_at}`")
    lines.append("")
    
    # 期間推移表（合計列付き）
    period_trend_label = "週次推移" if period_type == "weekly" else "月次推移"
    lines.append(f"## {period_trend_label}")
    lines.append("")
    
    # ヘッダー行（合計列を追加）- 短い期間ラベルを使用
    month_headers = " | ".join([format_period_label(m, r) for m, r in reports])
    lines.append(f"| KPI | {month_headers} | **合計** |")
    lines.append("|------" + "|------" * num_months + "|------|")
    
    # データ行
    for key, display in KPI_DISPLAY:
        values = []
        for month, report in reports:
            v = report.get_kpi(key)
            if v is None:
                print(f"[WARN] {month}/{key} = 未取得")  # デバッグログ
            values.append(fmt_value(v, kpi_key=key))
        
        # 合計値
        total_v = totals_report.get_kpi(key)
        values.append(f"**{fmt_value(total_v, kpi_key=key)}**")
        
        lines.append(f"| {display} | {' | '.join(values)} |")
    
    lines.append("")
    
    # トレンド分析（当月 vs 最古月）
    if num_months >= 2:
        current_report = reports[0][1]
        oldest_report = reports[-1][1]
        oldest_month = reports[-1][0]

        # 短いラベルを使用
        current_label = format_period_label(current_month, current_report)
        oldest_label = format_period_label(oldest_month, oldest_report)

        lines.append(f"## トレンド分析（{current_label} vs {oldest_label}）")
        lines.append("")
        lines.append(f"| KPI | {current_label} | {oldest_label} | 変化 | 増減率 |")
        lines.append("|------|------|------|------|------|")
        
        for key, display in KPI_DISPLAY:
            cv = current_report.get_kpi(key)
            ov = oldest_report.get_kpi(key)
            delta = calc_delta(cv, ov)
            pct = calc_pct_change(cv, ov)
            lines.append(
                f"| {display} | {fmt_value(cv, kpi_key=key)} | {fmt_value(ov, kpi_key=key)} | "
                f"{fmt_value(delta, kpi_key=key)} | {fmt_value(pct, pct=True)} |"
            )
        
        lines.append("")
    
    # 前週/前月比較（直近2期間）
    if num_months >= 2:
        current_report = reports[0][1]
        prev_report = reports[1][1]
        prev_month = reports[1][0]

        # 週次か月次かで表記を変える
        comparison_label = "前週比較" if period_type == "weekly" else "前月比較"

        # 短いラベルを使用
        current_label = format_period_label(current_month, current_report)
        prev_label = format_period_label(prev_month, prev_report)

        lines.append(f"## {comparison_label}（{current_label} vs {prev_label}）")
        lines.append("")
        lines.append(f"| KPI | {current_label} | {prev_label} | 変化 | 増減率 |")
        lines.append("|------|------|------|------|------|")
        
        changes_list = []
        for key, display in KPI_DISPLAY:
            cv = current_report.get_kpi(key)
            pv = prev_report.get_kpi(key)
            delta = calc_delta(cv, pv)
            pct = calc_pct_change(cv, pv)
            lines.append(
                f"| {display} | {fmt_value(cv, kpi_key=key)} | {fmt_value(pv, kpi_key=key)} | "
                f"{fmt_value(delta, kpi_key=key)} | {fmt_value(pct, pct=True)} |"
            )
            if pct is not None:
                changes_list.append((key, display, pct))
        
        lines.append("")

        # 変化Top
        up = sorted([(k, d, p) for k, d, p in changes_list if p > 0], key=lambda x: -x[2])[:3]
        down = sorted([(k, d, p) for k, d, p in changes_list if p < 0], key=lambda x: x[2])[:3]

        prev_period_label = "前週" if period_type == "weekly" else "前月"
        lines.append(f"### {prev_period_label}からの主な変化")
        lines.append("")
        if up:
            lines.append("**上昇:**")
            for k, d, p in up:
                lines.append(f"- {d}: {p:+.2%}")
        if down:
            lines.append("")
            lines.append("**下降:**")
            for k, d, p in down:
                lines.append(f"- {d}: {p:+.2%}")
        lines.append("")

    # 媒体別パフォーマンス（最新期間のみ）
    current_report = reports[0][1]
    if hasattr(current_report, 'media_breakdown') and current_report.media_breakdown:
        lines.append("## 媒体別パフォーマンス")
        lines.append("")
        lines.append("> 📊 各広告媒体のKPI比較（AIによる媒体別分析の参考データ）")
        lines.append("")

        # ヘッダー行
        lines.append("| 媒体 | 費用 | 表示回数 | クリック | CV | CTR | CVR | CPA | CPC |")
        lines.append("|------|------|----------|----------|----|----|----|----|-----|")

        # データ行
        for media in current_report.media_breakdown:
            k = media.kpis
            lines.append(
                f"| {media.media_name} "
                f"| {fmt_value(k.get('cost'), kpi_key='cost')} "
                f"| {fmt_value(k.get('impr'), kpi_key='impr')} "
                f"| {fmt_value(k.get('click'), kpi_key='click')} "
                f"| {fmt_value(k.get('cv'), kpi_key='cv')} "
                f"| {fmt_value(k.get('ctr'), kpi_key='ctr')} "
                f"| {fmt_value(k.get('cvr'), kpi_key='cvr')} "
                f"| {fmt_value(k.get('cpa'), kpi_key='cpa')} "
                f"| {fmt_value(k.get('cpc'), kpi_key='cpc')} |"
            )

        lines.append("")

        # 媒体別寄与度分析
        total_cost = sum(m.kpis.get('cost', 0) or 0 for m in current_report.media_breakdown)
        total_cv = sum(m.kpis.get('cv', 0) or 0 for m in current_report.media_breakdown)

        if total_cost > 0 or total_cv > 0:
            lines.append("### 媒体別寄与度")
            lines.append("")
            lines.append("> 費用シェアとCVシェアの比較から、各媒体の費用対効果を確認できます")
            lines.append("")
            lines.append("| 媒体 | 費用シェア | CVシェア | 効率比 |")
            lines.append("|------|-----------|----------|--------|")

            for media in current_report.media_breakdown:
                cost = media.kpis.get('cost', 0) or 0
                cv = media.kpis.get('cv', 0) or 0
                cost_share = (cost / total_cost * 100) if total_cost > 0 else 0
                cv_share = (cv / total_cv * 100) if total_cv > 0 else 0
                # 効率比 = CVシェア / 費用シェア（1.0以上なら効率的）
                efficiency = (cv_share / cost_share) if cost_share > 0 else 0

                # 効率比の評価アイコン
                if efficiency >= 1.2:
                    eff_icon = "🟢"
                elif efficiency >= 0.8:
                    eff_icon = "🟡"
                else:
                    eff_icon = "🔴"

                lines.append(
                    f"| {media.media_name} "
                    f"| {cost_share:.1f}% "
                    f"| {cv_share:.1f}% "
                    f"| {eff_icon} {efficiency:.2f}x |"
                )

            lines.append("")
            lines.append("> 効率比 = CVシェア ÷ 費用シェア（1.0以上 = 費用以上のCV貢献）")
            lines.append("")

    # 売上効率指標（CV値・売上がある場合のみ表示）
    current_report = reports[0][1]
    has_cv_value = current_report.get_kpi("conversion_value") is not None
    has_revenue = current_report.get_kpi("revenue") is not None

    if has_cv_value or has_revenue:
        lines.append("## 売上効率指標")
        lines.append("")
        lines.append("> 💰 1件のCVでどれくらい売り上げが上がるか、広告費用対効果を分析")
        lines.append("")

        # 各期間の効率指標を計算
        efficiency_data = []
        for month, report in reports:
            cv = report.get_kpi("cv")
            cv_value = report.get_kpi("conversion_value")
            revenue = report.get_kpi("revenue")
            cost = report.get_kpi("cost")

            # 売上単価（CV値 / CV または 売上 / CV）
            revenue_per_cv = None
            if cv and cv > 0:
                if cv_value is not None:
                    revenue_per_cv = cv_value / cv
                elif revenue is not None:
                    revenue_per_cv = revenue / cv

            # ROAS（CV値 / 費用 * 100 または 売上 / 費用 * 100）
            roas = None
            if cost and cost > 0:
                if cv_value is not None:
                    roas = (cv_value / cost) * 100
                elif revenue is not None:
                    roas = (revenue / cost) * 100

            efficiency_data.append({
                "month": month,
                "report": report,
                "revenue_per_cv": revenue_per_cv,
                "roas": roas,
            })

        # 表のヘッダー
        month_headers = " | ".join([format_period_label(d["month"], d["report"]) for d in efficiency_data])
        lines.append(f"| 指標 | {month_headers} |")
        lines.append("|------" + "|------" * len(efficiency_data) + "|")

        # 売上単価の行
        rev_per_cv_values = []
        for d in efficiency_data:
            v = d["revenue_per_cv"]
            if v is not None:
                rev_per_cv_values.append(f"¥{v:,.0f}")
            else:
                rev_per_cv_values.append("-")
        lines.append(f"| 売上単価（/CV） | {' | '.join(rev_per_cv_values)} |")

        # ROASの行
        roas_values = []
        for d in efficiency_data:
            v = d["roas"]
            if v is not None:
                roas_values.append(f"{v:.0f}%")
            else:
                roas_values.append("-")
        lines.append(f"| ROAS | {' | '.join(roas_values)} |")

        lines.append("")

        # 直近2期間の比較コメント
        if len(efficiency_data) >= 2:
            curr = efficiency_data[0]
            prev = efficiency_data[1]

            lines.append("### 売上効率の変化")
            lines.append("")

            # 売上単価の変化
            if curr["revenue_per_cv"] is not None and prev["revenue_per_cv"] is not None:
                delta_rev = curr["revenue_per_cv"] - prev["revenue_per_cv"]
                pct_rev = delta_rev / prev["revenue_per_cv"] if prev["revenue_per_cv"] != 0 else 0
                direction = "上昇" if delta_rev > 0 else "下降"
                lines.append(f"- **売上単価**: ¥{curr['revenue_per_cv']:,.0f}（{direction} {abs(pct_rev):.1%}）")

            # ROASの変化
            if curr["roas"] is not None and prev["roas"] is not None:
                delta_roas = curr["roas"] - prev["roas"]
                direction = "改善" if delta_roas > 0 else "悪化"
                lines.append(f"- **ROAS**: {curr['roas']:.0f}%（{direction} {abs(delta_roas):.0f}pt）")

            lines.append("")

    # 異常値検出（データ品質チェック）
    anomalies = []
    for month, report in reports:
        month_label = format_period_label(month, report)

        # CTR > 100% チェック
        ctr = report.get_kpi("ctr")
        if ctr is not None and ctr > 1.0:  # 内部では0-1で保持
            anomalies.append(f"⚠️ {month_label}: CTR {ctr*100:.1f}% が100%を超えています")

        # CVR > 100% チェック
        cvr = report.get_kpi("cvr")
        if cvr is not None and cvr > 1.0:
            anomalies.append(f"⚠️ {month_label}: CVR {cvr*100:.1f}% が100%を超えています")

        # 負の費用チェック
        cost = report.get_kpi("cost")
        if cost is not None and cost < 0:
            anomalies.append(f"⚠️ {month_label}: 費用 ¥{cost:,.0f} が負の値です")

        # CPA = 0 チェック（費用とCVがあるのにCPA=0）
        cpa = report.get_kpi("cpa")
        cv = report.get_kpi("cv")
        if cpa is not None and cpa == 0 and cost and cost > 0 and cv and cv > 0:
            anomalies.append(f"⚠️ {month_label}: CPA=0 ですが費用とCVは正の値です（計算エラーの可能性）")

        # CV > クリック チェック（通常はありえない）
        click = report.get_kpi("click")
        if cv is not None and click is not None and cv > click and click > 0:
            anomalies.append(f"⚠️ {month_label}: CV({cv:.0f}) > クリック({click:.0f}) となっています（データ確認推奨）")

    if anomalies:
        lines.append("## データ品質警告")
        lines.append("")
        lines.append("> 以下の値に異常が検出されました。データの正確性をご確認ください。")
        lines.append("")
        for anomaly in anomalies:
            lines.append(f"- {anomaly}")
        lines.append("")

    # Evidence
    lines.append("## Evidence（抽出根拠）")
    lines.append("")
    lines.append("| 月 | シート | 抽出方式 | ファイルハッシュ |")
    lines.append("|------|------|------|------|")
    for month, report in reports:
        lines.append(
            f"| {month} | {report.meta.sheet} | {report.meta.method} | "
            f"`{report.meta.file_hash[:8]}...` |"
        )
    lines.append("")
    
    lines.append("")

    if chart_paths:
        lines.append("## 参考データ（グラフ）")
        for cp in chart_paths:
            lines.append(f"![]({cp})")
        lines.append("")

    # バナー画像を追加（最新レポートから抽出）
    if include_banners and reports:
        latest_report = reports[0][1]
        excel_path = Path(latest_report.meta.file)

        if excel_path.exists():
            try:
                # バナー画像情報テーブル（AI考察用 - 簡略版）
                banner_info_table = get_banner_info_table(excel_path)
                has_images = bool(banner_info_table)

                if has_images:
                    lines.append(banner_info_table)
                    lines.append("")
                else:
                    # 画像が取得できなかった場合、広告タイトルをフォールバック
                    print("[要点パック] 画像が見つからないため、広告タイトルを抽出します")
                    ad_titles_md = extract_ad_titles_fallback(excel_path)
                    if ad_titles_md:
                        lines.append(ad_titles_md)
                        lines.append("")
            except Exception as e:
                print(f"バナー画像抽出エラー: {e}")
                import traceback
                traceback.print_exc()

    return "\n".join(lines)



def save_point_pack(
    output_path: Path,
    current: ReportData,
    base: Optional[ReportData],
    client_name: str,
    base_label: str = "前月",
) -> str:
    """
    point-pack.md をファイルに保存
    
    Returns:
        生成したMarkdown本文
    """
    content = generate_point_pack_md(current, base, client_name, base_label)
    
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8-sig")
    
    return content

