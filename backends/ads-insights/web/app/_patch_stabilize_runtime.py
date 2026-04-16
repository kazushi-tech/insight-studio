from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

APP = Path("web/app/app.py")
SV  = Path("web/app/source_view.py")

if not APP.exists():
    raise SystemExit(f"app.py not found: {APP.resolve()}")
if not SV.exists():
    raise SystemExit(f"source_view.py not found: {SV.resolve()}")

def backup(p: Path) -> Path:
    ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = p.with_name(p.name + f".bak.{ts}")
    bak.write_bytes(p.read_bytes())
    return bak

bak_app = backup(APP)
bak_sv  = backup(SV)
print(f"[OK] backup app.py -> {bak_app}")
print(f"[OK] backup source_view.py -> {bak_sv}")

text = APP.read_text(encoding="utf-8-sig")

# 1) 末尾に残ってる EXCEL_EXCERPT_UI_V1 を丸ごと削除（これがArrow事故の主犯になりがち）
pat_v1 = re.compile(r"(?ms)^\s*#\s*---\s*EXCEL_EXCERPT_UI_V1.*?^\s*#\s*---\s*/EXCEL_EXCERPT_UI_V1\s*---\s*$\n?")
text, n_v1 = pat_v1.subn("", text)
print(f"[OK] removed EXCEL_EXCERPT_UI_V1 blocks: {n_v1}")

# 2) st.dataframe を“全域で安全化”してArrow事故をゼロ化（DFは全部文字列にして表示）
if "SAFE_DATAFRAME_V1" not in text:
    wrapper = """
# --- SAFE_DATAFRAME_V1 ---
try:
    import pandas as _pd
    _st_dataframe_orig = st.dataframe
    def _st_dataframe_safe(data=None, *args, **kwargs):
        try:
            if isinstance(data, _pd.DataFrame):
                data = data.astype(str)
        except Exception:
            pass
        return _st_dataframe_orig(data, *args, **kwargs)
    st.dataframe = _st_dataframe_safe
except Exception:
    pass
# --- /SAFE_DATAFRAME_V1 ---
"""
    m = re.search(r"(?m)^\s*#\s*---\s*/BOOT_MARKER_V1\s*---\s*$", text)
    if m:
        ins = m.end()
        text = text[:ins] + wrapper + text[ins:]
        print("[OK] injected SAFE_DATAFRAME_V1 after /BOOT_MARKER_V1")
    else:
        m = re.search(r"(?m)^\s*import\s+streamlit\s+as\s+st\s*$", text)
        if not m:
            raise SystemExit("import streamlit as st not found; can't inject SAFE_DATAFRAME_V1")
        ins = m.end()
        text = text[:ins] + wrapper + text[ins:]
        print("[OK] injected SAFE_DATAFRAME_V1 after import streamlit as st")
else:
    print("[OK] SAFE_DATAFRAME_V1 already present")

# 3) use_container_width を width に一括置換（警告うるさいので潰す）
text, n_ucw_t = re.subn(r"use_container_width\s*=\s*True",  "width='stretch'", text)
text, n_ucw_f = re.subn(r"use_container_width\s*=\s*False", "width='content'", text)
print(f"[OK] replaced use_container_width True:{n_ucw_t} False:{n_ucw_f}")

# 4) SyntaxWarning の地雷（例文字列の G:\...\）は forward slash 表記に寄せる
n_ex = 0
text, c = re.subn(
    r"^(\s*).*例:\s*G:.*My\s*Drive.*foo\.xlsx.*$",
    r"\1例: G:/My Drive/foo.xlsx -> file:///G:/My%20Drive/foo.xlsx",
    text,
    flags=re.M,
)
n_ex += c

text, c = re.subn(
    r"^(\s*).*G:.*マイドライブ.*2025年12月\.xlsx,https://drive\.google\.com/file/d/xxxxx/view.*$",
    r"\1G:/マイドライブ/.../2025年12月.xlsx,https://drive.google.com/file/d/xxxxx/view",
    text,
    flags=re.M,
)
n_ex += c

text, c = re.subn(
    r"^\s*\|参照ファイル\|G:.*2025年12月\.xlsx\|G:.*2025年11月\.xlsx\|\s*$",
    r"|参照ファイル|G:/.../2025年12月.xlsx|G:/.../2025年11月.xlsx|",
    text,
    flags=re.M,
)
n_ex += c
print(f"[OK] SyntaxWarning example lines normalized: {n_ex}")

# 5) 「141,383 → 141」系の誤パース対策（カンマ対応）
#   (a) 正規表現の代表パターンがあれば置換（raw文字列想定）
n_rx = 0
if r"(-?\d+(?:\.\d+)?)" in text:
    text = text.replace(r"(-?\d+(?:\.\d+)?)", r"(-?[\d,]+(?:\.\d+)?)")
    n_rx += 1
if r"(\d+(?:\.\d+)?)" in text:
    text = text.replace(r"(\d+(?:\.\d+)?)", r"([\d,]+(?:\.\d+)?)")
    n_rx += 1

#   (b) float(xxx.group(n)) を float(xxx.group(n).replace(',', '')) に寄せる（副作用ほぼ無し）
text, n_float = re.subn(
    r"float\(\s*([A-Za-z_][A-Za-z0-9_]*)\.group\(\s*(\d+)\s*\)\s*\)",
    r"float(\1.group(\2).replace(',', ''))",
    text,
)
print(f"[OK] numeric parsing patch: regexPatterns:{n_rx} floatGroupFix:{n_float}")

APP.write_text(text, encoding="utf-8-sig")
print("[OK] wrote app.py")

# source_view.py：docstringの \. 地雷を根本排除（docstringをraw化）
sv = SV.read_text(encoding="utf-8-sig")
sv2, n_raw = re.subn(
    r'(?ms)(def\s+parse_audit_info\([^)]*\)\s*(?:->\s*dict\s*)?:\s*\n\s*)"""',
    r'\1r"""',
    sv,
    count=1,
)
if n_raw:
    SV.write_text(sv2, encoding="utf-8-sig")
    print("[OK] patched source_view.py docstring to raw string")
else:
    print("[OK] source_view.py docstring raw patch skipped (pattern not found)")

print("[DONE]")
