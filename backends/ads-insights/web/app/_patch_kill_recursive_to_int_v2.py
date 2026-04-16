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

# 1) 再帰の原因行を潰す（今の赤の根本）
s, n_bad = re.subn(
    r"(?m)^\s*return\s+_to_int\(\s*m\.group\(\s*0\s*\)\s*\)\s*if\s*m\s*else\s*None\s*$",
    "    return int(m.group(0)) if m else None  # patched: no recursion",
    s,
)
print(f"[OK] patched recursive return lines: {n_bad}")

# 2) def _to_int ブロックを “非再帰版” に丸ごと置換（top-level def のみ）
def_block = '''
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
    m = re.search(r"-?[\\d,]+", s)
    if not m:
        return None
    return int(m.group(0).replace(",", ""))
'''.lstrip("\n").rstrip() + "\n\n"

pat = re.compile(r"(?ms)^def\s+_to_int\([^)]*\):\n(?:^[ \t]+.*\n)*?(?=^def\s|\Z)")
s, n_def = pat.subn(lambda m: def_block, s)
print(f"[OK] replaced _to_int def blocks: {n_def}")

SV.write_text(s, encoding="utf-8-sig")
print("[DONE]")
