"""Unified ASGI dispatcher — routes /api/ml/* and /api/ads/* to respective apps.

Both backends share a ``web/app/`` package layout, so we must import
ads-insights *first* (before market-lens-ai's ``web`` package is loaded),
then swap the ``web.*`` entries in ``sys.modules`` so market-lens-ai can
claim the namespace.  Object references in ads_app survive because
Python keeps module objects alive as long as something holds a reference.
"""

import asyncio
import json as _json
import sys
from pathlib import Path

# ── 1) Import ads-insights first (its web.app.* must load before ML's) ──
ADS_DIR = str(Path(__file__).resolve().parent.parent / "ads-insights")
sys.path.insert(0, ADS_DIR)

from web.app.backend_api import app as ads_app  # noqa: E402

# ── 2) Snapshot ads web.* modules, then clear them for market-lens-ai ──
_ads_web_modules = {
    k: sys.modules.pop(k)
    for k in list(sys.modules)
    if k == "web" or k.startswith("web.")
}

# Keep ADS_DIR at the *end* of sys.path so non-web imports (bq.auth etc.)
# still resolve, but market-lens-ai's web/ package takes priority.
sys.path.remove(ADS_DIR)
sys.path.append(ADS_DIR)

# ── 3) Import market-lens-ai (loads its own web.app.*) ──
from web.app.main import app as ml_app  # noqa: E402

# ── 4) Stash ads modules under aliased keys so GC doesn't collect them ──
for _k, _mod in _ads_web_modules.items():
    sys.modules[f"_ads.{_k}"] = _mod


# ── Dispatcher ───────────────────────────────────────────────


async def _run_handlers(handlers):
    for handler in handlers:
        result = handler()
        if asyncio.iscoroutine(result):
            await result


# ── Temporary BQ debug endpoint (remove after fix) ──
async def _bq_debug_response(scope, receive, send):
    """Test BQ imports in the SAME context as ads_app route handlers."""
    import traceback
    results = {}

    # Test 1: Direct import (same as dispatcher diagnostic)
    try:
        from bq.client import run_query, PROJECT_ID
        results["direct_bq_import"] = f"OK (PROJECT_ID={PROJECT_ID})"
    except ImportError as e:
        results["direct_bq_import"] = f"FAIL: {e}"
        results["direct_traceback"] = traceback.format_exc()

    # Test 2: Import via the _ads aliased module path
    mod = sys.modules.get("_ads.web.app.backend_api")
    if mod:
        results["backend_api_module"] = f"Found at {mod.__file__}"
    else:
        results["backend_api_module"] = "NOT IN sys.modules"

    # Test 3: Check if bq is reachable from current sys.path
    results["sys_path_ads_entries"] = [p for p in sys.path if "ads" in p.lower()]

    # Test 4: Check bq in sys.modules
    results["bq_modules"] = [k for k in sys.modules if k.startswith("bq")]

    # Test 5: bq.queries (used by query_types endpoint)
    try:
        from bq.queries import list_query_types
        types = list_query_types()
        results["bq_queries"] = f"OK ({len(types)} types)"
    except ImportError as e:
        results["bq_queries"] = f"FAIL: {e}"
        results["bq_queries_traceback"] = traceback.format_exc()

    body = _json.dumps(results, indent=2).encode()
    await send({"type": "http.response.start", "status": 200,
                "headers": [[b"content-type", b"application/json"],
                            [b"content-length", str(len(body)).encode()]]})
    await send({"type": "http.response.body", "body": body})


class PrefixDispatcher:
    """
    /api/ml/*  -> ml_app  (strip "/ml", keep "/api")
    /api/ads/* -> ads_app (strip "/ads", keep "/api")
    Fallback   -> ml_app  (e.g. /api/health -> ml_app)
    """

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            await self._handle_lifespan(scope, receive, send)
            return

        if scope["type"] == "http":
            path = scope.get("path", "")
            # ── Temporary debug (remove after BQ fix) ──
            if path == "/api/ads/debug/bq":
                await _bq_debug_response(scope, receive, send)
                return

        if scope["type"] in ("http", "websocket"):
            path = scope.get("path", "")
            if path.startswith("/api/ml/") or path == "/api/ml":
                scope = {**scope, "path": "/api" + path[7:], "root_path": ""}
                await ml_app(scope, receive, send)
                return
            if path.startswith("/api/ads/") or path == "/api/ads":
                scope = {**scope, "path": "/api" + path[8:], "root_path": ""}
                await ads_app(scope, receive, send)
                return
            # fallback (e.g. /docs, /openapi.json)
            await ml_app(scope, receive, send)
            return

        # Unknown scope type — forward to ml_app
        await ml_app(scope, receive, send)

    async def _handle_lifespan(self, scope, receive, send):
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                try:
                    await _run_handlers(ml_app.router.on_startup)
                    await _run_handlers(ads_app.router.on_startup)
                    await send({"type": "lifespan.startup.complete"})
                except Exception as exc:
                    await send(
                        {"type": "lifespan.startup.failed", "message": str(exc)}
                    )
                    return
            elif message["type"] == "lifespan.shutdown":
                await _run_handlers(ml_app.router.on_shutdown)
                await _run_handlers(ads_app.router.on_shutdown)
                await send({"type": "lifespan.shutdown.complete"})
                return


app = PrefixDispatcher()
