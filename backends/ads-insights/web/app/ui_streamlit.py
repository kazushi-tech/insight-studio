from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from urllib import request, error

import streamlit as st


def repo_root() -> Path:
    # web/app/ui_streamlit.py -> app -> web -> repo
    return Path(__file__).resolve().parents[2]


def list_point_packs_local() -> list[str]:
    root = repo_root()
    compare = root / "compare"
    if not compare.exists():
        return []
    items = sorted(compare.rglob("*point-pack.md"), key=lambda p: p.name)
    return [str(p) for p in items]


def http_json(method: str, url: str, payload: dict | None = None, timeout: int = 180) -> dict:
    body = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"

    req = request.Request(url=url, data=body, headers=headers, method=method.upper())
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            try:
                return json.loads(raw)
            except Exception:
                return {"ok": False, "error": "invalid_json", "detail": raw}
    except error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace") if hasattr(e, "read") else str(e)
        return {"ok": False, "error": "http_error", "status_code": getattr(e, "code", None), "detail": raw}
    except Exception as e:
        return {"ok": False, "error": "request_failed", "detail": repr(e)}


def extract_audit_pair(text: str, label: str) -> tuple[int | None, int | None]:
    # | キー合計:費用 | 141,383 | 141,769 |
    pat = rf"\|\s*{re.escape(label)}\s*\|\s*([0-9,]+)\s*\|\s*([0-9,]+)\s*\|"
    m = re.search(pat, text)
    if not m:
        return None, None
    a = int(m.group(1).replace(",", ""))
    b = int(m.group(2).replace(",", ""))
    return a, b


def extract_kpi_row(text: str, kpi: str) -> dict | None:
    # | 費用 | 141,383 | 141,769 | -386.4 | -0.27% |
    pat = rf"\|\s*{re.escape(kpi)}\s*\|\s*([^\|]+)\|\s*([^\|]+)\|\s*([^\|]+)\|\s*([^\|]+)\|"
    m = re.search(pat, text)
    if not m:
        return None
    return {"current": m.group(1).strip(), "prev": m.group(2).strip(), "diff": m.group(3).strip(), "rate": m.group(4).strip()}


st.set_page_config(page_title="ads-insights UI (Streamlit)", layout="wide")
st.title("ads-insights / 考察生成UI（Streamlit）")

backend_base = st.sidebar.text_input("Backend URL", value=os.environ.get("ADS_BACKEND_URL", "http://127.0.0.1:8001"))
gen_url = backend_base.rstrip("/") + "/api/generate_insights"

st.sidebar.markdown("### 入力")
pps = list_point_packs_local()
if not pps:
    st.sidebar.warning("compare/ に point-pack.md が見つかりません")
pp = st.sidebar.selectbox("point-pack", options=pps, index=0 if pps else None)

model = st.sidebar.selectbox("model", options=["gemini-2.5-flash"], index=0)
temperature = st.sidebar.slider("temperature", min_value=0.0, max_value=1.0, value=0.7, step=0.05)
message = st.sidebar.text_area("message（任意）", value="", height=120)

run = st.sidebar.button("生成する", type="primary", use_container_width=True)

left, right = st.columns([1, 1])

if run:
    if not pp:
        st.error("point-pack を選んでください")
    else:
        payload = {"point_pack_path": pp, "message": message, "model": model, "temperature": temperature}
        with st.spinner("生成中..."):
            t0 = time.time()
            resp = http_json("POST", gen_url, payload=payload, timeout=300)
            dt_sec = time.time() - t0

        st.session_state["last_resp"] = resp
        st.session_state["last_dt"] = dt_sec
        st.session_state["last_pp"] = pp

resp = st.session_state.get("last_resp")
dt_sec = st.session_state.get("last_dt")
last_pp = st.session_state.get("last_pp")

with left:
    st.subheader("結果")
    if resp is None:
        st.info("左の「生成する」を押すと結果がここに出ます。")
    else:
        ok = bool(resp.get("ok"))
        st.write(f"point-pack: `{last_pp}`")
        st.write(f"elapsed: **{dt_sec:.2f}s**")
        if ok:
            st.success("ok:true")
            text = resp.get("text", "")
            st.markdown(text)
            st.download_button("Markdownを保存", data=text.encode("utf-8"), file_name="insights.md", mime="text/markdown")
        else:
            st.error(f"ok:false / error={resp.get('error')}")
            if resp.get("hint"):
                st.warning(resp.get("hint"))
            if resp.get("detail"):
                st.code(resp.get("detail"))
            if resp.get("upstream_error_body"):
                st.code(resp.get("upstream_error_body"))

with right:
    st.subheader("監査・精度チェック（簡易）")
    if resp and resp.get("ok") and resp.get("text"):
        text = resp["text"]

        # audit sums
        cost_cur, cost_prev = extract_audit_pair(text, "キー合計:費用")
        clk_cur, clk_prev = extract_audit_pair(text, "キー合計:クリック")
        cv_cur, cv_prev = extract_audit_pair(text, "キー合計:CV")

        st.markdown("### 監査ログ（キー合計）")
        st.write({
            "cost": (cost_cur, cost_prev),
            "click": (clk_cur, clk_prev),
            "cv": (cv_cur, cv_prev),
        })

        st.markdown("### 自動計算（監査ログから再計算）")
        def show_diff(name, cur, prev):
            if cur is None or prev is None:
                st.write(f"- {name}: 監査ログが見つからない")
                return
            diff = cur - prev
            rate = (diff / prev * 100) if prev != 0 else None
            st.write(f"- {name}: diff={diff} / rate={rate:.2f}%" if rate is not None else f"- {name}: diff={diff} / rate=算出不可")

        show_diff("費用", cost_cur, cost_prev)
        show_diff("クリック", clk_cur, clk_prev)
        show_diff("CV", cv_cur, cv_prev)

        st.markdown("### KPI表（生成テキスト内）との突合（表示確認用）")
        for kpi in ["費用", "クリック", "CV", "CTR", "CVR", "CPA"]:
            row = extract_kpi_row(text, kpi)
            if row:
                st.write({kpi: row})

        st.markdown("### 生JSON（デバッグ）")
        st.json(resp)
    elif resp:
        st.info("ok:true の時だけ監査チェックを表示します。")
        st.json(resp)
