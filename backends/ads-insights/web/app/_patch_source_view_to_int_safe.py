from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

SV = Path("web/app/source_view.py")
if not SV.exists():
    raise SystemExit(f"not found: {SV.resolve()}")

# backup
ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
bak = SV.with_name(SV.name + f".bak.{ts}")
bak.write_bytes(SV.read_bytes())
print(f"[OK] backup -> {bak}")

s = SV.read_text(encoding="utf-8-sig")

# 既存の壊れたパッチがあれば除去（何回当てても安全に）
pat = re.compile(r"(?ms)^\s*#\s*---\s*TO_INT_SAFE_V1\s*---.*?^\s*#\s*---\s*/TO_INT_SAFE_V1\s*---\s*\n?")
s, n = pat.subn("", s)
print(f"[OK] removed old TO_INT_SAFE_V1 blocks: {n}")

patch = r'''
# --- TO_INT_SAFE_V1 ---
import re as _re

def _to_int(x):
    """Parse int from values like 'rows=63', '63行', '141,383', etc. Return None if not found."""
    if x is None:
        return None
    if isinstance(x, bool):
        return int(x)
    if isinstance(x, int):
        return x
    if isinstance(x, float):
        return int(x)

    s = str(x).strip()
    m = _re.search(r"-?[\d,]+", s)
    if not m:
        return None
    return int(m.group(0).replace(",", ""))

def _to_float(x):
    """Parse float from '141,383.88', '¥141,383', '7.47%' etc. Return None if not found."""
    if x is None:
        return None
    if isinstance(x, bool):
        return float(x)
    if isinstance(x, (int, float)):
        return float(x)

    s = str(x).strip()
    pct = False
    if s.endswith("%"):
        pct = True
        s = s[:-1].strip()

    s = s.replace("¥", "").replace("￥", "")
    m = _re.search(r"-?[\d,]+(?:\.\d+)?", s)
    if not m:
        return None

    v = float(m.group(0).replace(",", ""))
    return v / 100.0 if pct else v
# --- /TO_INT_SAFE_V1 ---
'''.lstrip("\n")

# 末尾に追記（後勝ちで確実に上書き）
s = s.rstrip() + "\n\n" + patch + "\n"
SV.write_text(s, encoding="utf-8-sig")
print("[DONE] appended TO_INT_SAFE_V1 to source_view.py")
