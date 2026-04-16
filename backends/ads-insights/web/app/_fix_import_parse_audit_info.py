from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

APP = Path("web/app/app.py")
if not APP.exists():
    raise SystemExit(f"not found: {APP.resolve()}")

ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
bak = APP.with_name(APP.name + f".bak.fix2.{ts}")
bak.write_bytes(APP.read_bytes())
print(f"[OK] backup -> {bak}")

s = APP.read_text(encoding="utf-8-sig")

# すでに import 済みなら何もしない
if re.search(r"(?m)^\s*from\s+source_view\s+import\s+parse_audit_info\s*$", s) or re.search(r"(?m)^\s*import\s+source_view\b", s):
    print("[SKIP] source_view import already exists")
else:
    # import ブロック（冒頭の import 群）の末尾に差し込む
    m = re.search(r"(?ms)^(?:from __future__.*\n)?(?:import .*\n|from .* import .*\n)+", s)
    ins = m.end() if m else 0
    inject = "\nfrom source_view import parse_audit_info\n"
    s = s[:ins] + inject + s[ins:]
    print("[OK] injected: from source_view import parse_audit_info")

APP.write_text(s, encoding="utf-8-sig")
print("[DONE]")
