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

# 安全なローカル関数を parse_audit_info の冒頭に注入（1回だけ）
MARK = "PARSE_AUDIT_ROWS_SAFE_V1"
if MARK not in s:
    # parse_audit_info 定義の直後に注入
    s, n = re.subn(
        r"(?m)^def\s+parse_audit_info\([^\n]*\):\s*$",
        lambda m: m.group(0) + "\n" + 
        "    # --- PARSE_AUDIT_ROWS_SAFE_V1 ---\n"
        "    import re as _re\n"
        "    def _rows_safe(v):\n"
        "        if v is None:\n"
        "            return None\n"
        "        if isinstance(v, bool):\n"
        "            return int(v)\n"
        "        if isinstance(v, int):\n"
        "            return v\n"
        "        if isinstance(v, float):\n"
        "            return int(v)\n"
        "        s = str(v).strip()\n"
        "        m = _re.search(r\"-?[\\d,]+\", s)\n"
        "        if not m:\n"
        "            return None\n"
        "        return int(m.group(0).replace(\",\", \"\"))\n"
        "    # --- /PARSE_AUDIT_ROWS_SAFE_V1 ---\n",
        s,
        count=1
    )
    print(f"[OK] injected {MARK}: {n}")
else:
    print(f"[OK] {MARK} already present")

# current_rows / base_rows の _to_int(...) を _rows_safe(...) に置換
s2, n1 = re.subn(r'("current_rows"\s*:\s*)_to_int\(([^)]+)\)', r'\1_rows_safe(\2)', s)
s2, n2 = re.subn(r'("base_rows"\s*:\s*)_to_int\(([^)]+)\)', r'\1_rows_safe(\2)', s2)
print(f"[OK] replaced current_rows _to_int -> _rows_safe: {n1}")
print(f"[OK] replaced base_rows    _to_int -> _rows_safe: {n2}")

SV.write_text(s2, encoding="utf-8-sig")
print("[DONE]")
