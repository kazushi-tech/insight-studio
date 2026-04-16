from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

APP = Path("web/app/app.py")
if not APP.exists():
    raise SystemExit(f"not found: {APP.resolve()}")

ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
bak = APP.with_name(APP.name + f".bak.fix3.{ts}")
bak.write_bytes(APP.read_bytes())
print(f"[OK] backup -> {bak}")

s = APP.read_text(encoding="utf-8-sig")

# 1) トップレベルの _info = parse_audit_info(_md) を無効化（NameErrorの元）
#    ついでに parse_audit_info 自体が無い場合も落ちないようにする
pat = re.compile(r"(?m)^\s*_info\s*=\s*parse_audit_info\(_md\)\s*$")
s2, n = pat.subn("# [PATCHED] _info will be computed inside main()", s)
print(f"[OK] patched top-level _info line: {n}")

# 2) main() の先頭付近（st.set_page_config の直後）に _info 計算を注入
#    既に注入済みなら二重に入れない
if "PATCHED_COMPUTE_INFO_IN_MAIN" in s2:
    print("[SKIP] main injection already exists")
else:
    # st.set_page_config(...) の直後に差し込む
    anchor = re.search(r"(?m)^\s*st\.set_page_config\(.*\)\s*$", s2)
    if not anchor:
        raise SystemExit("Could not find st.set_page_config(...) line to anchor injection.")

    insert_pos = anchor.end()
    inject = "\n".join([
        "",
        "    # --- PATCHED_COMPUTE_INFO_IN_MAIN ---",
        "    try:",
        "        from source_view import parse_audit_info  # local module",
        "    except Exception:",
        "        parse_audit_info = None",
        "",
        "    _info = None",
        "    try:",
        "        if parse_audit_info is not None:",
        "            _info = parse_audit_info(_md)",
        "    except Exception as e:",
        "        _info = None",
        "        try:",
        "            st.warning(f\"parse_audit_info failed: {e}\")",
        "        except Exception:",
        "            pass",
        "    # --- /PATCHED_COMPUTE_INFO_IN_MAIN ---",
        "",
    ])
    s2 = s2[:insert_pos] + inject + s2[insert_pos:]
    print("[OK] injected _info compute block into main()")

APP.write_text(s2, encoding="utf-8-sig")
print("[DONE]")
