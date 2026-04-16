from __future__ import annotations

import os
import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(page_title="広告レポート考察スタジオ", layout="wide")

ui_host = os.environ.get("ADS_INSIGHTS_UI_HOST", "http://127.0.0.1:8000/")
st.caption(f"UI Host: {ui_host}  （表示が真っ白なら proxy_ui_server.py を起動）")
components.iframe(ui_host, height=920, scrolling=True)
