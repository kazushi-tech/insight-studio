"""FastAPI application for Market Lens AI."""

from __future__ import annotations

import logging
import os
import ssl
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from fastapi.responses import RedirectResponse

from .policies import allowed_domains
from .repositories.tenant_db_repository import (
    TenantRepositoryConfigurationError,
    create_tenant_repository_bundle,
    unavailable_tenant_repository_bundle,
)
from .routers.creative_asset_routes import create_asset_router
from .routers.discovery_routes import create_discovery_router
from .routers.export_routes import router as export_router
from .routers.integration_routes import router as integration_router
from .routers.generation_routes import create_generation_router
from .routers.health_routes import (
    configure_analysis_worker_readiness,
    configure_repository_readiness,
    router as health_router,
)
from .routers.history_routes import create_history_router
from .routers.policy_routes import router as policy_router
from .routers.review_routes import create_review_router
from .routers.scan_routes import create_scan_router
from .routers.template_routes import router as template_router
from .routers.watchlist_routes import create_watchlist_router
from .routers.scheduler_routes import create_scheduler_router
from .routers.delivery_routes import create_delivery_router
from .routers.admin_routes import create_admin_router
from .jobs.runner import JobRunner
from .jobs.analysis_backend import (
    InlineAnalysisJobBackend,
    JobBackendConfigurationError,
    JobBackendMode,
    JobBackendSettings,
    UnavailableAnalysisJobBackend,
    create_analysis_job_backend,
)
from .gemini_budget import GeminiBudgetUnavailable, get_budget_summary, reset_budget_for_dev
from .auth import verify_admin_or_integration
from .api_errors import ensure_request_id, http_exception_response, problem_response
from .tenant_auth import (
    TenantAuthConfigurationError,
    clear_current_tenant_context,
    get_managed_session_factory,
    reset_current_tenant_context,
)
from .observability import capture_exception_safe, initialize_sentry, log_event, workspace_hash
from .shared_rate_limits import (
    RateLimitUnavailable,
    clear_rate_limit_buckets,
    consume_rate_limit,
)
from starlette.concurrency import run_in_threadpool

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

initialize_sentry()

# ── App ──────────────────────────────────────────────────────
app = FastAPI(title="Market Lens AI", version="0.2.0")

# ── CORS ─────────────────────────────────────────────────────
_IS_PRODUCTION = bool(os.getenv("RENDER") or os.getenv("VERCEL"))
_dev_origins = [
    "http://localhost:3001",
    "http://localhost:3002",
    "http://127.0.0.1:3002",
    "http://127.0.0.1:3004",
]
_env_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
]
_allowed_origins = [] if _IS_PRODUCTION else list(dict.fromkeys([*_env_origins, *_dev_origins]))
_cors_headers = [
    "Content-Type",
    "Authorization",
    "X-API-Key",
    "X-Insight-Project",
    "X-Analysis-Provider",
    "X-Client-ID",
    "X-Gemini-API-Key",
    "Idempotency-Key",
    "Accept",
]
if not _IS_PRODUCTION:
    _cors_headers.append("X-Insight-User")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=_cors_headers,
)


@app.middleware("http")
async def tenant_context_lifecycle_middleware(request: Request, call_next):
    """Prevent verified tenant context from leaking across reused tasks."""

    clear_current_tenant_context()
    request.state.tenant_context_tokens = []
    try:
        return await call_next(request)
    finally:
        tokens = getattr(request.state, "tenant_context_tokens", [])
        for token in reversed(tokens if isinstance(tokens, list) else []):
            try:
                reset_current_tenant_context(token)
            except (RuntimeError, ValueError):
                # Some Starlette middleware layers execute downstream in a
                # copied context; the unconditional clear below remains the
                # authoritative cleanup for this request task.
                pass
        clear_current_tenant_context()

# ── PostgreSQL-shared rate limit ─────────────────────────────
_rate_window = 60  # seconds
_rate_max = int(os.getenv("RATE_LIMIT_PER_MIN", "10"))


class _LegacyRateStoreClearAdapter:
    """Test compatibility shim; no request state is kept in this process."""

    @staticmethod
    def clear() -> None:
        clear_rate_limit_buckets()


_rate_store = _LegacyRateStoreClearAdapter()


def _rate_limit_subject(request: Request) -> str:
    """Return server-observed subject material; persistence HMACs it.

    We deliberately ignore X-Client-ID and forwarded-address headers because
    they are caller-controlled in several supported deployments.  Authenticated
    routes are still protected by their authorization dependency; the shared
    limiter uses the socket peer so rotating arbitrary bearer strings cannot
    bypass capacity.
    """

    client_host = request.client.host if request.client else "unknown"
    return f"socket:{client_host}"


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
        try:
            decision = await run_in_threadpool(
                consume_rate_limit,
                subject_material=_rate_limit_subject(request),
                route_key=f"{request.method.upper()}:{request.url.path}",
                limit=_rate_max,
                window_seconds=_rate_window,
            )
        except RateLimitUnavailable:
            return problem_response(
                request,
                status_code=503,
                code="rate_limit_unavailable",
                category="dependency",
                user_message="サービスを一時的に利用できません。時間をおいて再試行してください。",
                retryable=True,
            )
        if not decision.allowed:
            log_event(
                "warning",
                "http_request_rate_limited",
                request_id=ensure_request_id(request),
                status_code=429,
            )
            return problem_response(
                request,
                status_code=429,
                code="rate_limited",
                category="rate_limit",
                user_message="操作が集中しています。少し待って再試行してください。",
                retryable=True,
                headers={"Retry-After": str(decision.retry_after_seconds)},
            )
    return await call_next(request)


# ── Response and error policy ────────────────────────────────
@app.middleware("http")
async def response_policy_middleware(request: Request, call_next):
    request_id = ensure_request_id(request)
    started = time.monotonic()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if request.url.path.startswith("/api/auth"):
        response.headers["Cache-Control"] = "private, no-store"
    tenant = getattr(request.state, "tenant_context", None)
    log_event(
        "info",
        "http_request_completed",
        request_id=request_id,
        workspace_hash=workspace_hash(getattr(tenant, "workspace_id", None)),
        duration_ms=round((time.monotonic() - started) * 1000, 1),
        status_code=response.status_code,
    )
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return http_exception_response(request, exc)


@app.exception_handler(GeminiBudgetUnavailable)
async def gemini_budget_unavailable_handler(request: Request, _exc: GeminiBudgetUnavailable):
    return problem_response(
        request,
        status_code=503,
        code="ai_budget_unavailable",
        category="dependency",
        user_message="AI分析を一時的に利用できません。時間をおいて再試行してください。",
        retryable=True,
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    capture_exception_safe(
        exc,
        error_code=type(exc).__name__,
        stage="http_request",
    )
    log_event(
        "error",
        "http_request_failed",
        request_id=ensure_request_id(request),
        workspace_hash=workspace_hash(
            getattr(getattr(request.state, "tenant_context", None), "workspace_id", None)
        ),
        status_code=500,
        error_code=type(exc).__name__,
    )
    return problem_response(
        request,
        status_code=500,
        code="internal_error",
        category="unexpected",
        user_message="処理を完了できませんでした。時間をおいて再試行してください。",
        retryable=True,
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
    if (
        _repository_bundle.is_ready()
        and getattr(_analysis_job_backend, "mode", None) == JobBackendMode.inline
    ):
        stale_count = _discovery_job_repo.mark_stale_running_as_failed()
        if stale_count:
            logger.info("Marked %d stale discovery job(s) as failed on startup", stale_count)
        scan_stale_count = _scan_job_repo.mark_stale_running_as_failed()
        if scan_stale_count:
            logger.info("Marked %d stale scan job(s) as failed on startup", scan_stale_count)
    elif not _repository_bundle.is_ready():
        logger.error("Market Lens persistence readiness failed; local fallback is disabled")
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
try:
    _repository_bundle = create_tenant_repository_bundle(verify_connection=False)
except TenantRepositoryConfigurationError:
    logger.exception("Market Lens repository configuration is unavailable")
    _repository_bundle = unavailable_tenant_repository_bundle()

try:
    _analysis_job_settings = JobBackendSettings.from_env()
    if _analysis_job_settings.mode == JobBackendMode.inline:
        _analysis_job_backend = InlineAnalysisJobBackend()
    else:
        _analysis_job_backend = create_analysis_job_backend(
            get_managed_session_factory(),
            settings=_analysis_job_settings,
        )
except (JobBackendConfigurationError, TenantAuthConfigurationError):
    logger.exception("Analysis job backend configuration is unavailable")
    _analysis_job_backend = UnavailableAnalysisJobBackend()


def _runtime_readiness() -> bool:
    if not _repository_bundle.is_ready():
        return False
    mode = getattr(_analysis_job_backend, "mode", None)
    if mode == JobBackendMode.inline:
        return True
    if mode in {JobBackendMode.worker, JobBackendMode.workflow}:
        return bool(_analysis_job_backend.readiness())
    return False


def _analysis_worker_readiness() -> dict[str, object]:
    mode = getattr(_analysis_job_backend, "mode", None)
    if mode == JobBackendMode.worker:
        return _analysis_job_backend.worker_readiness_snapshot()
    return {
        "mode": mode.value if isinstance(mode, JobBackendMode) else "unavailable",
        "required": False,
        "ready": mode in {JobBackendMode.inline, JobBackendMode.workflow},
        "freshness_seconds": getattr(
            getattr(_analysis_job_backend, "settings", None),
            "lease_seconds",
            60,
        ),
        "fresh_workers": 0,
        "stale_workers": 0,
        "stopped_workers": 0,
        "starting_workers": 0,
        "latest_heartbeat_at": None,
        "latest_successful_job_at": None,
    }


configure_repository_readiness(_runtime_readiness)
configure_analysis_worker_readiness(_analysis_worker_readiness)
_repo = _repository_bundle.scan_repo
_scan_job_repo = _repository_bundle.scan_job_repo
_asset_repo = _repository_bundle.asset_repo
_review_repo = _repository_bundle.review_repo
_watchlist_repo = _repository_bundle.watchlist_repo
_scheduler = _repository_bundle.scheduler
_delivery_repo = _repository_bundle.delivery_repo

app.include_router(health_router)
app.include_router(policy_router)
app.include_router(
    create_scan_router(
        _repo,
        job_repo=_scan_job_repo,
        analysis_job_backend=_analysis_job_backend,
    )
)
app.include_router(create_history_router(_repo))
app.include_router(create_asset_router(_asset_repo))
app.include_router(
    create_review_router(
        _asset_repo,
        review_repo=_review_repo,
        analysis_job_backend=_analysis_job_backend,
    )
)
_discovery_job_repo = _repository_bundle.discovery_job_repo
app.include_router(
    create_discovery_router(
        job_repo=_discovery_job_repo,
        analysis_job_backend=_analysis_job_backend,
    )
)
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
from .services.competitor_monitor import CompetitorMonitor as _CompetitorMonitor
from . import fetcher as _fetcher_mod
from . import extractor as _extractor_mod

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
app.include_router(create_scheduler_router(
    scheduler=_scheduler,
    runner=JobRunner(_scheduler, monitor=_monitor),
))
app.include_router(create_delivery_router(repository=_delivery_repo))
app.include_router(create_admin_router(analysis_job_backend=_analysis_job_backend))
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


@app.get(
    "/api/usage/budget",
    tags=["usage"],
    dependencies=[Depends(verify_admin_or_integration)],
)
async def get_gemini_budget():
    return get_budget_summary()


@app.post(
    "/api/usage/reset-dev",
    tags=["usage"],
    dependencies=[Depends(verify_admin_or_integration)],
)
async def reset_gemini_budget_dev():
    try:
        return reset_budget_for_dev()
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


# ── Legacy page compatibility ────────────────────────────────
# These pages moved to the React/Vite frontend. Keep explicit redirects for
# old bookmarks instead of trying to serve deleted ``pages/*.html`` files.
def _frontend_page_redirect(path: str) -> RedirectResponse:
    frontend_url = os.getenv("FRONTEND_APP_URL", "").strip().rstrip("/")
    target = f"{frontend_url}{path}" if frontend_url else "/docs"
    return RedirectResponse(target, status_code=307)


@app.get("/admin", include_in_schema=False)
async def admin_page():
    return _frontend_page_redirect("/settings")


@app.get("/lp", include_in_schema=False)
async def landing_page():
    return _frontend_page_redirect("/lp")


@app.get("/onboarding", include_in_schema=False)
async def onboarding_page():
    return _frontend_page_redirect("/ads/wizard")
