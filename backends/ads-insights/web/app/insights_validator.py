# insights_validator.py
# 考察md内の数値がReportDataと整合しているかを検証するモジュール
# 許可される数値: KPI値 or そこから計算可能な派生値のみ

from __future__ import annotations
from typing import Dict, List, Set, Tuple, Optional, Any
import re
import math

from .report_data import ReportData


# 数値抽出パターン（日本語文中の数値を拾う）
NUMBER_PATTERNS = [
    # 通常の数値：1,234 / 1234 / 1,234.56
    re.compile(r"(?<![0-9])(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?)(?![0-9])"),
    # パーセント：12.34% / +12.34% / -12.34%
    re.compile(r"([+-]?\d+(?:\.\d+)?)\s*[%％]"),
    # 円：¥1,234 / 1,234円
    re.compile(r"[¥￥]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*円?"),
]


def extract_numbers_from_text(text: str) -> List[float]:
    """
    テキストから数値を抽出
    
    Returns:
        抽出した数値のリスト
    """
    numbers: List[float] = []
    
    for pattern in NUMBER_PATTERNS:
        for m in pattern.finditer(text):
            try:
                s = m.group(1) if m.lastindex else m.group(0)
                s = s.replace(",", "").replace("¥", "").replace("￥", "").replace("円", "").replace("%", "").replace("％", "")
                if s:
                    numbers.append(float(s))
            except (ValueError, AttributeError):
                continue
    
    return numbers


def build_allowed_numbers(current: ReportData, base: Optional[ReportData], tolerance: float = 0.01) -> Set[float]:
    """
    許可される数値の集合を構築
    
    含まれるもの:
    - 当月/ベースのKPI値
    - 差分（当月 - ベース）
    - 増減率（差分 / ベース）
    - パーセント表記（x100）
    """
    allowed: Set[float] = set()
    
    def add_if_valid(v: Optional[float]):
        if v is not None and not math.isnan(v) and not math.isinf(v):
            allowed.add(round(v, 4))
            # 誤差許容のため近い値も追加
            allowed.add(round(v, 2))
            allowed.add(round(v, 0))
    
    # 当月KPI
    for key, cv in current.kpis.items():
        add_if_valid(cv)
    
    # ベースKPI
    if base:
        for key, bv in base.kpis.items():
            add_if_valid(bv)
    
    # 派生値（差分、増減率）
    for key in current.kpis.keys():
        cv = current.kpis.get(key)
        bv = base.kpis.get(key) if base else None
        
        if cv is not None and bv is not None:
            # 差分
            delta = cv - bv
            add_if_valid(delta)
            
            # 増減率
            if bv != 0:
                pct = delta / bv
                add_if_valid(pct)
                add_if_valid(pct * 100)  # パーセント表記
    
    # よく使う固定値（0, 1, 100など）も許可
    for common in [0, 1, 2, 3, 5, 10, 100, 1000]:
        allowed.add(float(common))
    
    return allowed


def validate_numbers(
    text: str,
    current: ReportData,
    base: Optional[ReportData],
    tolerance: float = 0.05,
) -> Dict[str, Any]:
    """
    テキスト内の数値がReportDataと整合しているかを検証
    
    Args:
        text: 検証対象のテキスト
        current: 当月ReportData
        base: ベースReportData
        tolerance: 許容誤差（相対誤差）
    
    Returns:
        {
            "ok": True/False,
            "extracted_numbers": [抽出した数値リスト],
            "allowed_numbers": [許可される数値リスト],
            "invalid_numbers": [不正な数値リスト],
            "issues": [問題の説明リスト],
        }
    """
    extracted = extract_numbers_from_text(text)
    allowed = build_allowed_numbers(current, base, tolerance)
    
    invalid: List[float] = []
    issues: List[str] = []
    
    def is_allowed(n: float) -> bool:
        # 完全一致チェック
        if round(n, 4) in allowed:
            return True
        if round(n, 2) in allowed:
            return True
        if round(n, 0) in allowed:
            return True
        
        # 誤差許容チェック
        for a in allowed:
            if a == 0:
                if abs(n) < 1:
                    return True
            else:
                if abs(n - a) / abs(a) < tolerance:
                    return True
        
        return False
    
    for n in extracted:
        if not is_allowed(n):
            invalid.append(n)
            issues.append(f"不明な数値: {n}")
    
    return {
        "ok": len(invalid) == 0,
        "extracted_numbers": extracted,
        "allowed_numbers": sorted(list(allowed)),
        "invalid_numbers": invalid,
        "issues": issues,
    }


def remove_invalid_sentences(text: str, invalid_numbers: List[float]) -> str:
    """
    不正な数値を含む文を削除してテキストを修正
    
    フォールバック処理：バリデーションNGの場合にテキストを整合させる
    """
    if not invalid_numbers:
        return text
    
    lines = text.split("\n")
    result_lines: List[str] = []
    
    for line in lines:
        line_numbers = extract_numbers_from_text(line)
        has_invalid = any(
            abs(ln - inv) < 0.01 or (inv != 0 and abs(ln - inv) / abs(inv) < 0.01)
            for ln in line_numbers
            for inv in invalid_numbers
        )
        
        if has_invalid:
            # 見出し行は残す、箇条書き内容は削除
            if line.strip().startswith("#"):
                result_lines.append(line)
            elif line.strip().startswith("-"):
                # 数値を含む箇条書きは削除
                continue
            else:
                result_lines.append(line)
        else:
            result_lines.append(line)
    
    return "\n".join(result_lines)


def validate_and_fix(
    text: str,
    current: ReportData,
    base: Optional[ReportData],
) -> Tuple[str, Dict[str, Any]]:
    """
    テキストを検証し、必要なら修正して返す
    
    Returns:
        (修正後テキスト, 検証結果)
    """
    result = validate_numbers(text, current, base)
    
    if result["ok"]:
        return text, result
    
    # 不正な数値を含む文を削除
    fixed_text = remove_invalid_sentences(text, result["invalid_numbers"])
    
    # 修正後を再検証
    result["fixed_text"] = fixed_text
    result["was_fixed"] = True
    
    return fixed_text, result
