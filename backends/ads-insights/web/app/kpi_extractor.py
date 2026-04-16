# kpi_extractor.py
# ExcelファイルからKPIを抽出するモジュール
# generate_reports.py のロジックを移植・堅牢化

from __future__ import annotations
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
import re
import datetime as dt

import pandas as pd

try:
    from .report_data import ReportData, ExtractMeta, MediaKPIs, get_file_meta
except ImportError:
    # 相対インポートが失敗した場合（テスト等）は絶対インポート
    from report_data import ReportData, ExtractMeta, MediaKPIs, get_file_meta


# KPI定義: (key, display_name, synonyms)
KPI_SPECS = [
    ("cost", "費用", ["費用", "広告費", "ご利用金額", "コスト", "Cost", "Spend", "ご利用額", "利用額", "使用金額", "消費額", "広告支出", "金額"]),
    ("impr", "表示回数", ["表示回数", "インプレッション", "Imp", "Impressions", "Impr", "表示", "インプレッション数", "イムプレッション", "imp数"]),
    ("click", "クリック", ["クリック", "クリック数", "Clicks", "Click", "クリック回数"]),
    ("cv", "CV", ["CV", "コンバージョン", "Conversions", "獲得", "成約", "獲得件数", "獲得数", "購入数", "成約数", "到達", "申込", "予約", "申し込み件数", "購入完了件数", "完了数", "件数"]),
    ("conversion_value", "CV値", ["CV値", "コンバージョン値", "Conversion value", "Conv. value", "Value", "合計コンバージョン値", "Total conversion value", "コンバージョンの価値", "価値", "値", "conv値", "CV価値", "売却額"]),
    ("revenue", "売上", ["売上", "売上高", "Revenue", "Sales", "収益", "総売上", "Total revenue", "購入額", "購入金額", "売上金額", "収益金額", "売却金額"]),
    ("ctr", "CTR", ["CTR", "クリック率", "Click through rate"]),
    ("cvr", "CVR", ["CVR", "コンバージョン率", "獲得率", "Conversion rate", "転換率"]),
    ("cpa", "CPA", ["CPA", "獲得単価", "Cost / conv.", "Cost/conv.", "コンバージョン単価", "顧客獲得単価"]),
    ("cpc", "CPC", ["CPC", "クリック単価", "Cost per click"]),
    ("roas", "ROAS", ["ROAS", "広告費用対効果", "投資対効果", "Return on Ad Spend"]),
    ("revenue_per_cv", "売上単価", ["売上単価", "1件あたり売上", "売上/CV"]),
]

# 必須KPI（これが欠けたらfail-fast）
REQUIRED_KPIS = ["cost", "click", "cv"]

NUM_RE = re.compile(r"^-?\d+(\.\d+)?$")

# デバッグモード（環境変数 DEBUG_KPI_EXTRACTION で有効化）
# レベル: 0=オフ, 1=エラーのみ, 2=警告+列マッピング, 3=詳細すべて
# 従来の true/yes/1 は レベル2 として扱う
import os
import sys

_debug_env = os.getenv("DEBUG_KPI_EXTRACTION", "").lower()
if _debug_env in ("true", "yes"):
    DEBUG_LEVEL = 2
elif _debug_env.isdigit():
    DEBUG_LEVEL = int(_debug_env)
else:
    DEBUG_LEVEL = 0

DEBUG_MODE = DEBUG_LEVEL >= 2  # 従来互換

def _debug_print(msg: str, level: int = 2) -> None:
    """デバッグ出力（指定レベル以上の場合のみ出力）"""
    if DEBUG_LEVEL >= level:
        print(f"[DEBUG L{level}] {msg}", file=sys.stderr, flush=True)


class ExtractionError(Exception):
    """KPI抽出エラー"""
    def __init__(self, message: str, missing_kpis: List[str] = None):
        super().__init__(message)
        self.missing_kpis = missing_kpis or []


def norm(s: Any) -> str:
    """
    文字列の正規化（V2.5強化版）

    1. Unicode正規化（NFKC）- 全角→半角
    2. 全スペース除去
    3. 括弧内除去（費用(円) → 費用）
    4. 小文字化
    5. 記号除去（¥, $, %, :, .など）
    """
    if s is None:
        return ""

    import unicodedata
    import re

    # 1. Unicode正規化（全角→半角）
    t = unicodedata.normalize("NFKC", str(s))

    # 2. 前後の空白を除去
    t = t.strip()

    # 3. 括弧内を除去（費用(円) → 費用, Cost (JPY) → Cost）
    t = re.sub(r'[（(].*?[）)]', '', t)

    # 4. 全スペース除去（全角・半角）
    t = t.replace("　", "")
    t = t.replace(" ", "")

    # 5. 小文字化
    t = t.lower()

    # 6. 記号除去
    symbols_to_remove = ["¥", "￥", "$", "%", ":", ".", "/", "-", "_"]
    for sym in symbols_to_remove:
        t = t.replace(sym, "")

    return t


def looks_num(x: Any) -> bool:
    """数値っぽいかどうか"""
    if x is None:
        return False
    if isinstance(x, (int, float)) and pd.notna(x):
        return True
    s = str(x).strip()
    if s == "":
        return False
    s = s.replace(",", "")
    s = s.replace("¥", "").replace("￥", "")
    s = s.replace("%", "")
    return bool(NUM_RE.match(s))


def to_float(x: Any) -> Optional[float]:
    """数値変換（NaN/Inf は None として返す）"""
    import math
    if x is None:
        return None
    if isinstance(x, (int, float)):
        if pd.notna(x) and not math.isnan(x) and not math.isinf(x):
            return float(x)
        return None
    s = str(x).strip().lower()
    if s == "" or s == "nan" or s == "inf" or s == "-inf":
        return None
    s = s.replace(",", "")
    s = s.replace("¥", "").replace("￥", "")
    s = s.replace("%", "")
    try:
        result = float(s)
        # NaN/Inf チェック
        if math.isnan(result) or math.isinf(result):
            return None
        return result
    except Exception:
        return None


def extract_month_tag(filename: str) -> str:
    """
    ファイル名から月タグ（YYYY-MM）を抽出（後方互換用）

    Note: 新しいコードでは extract_period_tag() を使用してください
    """
    period_tag, period_type, _, _ = extract_period_tag(filename)
    if period_type == "monthly":
        return period_tag
    # 週次の場合は月次に変換（暫定）
    if period_type == "weekly":
        # YYYY-W## → YYYY-MM に変換（週の開始日から月を取得）
        import calendar
        year_str, week_str = period_tag.split("-W")
        year = int(year_str)
        week = int(week_str)
        jan4 = dt.date(year, 1, 4)
        week_start = jan4 + dt.timedelta(days=-jan4.weekday(), weeks=week - 1)
        return week_start.strftime("%Y-%m")
    return period_tag


def _extract_period_from_content(file_content_df: Any) -> Optional[Tuple[str, str, str, str]]:
    """
    Excelファイルの内容から期間情報を抽出

    Args:
        file_content_df: pandasのDataFrameまたはExcelFileオブジェクト

    Returns:
        (period_tag, period_type, period_start, period_end) or None
    """
    import calendar

    # 日付範囲のパターン（セル内の値から抽出）
    # 期間キーワード（対象期間、集計期間、期間など）は現在未使用だが、将来的な精度向上に使用可能
    # 例: "2025/12/1～2025/12/7", "12/1-12/7", "1/16～22"
    date_range_patterns = [
        # 完全な日付範囲: 2025/12/1～2025/12/7
        re.compile(r"(\d{4})[/\-年.](\d{1,2})[/\-月.](\d{1,2})[日]?\s*[～〜\-~]\s*(\d{4})[/\-年.](\d{1,2})[/\-月.](\d{1,2})日?"),
        # 年省略: 12/1～12/7
        re.compile(r"(\d{1,2})[/\-月.](\d{1,2})[日]?\s*[～〜\-~]\s*(\d{1,2})[/\-月.](\d{1,2})日?"),
        # 月省略: 1/16～22
        re.compile(r"(\d{1,2})[/\-月.](\d{1,2})[日]?\s*[～〜\-~]\s*(\d{1,2})日?"),
    ]

    try:
        # DataFrameまたはExcelFileオブジェクトから全シートを検索
        if hasattr(file_content_df, 'sheet_names'):
            # ExcelFileオブジェクトの場合
            sheets_to_check = file_content_df.sheet_names[:3]  # 最初の3シートのみ
        else:
            # DataFrameの場合はそのまま検索
            sheets_to_check = [None]

        for sheet in sheets_to_check:
            if sheet is not None:
                try:
                    df = pd.read_excel(file_content_df, sheet_name=sheet, header=None, nrows=20)
                except Exception:
                    continue
            else:
                df = file_content_df

            # 全セルを検索
            for row_idx in range(min(20, len(df))):
                for col_idx in range(min(10, len(df.columns))):
                    try:
                        cell_value = str(df.iloc[row_idx, col_idx])
                    except Exception:
                        continue

                    # パターン1: 完全な日付範囲
                    m = date_range_patterns[0].search(cell_value)
                    if m:
                        y1, m1, d1, y2, m2, d2 = m.groups()
                        start_date = f"{y1}-{int(m1):02d}-{int(d1):02d}"
                        end_date = f"{y2}-{int(m2):02d}-{int(d2):02d}"
                        tag = f"{start_date}_{end_date}"
                        return (tag, "weekly", start_date, end_date)

                    # パターン2: 年省略（今年または前後）
                    m = date_range_patterns[1].search(cell_value)
                    if m:
                        m1, d1, m2, d2 = m.groups()
                        # 現在の年を使用
                        today = dt.date.today()
                        year = today.year
                        # 月が逆転している場合は年をまたぐ
                        if int(m1) > int(m2):
                            start_date = f"{year-1}-{int(m1):02d}-{int(d1):02d}"
                            end_date = f"{year}-{int(m2):02d}-{int(d2):02d}"
                        else:
                            start_date = f"{year}-{int(m1):02d}-{int(d1):02d}"
                            end_date = f"{year}-{int(m2):02d}-{int(d2):02d}"
                        tag = f"{start_date}_{end_date}"
                        return (tag, "weekly", start_date, end_date)

                    # パターン3: 月省略（同月内）
                    m = date_range_patterns[2].search(cell_value)
                    if m:
                        m1, d1, d2 = m.groups()
                        today = dt.date.today()
                        year = today.year
                        month = int(m1)
                        start_date = f"{year}-{month:02d}-{int(d1):02d}"
                        end_date = f"{year}-{month:02d}-{int(d2):02d}"
                        tag = f"{start_date}_{end_date}"
                        return (tag, "weekly", start_date, end_date)

        return None

    except Exception as e:
        # エラーが発生しても他のパターンを試せるようNoneを返す
        return None


def extract_period_tag(filename: str, file_content_df: Optional[Any] = None) -> Tuple[str, str, str, str]:
    """
    ファイル名または中身から期間タグを抽出

    Args:
        filename: ファイル名
        file_content_df: ファイル内容のDataFrame（オプション）

    Returns:
        (period_tag, period_type, period_start, period_end)
        例: ("2025-W48", "weekly", "2025-11-25", "2025-12-01")
            ("2025-11", "monthly", "2025-11-01", "2025-11-30")
    """
    import unicodedata as ud
    import calendar

    name = ud.normalize("NFKC", filename)

    # パターン1: ISO週番号形式
    weekly_patterns = [
        (re.compile(r"(\d{4})[年\-_/. ]*W(\d{1,2})"), "year_week"),  # 2025-W48, 2025W48
        (re.compile(r"W(\d{2})[_\-](\d{4})"), "week_year"),  # W48_2025
        (re.compile(r"(\d{4})年(\d{1,2})週"), "year_week"),  # 2025年48週
    ]

    for pat, order in weekly_patterns:
        m = pat.search(name)
        if m:
            if order == "week_year":
                week, year = m.groups()
            else:
                year, week = m.groups()
            week = week.zfill(2)
            year_int = int(year)
            week_int = int(week)

            if 1 <= week_int <= 53:
                # ISO週から日付範囲を計算
                jan4 = dt.date(year_int, 1, 4)
                week_start = jan4 + dt.timedelta(days=-jan4.weekday(), weeks=week_int - 1)
                week_end = week_start + dt.timedelta(days=6)
                print(f"[期間抽出DEBUG] ファイル名: {filename} -> パターン: 週次 -> {year}-W{week}")
                return (
                    f"{year}-W{week}",
                    "weekly",
                    week_start.isoformat(),
                    week_end.isoformat(),
                )

    # パターン2: 日付範囲形式
    date_range_patterns = [
        re.compile(r"(\d{4})-(\d{2})-(\d{2})[_\-](\d{2})-(\d{2})"),  # 2025-12-01_12-07
        re.compile(r"(\d{4})\.(\d{2})\.(\d{2})[_\-](\d{2})\.(\d{2})"),  # 2025.12.01-12.07
    ]

    for pat in date_range_patterns:
        m = pat.search(name)
        if m:
            year, m1, d1, m2, d2 = m.groups()
            start = f"{year}-{m1.zfill(2)}-{d1.zfill(2)}"
            end = f"{year}-{m2.zfill(2)}-{d2.zfill(2)}"
            return (
                f"{start}_{end}",
                "weekly",  # 日付範囲は週次として扱う
                start,
                end,
            )

    # パターン3: 単一日付形式（その日を含む週を推定）
    single_date_patterns = [
        re.compile(r"(\d{4})年(\d{1,2})月(\d{1,2})日"),  # 2026年1月23日
        re.compile(r"(\d{4})[年\-_/.](\d{1,2})[月\-_/.](\d{1,2})日?"),  # 2026年1月23, 2026-01-23, 2026.1.23
        re.compile(r"(\d{4})(\d{2})(\d{2})(?!\d)"),  # 20260123 (8 digits)
    ]

    for pat in single_date_patterns:
        m = pat.search(name)
        if m:
            year, month, day = m.group(1), m.group(2).zfill(2), m.group(3).zfill(2)
            year_int = int(year)
            month_int = int(month)
            day_int = int(day)

            # 日付の妥当性チェック
            try:
                target_date = dt.date(year_int, month_int, day_int)
            except ValueError:
                continue  # 無効な日付はスキップ

            # その日を含む週を計算（月曜始まり、ISO週に準拠）
            # 環境変数で週の開始曜日を変更可能（デフォルト: monday）
            import os
            week_start_day = os.getenv("WEEK_START_DAY", "monday").lower()

            if week_start_day == "sunday":
                # 日曜始まり
                days_since_sunday = (target_date.weekday() + 1) % 7
                week_start = target_date - dt.timedelta(days=days_since_sunday)
            else:
                # 月曜始まり（デフォルト）
                days_since_monday = target_date.weekday()
                week_start = target_date - dt.timedelta(days=days_since_monday)

            week_end = week_start + dt.timedelta(days=6)

            return (
                f"{week_start.isoformat()}_{week_end.isoformat()}",
                "weekly",
                week_start.isoformat(),
                week_end.isoformat(),
            )

    # パターン4: 月次形式（4桁年 + 月）
    monthly_patterns_4digit = [
        re.compile(r"(\d{4})[年\-_/. ]+(\d{1,2})月?"),
        re.compile(r"(\d{4})(\d{2})(?![0-9])"),
    ]

    for pat in monthly_patterns_4digit:
        m = pat.search(name)
        if m:
            year, month = m.group(1), m.group(2).zfill(2)
            year_int = int(year)
            month_int = int(month)

            if 1 <= month_int <= 12:
                _, last_day = calendar.monthrange(year_int, month_int)
                print(f"[期間抽出DEBUG] ファイル名: {filename} -> パターン: 4桁年月次 -> {year}-{month}")
                return (
                    f"{year}-{month}",
                    "monthly",
                    f"{year}-{month}-01",
                    f"{year}-{month}-{last_day:02d}",
                )

    # パターン5: 月次形式（2桁年 + 月）例: 25.01月, 25年01月, 25.02
    monthly_patterns_2digit = [
        re.compile(r"[_\-](\d{2})[\.年](\d{1,2})月?"),  # _25.01月, _25年01月, _25.02
        re.compile(r"(\d{2})[\.年](\d{1,2})月?"),  # 25.01月, 25年01月, 25.02
    ]

    for pat in monthly_patterns_2digit:
        m = pat.search(name)
        if m:
            year_2digit, month = m.group(1), m.group(2).zfill(2)
            # 2桁年を4桁に変換（2000年代として解釈）
            year_int = 2000 + int(year_2digit)
            month_int = int(month)

            if 1 <= month_int <= 12:
                year = str(year_int)
                _, last_day = calendar.monthrange(year_int, month_int)
                print(f"[期間抽出DEBUG] ファイル名: {filename} -> パターン: 2桁年月次 -> {year}-{month}")
                return (
                    f"{year}-{month}",
                    "monthly",
                    f"{year}-{month}-01",
                    f"{year}-{month}-{last_day:02d}",
                )

    # パターン6: ファイル中のセルから探索（file_content_df が渡された場合）
    if file_content_df is not None:
        content_result = _extract_period_from_content(file_content_df)
        if content_result is not None:
            return content_result

    # どのパターンにもマッチしない場合は認識不可として扱う
    print(f"[期間抽出WARNING] ファイル名から期間を認識できませんでした: {filename}")
    print(f"  → ファイル名パターンが未対応の可能性があります")

    # 認識不可の場合は例外を投げる（呼び出し側でスキップされる）
    raise ValueError(f"期間を認識できませんでした: {filename}")


def _extract_from_table(xls: pd.ExcelFile, sheet: str) -> Optional[Tuple[Dict[str, Optional[float]], Dict[str, str]]]:
    """テーブル形式のシートからKPIを抽出（ExcelFileオブジェクトを再利用）"""
    # まずheader=Noneで読み込んで、ヘッダー行を探す
    try:
        df_raw = pd.read_excel(xls, sheet_name=sheet, header=None, nrows=30)
    except Exception:
        return None

    # ヘッダー行を探す（"費用"または"ご利用額"を含む行）
    header_row = None
    for i in range(min(20, len(df_raw))):
        row_str = ' '.join([str(x) for x in df_raw.iloc[i, :15] if pd.notna(x)])
        if any(kw in row_str for kw in ["費用", "ご利用額", "クリック数", "表示回数", "インプレッション"]):
            header_row = i
            break

    # ヘッダーが見つからなければheader=3で試す（従来の動作）
    if header_row is None:
        header_row = 3

    try:
        df = pd.read_excel(xls, sheet_name=sheet, header=header_row)
    except Exception:
        return None

    if df.shape[1] < 2:
        return None

    first_col = df.columns[0]
    col0 = df[first_col].astype(str).fillna("")

    # デバッグモード: 検出された列名を表示
    if DEBUG_MODE:
        print(f"\n[DEBUG] Sheet: {sheet}")
        print(f"[DEBUG] Header row detected at: {header_row}")
        print(f"[DEBUG] Columns found ({len(df.columns)}):")
        for i, col in enumerate(df.columns[:15]):  # 最初の15列のみ表示
            print(f"  {i}: {col}")

    # 合計行を探す（複数のキーワードに対応）
    TOTAL_KEYWORDS = ["合計", "小計", "Total", "TOTAL", "総計", "計"]
    total_idx = None
    for i, v in col0.items():
        v_stripped = v.strip()
        if any(kw in v_stripped for kw in TOTAL_KEYWORDS):
            total_idx = i
            break

    # 合計行が見つからない場合、最初の行を使う
    if total_idx is None:
        total_idx = df.index.min()

    # 次のブロック見出しで切る
    end_idx = None
    for i, v in col0.items():
        t = v.strip()
        if i <= total_idx:
            continue
        if t and t not in ("月", "前月差"):
            try:
                float(t)
                is_number = True
            except Exception:
                is_number = False
            if (not is_number) and any(x in t for x in ["Yahoo", "Google", "検索", "ディスプレイ", "Facebook", "LINE", "X", "Twitter"]):
                end_idx = i - 1
                break

    block = df.loc[total_idx:end_idx].copy() if end_idx is not None else df.loc[total_idx:].copy()

    # If we found a Total row, use it directly
    # Otherwise, find the row with numeric data in the first column
    first_col_val = str(df.loc[total_idx, first_col]) if total_idx is not None else ""
    if total_idx is not None and any(kw in first_col_val for kw in TOTAL_KEYWORDS):
        row = df.loc[total_idx]
    else:
        month_series = pd.to_numeric(block[first_col], errors="coerce")
        numeric_rows = block[month_series.notna()].copy()
        if numeric_rows.empty:
            return None

        cur_i = month_series.loc[numeric_rows.index].idxmax()
        row = block.loc[cur_i]
    
    def pick(*cands):
        for c in cands:
            if c in block.columns:
                return c
        return None
    
    col_map = {
        "impr": pick("表示回数", "インプレッション数"),
        "click": pick("クリック数", "クリック"),
        "cost": pick("ご利用額", "費用", "利用額", "ご利用金額"),
        "cv": pick("獲得件数", "CV", "コンバージョン", "獲得数", "購入数", "成約数"),
        "ctr": pick("クリック率", "CTR"),
        "cvr": pick("獲得率", "CVR", "コンバージョン率"),
        "cpa": pick("獲得単価", "CPA", "コンバージョン単価"),
        "cpc": pick("クリック単価", "CPC"),
        # 売上関連KPI
        "revenue": pick("売上金額", "売上", "売上高", "Revenue"),
        "conversion_value": pick("CV値", "コンバージョン値", "合計コンバージョン値"),
        "roas": pick("ROAS", "広告費用対効果"),
        "revenue_per_cv": pick("売上単価"),
    }

    # デバッグモード: 列マッピング結果を表示
    if DEBUG_MODE:
        print(f"[DEBUG] Total row index: {total_idx}")
        print(f"[DEBUG] Column mapping:")
        for kpi, col in col_map.items():
            status = "OK" if col else "NG"
            print(f"  {status} {kpi:6s} -> {col}")
        # 未マッチの重要そうな列を警告
        all_mapped_cols = set(filter(None, col_map.values()))
        unmapped_important = []
        for col in df.columns[:20]:
            col_str = str(col).lower()
            if col not in all_mapped_cols and any(kw in col_str for kw in
                ["件数", "単価", "率", "回数", "費用", "コスト", "cv", "click", "impr", "conversion"]):
                unmapped_important.append(col)
        if unmapped_important:
            print(f"[DEBUG] [!] Unmapped important columns (consider adding to synonyms):")
            for col in unmapped_important:
                print(f"    - {col}")

    kpis: Dict[str, Optional[float]] = {}
    refs: Dict[str, str] = {}
    
    for key, col in col_map.items():
        if col:
            kpis[key] = to_float(row[col])
            refs[key] = f"table:col:{col}"
    
    return kpis, refs


def _extract_from_cells(xls: pd.ExcelFile, sheet: str) -> Optional[Tuple[Dict[str, Optional[float]], Dict[str, str]]]:
    """セル形式のシートからKPIを抽出（ExcelFileオブジェクトを再利用）"""
    try:
        df = pd.read_excel(xls, sheet_name=sheet, header=None, nrows=120)
    except Exception:
        return None
    
    if df is None or df.empty:
        return None
    
    kpis: Dict[str, Optional[float]] = {}
    refs: Dict[str, str] = {}
    
    max_r, max_c = df.shape
    
    for r in range(max_r):
        for c in range(max_c):
            cell = df.iat[r, c]
            label = norm(cell)
            if not label:
                continue
            
            for key, _, syns in KPI_SPECS:
                if key in kpis:
                    continue
                if label in [norm(s) for s in syns]:
                    for cc in range(c + 1, min(c + 8, max_c)):
                        v = df.iat[r, cc]
                        if looks_num(v):
                            kpis[key] = to_float(v)
                            refs[key] = f"cell:R{r+1}C{cc+1}"
                            break
    
    found = sum(1 for v in kpis.values() if v is not None)
    if found < 2:
        return None
    
    return kpis, refs


def extract_from_excel(xlsx_path: Path, fail_fast: bool = True) -> ReportData:
    """
    ExcelファイルからKPIを抽出してReportDataを返す
    
    Args:
        xlsx_path: Excelファイルパス
        fail_fast: 必須KPIが欠けていたらExtractionErrorを投げる
    
    Returns:
        ReportData
    
    Raises:
        ExtractionError: fail_fast=Trueで必須KPIが欠けている場合
    """
    xlsx_path = Path(xlsx_path)
    if not xlsx_path.exists():
        raise ExtractionError(f"ファイルが見つかりません: {xlsx_path}")

    file_meta = get_file_meta(xlsx_path)

    try:
        # Use read_only=True for performance optimization
        xls = pd.ExcelFile(xlsx_path, engine="openpyxl")
    except Exception as e:
        raise ExtractionError(f"Excelファイルを開けません: {xlsx_path} - {e}")

    # 期間情報を抽出（ファイル名で判定できない場合はファイル内容を検索）
    period_tag, period_type, period_start, period_end = extract_period_tag(xlsx_path.name, file_content_df=xls)
    month_tag = period_tag  # 後方互換のためmonth_tagにも設定
    
    best_kpis: Dict[str, Optional[float]] = {}
    best_refs: Dict[str, str] = {}
    best_sheet: str = "(not found)"
    best_method: str = "none"
    best_score: int = 0
    
    # 優先シートを先にチェック（all, 合計, summary, total などを優先）
    priority_keywords = ['all', '合計', 'summary', 'total', '集計']
    priority_sheets = [s for s in xls.sheet_names if any(kw in s.lower() for kw in priority_keywords)]
    other_sheets = [s for s in xls.sheet_names if s not in priority_sheets]
    sheets_to_check = priority_sheets + other_sheets[:10]  # 優先シート + 残りの最初の10シート
    
    for sheet in sheets_to_check:
        # テーブル形式を試す（ExcelFileオブジェクトを渡す）
        result = _extract_from_table(xls, sheet)
        if result:
            kpis, refs = result
            score = sum(1 for v in kpis.values() if v is not None)
            if score > best_score:
                best_kpis = kpis
                best_refs = refs
                best_sheet = sheet
                best_method = "table"
                best_score = score
                # 必須KPIがすべて揃ったら早期リターン
                if all(best_kpis.get(k) is not None for k in REQUIRED_KPIS):
                    break
        
        # セル形式を試す（ExcelFileオブジェクトを渡す）
        result = _extract_from_cells(xls, sheet)
        if result:
            kpis, refs = result
            score = sum(1 for v in kpis.values() if v is not None)
            if score > best_score:
                best_kpis = kpis
                best_refs = refs
                best_sheet = sheet
                best_method = "cells"
                best_score = score
                # 必須KPIがすべて揃ったら早期リターン
                if all(best_kpis.get(k) is not None for k in REQUIRED_KPIS):
                    break
    
    # Evidence作成
    evidence: Dict[str, str] = {}
    for key, _, _ in KPI_SPECS:
        if key in best_refs:
            evidence[key] = f"抽出元: {best_sheet} / {best_refs[key]}"
        elif key in best_kpis and best_kpis[key] is not None:
            evidence[key] = f"抽出元: {best_sheet} (位置不明)"
        else:
            evidence[key] = "未取得"
    
    # Meta作成
    meta = ExtractMeta(
        file=str(xlsx_path),
        sheet=best_sheet,
        method=best_method,
        refs=best_refs,
        rows=0,  # TODO: 必要なら追加
        cols=0,
        file_hash=file_meta.get("file_hash", ""),
        file_size=file_meta.get("file_size", 0),
        file_modified=file_meta.get("file_modified", ""),
    )
    
    report = ReportData(
        kpis=best_kpis,
        meta=meta,
        evidence=evidence,
        month_tag=month_tag,
        period_type=period_type,
        period_start=period_start,
        period_end=period_end,
    )

    # 派生指標を計算（Excelから取得できなかった場合の補完）
    report.compute_derived_kpis()

    # 媒体別KPIを抽出（複数シート対応版）
    try:
        # まず複数シートからの抽出を試みる
        media_breakdown = extract_media_from_multiple_sheets(xlsx_path)
        if not media_breakdown:
            # フォールバック: 従来の方式で単一シートから抽出
            media_breakdown = extract_media_data_full(xlsx_path, best_sheet)
        report.media_breakdown = media_breakdown
        _debug_print(f"[extract] Media breakdown: {len(media_breakdown)} media found", level=2)
    except Exception as e:
        _debug_print(f"[extract] Media breakdown extraction failed: {e}", level=1)
        # 媒体別抽出が失敗しても集計データは返す
    
    # fail-fast チェック
    if fail_fast:
        missing = report.missing_kpis(REQUIRED_KPIS)
        if missing:
            # 修正提案のヒントを生成
            hints = {
                "cost": "「費用」「広告費」「ご利用金額」「コスト」などの列を確認してください",
                "click": "「クリック」「クリック数」などの列を確認してください",
                "cv": "「CV」「コンバージョン」「獲得件数」「購入数」「成約数」などの列を確認してください",
            }
            hint_lines = [f"  - {k}: {hints.get(k, '列名を確認してください')}" for k in missing]
            hint_text = "\n".join(hint_lines)
            raise ExtractionError(
                f"必須KPIが抽出できませんでした: {missing}\n"
                f"ファイル: {xlsx_path}\n"
                f"シート: {best_sheet}\n"
                f"\n【修正ヒント】\n{hint_text}\n\n"
                f"詳細なデバッグには .env.local に DEBUG_KPI_EXTRACTION=true を設定してください",
                missing_kpis=missing
            )
    
    return report


def extract_pair(current_path: Path, base_path: Optional[Path], fail_fast: bool = True) -> Tuple[ReportData, Optional[ReportData]]:
    """
    当月とベースの2件を抽出
    
    Returns:
        (current_report, base_report) - baseがない場合はNone
    """
    current_report = extract_from_excel(current_path, fail_fast=fail_fast)
    
    base_report = None
    if base_path and base_path.exists():
        try:
            base_report = extract_from_excel(base_path, fail_fast=False)  # baseはfail-fastしない
        except ExtractionError:
            base_report = None
    
    return current_report, base_report


def extract_trend_data(xlsx: Path, sheet: str) -> pd.DataFrame:
    """
    Extract historical data from the 'Total' block for trend charts.
    Returns DataFrame with columns: ['month', 'cost', 'cv', 'cpa']
    """
    try:
        # Read a chunk to find header
        df_raw = pd.read_excel(xlsx, sheet_name=sheet, header=None, nrows=30, engine="openpyxl")
    except Exception:
        return pd.DataFrame()

    # Dynamic header detection
    header_row = None
    for i in range(min(20, len(df_raw))):
        row_str = ' '.join([str(x) for x in df_raw.iloc[i, :15] if pd.notna(x)])
        if any(kw in row_str for kw in ["費用", "ご利用額", "クリック数", "表示回数", "インプレッション"]):
            header_row = i
            break
    
    if header_row is None:
        header_row = 3

    try:
        df = pd.read_excel(xlsx, sheet_name=sheet, header=header_row, engine="openpyxl")
    except Exception:
        return pd.DataFrame()

    if df.shape[1] < 2:
        return pd.DataFrame()

    first_col = df.columns[0]
    col0 = df[first_col].astype(str).fillna("")

    # Find Total block start: match total keywords
    TOTAL_KEYWORDS_ALT = ["合計", "小計", "Total", "TOTAL", "総計"]
    start_idx = None
    for i, v in col0.items():
        v_stripped = v.strip()
        if any(kw in v_stripped for kw in TOTAL_KEYWORDS_ALT):
            start_idx = i + 1
            break
    if start_idx is None:
        # If no explicit Total block, maybe the whole table is the total block?
        # But usually we want the monthly breakdown. 
        # For safety, let's start from top if "month" like values appear.
        start_idx = df.index.min()

    # Find Total block end
    end_idx = None
    for i, v in col0.items():
        t = v.strip()
        if i <= start_idx:
            continue
        if t and t not in ("月", "前月差") and not any(kw in t for kw in TOTAL_KEYWORDS_ALT):
            try:
                float(t)
                is_num = True
            except:
                is_num = False
            
            # Stop if we hit a media block or text that isn't a month number
            if (not is_num) and (("Yahoo" in t) or ("Google" in t) or ("検索" in t) or ("Facebook" in t) or ("Instagram" in t)):
                end_idx = i - 1
                break
    
    block = df.loc[start_idx:end_idx].copy() if end_idx is not None else df.loc[start_idx:].copy()
    
    # Identify key columns
    def pick(*cands):
        for c in cands:
            if c in block.columns:
                return c
        return None

    c_month = first_col
    c_cost = pick("ご利用額", "費用", "利用額")
    c_cv = pick("獲得件数", "CV", "コンバージョン", "獲得数")
    c_cpa = pick("獲得単価", "CPA", "Cost/conv.")

    # Filter for numeric month rows
    block = block[pd.to_numeric(block[c_month], errors="coerce").notna()].copy()
    
    if block.empty or not c_cost:
        return pd.DataFrame()

    # Create standardized DF
    out_df = pd.DataFrame()
    out_df["month"] = block[c_month]
    out_df["cost"] = _to_numeric_series(block[c_cost])
    out_df["cv"] = _to_numeric_series(block[c_cv]) if c_cv else 0
    out_df["cpa"] = _to_numeric_series(block[c_cpa]) if c_cpa else 0
    
    # Sort by month
    out_df.sort_values("month", inplace=True)
    return out_df

def _to_numeric_series(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s.astype(str).str.replace(",", "").str.replace("¥", "").str.replace("%", ""), errors="coerce").fillna(0)

def extract_media_data(xlsx: Path, sheet: str) -> pd.DataFrame:
    """
    Extract current month data for each media block.
    Returns DataFrame columns: ['media', 'cost', 'cv']
    """
    try:
        df_raw = pd.read_excel(xlsx, sheet_name=sheet, header=None, nrows=30, engine="openpyxl")
    except Exception:
        return pd.DataFrame()

    header_row = None
    for i in range(min(20, len(df_raw))):
        row_str = ' '.join([str(x) for x in df_raw.iloc[i, :15] if pd.notna(x)])
        if any(kw in row_str for kw in ["費用", "ご利用額", "クリック数", "表示回数"]):
            header_row = i
            break
    
    if header_row is None:
        header_row = 3

    try:
        df = pd.read_excel(xlsx, sheet_name=sheet, header=header_row, engine="openpyxl")
    except Exception:
        return pd.DataFrame()
        
    first_col = df.columns[0]
    col0 = df[first_col].astype(str).fillna("")
    
    # Column mapping
    def pick(df_, *cands):
        for c in cands:
            if c in df_.columns:
                return c
        return None
    
    c_cost = pick(df, "ご利用額", "費用", "利用額")
    c_cv = pick(df, "獲得件数", "CV", "コンバージョン", "獲得数")
    
    if not c_cost:
        return pd.DataFrame()

    medias = []
    
    keywords = ["Yahoo", "Google", "Facebook", "LINE", "Instagram", "X", "Twitter", "Microsoft", "Criteo"]
    
    # Find block headers
    block_starts = []
    for i, v in col0.items():
        t = v.strip()
        for k in keywords:
            if k in t and not any(kw in t for kw in ["合計", "小計", "Total", "TOTAL", "総計"]):
                block_starts.append((i, t))
                break
    
    # For each block, find the data
    rows = []
    for i, (start_row, media_name) in enumerate(block_starts):
        # Determine end of this block (start of next or end of df)
        next_start = block_starts[i+1][0] if i + 1 < len(block_starts) else df.index.max() + 1
        
        # Limit scan to reasonable range (e.g. 50 rows) in case of garbage
        end_row = min(next_start, start_row + 100)
        
        block = df.loc[start_row+1 : end_row-1].copy()
        
        # Find max month row
        m_series = pd.to_numeric(block[first_col], errors="coerce")
        numeric_rows = block[m_series.notna()]
        
        if numeric_rows.empty:
            continue
            
        cur_i = m_series.loc[numeric_rows.index].idxmax()
        row = block.loc[cur_i]
        
        cost_val = to_float(row[c_cost]) or 0
        cv_val = to_float(row[c_cv]) or 0
        
        if cost_val > 0:
            rows.append({"media": media_name, "cost": cost_val, "cv": cv_val})

    return pd.DataFrame(rows)


def extract_media_data_full(xlsx: Path, sheet: str) -> List[MediaKPIs]:
    """
    Extract full KPI set for each media block.

    Returns:
        List of MediaKPIs objects with all available KPIs per media
    """
    _debug_print(f"[media_full] Starting extraction from sheet: {sheet}", level=2)

    try:
        df_raw = pd.read_excel(xlsx, sheet_name=sheet, header=None, nrows=50, engine="openpyxl")
    except Exception as e:
        _debug_print(f"[media_full] Failed to read sheet: {e}", level=1)
        return []

    # Dynamic header detection
    header_row = None
    for i in range(min(20, len(df_raw))):
        row_str = ' '.join([str(x) for x in df_raw.iloc[i, :20] if pd.notna(x)])
        if any(kw in row_str for kw in ["費用", "ご利用額", "クリック数", "表示回数", "インプレッション"]):
            header_row = i
            break

    if header_row is None:
        header_row = 3
        _debug_print(f"[media_full] Header not found, using default row {header_row}", level=2)

    try:
        df = pd.read_excel(xlsx, sheet_name=sheet, header=header_row, engine="openpyxl")
    except Exception as e:
        _debug_print(f"[media_full] Failed to read with header: {e}", level=1)
        return []

    if df.empty or len(df.columns) == 0:
        return []

    first_col = df.columns[0]
    col0 = df[first_col].astype(str).fillna("")

    # Column mapping helper
    def pick(df_, *cands):
        for c in cands:
            if c in df_.columns:
                return c
            # Also try normalized matching
            for col in df_.columns:
                if norm(col) == norm(c):
                    return col
        return None

    # Map all KPI columns
    kpi_col_map = {
        "cost": pick(df, "ご利用額", "費用", "利用額", "広告費", "コスト", "Cost"),
        "impr": pick(df, "表示回数", "インプレッション", "Imp", "インプレッション数", "Impressions"),
        "click": pick(df, "クリック", "クリック数", "Clicks"),
        "cv": pick(df, "獲得件数", "CV", "コンバージョン", "獲得数", "Conversions", "購入数"),
        "conversion_value": pick(df, "CV値", "コンバージョン値", "Conversion value", "Value"),
        "revenue": pick(df, "売上金額", "売上", "売上高", "Revenue", "Sales"),
        "ctr": pick(df, "CTR", "クリック率"),
        "cvr": pick(df, "CVR", "獲得率", "コンバージョン率"),
        "cpa": pick(df, "CPA", "獲得単価", "Cost / conv."),
        "cpc": pick(df, "CPC", "クリック単価"),
    }

    _debug_print(f"[media_full] Column mapping: {kpi_col_map}", level=3)

    # Check if we have at least cost column
    if not kpi_col_map["cost"]:
        _debug_print("[media_full] No cost column found, aborting", level=2)
        return []

    # Media detection keywords (expanded list)
    keywords = [
        "Yahoo", "Google", "Facebook", "LINE", "Instagram", "X", "Twitter",
        "Microsoft", "Criteo", "TikTok", "SmartNews", "Gunosy", "TVer",
        "YouTube", "YDN", "GDN", "検索", "ディスプレイ", "Display"
    ]

    # Find block headers (media names in first column)
    block_starts = []
    for i, v in col0.items():
        t = str(v).strip()
        if not t:
            continue
        for k in keywords:
            if k in t and not any(kw in t for kw in ["合計", "小計", "Total", "TOTAL", "総計", "全体"]):
                block_starts.append((i, t))
                _debug_print(f"[media_full] Found media block: {t} at row {i}", level=3)
                break

    if not block_starts:
        _debug_print("[media_full] No media blocks found", level=2)
        return []

    # Extract KPIs for each media block
    media_list: List[MediaKPIs] = []

    for idx, (start_row, media_name) in enumerate(block_starts):
        # Determine end of this block
        next_start = block_starts[idx + 1][0] if idx + 1 < len(block_starts) else df.index.max() + 1
        end_row = min(next_start, start_row + 100)

        block = df.loc[start_row + 1 : end_row - 1].copy()

        if block.empty:
            continue

        # Find the row with the latest month data (highest numeric value in first column)
        m_series = pd.to_numeric(block[first_col], errors="coerce")
        numeric_rows = block[m_series.notna()]

        if numeric_rows.empty:
            # Fallback: try to find a row with valid cost data
            for row_idx in block.index:
                if kpi_col_map["cost"] and pd.notna(block.loc[row_idx, kpi_col_map["cost"]]):
                    row = block.loc[row_idx]
                    break
            else:
                continue
        else:
            cur_i = m_series.loc[numeric_rows.index].idxmax()
            row = block.loc[cur_i]

        # Extract all available KPIs
        kpis: Dict[str, Optional[float]] = {}
        evidence: Dict[str, str] = {}

        for kpi_key, col_name in kpi_col_map.items():
            if col_name and col_name in row.index:
                val = to_float(row[col_name])
                if val is not None:
                    kpis[kpi_key] = val
                    evidence[kpi_key] = f"col:{col_name}"

        # Skip if no cost data
        if not kpis.get("cost"):
            continue

        # Create MediaKPIs object
        media_kpi = MediaKPIs(
            media_name=media_name,
            kpis=kpis,
            evidence=evidence,
        )

        # Compute derived KPIs (CTR, CVR, CPA, CPC)
        media_kpi.compute_derived_kpis()

        media_list.append(media_kpi)
        _debug_print(f"[media_full] Extracted {media_name}: {len(kpis)} KPIs", level=2)

    _debug_print(f"[media_full] Total media extracted: {len(media_list)}", level=2)
    return media_list


def extract_media_from_multiple_sheets(xlsx: Path) -> List[MediaKPIs]:
    """
    複数のシートから媒体別データを抽出する（改善版）

    優先順位:
    0. ファイル名から媒体を検出し、シート全体を1つの媒体として扱う
    1. 「all」「全体」「サマリ」などの集計シートから抽出
    2. シート名に媒体名が含まれている場合、そのシートを媒体として扱う
    3. 各シート内で媒体ブロックを探す（従来の方式）

    Returns:
        List of MediaKPIs objects
    """
    _debug_print(f"[media_multi] Starting multi-sheet extraction from: {xlsx}", level=2)

    try:
        xl = pd.ExcelFile(xlsx, engine="openpyxl")
    except Exception as e:
        _debug_print(f"[media_multi] Failed to open file: {e}", level=1)
        return []

    sheet_names = xl.sheet_names
    _debug_print(f"[media_multi] Available sheets: {sheet_names}", level=2)

    media_list: List[MediaKPIs] = []
    processed_media: set = set()  # 重複防止用

    # シート名検索用のキーワード
    AGGREGATE_SHEETS = ["all", "全体", "サマリ", "summary", "合計", "集計", "総合", "media", "媒体"]
    MEDIA_KEYWORDS = [
        "Yahoo", "Google", "Facebook", "LINE", "Instagram", "X", "Twitter",
        "Microsoft", "Criteo", "TikTok", "SmartNews", "Gunosy", "TVer",
        "YouTube", "YDN", "GDN", "Meta", "Display", "検索", "ディスプレイ",
        "リスティング", "DSP", "ASA", "Apple"
    ]

    # ステップ0: ファイル名から単一媒体レポートかどうかを判定
    filename = xlsx.stem.lower()  # 拡張子なしのファイル名
    detected_media_from_filename = None
    for keyword in MEDIA_KEYWORDS:
        if keyword.lower() in filename:
            detected_media_from_filename = _normalize_media_name(xlsx.stem, keyword)
            _debug_print(f"[media_multi] Detected media from filename: {detected_media_from_filename}", level=2)
            break

    # ファイル名で媒体が検出された場合、最初のシートの合計をその媒体として使用
    if detected_media_from_filename and len(sheet_names) <= 2:
        # シート数が少ない = 単一媒体レポートの可能性が高い
        first_sheet = sheet_names[0]
        try:
            kpis = _extract_sheet_totals(xlsx, first_sheet)
            if kpis and kpis.get("cost"):
                media_kpi = MediaKPIs(
                    media_name=detected_media_from_filename,
                    kpis=kpis,
                    evidence={"source": f"filename:{xlsx.name}", "sheet": first_sheet},
                )
                media_kpi.compute_derived_kpis()
                media_list.append(media_kpi)
                processed_media.add(detected_media_from_filename)
                _debug_print(f"[media_multi] Created media from filename: {detected_media_from_filename}", level=2)
                return media_list  # 単一媒体レポートとして返す
        except Exception as e:
            _debug_print(f"[media_multi] Failed to extract from filename-based media: {e}", level=1)

    # ステップ1: 集計シート（all, 全体等）を探して抽出
    for sheet in sheet_names:
        sheet_lower = sheet.lower().strip()
        if any(agg.lower() in sheet_lower for agg in AGGREGATE_SHEETS):
            _debug_print(f"[media_multi] Found aggregate sheet: {sheet}", level=2)
            try:
                extracted = extract_media_data_full(xlsx, sheet)
                for media in extracted:
                    if media.media_name not in processed_media:
                        media_list.append(media)
                        processed_media.add(media.media_name)
                        _debug_print(f"[media_multi] Added from aggregate: {media.media_name}", level=2)
            except Exception as e:
                _debug_print(f"[media_multi] Failed to extract from {sheet}: {e}", level=1)

    # 集計シートから取得できた場合は、それを優先して返す
    if media_list:
        _debug_print(f"[media_multi] Found {len(media_list)} media from aggregate sheets", level=2)
        return media_list

    # ステップ2: シート名に媒体名が含まれる場合、そのシートを媒体として扱う
    media_sheets: List[Tuple[str, str]] = []  # (sheet_name, detected_media_name)

    for sheet in sheet_names:
        for keyword in MEDIA_KEYWORDS:
            if keyword.lower() in sheet.lower():
                # シート名から媒体名を正規化
                media_name = _normalize_media_name(sheet, keyword)
                if media_name not in processed_media:
                    media_sheets.append((sheet, media_name))
                    _debug_print(f"[media_multi] Found media sheet: {sheet} -> {media_name}", level=2)
                break

    # 各媒体シートからKPIを抽出
    for sheet, media_name in media_sheets:
        try:
            kpis = _extract_sheet_totals(xlsx, sheet)
            if kpis and kpis.get("cost"):
                media_kpi = MediaKPIs(
                    media_name=media_name,
                    kpis=kpis,
                    evidence={"source": f"sheet:{sheet}"},
                )
                media_kpi.compute_derived_kpis()
                media_list.append(media_kpi)
                processed_media.add(media_name)
                _debug_print(f"[media_multi] Extracted from sheet {sheet}: {media_name}", level=2)
        except Exception as e:
            _debug_print(f"[media_multi] Failed to extract from sheet {sheet}: {e}", level=1)

    # ステップ3: 従来の方式で各シートから媒体ブロックを探す
    if not media_list:
        for sheet in sheet_names:
            try:
                extracted = extract_media_data_full(xlsx, sheet)
                for media in extracted:
                    if media.media_name not in processed_media:
                        media_list.append(media)
                        processed_media.add(media.media_name)
            except Exception as e:
                _debug_print(f"[media_multi] Failed fallback extraction from {sheet}: {e}", level=1)

    _debug_print(f"[media_multi] Total media extracted: {len(media_list)}", level=2)
    return media_list


def _normalize_media_name(sheet_name: str, keyword: str) -> str:
    """シート名から媒体名を正規化"""
    # 一般的なパターン
    name_map = {
        "google": "Google広告",
        "yahoo": "Yahoo広告",
        "facebook": "Facebook",
        "meta": "Meta広告",
        "instagram": "Instagram",
        "line": "LINE広告",
        "twitter": "Twitter/X",
        "x": "Twitter/X",
        "tiktok": "TikTok",
        "youtube": "YouTube",
        "ydn": "YDN",
        "gdn": "GDN",
        "microsoft": "Microsoft広告",
        "criteo": "Criteo",
        "smartnews": "SmartNews",
        "gunosy": "Gunosy",
        "tver": "TVer",
        "display": "ディスプレイ広告",
        "検索": "検索広告",
        "ディスプレイ": "ディスプレイ広告",
        "リスティング": "リスティング広告",
        "dsp": "DSP",
        "asa": "Apple Search Ads",
        "apple": "Apple Search Ads",
    }

    key = keyword.lower()
    if key in name_map:
        return name_map[key]

    # マップにない場合はシート名をそのまま使用（ただしクリーンアップ）
    clean_name = sheet_name.strip()
    # 「_」や「-」で区切られた部分を取り除く
    if "_" in clean_name:
        parts = clean_name.split("_")
        for part in parts:
            if any(kw.lower() in part.lower() for kw in ["google", "yahoo", "facebook"]):
                return part.strip()
    return clean_name


def _extract_sheet_totals(xlsx: Path, sheet: str) -> Dict[str, Optional[float]]:
    """
    シート全体の合計行からKPIを抽出

    「合計」「Total」などの行を探すか、最終行のデータを取得
    """
    _debug_print(f"[sheet_totals] Extracting totals from: {sheet}", level=3)

    try:
        df_raw = pd.read_excel(xlsx, sheet_name=sheet, header=None, nrows=50, engine="openpyxl")
    except Exception as e:
        _debug_print(f"[sheet_totals] Failed to read: {e}", level=1)
        return {}

    # ヘッダー行を検出
    header_row = None
    for i in range(min(20, len(df_raw))):
        row_str = ' '.join([str(x) for x in df_raw.iloc[i, :20] if pd.notna(x)])
        if any(kw in row_str for kw in ["費用", "ご利用額", "クリック数", "表示回数", "インプレッション", "Cost", "Click"]):
            header_row = i
            break

    if header_row is None:
        header_row = 0

    try:
        df = pd.read_excel(xlsx, sheet_name=sheet, header=header_row, engine="openpyxl")
    except Exception:
        return {}

    if df.empty:
        return {}

    # 列マッピング
    def pick(df_, *cands):
        for c in cands:
            if c in df_.columns:
                return c
            for col in df_.columns:
                if isinstance(col, str) and c.lower() in col.lower():
                    return col
        return None

    kpi_col_map = {
        "cost": pick(df, "ご利用額", "費用", "利用額", "広告費", "コスト", "Cost", "消化金額"),
        "impr": pick(df, "表示回数", "インプレッション", "Imp", "インプレッション数", "Impressions"),
        "click": pick(df, "クリック", "クリック数", "Clicks"),
        "cv": pick(df, "獲得件数", "CV", "コンバージョン", "獲得数", "Conversions", "購入数", "視聴完了"),
        "conversion_value": pick(df, "CV値", "コンバージョン値", "合計コンバージョン値", "Conversion value", "Value"),
        "revenue": pick(df, "売上金額", "売上", "売上高", "Revenue", "Sales"),
        "ctr": pick(df, "CTR", "クリック率"),
        "cvr": pick(df, "CVR", "獲得率"),
        "cpa": pick(df, "CPA", "獲得単価"),
        "cpc": pick(df, "CPC", "クリック単価"),
    }

    # 「合計」行を探す
    total_keywords = ["合計", "Total", "TOTAL", "総計", "全体", "sum", "合算"]
    total_row = None

    first_col = df.columns[0] if len(df.columns) > 0 else None
    if first_col:
        for idx, val in df[first_col].items():
            if pd.notna(val) and any(kw in str(val) for kw in total_keywords):
                total_row = idx
                break

    # 合計行がなければ最終行を使用
    if total_row is None and len(df) > 0:
        # 数値データがある最終行を探す
        for idx in reversed(df.index):
            row = df.loc[idx]
            if any(pd.notna(row[c]) and isinstance(row[c], (int, float)) for c in df.columns if pd.notna(row[c])):
                total_row = idx
                break

    if total_row is None:
        return {}

    # KPIを抽出
    kpis: Dict[str, Optional[float]] = {}
    row = df.loc[total_row]

    for kpi_key, col_name in kpi_col_map.items():
        if col_name and col_name in row.index:
            val = to_float(row[col_name])
            if val is not None:
                kpis[kpi_key] = val

    return kpis
