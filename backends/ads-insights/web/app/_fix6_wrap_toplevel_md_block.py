from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

APP = Path("web/app/app.py")
if not APP.exists():
    raise SystemExit(f"not found: {APP.resolve()}")

ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
bak = APP.with_name(APP.name + f".bak.fix6.{ts}")
bak.write_bytes(APP.read_bytes())
print(f"[OK] backup -> {bak}")

s = APP.read_text(encoding="utf-8-sig")
lines = s.splitlines()

# 1) _md を作ってる最初の行（トップレベル）を探す
start = None
for i, ln in enumerate(lines):
    if re.match(r"^\s*_md\s*=\s*", ln):
        start = i
        break

if start is None:
    raise SystemExit("Could not find top-level `_md = ...` line. Abort.")

# 2) def main の直前までを範囲にする
end = None
for j in range(start + 1, len(lines)):
    if re.match(r"^\s*def\s+main\s*\(", lines[j]):
        end = j
        break

if end is None:
    raise SystemExit("Could not find `def main(...)` after `_md`. Abort.")

print(f"[OK] wrap range: {start+1}..{end} (1-based line numbers)")

# 3) その範囲を if False: で包む（インデント壊さない）
out = []
out.extend(lines[:start])
out.append("if False:  # PATCHED_DISABLE_TOPLEVEL_BLOCK")
# 既存の行を 4スペインデントして入れる
for ln in lines[start:end]:
    out.append("    " + ln)
out.append("")  # spacer
out.extend(lines[end:])

APP.write_text("\n".join(out) + "\n", encoding="utf-8-sig")
print("[DONE]")
