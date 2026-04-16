from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

APP = Path("web/app/app.py")
if not APP.exists():
    raise SystemExit(f"not found: {APP.resolve()}")

# backup
ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
bak = APP.with_name(APP.name + f".bak.{ts}")
bak.write_bytes(APP.read_bytes())
print(f"[OK] backup -> {bak}")

s = APP.read_text(encoding="utf-8-sig")

# 1) NUM_PARSE_SAFE_V1 ブロックが残ってたら削除（副作用源）
pat = re.compile(r"(?ms)^\s*#\s*---\s*NUM_PARSE_SAFE_V1\s*---.*?^\s*#\s*---\s*/NUM_PARSE_SAFE_V1\s*---\s*\n?")
s, n = pat.subn("", s)
print(f"[OK] removed NUM_PARSE_SAFE_V1 blocks: {n}")

# 2) EXCEL_EXCERPT_UI_V2 の st.dataframe 呼び出し“直前”に、日付シリアル変換を挿入
#    目標：df_cur / df_base が出来た後、表示前に applymap を1回噛ませる
mark = "EXCEL_SERIAL_DATE_FIX_V1"
if mark not in s:
    insert_pat = re.compile(r"(?ms)(df_cur\s*=\s*_load_df.*?\n)(.*?)(df_base\s*=\s*_load_df.*?\n)")
    m = insert_pat.search(s)
    if not m:
        print("[WARN] could not find df_cur/_load_df block. skipped")
    else:
        inject = r'''
# --- EXCEL_SERIAL_DATE_FIX_V1 ---
import datetime as _dt
_base = _dt.date(1899, 12, 30)

def _serial_to_date_str(v):
    try:
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            fv = float(v)
            if 35000 <= fv <= 60000 and abs(fv - round(fv)) < 1e-6:
                return str(_base + _dt.timedelta(days=int(round(fv))))
    except Exception:
        pass
    return v

def _apply_serial_fix(df):
    try:
        return df.applymap(_serial_to_date_str)
    except Exception:
        return df
# --- /EXCEL_SERIAL_DATE_FIX_V1 ---
'''.lstrip("\n")

        # df_cur 読み込みの直後に inject を入れる（インデント0で安全）
        pos = m.start(2)
        s = s[:pos] + inject + "\n" + s[pos:]
        print("[OK] injected EXCEL_SERIAL_DATE_FIX_V1")
else:
    print("[OK] EXCEL_SERIAL_DATE_FIX_V1 already present")

# 3) df_cur/df_base の表示直前に apply を入れる（安全）
#    「with t1: if df_cur is not None: st.dataframe(df_cur...)」の直前あたりを狙う
if mark in s and "df_cur = _apply_serial_fix(df_cur)" not in s:
    s = re.sub(
        r"(?m)^\s*with\s+t1:\s*$",
        "df_cur = _apply_serial_fix(df_cur)\ndf_base = _apply_serial_fix(df_base)\n\nwith t1:",
        s,
        count=1,
    )
    print("[OK] added apply_serial_fix before tabs render")

APP.write_text(s, encoding="utf-8-sig")
print("[DONE]")
