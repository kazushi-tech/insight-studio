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

# backup
ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
bak = Path(str(APP) + f".bak.{ts}")
bak.write_bytes(APP.read_bytes())
print(f"[OK] backup -> {bak}")

text = APP.read_text(encoding="utf-8-sig")

# --- 1) BOOTマーカー（ここが出ないなら末尾以前に止まってる以前の問題） ---
BOOT_MARK = "BOOT_MARKER_V1"
boot_block = r'''
# --- BOOT_MARKER_V1 ---
try:
    import streamlit as st
    st.sidebar.success("BOOT: app.py reached (BOOT_MARKER_V1)")
except Exception:
    pass
# --- /BOOT_MARKER_V1 ---
'''
if BOOT_MARK not in text:
    m = re.search(r'^\s*import\s+streamlit\s+as\s+st\s*$', text, flags=re.M)
    if m:
        ins = m.end()
        text = text[:ins] + "\n" + boot_block + "\n" + text[ins:]
        print("[OK] injected BOOT marker after streamlit import")
    else:
        text = boot_block + "\n" + text
        print("[OK] injected BOOT marker at top")

# --- 2) Excel抜粋UIを st.title の直後に差し込む（末尾到達しなくても出る） ---
UI_MARK = "EXCEL_EXCERPT_UI_V2"
ui_block = r'''
# --- EXCEL_EXCERPT_UI_V2 ---
try:
    import streamlit as st
    from pathlib import Path as _Path
    from source_view import (
        parse_audit_info,
        infer_data_dir_from_any_compare,
        scan_xlsx_months,
        scan_md_months,
        read_excel_grid,
        open_local_file,
        resolve_source_url,
        open_url,
    )
except Exception as _e:
    st = None
    _EXCEL_UI_IMPORT_ERROR = str(_e)

if st is not None:
    try:
        _compare_dir = _Path("compare")
        _insights_dir = _Path("insights")
        _data_dir = infer_data_dir_from_any_compare(_compare_dir)
        _xlsx_months = scan_xlsx_months(_data_dir) if _data_dir else {}
        _compare_months = scan_md_months(_compare_dir)
        _insights_months = scan_md_months(_insights_dir)

        with st.sidebar.expander("データ検出（xlsx/ソース）", expanded=True):
            st.write(f"data_dir: {str(_data_dir) if _data_dir else '未推定'}")
            st.write(f"xlsx(月): {len(_xlsx_months)} 件")
            if _xlsx_months:
                st.caption(", ".join(list(_xlsx_months.keys())[:24]))
            st.write(f"compare(md) 月: {len(_compare_months)} / insights(md) 月: {len(_insights_months)}")

            if _xlsx_months:
                missing_c = sorted(set(_xlsx_months.keys()) - set(_compare_months.keys()))
                missing_i = sorted(set(_xlsx_months.keys()) - set(_insights_months.keys()))
                if missing_c:
                    st.warning("compare未生成の月: " + ", ".join(missing_c))
                if missing_i:
                    st.warning("insights未生成の月: " + ", ".join(missing_i))
                if not missing_c and not missing_i:
                    st.success("xlsx月は compare/insights に反映済みです")
    except Exception as _e:
        st.sidebar.error(f"データ検出エラー: {_e}")

    st.markdown("---")
    st.subheader("根拠（Excel抜粋 / NotebookLM風）")

    _compare_files = sorted(_Path("compare").glob("*.md")) if _Path("compare").exists() else []
    if not _compare_files:
        st.info("compare/*.md がありません（要点パックが未生成です）。")
    else:
        _pick = st.selectbox(
            "compareファイル（監査ログからExcelを抜粋します）",
            [str(p) for p in _compare_files],
            index=0,
            key="__excel_ui_compare_pick_v2",
        )
        _md = _Path(_pick).read_text(encoding="utf-8-sig")
        _info = parse_audit_info(_md)

        if _info.get("error"):
            st.error(_info["error"])
        else:
            st.caption(
                f"参照シート: current={_info.get('current_sheet')} / 前月={_info.get('base_sheet')} ｜ "
                f"行×列: current={_info.get('current_rows')}×{_info.get('current_cols')} / 前月={_info.get('base_rows')}×{_info.get('base_cols')}"
            )

            _cur = _info["current_path"]
            _base = _info["base_path"]

            c1, c2 = st.columns(2)
            with c1:
                st.write("**当月ソース**")
                st.code(_cur)
                if st.button("当月Excelを開く（ローカル）", key="__open_cur_local_v2"):
                    ok, msg = open_local_file(_cur)
                    if not ok: st.error(msg)
                if st.button("当月URLを開く（sources_map.csvがあればDrive）", key="__open_cur_url_v2"):
                    ok, msg = open_url(resolve_source_url(_cur))
                    if not ok: st.error(msg)

            with c2:
                st.write("**前月ソース**")
                st.code(_base)
                if st.button("前月Excelを開く（ローカル）", key="__open_base_local_v2"):
                    ok, msg = open_local_file(_base)
                    if not ok: st.error(msg)
                if st.button("前月URLを開く（sources_map.csvがあればDrive）", key="__open_base_url_v2"):
                    ok, msg = open_url(resolve_source_url(_base))
                    if not ok: st.error(msg)

            q = st.text_input("検索（行フィルタ）", value="", placeholder="例: 費用 / クリック / キャンペーン / 媒体", key="__excel_ui_q_v2")

            @st.cache_data(show_spinner=False)
            def _load_df(path: str, sheet: str, r, c):
                df = read_excel_grid(path, sheet, r, c, limit_rows=120)
                return df.astype(str)  # Arrow事故をゼロ化

            df_cur = None
            df_base = None
            try:
                df_cur = _load_df(_cur, _info.get("current_sheet") or "media", _info.get("current_rows"), _info.get("current_cols"))
            except Exception as _err:
                st.error(f"当月Excel読込エラー: {_err}")

            try:
                df_base = _load_df(_base, _info.get("base_sheet") or "media", _info.get("base_rows"), _info.get("base_cols"))
            except Exception as _err:
                st.error(f"前月Excel読込エラー: {_err}")

            if q:
                def _filter(df):
                    if df is None: return None
                    qq = str(q)
                    mask = df.apply(lambda row: row.str.contains(qq, case=False, na=False)).any(axis=1)
                    return df[mask]
                df_cur = _filter(df_cur)
                df_base = _filter(df_base)

            t1, t2 = st.tabs(["当月（抜粋）", "前月（抜粋）"])
            with t1:
                if df_cur is not None:
                    st.dataframe(df_cur, width="stretch", hide_index=True)
            with t2:
                if df_base is not None:
                    st.dataframe(df_base, width="stretch", hide_index=True)

# --- /EXCEL_EXCERPT_UI_V2 ---
'''
if UI_MARK not in text:
    m = re.search(r'^\s*st\.title\(.+?\)\s*$', text, flags=re.M)
    if m:
        ins = m.end()
        text = text[:ins] + "\n\n" + ui_block + "\n\n" + text[ins:]
        print("[OK] injected EXCEL UI V2 after st.title")
    else:
        text = text + "\n\n" + ui_block
        print("[OK] appended EXCEL UI V2 at end")

# --- 3) SyntaxWarning潰し（app.py / source_view.py） ---
text = re.sub(r"(例:\s*G:)\\", r"\1\\\\", text)
text = re.sub(r"(G:)\\(マイドライブ)", r"\1\\\\\2", text)
text = re.sub(r"(\|参照ファイル\|G:)\\", r"\1\\\\", text)

APP.write_text(text, encoding="utf-8-sig")
print("[OK] wrote app.py")

sv = SV.read_text(encoding="utf-8-sig")
sv2 = re.sub(r"(\|参照ファイル\|G:)\\", r"\1\\\\", sv)
if sv2 != sv:
    SV.write_text(sv2, encoding="utf-8-sig")
    print("[OK] patched source_view.py")
else:
    print("[OK] source_view.py unchanged")

print("[DONE]")
