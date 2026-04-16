from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

SV = Path("web/app/source_view.py")
if not SV.exists():
    raise SystemExit(f"not found: {SV.resolve()}")

ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
bak = SV.with_name(SV.name + f".bak.{ts}")
bak.write_bytes(SV.read_bytes())
print(f"[OK] backup -> {bak}")

s = SV.read_text(encoding="utf-8-sig")

# 1) 以前の _rows_safe 注入ブロックがあれば除去（何回でも安全に）
pat = re.compile(r"(?ms)^\s*#\s*---\s*ROWS_SAFE_TOP_V1\s*---.*?^\s*#\s*---\s*/ROWS_SAFE_TOP_V1\s*---\s*\n?")
s, n = pat.subn("", s)
print(f"[OK] removed old ROWS_SAFE_TOP_V1: {n}")

# 2) モジュールトップに _rows_safe を確実に定義（import群の後ろに入れる）
block = r'''
# --- ROWS_SAFE_TOP_V1 ---
import re as _re

def _rows_safe(v):
    """Parse int safely from 'rows=63', '63行', '141,383', etc. Return None if not found."""
    if v is None:
        return None
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v)
    s = str(v).strip()
    m = _re.search(r"-?[\d,]+", s)
    if not m:
        return None
    return int(m.group(0).replace(",", ""))
# --- /ROWS_SAFE_TOP_V1 ---
'''.lstrip("\n")

# import 連続ブロックの直後へ
m = re.search(r"(?m)^(?:from __future__.*\n)?(?:import .*\n|from .* import .*\n)+", s)
if m:
    ins = m.end()
    s = s[:ins] + "\n" + block + "\n" + s[ins:]
    print("[OK] injected ROWS_SAFE_TOP_V1 after imports")
else:
    s = block + "\n" + s
    print("[OK] injected ROWS_SAFE_TOP_V1 at top")

SV.write_text(s, encoding="utf-8-sig")
print("[DONE]")
