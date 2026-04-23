"""FastAPI application for Market Lens AI."""

from __future__ import annotations

import logging
import os
import re
import ssl
import sys
import time
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from fastapi.responses import RedirectResponse

from .policies import allowed_domains
from .repositories import create_asset_repository, create_review_repository
from .repositories.file_scan_repository import FileScanRepository
from .repositories.file_scan_job_repository import FileScanJobRepository
from .routers.creative_asset_routes import create_asset_router
from .repositories.file_discovery_job_repository import FileDiscoveryJobRepository
from .routers.discovery_routes import create_discovery_router
from .routers.export_routes import router as export_router
from .routers.integration_routes import router as integration_router
from .routers.generation_routes import create_generation_router
from .routers.health_routes import router as health_router
from .routers.history_routes import create_history_router
from .routers.policy_routes import router as policy_router
from .routers.review_routes import create_review_router
from .routers.scan_routes import create_scan_router
from .routers.template_routes import router as template_router
from .routers.watchlist_routes import create_watchlist_router
from .routers.scheduler_routes import create_scheduler_router
from .routers.delivery_routes import create_delivery_router
from .routers.admin_routes import create_admin_router

# ── Logging ──────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("market-lens")


def _env_state(name: str) -> str:
    value = os.getenv(name)
    return "set" if value else "unset"


def _runtime_tls_snapshot() -> dict[str, str]:
    try:
        import certifi  # type: ignore

        certifi_path = certifi.where()
    except Exception as exc:  # pragma: no cover - defensive only
        certifi_path = f"unavailable: {exc}"

    paths = ssl.get_default_verify_paths()
    return {
        "python_version": sys.version.replace("\n", " "),
        "openssl_version": ssl.OPENSSL_VERSION,
        "default_cafile": str(paths.cafile),
        "default_capath": str(paths.capath),
        "certifi_path": certifi_path,
        "render": _env_state("RENDER"),
        "render_service_id": _env_state("RENDER_SERVICE_ID"),
        "render_external_url": _env_state("RENDER_EXTERNAL_URL"),
        "http_proxy": _env_state("HTTP_PROXY"),
        "https_proxy": _env_state("HTTPS_PROXY"),
        "no_proxy": _env_state("NO_PROXY"),
        "ssl_cert_file": _env_state("SSL_CERT_FILE"),
        "requests_ca_bundle": _env_state("REQUESTS_CA_BUNDLE"),
        "curl_ca_bundle": _env_state("CURL_CA_BUNDLE"),
        "anthropic_api_key": _env_state("ANTHROPIC_API_KEY"),
        "anthropic_analysis_model": os.getenv("ANTHROPIC_ANALYSIS_MODEL", os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")),
        "anthropic_discovery_search_model": os.getenv("ANTHROPIC_DISCOVERY_SEARCH_MODEL", os.getenv("ANTHROPIC_ANALYSIS_MODEL", os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6"))),
        "anthropic_discovery_search_tool": os.getenv("ANTHROPIC_DISCOVERY_SEARCH_TOOL_VERSION", "web_search_20250305"),
        "anthropic_discovery_search_max_uses": os.getenv("ANTHROPIC_DISCOVERY_SEARCH_MAX_USES", "4"),
        "anthropic_discovery_classify_model": os.getenv("ANTHROPIC_DISCOVERY_CLASSIFY_MODEL", os.getenv("ANTHROPIC_ANALYSIS_MODEL", os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6"))),
        "default_analysis_provider": "anthropic",
        "discovery_search_timeout_sec": os.getenv("DISCOVERY_SEARCH_TIMEOUT_SEC", "90"),
        "discovery_grounded_search_timeout_sec": os.getenv("DISCOVERY_GROUNDED_SEARCH_TIMEOUT_SEC", "45"),
        "discovery_search_max_retries": os.getenv("DISCOVERY_SEARCH_MAX_RETRIES", "2"),
        "discovery_search_retry_delay_sec": os.getenv("DISCOVERY_SEARCH_RETRY_DELAY_SEC", "1"),
    }

# ── Env ──────────────────────────────────────────────────────
for env_file in [".env.local", ".env"]:
    if Path(env_file).exists():
        load_dotenv(env_file)
        break

# ── App ──────────────────────────────────────────────────────
app = FastAPI(title="Market Lens AI", version="0.2.0")

# ── CORS ─────────────────────────────────────────────────────
_default_origins = [
    "http://localhost:3001",
    "http://localhost:3002",
    "http://127.0.0.1:3002",
    "http://127.0.0.1:3004",
    "https://insight-studio-chi.vercel.app",
]
_env_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
]
_allowed_origins = list(dict.fromkeys([*_env_origins, *_default_origins]))
# Vercel preview deploys を正規表現で許可
_CORS_ORIGIN_REGEX = r"^https://insight-studio(-[a-z0-9-]+)?\.vercel\.app$"
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=_CORS_ORIGIN_REGEX,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "X-API-Key", "X-Insight-User", "X-Analysis-Provider", "X-Client-ID", "X-Gemini-API-Key", "Accept"],
)

# ── Rate Limit (simple in-memory) ────────────────────────────
_rate_window = 60  # seconds
_rate_max = int(os.getenv("RATE_LIMIT_PER_MIN", "10"))
_rate_store: dict[str, list[float]] = defaultdict(list)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    # Apply rate limit to all POST endpoints on protected prefixes
    _protected_prefixes = ("/api/scan", "/api/integrations/", "/api/watchlists",
                           "/api/jobs", "/api/delivery", "/api/admin",
                           "/api/discovery")
    is_protected = request.method in ("POST", "PATCH", "DELETE") and any(
        request.url.path.startswith(p) for p in _protected_prefixes
    )

    if is_protected:
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        timestamps = _rate_store[client_ip]
        _rate_store[client_ip] = [t for t in timestamps if now - t < _rate_window]
        if len(_rate_store[client_ip]) >= _rate_max:
            logger.warning("Rate limit exceeded for %s", client_ip)
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Try again later."},
            )
        _rate_store[client_ip].append(now)
    return await call_next(request)


# ── Error handler ────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Let FastAPI handle HTTPException with its own status code and detail
    if isinstance(exc, HTTPException):
        raise exc
    logger.error("Unhandled error on %s %s: %s", request.method, request.url.path, exc, exc_info=True)
    error_type = type(exc).__name__
    # Manually attach CORS headers so the browser can read the error JSON
    # instead of showing an opaque CORS failure.
    origin = request.headers.get("origin", "")
    headers = {}
    if origin and (origin in _allowed_origins or re.match(_CORS_ORIGIN_REGEX, origin)):
        headers["access-control-allow-origin"] = origin
        headers["access-control-allow-credentials"] = "true"
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error ({error_type})"},
        headers=headers,
    )


@app.on_event("startup")
async def _startup_checks():
    domains = allowed_domains()
    if not domains:
        logger.warning(
            "Allowlist is empty — all scan requests will be rejected. "
            "Set ALLOWLIST_JSON or ALLOWLIST_PATH to configure allowed domains."
        )
    else:
        logger.info("Allowlist loaded: %d domain(s)", len(domains))
    if not os.getenv("ANTHROPIC_API_KEY"):
        logger.info("ANTHROPIC_API_KEY not set — Discovery/analysis are running in BYOK mode")
    stale_count = _discovery_job_repo.mark_stale_running_as_failed()
    if stale_count:
        logger.info("Marked %d stale discovery job(s) as failed on startup", stale_count)
    scan_stale_count = _scan_job_repo.mark_stale_running_as_failed()
    if scan_stale_count:
        logger.info("Marked %d stale scan job(s) as failed on startup", scan_stale_count)
    tls_snapshot = _runtime_tls_snapshot()
    logger.info(
        "Runtime TLS snapshot python=%s openssl=%s default_cafile=%s "
        "default_capath=%s certifi_path=%s",
        tls_snapshot["python_version"],
        tls_snapshot["openssl_version"],
        tls_snapshot["default_cafile"],
        tls_snapshot["default_capath"],
        tls_snapshot["certifi_path"],
    )
    logger.info(
        "Runtime env snapshot render=%s render_service_id=%s render_external_url=%s "
        "http_proxy=%s https_proxy=%s no_proxy=%s ssl_cert_file=%s "
        "requests_ca_bundle=%s curl_ca_bundle=%s anthropic_api_key=%s "
        "anthropic_analysis_model=%s anthropic_discovery_search_model=%s "
        "anthropic_discovery_search_tool=%s anthropic_discovery_search_max_uses=%s "
        "anthropic_discovery_classify_model=%s default_analysis_provider=%s "
        "discovery_search_timeout_sec=%s discovery_grounded_search_timeout_sec=%s "
        "discovery_search_max_retries=%s discovery_search_retry_delay_sec=%s",
        tls_snapshot["render"],
        tls_snapshot["render_service_id"],
        tls_snapshot["render_external_url"],
        tls_snapshot["http_proxy"],
        tls_snapshot["https_proxy"],
        tls_snapshot["no_proxy"],
        tls_snapshot["ssl_cert_file"],
        tls_snapshot["requests_ca_bundle"],
        tls_snapshot["curl_ca_bundle"],
        tls_snapshot["anthropic_api_key"],
        tls_snapshot["anthropic_analysis_model"],
        tls_snapshot["anthropic_discovery_search_model"],
        tls_snapshot["anthropic_discovery_search_tool"],
        tls_snapshot["anthropic_discovery_search_max_uses"],
        tls_snapshot["anthropic_discovery_classify_model"],
        tls_snapshot["default_analysis_provider"],
        tls_snapshot["discovery_search_timeout_sec"],
        tls_snapshot["discovery_grounded_search_timeout_sec"],
        tls_snapshot["discovery_search_max_retries"],
        tls_snapshot["discovery_search_retry_delay_sec"],
    )


# ── Root redirect ────────────────────────────────────────────
@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
async def root():
    """Redirect root to API docs (also handles HEAD from external monitors)."""
    return RedirectResponse(url="/docs")


# ── Wire routers ─────────────────────────────────────────────
_repo = FileScanRepository()
_scan_job_repo = FileScanJobRepository()
_asset_repo = create_asset_repository(os.getenv("REPOSITORY_BACKEND", "file"))
_review_repo = create_review_repository(os.getenv("REPOSITORY_BACKEND", "file"))

app.include_router(health_router)
app.include_router(policy_router)
app.include_router(create_scan_router(_repo, job_repo=_scan_job_repo))
app.include_router(create_history_router(_repo))
app.include_router(create_asset_router(_asset_repo))
app.include_router(create_review_router(_asset_repo, review_repo=_review_repo))
_discovery_job_repo = FileDiscoveryJobRepository()
app.include_router(create_discovery_router(job_repo=_discovery_job_repo))
def _load_review_result(run_id: str):
    """Load (ReviewResult, asset_id) from review repository for banner generation."""
    from .schemas.review_result import ReviewResult

    output = _review_repo.load_output(run_id)
    if output is None:
        return None
    try:
        result = ReviewResult(**output.output_json)
    except Exception:
        return None

    # Retrieve asset_id from the review run metadata
    asset_id = None
    run = _review_repo.load_run(run_id)
    if run is not None:
        asset_id = run.asset_id

    return result, asset_id


def _load_asset_image(asset_id: str) -> bytes | None:
    """Load original image bytes from asset repository."""
    return _asset_repo.load_data(asset_id)


app.include_router(create_generation_router(
    review_result_loader=_load_review_result,
    asset_loader=_load_asset_image,
    asset_metadata_loader=_asset_repo.load_metadata,
))
app.include_router(template_router)
from .repositories.watchlist_repository import WatchlistRepository as _WatchlistRepo
from .services.competitor_monitor import CompetitorMonitor as _CompetitorMonitor
from . import fetcher as _fetcher_mod
from . import extractor as _extractor_mod

_watchlist_repo = _WatchlistRepo()


class _FetcherAdapter:
    """Adapt module-level fetch_html into object with .fetch() method."""
    async def fetch(self, url: str) -> str:
        html, _ = await _fetcher_mod.fetch_html(url)
        return html


class _ExtractorAdapter:
    """Adapt module-level extract into object with .extract() method."""
    def extract(self, html: str) -> dict:
        result = _extractor_mod.extract("", html)
        return result.model_dump() if hasattr(result, "model_dump") else dict(result)


_monitor = _CompetitorMonitor(
    repo=_watchlist_repo,
    fetcher=_FetcherAdapter(),
    extractor=_ExtractorAdapter(),
)

app.include_router(create_watchlist_router(repo=_watchlist_repo, monitor=_monitor))
app.include_router(create_scheduler_router())
app.include_router(create_delivery_router())
app.include_router(create_admin_router())
app.include_router(integration_router)
app.include_router(export_router)


# ── Sample gallery API (Phase 9) ────────────────────────────
from .services.sample_gallery import SampleGalleryService
_gallery = SampleGalleryService()


@app.get("/api/samples", tags=["samples"])
async def list_samples(industry: str | None = None):
    return _gallery.list_samples(industry=industry)


@app.get("/api/samples/{sample_id}", tags=["samples"])
async def get_sample(sample_id: str):
    sample = _gallery.get_sample(sample_id)
    if sample is None:
        raise HTTPException(status_code=404, detail="Sample not found")
    return sample


# ── Static pages serving (Phase 9) ──────────────────────────
from fastapi.responses import FileResponse


@app.get("/admin", include_in_schema=False)
async def admin_page():
    return FileResponse("pages/admin.html")


@app.get("/lp", include_in_schema=False)
async def landing_page():
    return FileResponse("pages/lp.html")


@app.get("/onboarding", include_in_schema=False)
async def onboarding_page():
    return FileResponse("pages/onboarding.html")
