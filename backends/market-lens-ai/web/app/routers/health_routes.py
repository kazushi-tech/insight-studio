"""Health check routes."""

from __future__ import annotations

import asyncio
import os
import time
from collections.abc import Callable, Mapping

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..services.discovery.pipeline_metrics import get_health_snapshot

router = APIRouter()
_repository_readiness_probe: Callable[[], bool] = lambda: True
_analysis_worker_readiness_probe: Callable[[], Mapping[str, object]] = lambda: {
    "mode": "inline",
    "required": False,
    "ready": True,
    "freshness_seconds": 60,
    "fresh_workers": 0,
    "stale_workers": 0,
    "stopped_workers": 0,
    "starting_workers": 0,
    "latest_heartbeat_at": None,
    "latest_successful_job_at": None,
}


def configure_repository_readiness(probe: Callable[[], bool]) -> None:
    global _repository_readiness_probe
    _repository_readiness_probe = probe


def configure_analysis_worker_readiness(
    probe: Callable[[], Mapping[str, object]],
) -> None:
    global _analysis_worker_readiness_probe
    _analysis_worker_readiness_probe = probe


def _safe_analysis_worker_snapshot() -> dict[str, object]:
    allowed_fields = {
        "mode",
        "required",
        "ready",
        "freshness_seconds",
        "fresh_workers",
        "stale_workers",
        "stopped_workers",
        "starting_workers",
        "latest_heartbeat_at",
        "latest_successful_job_at",
    }
    try:
        snapshot = dict(_analysis_worker_readiness_probe())
    except Exception:
        snapshot = {"mode": "unavailable", "required": True, "ready": False}
    return {key: snapshot.get(key) for key in allowed_fields}


@router.get("/api/health")
async def health():
    repository_ready = bool(_repository_readiness_probe())
    analysis_worker = _safe_analysis_worker_snapshot()
    worker_ready = not bool(analysis_worker.get("required")) or bool(
        analysis_worker.get("ready")
    )
    ready = repository_ready and worker_ready
    deployment_sha = os.getenv("VERCEL_GIT_COMMIT_SHA") or os.getenv("RENDER_GIT_COMMIT", "unknown")
    payload = {
        "ok": ready,
        "service": "market-lens",
        "deployment_sha": deployment_sha,
        "commit": deployment_sha,
        "persistence": "ready" if repository_ready else "unavailable",
        "analysis_worker": analysis_worker,
        "discovery_pipeline": get_health_snapshot(),
    }
    return JSONResponse(payload, status_code=200 if ready else 503)


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
