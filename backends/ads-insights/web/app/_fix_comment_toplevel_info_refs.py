from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

APP = Path("web/app/app.py")
if not APP.exists():
    raise SystemExit(f"not found: {APP.resolve()}")

ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
bak = APP.with_name(APP.name + f".bak.fix4.{ts}")
bak.write_bytes(APP.read_bytes())
print(f"[OK] backup -> {bak}")

s = APP.read_text(encoding="utf-8-sig")

# 1) トップレベルの `_info` 参照（if _info.get(...) など）を全部コメントアウト
#    ルール: 行頭にインデントが無い `_info` 参照だけを潰す（main内は残す）
lines = s.splitlines(True)
out = []
n = 0
for ln in lines:
    # top-levelで _info を触ってる行を対象にする（先頭が空白じゃない）
    if re.match(r"^_info\b", ln) or re.match(r"^if\s+_info\b", ln) or re.match(r"^elif\s+_info\b", ln):
        out.append("# [PATCHED_TOPLEVEL_INFO] " + ln)
        n += 1
        continue
    # 例: st.error(_info["error"]) みたいな top-level参照も潰す
    if (not ln.startswith((" ", "\t"))) and ("_info" in ln) and ("PATCHED_COMPUTE_INFO_IN_MAIN" not in ln):
        # ただし import行は除外
        if not re.match(r"^(from|import)\s+", ln):
            out.append("# [PATCHED_TOPLEVEL_INFO] " + ln)
            n += 1
            continue
    out.append(ln)

s2 = "".join(out)
print(f"[OK] commented top-level _info references: {n}")

APP.write_text(s2, encoding="utf-8-sig")
print("[DONE]")
