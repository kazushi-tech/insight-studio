from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

APP = Path("web/app/app.py")
if not APP.exists():
    raise SystemExit(f"not found: {APP.resolve()}")

ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
bak = APP.with_name(APP.name + f".bak.fix7.{ts}")
bak.write_bytes(APP.read_bytes())
print(f"[OK] backup -> {bak}")

s = APP.read_text(encoding="utf-8-sig")
lines = s.splitlines(True)

# 1) `if _info.get("error"):` の行を探す（ここで NameError になってる）
idx = None
for i, ln in enumerate(lines):
    if re.search(r"\bif\s+_info\.get\(\s*[\"']error[\"']\s*\)\s*:", ln):
        idx = i
        break

if idx is None:
    raise SystemExit("Could not find `if _info.get(\"error\"):` line. Abort.")

# 2) その直前で _info を必ず定義する
#    - 可能なら parse_audit_info(_md) を試す
#    - ダメなら {"error": "..."} か {} にする（とにかく NameError を消す）
indent = re.match(r"^(\s*)", lines[idx]).group(1)

inject = [
    f"{indent}# --- PATCHED_DEFINE_INFO_GUARD ---\n",
    f"{indent}if '_info' not in globals() and '_info' not in locals():\n",
    f"{indent}    _info = {{}}\n",
    f"{indent}try:\n",
    f"{indent}    # parse_audit_info が使えるなら試す（_md が無い/失敗でも落ちない）\n",
    f"{indent}    from source_view import parse_audit_info\n",
    f"{indent}    if ' _md' in locals() or '_md' in globals():\n",
    f"{indent}        _info = parse_audit_info(_md)\n",
    f"{indent}except Exception as e:\n",
    f"{indent}    # 失敗しても UI を落とさない\n",
    f"{indent}    if not isinstance(_info, dict):\n",
    f"{indent}        _info = {{}}\n",
    f"{indent}# --- /PATCHED_DEFINE_INFO_GUARD ---\n",
]

# すでに注入済みなら二重に入れない
already = any("PATCHED_DEFINE_INFO_GUARD" in ln for ln in lines[max(0, idx-30):idx+1])
if already:
    print("[SKIP] guard already exists near target")
else:
    lines = lines[:idx] + inject + lines[idx:]
    print(f"[OK] injected guard before line {idx+1}")

APP.write_text("".join(lines), encoding="utf-8-sig")
print("[DONE]")
