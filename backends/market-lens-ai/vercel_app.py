"""Vercel ASGI entrypoint for Market Lens AI."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path


RUNTIME_DIR = Path(tempfile.gettempdir()) / "insight-studio-market-lens"
if os.getenv("VERCEL"):
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("GEMINI_USAGE_PATH", str(RUNTIME_DIR / "gemini-usage.json"))
    os.environ.setdefault("MARKET_LENS_DATA_DIR", str(RUNTIME_DIR / "data"))
    os.environ.setdefault(
        "ALLOWLIST_PATH",
        str(Path(__file__).resolve().parent / "config" / "domain_allowlist.json"),
    )
    # Existing file repositories use paths relative to the process directory.
    # Point those writes at Vercel's only writable filesystem.
    os.chdir(RUNTIME_DIR)

from web.app.main import app as market_lens_app  # noqa: E402


class MarketLensPrefixDispatcher:
    """Expose the Market Lens app under the frontend's /api/ml namespace."""

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            path = scope.get("path", "")
            if path.startswith("/api/ml/") or path == "/api/ml":
                scope = {**scope, "path": "/api" + path[7:], "root_path": ""}
        await market_lens_app(scope, receive, send)


app = MarketLensPrefixDispatcher()
