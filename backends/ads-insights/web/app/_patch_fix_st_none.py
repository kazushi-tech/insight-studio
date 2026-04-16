from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

APP = Path("web/app/app.py")
if not APP.exists():
    raise SystemExit(f"not found: {APP.resolve()}")

ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
bak = APP.with_name(APP.name + f".bak.{ts}")
bak.write_bytes(APP.read_bytes())
print(f"[OK] backup -> {bak}")

s = APP.read_text(encoding="utf-8-sig")

# 1) `import streamlit as st` が存在することを確認（なければ先頭に追加）
if not re.search(r"(?m)^\s*import\s+streamlit\s+as\s+st\s*$", s):
    # import群の最後に差し込む
    m = re.search(r"(?m)^(?:from __future__.*\n)?(?:import .*\n|from .* import .*\n)+", s)
    ins = m.end() if m else 0
    s = s[:ins] + ("\nimport streamlit as st\n" if ins else "import streamlit as st\n") + s[ins:]
    print("[OK] injected `import streamlit as st`")

# 2) top-levelで `st = ...` してる行をコメントアウト（streamlit alias を殺すので禁止）
#    ※ "st." を含む行は対象外（これは普通に使ってるだけ）
pat = re.compile(r"(?m)^(st\s*=\s*.+)$")
lines = s.splitlines(True)
out = []
n = 0
for ln in lines:
    if pat.match(ln) and ("st." not in ln):
        out.append("# [PATCHED] " + ln)
        n += 1
    else:
        out.append(ln)
s2 = "".join(out)
print(f"[OK] commented out `st = ...` lines: {n}")

APP.write_text(s2, encoding="utf-8-sig")
print("[DONE]")
