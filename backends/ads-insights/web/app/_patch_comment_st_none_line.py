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

# インデント有りの `st = None` をピンポイントで潰す（これが st を壊してる）
s2, n = re.subn(r"(?m)^(\s*)st\s*=\s*None\s*$", r"\1# [PATCHED] st = None", s)
print(f"[OK] patched `st = None`: {n}")

APP.write_text(s2, encoding="utf-8-sig")
print("[DONE]")
