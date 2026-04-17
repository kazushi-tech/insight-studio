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

# ── 1b) Pre-import bq modules while ADS_DIR is at sys.path[0] ──
# This ensures bq.* is in sys.modules before the path is rearranged,
# so lazy imports inside route handlers always find cached modules.
try:
    import bq.client        # noqa: F401
    import bq.auth          # noqa: F401
    import bq.queries       # noqa: F401
    import bq.reporter      # noqa: F401
    print("[unified_app] BigQuery modules pre-loaded OK")
except ImportError as exc:
    print(f"[unified_app] BigQuery modules not available: {exc}")

# ── 2) Snapshot ads web.* modules, then clear them for market-lens-ai ──
_ads_web_modules = {
    k: sys.modules.pop(k)
    for k in list(sys.modules)
    if k == "web" or k.startswith("web.")
}

# Keep ADS_DIR at the *end* of sys.path so non-web imports (bq.auth etc.)
# still resolve, but market-lens-ai's web/ package takes priority.
# bq.reporter inserts ADS_DIR and ADS_DIR/.agent/skills at sys.path[0] when
# imported, so strip every occurrence before re-appending once at the tail.
_ads_skills_dir = str(Path(ADS_DIR) / ".agent" / "skills")
while ADS_DIR in sys.path:
    sys.path.remove(ADS_DIR)
while _ads_skills_dir in sys.path:
    sys.path.remove(_ads_skills_dir)
sys.path.append(ADS_DIR)

# ── 3) Import market-lens-ai (loads its own web.app.*) ──
from web.app.main import app as ml_app  # noqa: E402

# ── 4) Stash ads modules under aliased keys AND rename them so that
#      lazy relative imports inside ads handlers (e.g. `from .bq_chart_builder
#      import X` in generate_batch) resolve to the `_ads.*` namespace instead
#      of ML's `web.app`, which lacks those submodules.
import types as _types  # noqa: E402

if "_ads" not in sys.modules:
    _ads_pkg = _types.ModuleType("_ads")
    _ads_pkg.__path__ = []  # mark as package so submodule lookup works
    sys.modules["_ads"] = _ads_pkg

for _k, _mod in _ads_web_modules.items():
    _new_name = f"_ads.{_k}"
    sys.modules[_new_name] = _mod
    _mod.__name__ = _new_name
    if getattr(_mod, "__path__", None) is not None:
        _mod.__package__ = _new_name  # package: own name
    else:
        _mod.__package__ = _new_name.rsplit(".", 1)[0]  # module: parent name
    _spec = getattr(_mod, "__spec__", None)
    if _spec is not None:
        _spec.name = _new_name


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


# ── Diagnostic endpoint (temporary — remove after BQ issue is resolved) ──
from fastapi import APIRouter

_diag = APIRouter()

@_diag.get("/api/bq/debug/bq-import")
async def debug_bq_import():
    import sys
    results = {}

    # sys.path チェック
    results["sys_path_ads"] = [p for p in sys.path if "ads" in p.lower()]
    results["sys_path_full"] = list(sys.path)

    # __file__ チェック for backend_api
    try:
        from _ads.web.app.backend_api import BASE_DIR
        results["backend_api_base_dir"] = str(BASE_DIR)
    except Exception as e:
        results["backend_api_base_dir"] = f"FAIL: {e}"

    # pandas インポート
    try:
        import pandas
        results["pandas"] = f"OK ({pandas.__version__})"
    except ImportError as e:
        results["pandas"] = f"FAIL: {e}"

    # google.cloud.bigquery インポート
    try:
        from google.cloud import bigquery
        results["bigquery"] = f"OK ({bigquery.__version__})"
    except ImportError as e:
        results["bigquery"] = f"FAIL: {e}"

    # bq.auth チェック
    try:
        from bq.auth import is_bq_available
        results["bq_auth_available"] = is_bq_available()
    except Exception as e:
        results["bq_auth_available"] = f"FAIL: {e}"

    # bq.client インポート (full traceback)
    try:
        from bq.client import run_query
        results["bq_client"] = "OK"
    except ImportError as e:
        import traceback
        results["bq_client"] = f"FAIL: {e}"
        results["bq_client_traceback"] = traceback.format_exc()

    # bq module in sys.modules
    results["bq_in_sys_modules"] = [k for k in sys.modules if k.startswith("bq")]

    return results

ads_app.include_router(_diag)


app = PrefixDispatcher()
