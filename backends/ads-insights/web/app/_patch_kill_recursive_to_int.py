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

# 0) まず “再帰してる旧 _to_int” を確実に殺す： `return _to_int(m.group(0))` を禁止
#    （この1行がある限り再帰する）
s2, n_bad = re.subn(
    r"(?m)^\s*return\s+_to_int\(\s*m\.group\(\s*0\s*\)\s*\)\s*if\s*m\s*else\s*None\s*$",
    "        return int(m.group(0)) if m else None  # patched: no recursion",
    s,
)
print(f"[OK] patched recursive return lines: {n_bad}")

# 1) さらに安全に：_to_int の本体（def _to_int ...）を “非再帰” 実装で置換
#    ※ source_view.py 内に def _to_int が複数あっても、全部置換する
pat = re.compile(r"(?ms)^def\s+_to_int\([^)]*\):\s*\n(?:(?:^[ \t].*\n)|(?:^\n))*")
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
'''.lstrip("\n")

# 置換対象を “def _to_int” ブロック単位で探して差し替える（複数対応）
# ブロック終端は次の top-level def か EOF まで
pat2 = re.compile(r"(?ms)^def\s+_to_int\([^)]*\):\n(?:^[ \t]+.*\n)*?(?=^def\s|\Z)")
s3, n_def = pat2.subn(def_block.rstrip() + "\n\n", s2)
print(f"[OK] replaced _to_int def blocks: {n_def}")

SV.write_text(s3, encoding="utf-8-sig")
print("[DONE]")
