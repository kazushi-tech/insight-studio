from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

APP = Path("web/app/app.py")
if not APP.exists():
    raise SystemExit(f"app.py not found: {APP.resolve()}")

# 0) 直近バックアップがあればそれに戻してから当て直す（中途半端混入を防ぐ）
baks = sorted(Path("web/app").glob("app.py.bak.*"), key=lambda p: p.name, reverse=True)
if baks:
    latest = baks[0]
    # 直近のbakの方が今のapp.pyより新しいケースは少ないが、混入してるときの復旧として常に戻す
    APP.write_bytes(latest.read_bytes())
    print(f"[OK] restored from backup -> {latest}")

# 1) まず SyntaxWarning の元（例文字列/CSV例/監査ログ例）を raw 文字列に強制置換
text = APP.read_text(encoding="utf-8-sig")

def replace_line_containing(substr: str, new_line: str) -> int:
    nonlocal_text = []
    changed = 0
    for ln in text.splitlines(True):
        if substr in ln:
            nonlocal_text.append(new_line + ("\n" if not new_line.endswith("\n") else ""))
            changed += 1
        else:
            nonlocal_text.append(ln)
    return changed, "".join(nonlocal_text)

# 置換対象は “そのまま表示する例” なので、意味は変えずに raw 文字列化
changed = 0

# 例: G:\My Drive\...
if "例: G:\\My Drive\\foo.xlsx -> file:///G:/My%20Drive/foo.xlsx" in text:
    text = text.replace(
        "例: G:\\My Drive\\foo.xlsx -> file:///G:/My%20Drive/foo.xlsx",
        r"例: G:\My Drive\foo.xlsx -> file:///G:/My%20Drive/foo.xlsx",
    )
    changed += 1

# G:\マイドライブ\...\2025年12月.xlsx,...
if "G:\\マイドライブ\\...\\2025年12月.xlsx,https://drive.google.com/file/d/xxxxx/view" in text:
    text = text.replace(
        "G:\\マイドライブ\\...\\2025年12月.xlsx,https://drive.google.com/file/d/xxxxx/view",
        r"G:\マイドライブ\...\2025年12月.xlsx,https://drive.google.com/file/d/xxxxx/view",
    )
    changed += 1

# |参照ファイル|G:\...\2025年12月.xlsx|...
# これはMarkdown例なので raw化が効くように “文字列リテラル内” であることが前提。該当箇所があれば置換。
if "|参照ファイル|G:\...\2025年12月.xlsx|G:\...\2025年11月.xlsx|" in text:
    text = text.replace(
        "|参照ファイル|G:\...\2025年12月.xlsx|G:\...\2025年11月.xlsx|",
        r"|参照ファイル|G:\...\2025年12月.xlsx|G:\...\2025年11月.xlsx|",
    )
    changed += 1

print(f"[OK] SyntaxWarning hotfix replacements: {changed}")

# 2) EXCEL_EXCERPT_UI_V1 を安全に追加（f-string禁止）
MARK = "EXCEL_EXCERPT_UI_V1"
if MARK in text:
    print("[OK] EXCEL_EXCERPT_UI_V1 already present -> skip append")
else:
    block = """
# --- EXCEL_EXCERPT_UI_V1 (auto injected) ---
try:
    from pathlib import Path as _Path
    import streamlit as st
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
    # サイドバーに「半年分が認識されてるか」を必ず出す（compare/insights未生成も見える）
    try:
        _compare_dir = _Path("compare")
        _insights_dir = _Path("insights")

        _data_dir = infer_data_dir_from_any_compare(_compare_dir)
        _xlsx_months = scan_xlsx_months(_data_dir) if _data_dir else {}
        _compare_months = scan_md_months(_compare_dir)
        _insights_months = scan_md_months(_insights_dir)

        with st.sidebar.expander("データ検出（xlsx/ソース）", expanded=False):
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
        try:
            st.sidebar.error(f"データ検出エラー: {_e}")
        except Exception:
            pass

    st.markdown("---")
    st.subheader("根拠（Excel抜粋 / NotebookLM風）")

    _compare_dir2 = _Path("compare")
    _compare_files = sorted(_compare_dir2.glob("*.md")) if _compare_dir2.exists() else []
    if not _compare_files:
        st.info("compare/*.md がありません（要点パックが未生成です）。まず compare を生成してください。")
    else:
        _pick = st.selectbox(
            "compareファイル（監査ログからExcelを抜粋します）",
            [str(p) for p in _compare_files],
            index=0,
            key="__excel_ui_compare_pick",
        )

        _md = _Path(_pick).read_text(encoding="utf-8-sig")
        _info = parse_audit_info(_md)

        if _info.get("error"):
            st.error(_info["error"])
        else:
            st.caption(
                f"参照シート: current={_info.get('current_sheet')} / 前月={_info.get('base_sheet')}  ｜  "
                f"行×列: current={_info.get('current_rows')}×{_info.get('current_cols')} / 前月={_info.get('base_rows')}×{_info.get('base_cols')}"
            )

            _cur = _info["current_path"]
            _base = _info["base_path"]

            c1, c2 = st.columns(2)
            with c1:
                st.write("**当月ソース**")
                st.code(_cur)
                if st.button("当月Excelを開く（ローカル）", key="__open_cur_local"):
                    ok, msg = open_local_file(_cur)
                    if not ok:
                        st.error(msg)
                if st.button("当月URLを開く（sources_map.csvがあればDrive）", key="__open_cur_url"):
                    ok, msg = open_url(resolve_source_url(_cur))
                    if not ok:
                        st.error(msg)

            with c2:
                st.write("**前月ソース**")
                st.code(_base)
                if st.button("前月Excelを開く（ローカル）", key="__open_base_local"):
                    ok, msg = open_local_file(_base)
                    if not ok:
                        st.error(msg)
                if st.button("前月URLを開く（sources_map.csvがあればDrive）", key="__open_base_url"):
                    ok, msg = open_url(resolve_source_url(_base))
                    if not ok:
                        st.error(msg)

            q = st.text_input("検索（行フィルタ）", value="", placeholder="例: 費用 / クリック / キャンペーン / 媒体", key="__excel_ui_q")

            @st.cache_data(show_spinner=False)
            def _load_df(path: str, sheet: str, r: int | None, c: int | None):
                return read_excel_grid(path, sheet, r, c, limit_rows=120)

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
                    if df is None:
                        return None
                    qq = str(q)
                    mask = df.astype(str).apply(lambda row: row.str.contains(qq, case=False, na=False)).any(axis=1)
                    return df[mask]
                df_cur_f = _filter(df_cur)
                df_base_f = _filter(df_base)
            else:
                df_cur_f, df_base_f = df_cur, df_base

            t1, t2 = st.tabs(["当月（抜粋）", "前月（抜粋）"])
            with t1:
                if df_cur_f is not None:
                    st.dataframe(df_cur_f, use_container_width=True, hide_index=True)
            with t2:
                if df_base_f is not None:
                    st.dataframe(df_base_f, use_container_width=True, hide_index=True)

# --- /EXCEL_EXCERPT_UI_V1 ---
"""
    text = text + "\n\n" + block
    print("[OK] appended EXCEL_EXCERPT_UI_V1 block")

# 3) 保存（再バックアップ）
ts2 = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
bak2 = Path(str(APP) + f".bak.{ts2}")
bak2.write_bytes(APP.read_bytes())
APP.write_text(text, encoding="utf-8-sig")
print(f"[OK] wrote app.py (backup -> {bak2})")
