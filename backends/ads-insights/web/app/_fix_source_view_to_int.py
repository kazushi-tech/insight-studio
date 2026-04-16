from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

SV = Path("web/app/source_view.py")
if not SV.exists():
    raise SystemExit(f"not found: {SV.resolve()}")

ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
bak = SV.with_name(SV.name + f".bak.fix.{ts}")
bak.write_bytes(SV.read_bytes())
print(f"[OK] backup -> {bak}")

s = SV.read_text(encoding="utf-8-sig")

# _to_int の定義ブロックを丸ごと “非再帰” 版に置換（repl内の \ を回避するため関数置換）
pat = re.compile(r"(?ms)^def\s+_to_int\([^)]*\):\n(?:^[ \t]+.*\n)*?(?=^def\s|\Z)")

def_block = "\n".join([
"def _to_int(x):",
"    \"\"\"Parse int safely from strings like 'rows=63', '63行', '141,383'. Return None if not found.\"\"\"",
"    if x is None:",
"        return None",
"    if isinstance(x, bool):",
"        return int(x)",
"    if isinstance(x, int):",
"        return x",
"    if isinstance(x, float):",
"        return int(x)",
"    s = str(x).strip()",
"    m = re.search(r\"-?[\\d,]+\", s)",
"    if not m:",
"        return None",
"    return int(m.group(0).replace(\",\", \"\"))",
"",
""
])

s2, n = pat.subn(lambda m: def_block, s)
print(f"[OK] replaced _to_int def blocks: {n}")

# 念のため、再帰してる行が残ってたら潰す
s3, n2 = re.subn(
    r"(?m)^\s*return\s+_to_int\(\s*m\.group\(\s*0\s*\)\s*\)\s*if\s*m\s*else\s*None\s*$",
    "    return int(m.group(0)) if m else None  # patched: no recursion",
    s2,
)
print(f"[OK] patched recursive return lines: {n2}")

SV.write_text(s3, encoding="utf-8-sig")
print("[DONE]")
