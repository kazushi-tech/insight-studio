# UI_APP_FIX_V1
from __future__ import annotations

import datetime as dt
import hashlib
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import streamlit as st

try:
    import pandas as pd
except Exception:
    pd = None

BOOT_MARKER = "BOOT_MARKER_V4_NOTEBOOKLM_3COL"

RE_COMPARE = re.compile(r"(?P<ym>\d{4}-\d{2})__(?P<client>.+?)__", re.UNICODE)
RE_YM_JP = re.compile(r"(?P<y>\d{4})年(?P<m>\d{1,2})月")

KPI_KEYS = [
    ("cost", ["費用", "広告費", "ご利用金額", "ご利用額", "合計:費用", "キー合計:費用"]),
    ("impr", ["表示回数", "インプレッション", "imp", "合計:表示回数", "キー合計:表示回数"]),
    ("click", ["クリック数", "クリック", "click", "合計:クリック", "キー合計:クリック"]),
    ("cv", ["コンバージョン", "CV", "成果", "合計:CV", "キー合計:CV"]),
    ("ctr", ["クリック率", "CTR", "合計:CTR", "キー合計:CTR"]),
    ("cpc", ["クリック単価", "CPC", "合計:CPC", "キー合計:CPC"]),
    ("cvr", ["コンバージョン率", "CVR", "合計:CVR", "キー合計:CVR"]),
]

def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]

def read_text_safely(p: Path) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp932"):
        try:
            return p.read_text(encoding=enc)
        except Exception:
            pass
    return p.read_text(errors="replace")

def ym_to_tuple(ym: str) -> Tuple[int, int]:
    m = re.match(r"(\d{4})-(\d{2})", ym)
    if not m:
        return (0, 0)
    return (int(m.group(1)), int(m.group(2)))

def ym_to_jp(ym: str) -> str:
    y, m = ym_to_tuple(ym)
    return f"{y}年{m}月" if y and m else ym

def add_months(ym: str, delta: int) -> str:
    y, m = ym_to_tuple(ym)
    if not y or not m:
        return ""
    idx = y * 12 + (m - 1) + delta
    ny = idx // 12
    nm = idx % 12 + 1
    return f"{ny:04d}-{nm:02d}"

def default_info() -> Dict[str, Any]:
    return {
        "current_path": "",
        "base_path": "",
        "compare_path": "",
        "ym": "",
        "client": "",
        "error": None,
    }

def ensure_info(info: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    base = default_info()
    if isinstance(info, dict):
        base.update(info)
    return base

def parse_audit_info(md_text: str) -> Dict[str, Any]:
    info: Dict[str, Any] = {}
    abs_xlsx = re.findall(r"([A-Za-z]:[\\/][^\r\n]*?\.xlsx)", md_text)
    rel_xlsx = re.findall(r"((?:data[\\/])?[^\s\)\]\"']+?\.xlsx)", md_text)
    if abs_xlsx:
        info["current_path"] = abs_xlsx[0]
        if len(abs_xlsx) >= 2:
            info["base_path"] = abs_xlsx[1]
    elif rel_xlsx:
        info["current_path"] = rel_xlsx[0]
        if len(rel_xlsx) >= 2:
            info["base_path"] = rel_xlsx[1]
    return ensure_info(info)

def resolve_xlsx_path(path_str: str) -> Optional[Path]:
    if not path_str:
        return None
    p = Path(path_str)
    if p.exists():
        return p
    rp = repo_root() / path_str
    return rp if rp.exists() else None

def infer_data_dir() -> Optional[Path]:
    d = repo_root() / "data"
    return d if d.exists() and d.is_dir() else None

def pick_month_from_filename(name: str) -> Optional[str]:
    m = RE_YM_JP.search(name)
    if m:
        y = int(m.group("y"))
        mo = int(m.group("m"))
        return f"{y:04d}-{mo:02d}"
    return None

def find_xlsx_candidates(data_dir: Path, client: str) -> List[Path]:
    if not data_dir.exists():
        return []
    all_xlsx = [p for p in data_dir.rglob("*.xlsx") if p.is_file()]
    if not client:
        return all_xlsx
    return [p for p in all_xlsx if client in p.name]

def build_month_map(paths: List[Path]) -> Dict[str, Path]:
    out: Dict[str, Path] = {}
    for p in paths:
        ym = pick_month_from_filename(p.name)
        if not ym:
            continue
        prev = out.get(ym)
        if prev is None:
            out[ym] = p
        else:
            if len(str(p)) < len(str(prev)):
                out[ym] = p
    return out

def build_info(md_text: str, compare_path: Path) -> Dict[str, Any]:
    info = ensure_info(parse_audit_info(md_text))
    info["compare_path"] = str(compare_path)

    m = RE_COMPARE.search(compare_path.name)
    ym = m.group("ym") if m else ""
    client = m.group("client") if m else ""
    info["ym"] = ym
    info["client"] = client

    cur_p = resolve_xlsx_path(str(info.get("current_path") or ""))
    base_p = resolve_xlsx_path(str(info.get("base_path") or ""))
    info["current_path"] = str(cur_p) if cur_p else str(info.get("current_path") or "")
    info["base_path"] = str(base_p) if base_p else str(info.get("base_path") or "")
    return ensure_info(info)

def runtime_marker() -> None:
    p = Path(__file__).resolve()
    h = hashlib.sha256(p.read_bytes()).hexdigest()[:12]
    st.sidebar.success(f"BOOT: app.py reached ({BOOT_MARKER})\n{p.name} / {h}")

@st.cache_data(show_spinner=False)
def cached_sheet_names(xlsx_str: str) -> List[str]:
    if pd is None:
        return []
    p = Path(xlsx_str)
    try:
        xl = pd.ExcelFile(p)
        return list(xl.sheet_names)
    except Exception:
        return []

@st.cache_data(show_spinner=False)
def cached_read_excel(xlsx_str: str, sheet: str, nrows: int) -> Optional["pd.DataFrame"]:
    if pd is None:
        return None
    p = Path(xlsx_str)
    try:
        return pd.read_excel(p, sheet_name=sheet, nrows=int(nrows))
    except Exception:
        return None

def parse_number(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        try:
            return float(v)
        except Exception:
            return None
    s = str(v).strip()
    if not s:
        return None
    s = s.replace(",", "")
    if s in ("-", "—", "–", "nan", "NaN"):
        return None
    try:
        if s.endswith("%"):
            return float(s[:-1]) / 100.0
        return float(s)
    except Exception:
        return None

def find_kpis_2d(df: "pd.DataFrame") -> Tuple[Dict[str, Any], Dict[str, str]]:
    out: Dict[str, Any] = {k: None for k, _ in KPI_KEYS}
    src: Dict[str, str] = {k: "" for k, _ in KPI_KEYS}
    if df is None or df.empty:
        return out, src

    rmax = min(len(df), 260)
    cmax = min(len(df.columns), 40)

    for r in range(rmax):
        for c in range(cmax):
            cell = df.iat[r, c]
            cell_s = "" if cell is None else str(cell)
            if not cell_s:
                continue

            for key, syns in KPI_KEYS:
                if out.get(key) is not None:
                    continue
                if not any(syn in cell_s for syn in syns):
                    continue

                found = None
                # 右優先 → 右下 → 下
                for rr in range(r, min(r + 6, rmax)):
                    for cc in range(c + 1, min(c + 9, cmax)):
                        n = parse_number(df.iat[rr, cc])
                        if n is not None:
                            found = n
                            break
                    if found is not None:
                        break
                if found is None:
                    for rr in range(r + 1, min(r + 10, rmax)):
                        n = parse_number(df.iat[rr, c])
                        if n is not None:
                            found = n
                            break

                if found is not None:
                    out[key] = found
                    src[key] = "direct"
    # 派生（コード計算＝OK）
    def set_derived(k: str, v: Optional[float]):
        if out.get(k) is None and v is not None:
            out[k] = v
            src[k] = "derived"

    cost = out.get("cost")
    impr = out.get("impr")
    click = out.get("click")
    cv = out.get("cv")

    if isinstance(click, (int, float)) and isinstance(impr, (int, float)) and impr:
        set_derived("ctr", float(click) / float(impr))
    if isinstance(cost, (int, float)) and isinstance(click, (int, float)) and click:
        set_derived("cpc", float(cost) / float(click))
    if isinstance(cv, (int, float)) and isinstance(click, (int, float)) and click:
        set_derived("cvr", float(cv) / float(click))

    return out, src

def extract_kpis_from_xlsx(xlsx: Path, prefer_sheet: str, nrows: int = 260) -> Tuple[str, Dict[str, Any], Dict[str, str], str]:
    if pd is None:
        return ("", {}, {}, "pandas が無いので抽出不可")
    sheets = cached_sheet_names(str(xlsx))
    if not sheets:
        return ("", {}, {}, "シート一覧取得に失敗")
    sheet = prefer_sheet if prefer_sheet in sheets else sheets[0]
    df = cached_read_excel(str(xlsx), sheet, int(nrows))
    if df is None:
        return (sheet, {}, {}, "Excel読込失敗")
    kpis, src = find_kpis_2d(df)
    return (sheet, kpis, src, "")

def df_to_md_table(df: "pd.DataFrame", max_rows: int = 30) -> str:
    cols = list(df.columns)
    rows = df.head(max_rows).values.tolist()
    def esc(x: Any) -> str:
        if x is None:
            return ""
        s = str(x)
        return s.replace("\n", " ").replace("|", "\\|")
    header = "| " + " | ".join(cols) + " |"
    sep = "| " + " | ".join(["---"] * len(cols)) + " |"
    body = "\n".join("| " + " | ".join(esc(v) for v in row) + " |" for row in rows)
    return "\n".join([header, sep, body])

def fmt_pct(x: Optional[float]) -> str:
    if x is None:
        return "None"
    try:
        return f"{x*100:.2f}%"
    except Exception:
        return "None"

def fmt_num(x: Optional[float]) -> str:
    if x is None:
        return "None"
    try:
        if abs(x) >= 1000:
            return f"{x:,.0f}"
        return f"{x:.4g}"
    except Exception:
        return "None"

def local_insight(client: str, ym: str, dfk: Optional["pd.DataFrame"], md_text: str) -> str:
    lines: List[str] = []
    lines.append(f"# 考察（ローカル）: {client} / {ym}")
    lines.append("")
    if dfk is None or dfk.empty:
        lines.append("KPI抽出が空です。左のソースでシート名やExcelプレビューを確認してください。")
        return "\n".join(lines)

    d = dfk.copy()
    d = d[d["error"] == ""]
    if d.empty:
        lines.append("KPI抽出が全件失敗です（error列参照）。シート名が違う可能性が高いです。")
        return "\n".join(lines)

    cur = d.iloc[0].to_dict()
    prev = d.iloc[1].to_dict() if len(d) >= 2 else {}

    def delta(a: Any, b: Any) -> Tuple[Optional[float], Optional[float]]:
        try:
            if a is None or b is None:
                return None, None
            a = float(a); b = float(b)
            diff = a - b
            pct = (diff / b) if b else None
            return diff, pct
        except Exception:
            return None, None

    lines.append("## 直近月 vs 前月（抽出値ベース）")
    for k, label in [("cost", "費用"), ("impr", "表示回数"), ("click", "クリック"), ("cv", "CV"), ("ctr", "CTR"), ("cpc", "CPC"), ("cvr", "CVR")]:
        a = cur.get(k)
        b = prev.get(k) if prev else None
        diff, pct = delta(a, b)
        if k in ("ctr", "cvr"):
            lines.append(f"- {label}: {fmt_pct(a)} / 前月 {fmt_pct(b)} / 差分 {fmt_pct(diff) if diff is not None else 'None'}")
        else:
            lines.append(f"- {label}: {fmt_num(a)} / 前月 {fmt_num(b)} / 差分 {fmt_num(diff)} / 率 {fmt_pct(pct)}")
    lines.append("")
    lines.append("## 半年推移（抽出できている月のみ）")
    try:
        keep = d[["month", "cost", "click", "cv", "ctr", "cpc", "cvr"]].copy()
        lines.append(df_to_md_table(keep, max_rows=12))
    except Exception:
        pass
    lines.append("")
    lines.append("## 根拠（compare Markdownの先頭抜粋）")
    excerpt = "\n".join(md_text.splitlines()[:80])
    lines.append("```markdown")
    lines.append(excerpt)
    lines.append("```")
    return "\n".join(lines)

def gemini_chat(messages: List[Dict[str, str]], system_md: str, model_name: str) -> Tuple[str, str]:
    api_key = os.environ.get("GOOGLE_API_KEY", "")
    if not api_key:
        return ("", "GOOGLE_API_KEY が未設定です（環境変数）")
    try:
        import google.generativeai as genai  # type: ignore
    except Exception as e:
        return ("", f"google-generativeai が使えません: {e}")

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(model_name=model_name)
        prompt = []
        prompt.append("あなたは広告レポートの考察アシスタントです。数値は根拠からのみ述べ、推測は推測と明示。")
        prompt.append("")
        prompt.append("## 根拠（システム側で渡す）")
        prompt.append(system_md)
        prompt.append("")
        prompt.append("## 会話")
        for m in messages[-12:]:
            role = m.get("role", "")
            content = m.get("content", "")
            prompt.append(f"{role.upper()}: {content}")
        resp = model.generate_content("\n".join(prompt))
        text = getattr(resp, "text", "") or ""
        return (text.strip(), "")
    except Exception as e:
        return ("", f"Gemini 呼び出し失敗: {e}")

def main() -> None:
    st.set_page_config(page_title="ads-insights (NotebookLM style)", layout="wide")
    runtime_marker()

    root = repo_root()
    compare_dir = root / "compare"

    if "chat_messages" not in st.session_state:
        st.session_state["chat_messages"] = []
    if "insight_md" not in st.session_state:
        st.session_state["insight_md"] = "左のソースを選んで、右のチャットで依頼するとここに考察が出ます。"
    if "source_pick" not in st.session_state:
        st.session_state["source_pick"] = "compare"

    col_src, col_mid, col_chat = st.columns([0.95, 1.25, 0.95], gap="large")

    with col_src:
        st.markdown("## ソース")
        if not compare_dir.exists():
            st.error(f"compare/ が見つかりません: {compare_dir}")
            return
        md_files = sorted([p for p in compare_dir.rglob("*point-pack.md") if p.is_file()], key=lambda p: p.name)
        if not md_files:
            st.warning(f"compare/**/*point-pack.md がありません: {compare_dir}")
            return

        pick = st.selectbox("compare を選択", [p.relative_to(compare_dir).as_posix() for p in md_files], index=0, key="compare_pick")
        compare_path = compare_dir / pick
        md_text = ""
        try:
            md_text = read_text_safely(compare_path)
        except Exception as e:
            st.error(f"Markdown読込失敗: {e}")
            return

        info = build_info(md_text, compare_path)
        ym = str(info.get("ym") or "")
        client = str(info.get("client") or "")
        cur_path = str(info.get("current_path") or "")
        base_path = str(info.get("base_path") or "")

        data_dir = infer_data_dir()
        cand: List[Path] = []
        month_map: Dict[str, Path] = {}
        months: List[str] = []
        if data_dir:
            cand = find_xlsx_candidates(data_dir, client)
            month_map = build_month_map(cand)
        if ym:
            months = [add_months(ym, -i) for i in range(0, 7)]

        src_opts: List[Tuple[str, str]] = []
        src_opts.append(("compare", f"compare: {pick}"))
        for m in months:
            p = month_map.get(m)
            label = f"xlsx: {m} / {'OK' if (p and p.exists()) else 'なし'}"
            src_opts.append((f"xlsx:{m}", label))

        value_to_label = {v: lab for v, lab in src_opts}
        labels = [lab for _, lab in src_opts]
        cur_val = st.session_state.get("source_pick", "compare")
        cur_label = value_to_label.get(cur_val, labels[0])

        chosen_label = st.radio("ソース一覧", labels, index=labels.index(cur_label) if cur_label in labels else 0)
        chosen_val = [v for v, lab in src_opts if lab == chosen_label][0]
        st.session_state["source_pick"] = chosen_val

        st.caption(f"client={client or '-'} / ym={ym or '-'}")
        st.caption(f"current_path={cur_path or 'None'}")
        st.caption(f"base_path={base_path or 'None'}")

        st.divider()
        if chosen_val == "compare":
            st.markdown("### compare（Markdown）")
            st.code(md_text, language="markdown")
        else:
            m = chosen_val.split(":", 1)[1]
            p = month_map.get(m)
            st.markdown(f"### xlsx（{m}）")
            if not p or not p.exists():
                st.warning("この月のxlsxは見つかっていません（data配下を確認）")
            else:
                st.write(str(p))
                if pd is None:
                    st.warning("pandas が無いのでプレビュー不可")
                else:
                    sheets = cached_sheet_names(str(p))
                    if not sheets:
                        st.warning("シート一覧取得に失敗")
                    else:
                        sh = st.selectbox("sheet", sheets, index=0, key=f"src_sheet_{m}")
                        n = st.number_input("表示行数", min_value=20, max_value=2000, value=200, step=20, key=f"src_n_{m}")
                        df = cached_read_excel(str(p), sh, int(n))
                        if df is None:
                            st.warning("Excel読込失敗")
                        else:
                            st.dataframe(df, width="stretch", hide_index=True)

        st.divider()
        st.markdown("### 半年分のxlsx（検算のための一覧）")
        rows = []
        for m in months:
            p = month_map.get(m)
            rows.append({"month": m, "xlsx": str(p) if p else "", "exists": bool(p and p.exists())})
        if pd is not None and rows:
            st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)
        else:
            st.write(rows)

    with col_mid:
        st.markdown("## 考察")
        st.markdown(st.session_state.get("insight_md", ""), unsafe_allow_html=False)

        st.divider()
        st.markdown("### KPI抽出（半年比較の“検算用”）")

        prefer_sheet = st.text_input("対象シート名（例: media）", value="media", key="kpi_sheet_name")
        nrows = st.number_input("抽出に使う先頭行数", min_value=80, max_value=1200, value=260, step=20, key="kpi_nrows")

        dfk = None
        try:
            root = repo_root()
            compare_dir = root / "compare"
            pick = st.session_state.get("compare_pick", "")
            compare_path = compare_dir / pick if pick else None
            if compare_path and compare_path.exists():
                md_text = read_text_safely(compare_path)
                info = build_info(md_text, compare_path)
                ym = str(info.get("ym") or "")
                client = str(info.get("client") or "")

                data_dir = infer_data_dir()
                if data_dir and ym:
                    cand = find_xlsx_candidates(data_dir, client)
                    month_map = build_month_map(cand)
                    months = [add_months(ym, -i) for i in range(0, 7)]
                    kpi_rows = []
                    src_rows = []

                    for m in months:
                        p = month_map.get(m)
                        if not p or not p.exists():
                            kpi_rows.append({"month": m, "xlsx": "", "sheet": "", "error": "xlsxなし"})
                            continue
                        sheet, kpis, src, err = extract_kpis_from_xlsx(p, prefer_sheet, int(nrows))
                        row = {
                            "month": m,
                            "xlsx": p.name,
                            "sheet": sheet,
                            "error": err,
                            "cost": kpis.get("cost"),
                            "impr": kpis.get("impr"),
                            "click": kpis.get("click"),
                            "cv": kpis.get("cv"),
                            "ctr": kpis.get("ctr"),
                            "cpc": kpis.get("cpc"),
                            "cvr": kpis.get("cvr"),
                        }
                        kpi_rows.append(row)

                    if pd is not None:
                        dfk = pd.DataFrame(kpi_rows)
                        st.dataframe(dfk, width="stretch", hide_index=True)

                        ok = dfk[dfk["error"] == ""]
                        st.caption(f"抽出OK: {len(ok)}/{len(dfk)}（Noneが多い=抽出ロジック改善が必要）")
                else:
                    st.warning("ym が取れないため半年抽出はスキップ（compare名の年月が前提）")
        except Exception as e:
            st.warning(f"KPI抽出で例外（継続）: {e}")

        if st.button("ローカルで考察を作る（API無しでも動く）", use_container_width=True, key="make_local_insight"):
            try:
                root = repo_root()
                compare_dir = root / "compare"
                pick = st.session_state.get("compare_pick", "")
                compare_path = compare_dir / pick if pick else None
                md_text = read_text_safely(compare_path) if compare_path and compare_path.exists() else ""
                info = build_info(md_text, compare_path) if compare_path else default_info()
                ym = str(info.get("ym") or "")
                client = str(info.get("client") or "")
                st.session_state["insight_md"] = local_insight(client, ym, dfk, md_text)
            except Exception as e:
                st.warning(f"ローカル考察生成に失敗（継続）: {e}")

    with col_chat:
        st.markdown("## チャット（API）")
        provider = st.selectbox("プロバイダ", ["Gemini", "ローカル"], index=0, key="chat_provider")
        model_name = st.text_input("モデル名", value="gemini-2.5-flash", key="chat_model")

        msgs: List[Dict[str, str]] = st.session_state.get("chat_messages", [])

        chat_box = st.container(height=520)
        with chat_box:
            if msgs:
                for m in msgs[-30:]:
                    role = m.get("role", "user")
                    content = m.get("content", "")
                    with st.chat_message(role):
                        st.markdown(content)
            else:
                st.info("ここに会話が出ます。右下の入力から送信。")

        user_text = st.text_area("入力", value="", height=120, key="chat_input")

        c1, c2 = st.columns([1, 1])
        send = c1.button("送信", use_container_width=True, key="chat_send")
        clear = c2.button("履歴クリア", use_container_width=True, key="chat_clear")

        if clear:
            st.session_state["chat_messages"] = []
            st.session_state["insight_md"] = "左のソースを選んで、右のチャットで依頼するとここに考察が出ます。"
            st.rerun()

        if send:
            text = (user_text or "").strip()
            if not text:
                st.warning("空です")
            else:
                msgs.append({"role": "user", "content": text})
                st.session_state["chat_messages"] = msgs

                try:
                    root = repo_root()
                    compare_dir = root / "compare"
                    pick = st.session_state.get("compare_pick", "")
                    compare_path = compare_dir / pick if pick else None
                    md_text = read_text_safely(compare_path) if compare_path and compare_path.exists() else ""
                    info = build_info(md_text, compare_path) if compare_path else default_info()
                    ym = str(info.get("ym") or "")
                    client = str(info.get("client") or "")

                    system_md_parts = []
                    system_md_parts.append(f"client={client} / ym={ym}")
                    system_md_parts.append("")
                    system_md_parts.append("### compare（Markdown）")
                    system_md_parts.append(md_text[:12000])
                    system_md_parts.append("")
                    system_md = "\n".join(system_md_parts)

                    if provider == "Gemini":
                        reply, err = gemini_chat(msgs, system_md, model_name)
                        if err:
                            st.warning(err)
                            reply = local_insight(client, ym, None, md_text)
                    else:
                        reply = local_insight(client, ym, None, md_text)

                    msgs.append({"role": "assistant", "content": reply})
                    st.session_state["chat_messages"] = msgs
                    st.session_state["insight_md"] = reply
                    st.rerun()
                except Exception as e:
                    st.warning(f"チャット処理で例外（継続）: {e}")

main()


# --- Gemini Insights API (auto-added) ---



