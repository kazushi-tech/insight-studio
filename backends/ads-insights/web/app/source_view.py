from __future__ import annotations

# --- NUM_PARSE_SAFE_V1 ---
import re as _re

def _clean_num_str(x):
    # "141,383" / "¥141,383" / "141,383.88" を安全に数値化できる形へ
    if x is None:
        return x
    if isinstance(x, (int, float)):
        return x
    s = str(x)
    # 数字の桁区切りカンマだけ除去（"a,b" みたいなのは無視される）
    s = _re.sub(r"(?<=\d),(?=\d)", "", s)
    # 通貨記号や余計な空白の除去（必要最小限）
    s = s.replace("¥", "").replace(",", "").strip()
    return s

def _to_float(x):
    x = _clean_num_str(x)
    return _to_float(x)

def _to_int(x):
    """Parse int safely from strings like 'rows=63', '63行', '141,383'. Return None if not found."""
    if x is None:
        return None
    if isinstance(x, bool):
        return int(x)
    if isinstance(x, int):
        return x
    if isinstance(x, float):
        return int(x)
    s = str(x).strip()
    m = re.search(r"-?[\d,]+", s)
    if not m:
        return None
    return int(m.group(0).replace(",", ""))

