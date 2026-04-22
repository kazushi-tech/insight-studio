"""Health check routes."""

from __future__ import annotations

import asyncio
import os
import time

import httpx
from fastapi import APIRouter

from ..services.discovery.pipeline_metrics import get_health_snapshot

router = APIRouter()


@router.get("/api/health")
async def health():
    return {
        "ok": True,
        "service": "market-lens",
        "commit": os.getenv("RENDER_GIT_COMMIT", "unknown"),
        "discovery_pipeline": get_health_snapshot(),
    }


@router.get("/api/health/anthropic")
async def health_anthropic():
    """Diagnose outbound HTTPS connectivity to api.anthropic.com (no API call, TCP only)."""
    target = "https://api.anthropic.com"
    t0 = time.monotonic()
    status = "unknown"
    error = None
    status_code = None
    elapsed_ms = None

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(target)
            status_code = res.status_code
            elapsed_ms = round((time.monotonic() - t0) * 1000)
            # 404 is expected for the root URL — it proves TCP+TLS works
            status = "reachable"
    except httpx.TimeoutException as e:
        elapsed_ms = round((time.monotonic() - t0) * 1000)
        status = "timeout"
        error = f"{type(e).__name__}: {e}"
    except httpx.ConnectError as e:
        elapsed_ms = round((time.monotonic() - t0) * 1000)
        status = "connect_error"
        error = f"{type(e).__name__}: {e}"
    except Exception as e:
        elapsed_ms = round((time.monotonic() - t0) * 1000)
        status = "error"
        error = f"{type(e).__name__}: {e}"

    has_server_key = bool(os.getenv("ANTHROPIC_API_KEY", ""))
    return {
        "anthropic_connectivity": status,
        "status_code": status_code,
        "elapsed_ms": elapsed_ms,
        "error": error,
        "has_server_api_key": has_server_key,
        "timeout_sec": float(os.getenv("ANTHROPIC_TIMEOUT_SEC", "120")),
    }
