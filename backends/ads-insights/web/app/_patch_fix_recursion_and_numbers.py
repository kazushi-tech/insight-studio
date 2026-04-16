from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

APP = Path("web/app/app.py")
SV  = Path("web/app/source_view.py")

for p in (APP, SV):
    if not p.exists():
        raise SystemExit(f"not found: {p.resolve()}")

def backup(p: Path) -> Path:
    ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = p.with_name(p.name + f".bak.{ts}")
    bak.write_bytes(p.read_bytes())
    return bak

def remove_num_parse_safe_block(text: str) -> tuple[str, int]:
    # 以前入れた NUM_PARSE_SAFE_V1 を丸ごと撤去（衝突/再帰の温床になる）
    pat = re.compile(r"(?ms)^\s*#\s*---\s*NUM_PARSE_SAFE_V1\s*---.*?^\s*#\s*---\s*/NUM_PARSE_SAFE_V1\s*---\s*\n?")
    new_text, n = pat.subn("", text)
    return new_text, n

def replace_top_level_func(text: str, name: str, new_def: str) -> tuple[str, bool]:
    # def name(...): のブロックを次の top-level def まで置換
    pat = re.compile(rf"(?ms)^def\s+{re.escape(name)}\([^)]*\):\n(?:^[ \t]+.*\n)*?(?=^def\s|\Z)")
    if pat.search(text):
        return pat.sub(new_def.rstrip() + "\n\n", text, count=1), True
    return text, False

# --- patch source_view.py ---
bak_sv = backup(SV)
sv = SV.read_text(encoding="utf-8-sig")
sv, n_rm_sv = remove_num_parse_safe_block(sv)

new_to_int = '''
def _to_int(x):
    """Parse int from values like '141,383', 'rows=63', etc. Return None if not found."""
    if x is None:
        return None
    if isinstance(x, bool):
        return int(x)
    if isinstance(x, int):
        return x
    if isinstance(x, float):
        return int(x)

    s = str(x).strip()
    m = re.search(r"-?[\\d,]+", s)
    if not m:
        return None
    return int(m.group(0).replace(",", ""))
'''.lstrip("\n")

new_to_float = '''
def _to_float(x):
    """Parse float from '141,383.88', '¥141,383', '7.47%' etc. Return None if not found."""
    if x is None:
        return None
    if isinstance(x, bool):
        return float(x)
    if isinstance(x, (int, float)):
        return float(x)

    s = str(x).strip()
    pct = False
    if s.endswith("%"):
        pct = True
        s = s[:-1].strip()

    s = s.replace("¥", "").replace("￥", "")
    m = re.search(r"-?[\\d,]+(?:\\.\\d+)?", s)
    if not m:
        return None

    v = float(m.group(0).replace(",", ""))
    return v / 100.0 if pct else v
'''.lstrip("\n")

sv, ok_i = replace_top_level_func(sv, "_to_int", new_to_int)
sv, ok_f = replace_top_level_func(sv, "_to_float", new_to_float)

SV.write_text(sv, encoding="utf-8-sig")

print(f"[OK] backup source_view.py -> {bak_sv}")
print(f"[OK] removed NUM_PARSE_SAFE_V1 in source_view.py: {n_rm_sv}")
print(f"[OK] patched source_view.py _to_int: {ok_i}, _to_float: {ok_f}")

# --- patch app.py (UI側で「月=46022」みたいなExcelシリアルを日付文字列へ) ---
bak_app = backup(APP)
app = APP.read_text(encoding="utf-8-sig")
app, n_rm_app = remove_num_parse_safe_block(app)

# EXCEL_EXCERPT_UI_V2 内の _load_df を差し替える（見た目用の変換なので副作用が少ない）
pat_load = re.compile(
    r"(?ms)@st\.cache_data\(show_spinner=False\)\s*\n\s*def\s+_load_df\([^\n]*\):\s*\n.*?(?=^\s*df_cur\s*=)",
)
m = pat_load.search(app)

new_load = r'''@st.cache_data(show_spinner=False)
def _load_df(path: str, sheet: str, r, c):
    import datetime as _dt
    df = read_excel_grid(path, sheet, r, c, limit_rows=120)

    # Excel serial date (e.g., 46022) -> YYYY-MM-DD
    _base = _dt.date(1899, 12, 30)

    def _norm(v):
        try:
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                fv = float(v)
                if 35000 <= fv <= 60000 and abs(fv - round(fv)) < 1e-6:
                    return str(_base + _dt.timedelta(days=int(round(fv))))
        except Exception:
            pass
        return v

    try:
        df = df.applymap(_norm)
    except Exception:
        pass

    # Arrow事故も避ける（全部文字列で表示）
    return df.astype(str)

'''

if m:
    app = app[:m.start()] + new_load + app[m.end():]
    print("[OK] patched app.py _load_df (excel serial date normalization)")
else:
    print("[WARN] app.py: _load_df block not found (EXCEL_EXCERPT_UI_V2 maybe changed). Skipped _load_df patch.")

APP.write_text(app, encoding="utf-8-sig")

print(f"[OK] backup app.py -> {bak_app}")
print(f"[OK] removed NUM_PARSE_SAFE_V1 in app.py: {n_rm_app}")
print("[DONE]")
