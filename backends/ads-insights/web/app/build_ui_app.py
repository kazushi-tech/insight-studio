from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict

# make repo root importable
REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from flask import Flask, jsonify, request, Response

from web.app import gemini_client as gc

COMPARE = REPO / "compare"
INSIGHTS = REPO / "insights"
CACHE_DIR = REPO / ".cache" / "gemini_ui"

app = Flask(__name__)


def read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8-sig")


def write_text(p: Path, s: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(s, encoding="utf-8-sig")


def insights_name_for_point_pack(pp_name: str) -> str:
    if pp_name.endswith("__point-pack.md"):
        return pp_name.replace("__point-pack.md", "__insights.md")
    base = Path(pp_name).stem
    return base + "__insights.md"


def validations(point_pack_md: str, insights_md: str) -> Dict[str, Any]:
    kpi_table = gc.extract_kpi_table(point_pack_md)
    allowed_kpis = gc.extract_kpis_from_table(kpi_table)
    allowed_numbers = gc.extract_allowed_numbers(point_pack_md)
    vr = gc.validate_final_output(
        final_md=insights_md,
        point_pack_md=point_pack_md,
        allowed_numbers=allowed_numbers,
        allowed_kpis=allowed_kpis,
    )
    return {
        "ok": vr.ok,
        "reasons": vr.reasons,
        "new_numbers": vr.new_numbers,
        "bad_kpis": vr.bad_kpis,
        "allowed_kpis": sorted(list(allowed_kpis)),
    }


@app.get("/")
def index() -> Response:
    html = """<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>ads-insights UI</title>
  <style>
    :root{
      --bg:#0b0f14; --panel:#0f1620; --panel2:#0c121a; --border:#1e2a3a;
      --text:#e8eef6; --muted:rgba(232,238,246,.72);
      --blue:#1a73e8; --ok:#7ee787; --ng:#ff7b72;
      --shadow: 0 10px 30px rgba(0,0,0,.35);
      --r:16px;
    }
    *{ box-sizing:border-box; }
    body{ margin:0; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; background:var(--bg); color:var(--text); }
    header{
      position:sticky; top:0; z-index:10;
      padding:14px 18px; border-bottom:1px solid var(--border);
      background:rgba(11,15,20,.92); backdrop-filter: blur(10px);
      display:flex; gap:14px; align-items:center;
    }
    header h1{ font-size:16px; margin:0; letter-spacing:.2px; }
    header .sub{ color:var(--muted); font-size:12px; }
    main{ display:grid; grid-template-columns:360px 1fr; min-height:calc(100vh - 56px); }
    .sidebar{
      border-right:1px solid var(--border);
      padding:14px;
      background:linear-gradient(180deg, rgba(15,22,32,.9), rgba(11,15,20,.9));
      overflow:auto;
    }
    .panel{ padding:14px; overflow:auto; }
    .card{ border:1px solid var(--border); background:var(--panel); border-radius:var(--r); padding:12px; box-shadow:var(--shadow); margin-bottom:12px; }
    .label{ color:var(--muted); font-size:12px; margin-bottom:8px; }
    select, button, textarea, input{
      width:100%; border-radius:14px; border:1px solid var(--border);
      background:var(--panel2); color:var(--text); padding:10px 12px; font-size:13px; outline:none;
    }
    textarea{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; line-height:1.45; min-height:68vh; resize:vertical; }
    button{ cursor:pointer; transition:transform .03s ease, opacity .2s ease; user-select:none; }
    button:active{ transform:translateY(1px); }
    .row{ display:flex; gap:10px; }
    .row > *{ flex:1; }
    .btn-primary{ background:var(--blue); border-color:var(--blue); font-weight:700; }
    .btn-ghost{ background:transparent; }
    .pill{ display:inline-flex; align-items:center; gap:8px; padding:8px 10px; border:1px solid var(--border); border-radius:999px; font-size:12px; color:var(--muted); background:rgba(15,22,32,.6); }
    .status-ok{ color:var(--ok); font-weight:900; }
    .status-ng{ color:var(--ng); font-weight:900; }
    .val{ font-size:13px; line-height:1.5; word-break:break-word; }
    .val ul{ margin:8px 0 0 18px; padding:0; color:var(--ng); }
    .val code{ color:rgba(232,238,246,.88); }
    .log{
      white-space:pre-wrap; font-size:12px; color:var(--muted);
      max-height:200px; overflow:auto; border-radius:14px; padding:10px;
      background:rgba(12,18,26,.7); border:1px solid var(--border);
    }
    .grid2{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .titlebar{ display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
    .titlebar .t{ font-size:12px; color:var(--muted); }
    .mini{ width:auto; padding:8px 10px; border-radius:12px; font-size:12px; }
    .kv{ display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
    .hint{ color:var(--muted); font-size:12px; margin-top:8px; }
    @media (max-width:1100px){
      main{ grid-template-columns:1fr; }
      .sidebar{ border-right:none; border-bottom:1px solid var(--border); }
      .grid2{ grid-template-columns:1fr; }
      textarea{ min-height:42vh; }
    }
  </style>
</head>
<body>
  <header>
    <h1>ads-insights / KPI引用固定 + 捏造防止ゲート</h1>
    <div class="sub">compare → insights をUIで操作（整形=API無し / 生成=Gemini / 保存=検証OKのみ）</div>
  </header>

  <main>
    <div class="sidebar">
      <div class="card">
        <div class="label">Point-pack を選択</div>
        <select id="ppSelect"></select>
        <div style="height:10px"></div>
        <button id="btnLoad" class="btn-ghost">読み込み</button>
      </div>

      <div class="card">
        <div class="label">生成設定</div>
        <div class="kv">
          <div>
            <div class="label" style="margin-bottom:6px">モデル</div>
            <select id="model">
              <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite（安い）</option>
              <option value="gemini-2.5-flash">gemini-2.5-flash（強い）</option>
              <option value="gemini-2.5-flash-preview-09-2025">gemini-2.5-flash-preview-09-2025</option>
            </select>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px">temperature</div>
            <input id="temp" type="number" min="0" max="1" step="0.05" value="0.2"/>
          </div>
        </div>
        <div style="height:10px"></div>
        <label class="pill" style="width:100%;justify-content:space-between">
          <span>キャッシュを使う（同一入力の再生成を回避）</span>
          <input id="useCache" type="checkbox" checked style="width:auto"/>
        </label>
        <div class="hint">普段は「整形→保存」。必要な月だけ「生成」。</div>
      </div>

      <div class="card">
        <div class="label">操作</div>
        <div class="row">
          <button id="btnEnsure" class="btn-ghost">整形（APIなし）</button>
          <button id="btnValidate" class="btn-ghost">検証</button>
        </div>
        <div style="height:10px"></div>
        <button id="btnGen" class="btn-primary">生成（Gemini）</button>
        <div style="height:10px"></div>
        <button id="btnSave" class="btn-ghost">保存（検証OKのみ）</button>
      </div>

      <div class="card">
        <div class="label">検証結果</div>
        <div id="valBox" class="val"></div>
      </div>

      <div class="card">
        <div class="label">ログ</div>
        <div id="log" class="log"></div>
      </div>
    </div>

    <div class="panel">
      <div class="grid2">
        <div class="card">
          <div class="titlebar">
            <div class="t">point-pack（入力）</div>
            <button id="btnCopyPP" class="mini btn-ghost">コピー</button>
          </div>
          <textarea id="ppText" placeholder="point-pack を貼り付けてもOK"></textarea>
        </div>

        <div class="card">
          <div class="titlebar">
            <div class="t">insights（出力/編集可）</div>
            <button id="btnCopyINS" class="mini btn-ghost">コピー</button>
          </div>
          <textarea id="insText" placeholder="ここに生成結果が入ります"></textarea>
        </div>
      </div>
    </div>
  </main>

<script>
  const el = (id)=>document.getElementById(id);
  const log = (s)=>{
    const cur = el("log").textContent || "";
    el("log").textContent = (cur + "\\n" + s).trim();
  };

  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: body ? {"Content-Type":"application/json"} : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(()=>({ok:false,error:"invalid json response"}));
    if (!res.ok || data.ok === false) {
      const err = data.error || ("HTTP " + res.status);
      const extra = data.validations ? ("\\n" + JSON.stringify(data.validations, null, 2)) : "";
      throw new Error(err + extra);
    }
    return data;
  }

  function esc(s){ return (s||"").toString().replaceAll("<","&lt;").replaceAll(">","&gt;"); }

  function renderVal(v){
    const cls = v.ok ? "status-ok" : "status-ng";
    const lines = [];
    lines.push(`<div class="${cls}">${v.ok ? "OK" : "NG"}</div>`);

    if (v.reasons && v.reasons.length){
      lines.push("<ul>" + v.reasons.map(x=>`<li>${esc(x)}</li>`).join("") + "</ul>");
    }
    if (v.new_numbers && v.new_numbers.length){
      lines.push(`<div style="margin-top:10px;color:var(--ng)"><b>新規数値</b>: <code>${esc(v.new_numbers.join(", "))}</code></div>`);
    }
    if (v.bad_kpis && v.bad_kpis.length){
      lines.push(`<div style="margin-top:6px;color:var(--ng)"><b>禁止KPI</b>: <code>${esc(v.bad_kpis.join(", "))}</code></div>`);
    }
    if (v.allowed_kpis){
      lines.push(`<div style="margin-top:10px;color:rgba(232,238,246,.72);font-size:12px;">許可KPI: ${esc(v.allowed_kpis.join(", ") || "(なし)")}</div>`);
    }
    el("valBox").innerHTML = lines.join("");
  }

  async function refreshList(){
    const d = await api("/api/list_point_packs");
    if (!d.items || d.items.length === 0){
      el("ppSelect").innerHTML = `<option value="">(point-pack がありません)</option>`;
      return;
    }
    el("ppSelect").innerHTML = d.items.map(x=>`<option value="${x}">${x}</option>`).join("");
  }

  async function loadSelected(){
    const name = el("ppSelect").value;
    if (!name){ return; }
    const d = await api("/api/load", { point_pack_name: name });
    el("ppText").value = d.point_pack_md || "";
    el("insText").value = d.insights_md || "";
    renderVal(d.validations);
    log("loaded: " + name);
  }

  async function ensureLocal(){
    const d = await api("/api/ensure_kpi_quote", {
      point_pack_md: el("ppText").value,
      insights_md: el("insText").value
    });
    el("insText").value = d.insights_md;
    renderVal(d.validations);
    log("ensure_kpi_quote: done");
  }

  async function validate(){
    const d = await api("/api/validate", {
      point_pack_md: el("ppText").value,
      insights_md: el("insText").value
    });
    renderVal(d.validations);
    log("validate: done");
  }

  async function generate(){
    const d = await api("/api/generate_insights", {
      point_pack_md: el("ppText").value,
      model: el("model").value,
      temperature: Number(el("temp").value || 0.2),
      use_cache: el("useCache").checked
    });
    el("insText").value = d.insights_md;
    renderVal(d.validations);
    log(`generate_insights: done (model=${d.model}, cached=${d.cached})`);
  }

  async function save(){
    const name = el("ppSelect").value || "manual__point-pack.md";
    const d = await api("/api/save", {
      point_pack_name: name,
      point_pack_md: el("ppText").value,
      insights_md: el("insText").value,
      force_save: false
    });
    renderVal(d.validations);
    log("saved: " + d.saved_path);
  }

  async function copyText(id){
    const t = el(id).value || "";
    await navigator.clipboard.writeText(t);
    log("copied: " + id);
  }

  el("btnLoad").onclick = ()=>loadSelected().catch(e=>log("[ERR] " + e.message));
  el("btnEnsure").onclick = ()=>ensureLocal().catch(e=>log("[ERR] " + e.message));
  el("btnValidate").onclick = ()=>validate().catch(e=>log("[ERR] " + e.message));
  el("btnGen").onclick = ()=>generate().catch(e=>log("[ERR] " + e.message));
  el("btnSave").onclick = ()=>save().catch(e=>log("[ERR] " + e.message));
  el("btnCopyPP").onclick = ()=>copyText("ppText").catch(e=>log("[ERR] " + e.message));
  el("btnCopyINS").onclick = ()=>copyText("insText").catch(e=>log("[ERR] " + e.message));

  refreshList().then(loadSelected).catch(e=>log("[ERR] " + e.message));
</script>
</body>
</html>
"""
    return Response(html, mimetype="text/html")


@app.get("/api/list_point_packs")
def list_point_packs():
    items = sorted([p.name for p in COMPARE.glob("*__point-pack.md")]) if COMPARE.exists() else []
    return jsonify({"ok": True, "items": items})


@app.post("/api/load")
def load():
    j = request.get_json(force=True)
    name = j.get("point_pack_name", "")
    pp = COMPARE / name
    if not pp.exists():
        return jsonify({"ok": False, "error": f"point-pack not found: {name}"}), 404

    pp_md = read_text(pp)

    ins_name = insights_name_for_point_pack(name)
    ins_path = INSIGHTS / ins_name
    ins_md = read_text(ins_path) if ins_path.exists() else "## TL;DR\n\n- （未生成）\n"

    ins_md = gc.ensure_kpi_quote(pp_md, ins_md)
    v = validations(pp_md, ins_md)
    return jsonify({"ok": True, "point_pack_md": pp_md, "insights_md": ins_md, "validations": v})


@app.post("/api/ensure_kpi_quote")
def ensure():
    j = request.get_json(force=True)
    pp_md = j.get("point_pack_md", "")
    ins_md = j.get("insights_md", "")
    if not pp_md.strip():
        return jsonify({"ok": False, "error": "point_pack_md is empty"}), 400
    patched = gc.ensure_kpi_quote(pp_md, ins_md or "## TL;DR\n\n- （未生成）\n")
    v = validations(pp_md, patched)
    return jsonify({"ok": True, "insights_md": patched, "validations": v})


@app.post("/api/validate")
def validate():
    j = request.get_json(force=True)
    pp_md = j.get("point_pack_md", "")
    ins_md = j.get("insights_md", "")
    if not pp_md.strip():
        return jsonify({"ok": False, "error": "point_pack_md is empty"}), 400
    if not ins_md.strip():
        return jsonify({"ok": False, "error": "insights_md is empty"}), 400
    v = validations(pp_md, ins_md)
    return jsonify({"ok": True, "validations": v})


@app.post("/api/generate_insights")
def gen():
    j = request.get_json(force=True)
    pp_md = j.get("point_pack_md", "")
    if not pp_md.strip():
        return jsonify({"ok": False, "error": "point_pack_md is empty"}), 400

    model = (j.get("model") or os.getenv("GEMINI_MODEL") or "gemini-2.5-flash-lite").strip()
    temperature = float(j.get("temperature") if j.get("temperature") is not None else os.getenv("GEMINI_TEMPERATURE", "0.2"))
    use_cache = bool(j.get("use_cache", True))

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_key = hashlib.sha256((model + "|" + str(temperature) + "|" + pp_md).encode("utf-8")).hexdigest()
    cache_path = CACHE_DIR / f"{cache_key}.json"

    cached = False
    if use_cache and cache_path.exists():
        data = json.loads(cache_path.read_text(encoding="utf-8-sig"))
        out = data.get("insights_md", "")
        cached = True
    else:
        try:
            out = gc.generate_insights_from_point_pack(pp_md, model=model, temperature=temperature, debug_name="ui")
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
        cache_path.write_text(json.dumps({"insights_md": out}, ensure_ascii=False), encoding="utf-8-sig")

    out = gc.ensure_kpi_quote(pp_md, out)
    v = validations(pp_md, out)
    return jsonify({"ok": True, "insights_md": out, "validations": v, "model": model, "cached": cached})


@app.post("/api/save")
def save():
    j = request.get_json(force=True)
    pp_name = j.get("point_pack_name", "manual__point-pack.md")
    pp_md = j.get("point_pack_md", "")
    ins_md = j.get("insights_md", "")
    force_save = bool(j.get("force_save", False))

    if not ins_md.strip():
        return jsonify({"ok": False, "error": "insights_md is empty"}), 400
    if not pp_md.strip():
        # fallback: load by name
        pp = COMPARE / pp_name
        if not pp.exists():
            return jsonify({"ok": False, "error": "point_pack_md is empty and point-pack file not found"}), 400
        pp_md = read_text(pp)

    ins_md = gc.ensure_kpi_quote(pp_md, ins_md)
    v = validations(pp_md, ins_md)

    if (not v["ok"]) and (not force_save):
        return jsonify({"ok": False, "error": "検証NGのため保存を拒否しました（force_save=trueで上書き可）", "validations": v}), 400

    name = insights_name_for_point_pack(pp_name)
    path = INSIGHTS / name
    write_text(path, ins_md)
    return jsonify({"ok": True, "saved_path": str(path), "validations": v})


if __name__ == "__main__":
    INSIGHTS.mkdir(parents=True, exist_ok=True)
    app.run(host="127.0.0.1", port=5000, debug=True)
