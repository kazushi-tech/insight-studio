from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

app = Path("web/app/app.py")
if not app.exists():
    raise SystemExit(f"app.py not found: {app.resolve()}")

ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
bak = Path(str(app) + f".bak.{ts}")
bak.write_bytes(app.read_bytes())
print(f"[OK] backup -> {bak}")

text = app.read_text(encoding="utf-8-sig")
lines = text.splitlines(True)

MARK = "ROBUST_KPI_PARSER_V1"
if MARK not in text:
    block = """
# --- ROBUST_KPI_PARSER_V1 (auto injected) ---
try:
    from kpi_parse import extract_compare_kpis as _extract_compare_kpis
    _KPI_PARSE_IMPORT_ERROR = ""
except Exception as _e:
    _extract_compare_kpis = None
    _KPI_PARSE_IMPORT_ERROR = str(_e)

def parse_kpis_label_map(md_text: str):
    \"\"\"Return (label_map, debug). label_map keys are Japanese labels like '費用','クリック','CV'...\"\"\"
    if _extract_compare_kpis is None:
        return {}, {"reason": "kpi_parse import failed", "error": _KPI_PARSE_IMPORT_ERROR}
    kpis, dbg = _extract_compare_kpis(md_text or "")
    label_map = {}
    for _key, v in (kpis or {}).items():
        if not isinstance(v, dict):
            continue
        label = v.get("label") or _key
        if not label:
            continue
        label_map[str(label)] = {
            "label": label,
            "current": v.get("current", None),
            "base": v.get("base", None),
            "current_raw": v.get("current_raw", ""),
            "base_raw": v.get("base_raw", ""),
        }
    return label_map, dbg
# --- /ROBUST_KPI_PARSER_V1 ---
"""
    # insert after "import streamlit as st" if present, else after import block
    insert_at = None
    for i, ln in enumerate(lines):
        if ln.strip() == "import streamlit as st":
            insert_at = i + 1
            break
    if insert_at is None:
        insert_at = 0
        for i, ln in enumerate(lines):
            s = ln.strip()
            if s.startswith("import ") or s.startswith("from ") or s == "" or s.startswith("#"):
                insert_at = i + 1
                continue
            break

    lines.insert(insert_at, "\n" + block + "\n")
    text = "".join(lines)
    print("[OK] injected robust KPI parser block")

def patch_compare_assignment(src: str) -> tuple[str, int]:
    src_lines = src.splitlines(True)
    changed = 0
    pat = re.compile(r"^(\s*)([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*\(\s*([^)]+?)\s*\)\s*(#.*)?$")

    for idx, ln in enumerate(src_lines):
        m = pat.match(ln)
        if not m:
            continue
        indent, var, func, arg, _c = m.groups()
        low = ln.lower()
        var_low = var.lower()
        arg_low = str(arg).lower()

        # target only "compare + kpi" assignments
        if ("kpi" in var_low or "kpis" in var_low or ("kpi" in low and "compare" in low)) and ("compare" in var_low or "compare" in arg_low):
            if "parse_kpis_label_map" in ln:
                continue
            src_lines[idx] = f"{indent}{var}, {var}_dbg = parse_kpis_label_map({arg})\n"
            changed += 1
            break

    return "".join(src_lines), changed

text2, c = patch_compare_assignment(text)
app.write_text(text2, encoding="utf-8-sig")
print(f"[OK] patched compare KPI assignment: {c}")

if c == 0:
    print("[WARN] compare KPI assignment line not found automatically.")
    print("       Next: run these to locate it:")
    print("       Select-String -Path .\\web\\app\\app.py -Pattern \"compare\"")
    print("       Select-String -Path .\\web\\app\\app.py -Pattern \"kpi\"")
