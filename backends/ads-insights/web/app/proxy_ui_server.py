from __future__ import annotations

import logging
import mimetypes
import os
import socket
import time
from pathlib import Path
from typing import Dict, Iterable, Tuple
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

# --- MIME: .ts/.tsx を JS として返す（StaticFiles の推測がブレるのを潰す）
mimetypes.add_type("application/javascript", ".ts")
mimetypes.add_type("application/javascript", ".tsx")

log = logging.getLogger("ads_insights.proxy")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())

THIS_DIR = Path(__file__).resolve().parent
UI_DIR = (THIS_DIR / ".." / "..").resolve()

BACKEND_ORIGIN = os.getenv("ADS_BACKEND_ORIGIN", "http://127.0.0.1:8001").rstrip("/")

def _tcp_check(origin: str, timeout: float = 0.5) -> Tuple[bool, str]:
    try:
        u = urlparse(origin)
        host = u.hostname or "127.0.0.1"
        port = u.port or (443 if u.scheme == "https" else 80)
        with socket.create_connection((host, port), timeout=timeout):
            return True, f"{host}:{port}"
    except Exception as e:
        return False, str(e)

def _safe_headers(h: Dict[str, str]) -> Dict[str, str]:
    drop = {"host", "content-length", "connection"}
    out: Dict[str, str] = {}
    for k, v in h.items():
        if k.lower() in drop:
            continue
        out[k] = v
    return out

# httpx があればフル対応、なければ GET/POST(最小) だけ stdlib で生存（依存追加しない）
try:
    import httpx  # type: ignore
    _HAS_HTTPX = True
except Exception:
    _HAS_HTTPX = False


app = FastAPI()


@app.get("/health")
def health() -> Dict[str, object]:
    backend_ok, backend_detail = _tcp_check(BACKEND_ORIGIN)
    index_html = UI_DIR / "index.html"
    index_tsx = UI_DIR / "index.tsx"
    return {
        "ok": True,
        "ts": time.time(),
        "backend_origin": BACKEND_ORIGIN,
        "backend_tcp_ok": backend_ok,
        "backend_tcp_detail": backend_detail,
        "ui_dir": str(UI_DIR),
        "ui_exists": UI_DIR.exists(),
        "index_html_exists": index_html.exists(),
        "index_tsx_exists": index_tsx.exists(),
    }


# --- UI: ルートは明示で index.html を返す（cwdやStaticFiles挙動に依存しない）
@app.get("/")
def ui_root():
    index_html = UI_DIR / "index.html"
    if not index_html.exists():
        return PlainTextResponse(f"UI index.html not found: {index_html}", status_code=500)
    return FileResponse(str(index_html), media_type="text/html; charset=utf-8")


# --- 既にやってる “index.tsx を application/javascript で返す” を確実化（StaticFilesの前）
@app.get("/index.tsx")
def ui_index_tsx():
    p = UI_DIR / "index.tsx"
    if not p.exists():
        return PlainTextResponse(f"not found: {p}", status_code=404)
    return FileResponse(str(p), media_type="application/javascript")

@app.get("/index.ts")
def ui_index_ts():
    p = UI_DIR / "index.ts"
    if not p.exists():
        return PlainTextResponse(f"not found: {p}", status_code=404)
    return FileResponse(str(p), media_type="application/javascript")

@app.get("/index.css")
def ui_index_css():
    # ログうざいなら空で返す（必要なら本物のcssを置く）
    return Response(content="", media_type="text/css")

@app.get("/favicon.ico")
def favicon():
    return Response(content=b"", media_type="image/x-icon")


# --- API proxy: ここで落ちないように “必ず 502 を返す” に寄せる
@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def api_proxy(path: str, request: Request):
    upstream = f"{BACKEND_ORIGIN}/api/{path}".rstrip("/")
    try:
        body = await request.body()
        headers = _safe_headers(dict(request.headers))
        params = dict(request.query_params)

        if _HAS_HTTPX:
            # タイムアウトを300秒（5分）に大幅延長
            timeout = float(os.getenv("ADS_PROXY_TIMEOUT", "300"))
            async with httpx.AsyncClient(timeout=timeout) as client:  # type: ignore
                try:
                    r = await client.request(
                        request.method,
                        upstream,
                        params=params,
                        content=body,
                        headers=headers,
                    )
                    resp_headers = {}
                    for k, v in r.headers.items():
                        kl = k.lower()
                        if kl in ("content-type", "cache-control"):
                            resp_headers[k] = v
                    resp_headers["x-ads-proxy"] = "1"
                    return Response(content=r.content, status_code=r.status_code, headers=resp_headers)
                except httpx.ReadTimeout:
                    log.error("Proxy Timeout: Backend took longer than %ss for %s", timeout, upstream)
                    return JSONResponse(content={"ok": False, "error": "Backend timeout"}, status_code=504)
                except Exception as e:
                    log.exception("Proxy Error: %s for %s", str(e), upstream)
                    return JSONResponse(content={"ok": False, "error": f"Proxy error: {str(e)}"}, status_code=500)

        # fallback: stdlib（最低限、生存優先）
        if request.method not in ("GET", "POST"):
            return JSONResponse(
                status_code=501,
                content={"ok": False, "error": "httpx not installed; method not supported", "method": request.method},
            )

        import urllib.request

        qs = ""
        if params:
            from urllib.parse import urlencode
            qs = "?" + urlencode(params, doseq=True)

        req = urllib.request.Request(upstream + qs, data=(body if request.method == "POST" else None), headers=headers, method=request.method)
        with urllib.request.urlopen(req, timeout=10) as resp:
            ctype = resp.headers.get("Content-Type", "application/json")
            data = resp.read()
            return Response(content=data, status_code=resp.status, media_type=ctype)

    except Exception as e:
        log.exception("proxy failed -> %s", upstream)
        return JSONResponse(
            status_code=502,
            content={"ok": False, "error": "Bad Gateway", "upstream": upstream, "detail": str(e)},
        )


# --- StaticFiles は最後に mount（/api を飲み込まない・ルーティング順の事故を防ぐ）
if UI_DIR.exists():
    app.mount("/", StaticFiles(directory=str(UI_DIR), html=True), name="ui")
else:
    log.error("UI_DIR does not exist: %s", UI_DIR)


# === COMPAT_PROXY_API_CATCHALL_V2 ===
import os
import asyncio
import urllib.request
import urllib.error
import urllib.parse

from fastapi import Request, Response

_BACKEND_ORIGIN = os.environ.get("ADS_BACKEND_ORIGIN", "http://127.0.0.1:8001").rstrip("/")

def _filter_headers(h: dict) -> dict:
    drop = {"content-encoding", "transfer-encoding", "connection", "content-length"}
    out = {}
    for k, v in h.items():
        if k and k.lower() not in drop:
            out[k] = v
    return out

async def _forward(method: str, url: str, headers: dict, params: dict, body: bytes):
    def _do():
        # build url with query
        if params:
            q = urllib.parse.urlencode(list(params.items()))
            url2 = url + ("&" if "?" in url else "?") + q
        else:
            url2 = url

        data = body if body else (b"" if method in ("POST","PUT","PATCH") else None)
        req = urllib.request.Request(url2, data=data, method=method)

        for k, v in headers.items():
            kl = k.lower()
            if kl in ("host","content-length","connection"):
                continue
            req.add_header(k, v)

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                status = resp.getcode()
                rh = dict(resp.headers)
                content = resp.read()
                return status, rh, content
        except urllib.error.HTTPError as e:
            # HTTP errorでもボディ返す
            status = getattr(e, "code", 500) or 500
            rh = dict(getattr(e, "headers", {}) or {})
            content = e.read() if hasattr(e, "read") else (str(e).encode("utf-8", errors="ignore"))
            return status, rh, content

    return await asyncio.to_thread(_do)

@app.api_route("/api/{full_path:path}", methods=["GET","POST","PUT","PATCH","DELETE","OPTIONS"])
async def _proxy_api_any(full_path: str, request: Request):
    url = f"{_BACKEND_ORIGIN}/api/{full_path}"
    body = await request.body()
    status, rh, content = await _forward(
        request.method,
        url,
        dict(request.headers),
        dict(request.query_params),
        body,
    )
    return Response(
        content=content,
        status_code=status,
        headers=_filter_headers(rh),
        media_type=rh.get("content-type"),
    )
# === /COMPAT_PROXY_API_CATCHALL_V2 ===


# === COMPAT_PROXY_API_404_FALLBACK_V1 ===
import os
import asyncio
import urllib.request
import urllib.error

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

_BACKEND_ORIGIN = os.environ.get("ADS_BACKEND_ORIGIN", "http://127.0.0.1:8001").rstrip("/")

def _filter_headers(h: dict) -> dict:
    drop = {"content-encoding", "transfer-encoding", "connection", "content-length"}
    out = {}
    for k, v in (h or {}).items():
        if k and k.lower() not in drop:
            out[k] = v
    return out

async def _forward_to_backend(request):
    url = _BACKEND_ORIGIN + request.url.path
    if request.url.query:
        url += "?" + request.url.query

    body = await request.body()
    headers = dict(request.headers)
    headers.pop("host", None)

    def _do():
        data = body if body else (b"" if request.method in ("POST","PUT","PATCH") else None)
        req = urllib.request.Request(url, data=data, method=request.method)
        for k, v in headers.items():
            kl = (k or "").lower()
            if kl in ("host", "content-length", "connection"):
                continue
            try:
                req.add_header(k, v)
            except Exception:
                pass

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.getcode(), dict(resp.headers), resp.read()
        except urllib.error.HTTPError as e:
            code = getattr(e, "code", 500) or 500
            rh = dict(getattr(e, "headers", {}) or {})
            content = e.read() if hasattr(e, "read") else b""
            return code, rh, content

    status, rh, content = await asyncio.to_thread(_do)
    return Response(
        content=content,
        status_code=status,
        headers=_filter_headers(rh),
        media_type=(rh or {}).get("content-type"),
    )

class _Api404FallbackProxy(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path.startswith("/api/"):
            resp = await call_next(request)
            if getattr(resp, "status_code", 500) == 404:
                return await _forward_to_backend(request)
            return resp
        return await call_next(request)

try:
    app.add_middleware(_Api404FallbackProxy)
except Exception:
    pass
# === /COMPAT_PROXY_API_404_FALLBACK_V1 ===


# === COMPAT_PROXY_FORCE_ALL_API_TO_BACKEND_V1 ===
import os
import asyncio
import urllib.request
import urllib.error

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

_BACKEND_ORIGIN = os.environ.get("ADS_BACKEND_ORIGIN", "http://127.0.0.1:8001").rstrip("/")

def _filter_headers(h: dict) -> dict:
    drop = {"content-encoding", "transfer-encoding", "connection", "content-length"}
    out = {}
    for k, v in (h or {}).items():
        if k and k.lower() not in drop:
            out[k] = v
    return out

async def _forward_to_backend(request):
    url = _BACKEND_ORIGIN + request.url.path
    if request.url.query:
        url += "?" + request.url.query

    body = await request.body()
    headers = dict(request.headers)
    headers.pop("host", None)

    def _do():
        data = body if body else (b"" if request.method in ("POST","PUT","PATCH") else None)
        req = urllib.request.Request(url, data=data, method=request.method)
        for k, v in headers.items():
            kl = (k or "").lower()
            if kl in ("host", "content-length", "connection"):
                continue
            try:
                req.add_header(k, v)
            except Exception:
                pass

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.getcode(), dict(resp.headers), resp.read()
        except urllib.error.HTTPError as e:
            code = getattr(e, "code", 500) or 500
            rh = dict(getattr(e, "headers", {}) or {})
            content = e.read() if hasattr(e, "read") else b""
            return code, rh, content

    status, rh, content = await asyncio.to_thread(_do)
    return Response(
        content=content,
        status_code=status,
        headers=_filter_headers(rh),
        media_type=(rh or {}).get("content-type"),
    )

class _ForceAllApiToBackend(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path.startswith("/api/"):
            return await _forward_to_backend(request)
        return await call_next(request)

try:
    app.add_middleware(_ForceAllApiToBackend)
except Exception:
    pass
# === /COMPAT_PROXY_FORCE_ALL_API_TO_BACKEND_V1 ===

