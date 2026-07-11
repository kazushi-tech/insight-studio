"""Vercel ASGI entrypoint for Ads Insights."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path


RUNTIME_DIR = Path(tempfile.gettempdir()) / "insight-studio-ads"
if os.getenv("VERCEL"):
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("DATA_ROOT", str(RUNTIME_DIR / "data"))
    os.environ.setdefault("DRIVE_ROOT", str(RUNTIME_DIR / "data"))
    os.environ.setdefault("GEMINI_USAGE_PATH", str(RUNTIME_DIR / "gemini-usage.json"))
    os.environ.setdefault("VERCEL_RUNTIME_DIR", str(RUNTIME_DIR))

from web.app.backend_api import app as ads_app  # noqa: E402


class AdsPrefixDispatcher:
    """Expose Ads routes under /api/ads while retaining /api/insights."""

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            path = scope.get("path", "")
            if path.startswith("/api/ads/") or path == "/api/ads":
                scope = {**scope, "path": "/api" + path[8:], "root_path": ""}
        await ads_app(scope, receive, send)


app = AdsPrefixDispatcher()
