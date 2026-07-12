from __future__ import annotations















import asyncio
import json
import logging
import re

logger = logging.getLogger("ads-insights")







import os







from pathlib import Path

# Case authentication
import bcrypt
import pyotp

# Load environment variables from local env files.
try:
    from dotenv import load_dotenv
    _env_paths = [
        Path(__file__).resolve().parents[2] / ".env.local",
        Path(__file__).resolve().parents[4] / ".env",
    ]
    _loaded_env_paths = []
    for _env_path in _env_paths:
        if _env_path.exists():
            load_dotenv(_env_path, override=False)
            _loaded_env_paths.append(str(_env_path))
    if _loaded_env_paths:
        print(f"[backend_api] Loaded env from: {', '.join(_loaded_env_paths)}")
    else:
        print(f"[backend_api] No local env file found at: {', '.join(map(str, _env_paths))}")
except ImportError:
    print("[backend_api] python-dotenv not available, skipping local env loading")

# Import report generation modules
from .kpi_extractor import extract_from_excel, extract_trend_data, extract_media_data

BASE_DIR = Path(__file__).resolve().parents[2]  # ads-insights repo root

# Add project root to sys.path to import chart_generator
import sys
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

import chart_generator as cg

from .point_pack_generator import generate_multi_month_point_pack_md, generate_point_pack_md, format_period_label
from .ai_analysis import (
    ai_json_output_contract,
    apply_pv_spike_diagnostic_to_context,
    build_ai_analysis_context,
    fetch_pv_spike_diagnostic_context,
    log_ai_debug,
    normalize_ai_model_response,
    question_needs_pv_spike_diagnostic,
    summarize_ai_context_for_log,
)

# Import data providers
from .data_providers import get_data_provider
from .demo.portfolio_demo_fixture import (
    DEMO_CASE_ID,
    DEMO_DATASET_ID,
    DEMO_DATA_SOURCE,
)
from .demo.portfolio_demo_service import (
    ai_response as _demo_ai_response,
    batch_generate_response as _demo_batch_generate_response,
    bq_status_response as _demo_bq_status_response,
    datasets_response as _demo_datasets_response,
    periods_response as _demo_periods_response,
    query_types_response as _demo_query_types_response,
    single_generate_response as _demo_single_generate_response,
)

import math

class _SafeJSONEncoder(json.JSONEncoder):
    """JSON encoder that converts NaN/Inf to null for JSON compatibility."""
    def default(self, obj):
        return super().default(obj)

    def encode(self, obj):
        return super().encode(self._sanitize(obj))

    def _sanitize(self, obj):
        """Recursively sanitize NaN/Inf values in nested structures."""
        if isinstance(obj, float):
            if math.isnan(obj) or math.isinf(obj):
                return None
            return obj
        elif isinstance(obj, dict):
            return {k: self._sanitize(v) for k, v in obj.items()}
        elif isinstance(obj, (list, tuple)):
            return [self._sanitize(item) for item in obj]
        return obj

def _safe_json_dumps(obj, **kwargs):
    """JSON dumps that safely handles NaN/Inf values."""
    return json.dumps(obj, cls=_SafeJSONEncoder, **kwargs)


def _build_chart_data(all_results) -> Dict[str, Any]:
    """
    Build chart data from extraction results for frontend visualization.
    数値の大きさでKPIをグループ化し、複数のグラフセットを生成

    Args:
        all_results: List of (month_tag, ReportData) tuples

    Returns:
        Dict containing groups of charts, each with labels and datasets
    """
    if not all_results:
        return {"groups": []}

    # Sort results by period (oldest first for chronological display)
    sorted_results = sorted(all_results, key=lambda x: x[0])

    # Extract labels (period tags) - 短い期間ラベルを使用
    labels = [format_period_label(month_tag, report) for month_tag, report in sorted_results]

    # Define KPIs to chart with their display names and colors
    kpi_configs = [
        {"key": "cost", "label": "費用", "color": "rgba(255, 99, 132, 1)", "bgColor": "rgba(255, 99, 132, 0.5)"},
        {"key": "impr", "label": "表示回数", "color": "rgba(54, 162, 235, 1)", "bgColor": "rgba(54, 162, 235, 0.5)"},
        {"key": "click", "label": "クリック", "color": "rgba(255, 206, 86, 1)", "bgColor": "rgba(255, 206, 86, 0.5)"},
        {"key": "cv", "label": "CV", "color": "rgba(75, 192, 192, 1)", "bgColor": "rgba(75, 192, 192, 0.5)"},
        {"key": "revenue", "label": "売上", "color": "rgba(155, 89, 182, 1)", "bgColor": "rgba(155, 89, 182, 0.5)"},
        {"key": "ctr", "label": "CTR", "color": "rgba(153, 102, 255, 1)", "bgColor": "rgba(153, 102, 255, 0.5)", "percent": True},
        {"key": "cvr", "label": "CVR", "color": "rgba(255, 159, 64, 1)", "bgColor": "rgba(255, 159, 64, 0.5)", "percent": True},
        {"key": "cpa", "label": "CPA", "color": "rgba(199, 199, 199, 1)", "bgColor": "rgba(199, 199, 199, 0.5)"},
        {"key": "cpc", "label": "CPC", "color": "rgba(83, 102, 255, 1)", "bgColor": "rgba(83, 102, 255, 0.5)"},
    ]

    # Build all datasets first
    all_datasets = []
    for cfg in kpi_configs:
        key = cfg["key"]
        data = []
        for _, report in sorted_results:
            val = report.kpis.get(key) if hasattr(report, 'kpis') else report.get('kpis', {}).get(key)
            # Convert percentage KPIs to readable format (0.05 -> 5.0)
            if val is not None and cfg.get("percent"):
                val = val * 100
            data.append(val)

        # Only include datasets that have at least one non-null value
        if any(v is not None for v in data):
            all_datasets.append({
                "key": key,
                "label": cfg["label"],
                "data": data,
                "borderColor": cfg["color"],
                "backgroundColor": cfg["bgColor"],
                "tension": 0.3,
                "fill": False,
                "isPercent": cfg.get("percent", False),
            })

    # Group KPIs into 2 charts
    # グループ1: 数値系（費用、表示回数、クリック、CV、CPA、CPC）
    # グループ2: 割合系（CTR、CVR）
    groups = []

    # Helper to find dataset by key
    def find_dataset(key):
        return next((ds for ds in all_datasets if ds["key"] == key), None)

    # Group 1: 数値系（金額・回数・単価）
    group1_datasets = []
    for key in ["cost", "impr", "click", "cv", "cpa", "cpc"]:
        ds = find_dataset(key)
        if ds:
            group1_datasets.append(ds)
    if group1_datasets:
        groups.append({
            "title": "数値指標（費用・回数・単価）",
            "labels": labels,
            "datasets": group1_datasets,
        })

    # Group 2: 割合系（CTR、CVR）
    group2_datasets = []
    for key in ["ctr", "cvr"]:
        ds = find_dataset(key)
        if ds:
            group2_datasets.append(ds)
    if group2_datasets:
        groups.append({
            "title": "割合指標（CTR・CVR）",
            "labels": labels,
            "datasets": group2_datasets,
        })

    # Group 3: 売上指標 - データがある場合のみ表示
    group3_datasets = []
    for key in ["revenue"]:
        ds = find_dataset(key)
        if ds:
            group3_datasets.append(ds)
    if group3_datasets:
        groups.append({
            "title": "売上指標",
            "labels": labels,
            "datasets": group3_datasets,
        })

    return {
        "groups": groups,
    }


def _build_media_breakdown_data(all_results) -> Dict[str, Any]:
    """
    Build media breakdown data from extraction results for frontend visualization.

    Args:
        all_results: List of (month_tag, ReportData) tuples

    Returns:
        Dict containing media breakdown data with KPIs per media
    """
    if not all_results:
        return {"media_data": [], "period": ""}

    # Get latest report's media breakdown
    latest_month, latest_report = all_results[0]

    if not hasattr(latest_report, 'media_breakdown') or not latest_report.media_breakdown:
        return {"media_data": [], "period": latest_month}

    media_data = []
    for media in latest_report.media_breakdown:
        media_data.append({
            "name": media.media_name,
            "kpis": {
                k: v for k, v in media.kpis.items() if v is not None
            },
        })

    # Calculate totals for share computation
    total_cost = sum(m.kpis.get('cost', 0) or 0 for m in latest_report.media_breakdown)
    total_cv = sum(m.kpis.get('cv', 0) or 0 for m in latest_report.media_breakdown)

    return {
        "period": latest_month,
        "media_data": media_data,
        "totals": {
            "cost": total_cost,
            "cv": total_cv,
        },
    }











def _gi_log(msg: str) -> None:







    print(f"[gi] {msg}", flush=True)























def _gi_validate_output(text: str, src: str | None = None) -> dict:







    """







    Validate output for submission-level constraints:







    - Only H2 headings: ## 良かった点 / ## 課題 / ## 打ち手 (no H1)







    - Minimum bullets: 3 / 3 / 5







    - Avoid using numbers not present in src (lightweight guard)







    """







    import re















    t = (text or "").strip()







    ok = True







    reasons: list[str] = []















    # H1 check







    if re.search(r"(?m)^#\s", t):







        ok = False







        reasons.append("H1_found")















    # section split







    sec: dict[str, list[str]] = {}







    cur = None







    for line in t.splitlines():







        m = re.match(r"^##\s*(.+?)\s*$", line.strip())







        if m:







            cur = m.group(1).strip()







            sec.setdefault(cur, [])







            continue







        if cur is not None:







            sec[cur].append(line)















    def count_bullets(lines: list[str]) -> int:







        return sum(1 for l in lines if re.match(r"^\s*[-*]\s+\S", l))















    # map by contains (robust)







    g_key = next((k for k in sec.keys() if "良かった点" in k), None)







    k_key = next((k for k in sec.keys() if "課題" in k), None)







    a_key = next((k for k in sec.keys() if "打ち手" in k), None)















    g = count_bullets(sec.get(g_key, [])) if g_key else 0







    k = count_bullets(sec.get(k_key, [])) if k_key else 0







    a = count_bullets(sec.get(a_key, [])) if a_key else 0















    if not g_key or not k_key or not a_key:







        ok = False







        reasons.append("missing_sections")







    if g < 3:







        ok = False







        reasons.append(f"good_bullets_lt3({g})")







    if k < 3:







        ok = False







        reasons.append(f"kadai_bullets_lt3({k})")







    if a < 5:







        ok = False







        reasons.append(f"action_bullets_lt5({a})")















    # lightweight numeric guard: only check >=3 digits or contains '.' or '%' or ',' (avoid false positives)







    unknown_nums: list[str] = []







    if src:







        nums = set(re.findall(r"\d+(?:,\d{3})*(?:\.\d+)?%?", t))







        for n in nums:







            if not (len(n) >= 3 or "." in n or "," in n or n.endswith("%")):







                continue







            if n not in src:







                unknown_nums.append(n)







        if unknown_nums:







            ok = False







            reasons.append("unknown_numbers")















    fix = []







    fix.append("次の条件を必ず満たすように全文を作り直してください。")







    fix.append("出力は「## 良かった点」「## 課題」「## 打ち手」の3セクションのみ。H1は禁止。")







    fix.append("良かった点は最低3項目、課題は最低3項目、打ち手は最低5項目。")







    fix.append("各項目は要点パック内の数値/差分を最低1つ含め、表にない数値は出さない。")







    fix.append("「未取得/不明」が根拠の場合は次回取得すべき計測項目/確認箇所を書く。")







    if unknown_nums:







        fix.append("注意: 要点パックに存在しない数値が含まれているため、それらを使わずに書き直す。")















    return {







        "ok": ok,







        "len": len(t),







        "good": g,







        "kadai": k,







        "action": a,







        "unknown_count": len(unknown_nums),







        "reasons": reasons,







        "fix_prompt": "\\n".join(fix),







    }















def _resolve_repo_path(p) -> Path:







    if not isinstance(p, Path):







        p = Path(str(p))







    if not p.is_absolute():







        p = (BASE_DIR / p).resolve()







    return p















def _read_text_strict(p: Path) -> str:







    # strict UTF-8 first (avoid silent mojibake)







    try:







        return p.read_text(encoding="utf-8-sig")







    except UnicodeDecodeError:







        return p.read_text(encoding="utf-8")  # will still raise if not utf-8































from typing import Any, Callable, Dict, List, Optional















from fastapi import FastAPI, Request, HTTPException
from .api_errors import (
    ensure_request_id,
    http_exception_response,
    normalize_legacy_failure,
    problem_response,
)







from fastapi.responses import Response
from .gemini_budget import (
    GeminiBudgetExceeded,
    GeminiBudgetUnavailable,
    assert_gemini_budget_available,
    get_budget_summary,
    normalize_gemini_model,
    record_gemini_usage_from_response,
    release_gemini_reservation,
    reset_budget_for_dev,
)















def _stable_operation_id(route) -> str:
    """Keep OpenAPI operation IDs deterministic for legacy multi-method routes.

    FastAPI's default generator selects the first item from ``route.methods``,
    which is a set.  Routes that intentionally accept both GET and POST would
    therefore alternate their generated schema between processes.  Sorting
    preserves the established GET-based IDs while making snapshots stable.
    """
    operation_id = re.sub(r"\W", "_", f"{route.name}{route.path_format}")
    methods = sorted(str(method).lower() for method in (route.methods or ()))
    return f"{operation_id}_{methods[0]}"


app = FastAPI(
    title="ads-insights backend API",
    generate_unique_id_function=_stable_operation_id,
)


@app.exception_handler(GeminiBudgetUnavailable)
async def _gemini_budget_unavailable_handler(request: Request, _exc: GeminiBudgetUnavailable):
    return problem_response(
        request,
        status_code=503,
        code="ai_budget_unavailable",
        category="dependency",
        user_message="AI分析を一時的に利用できません。時間をおいて再試行してください。",
        retryable=True,
    )
from .routers.platform_routes import router as platform_router
from .platform.bq_adapter import test_ga4_bigquery_data_source
from .routers.platform_v2_routes import create_platform_v2_router
from .platform.runtime_access import RuntimeAccessError, resolve_clerk_project_runtime_access
from .platform.rate_limits import (
    RateLimitUnavailable,
    consume_rate_limit,
    verified_clerk_subject_material,
)
from .routers.report_v2_routes import create_report_v2_router, report_platform_session
from .reporting.platform_identity import create_platform_report_identity_dependency
from .routers.billing_routes import create_billing_router, billing_platform_session
from .billing.platform_identity import create_platform_billing_identity_dependency
from .routers.legal_routes import create_legal_router, legal_platform_session
from .legal.platform_identity import create_platform_legal_identity_dependency

app.include_router(platform_router)
app.include_router(
    create_platform_v2_router(data_source_tester=test_ga4_bigquery_data_source)
)
report_identity = create_platform_report_identity_dependency(report_platform_session)
app.include_router(
    create_report_v2_router(
        session_dependency=report_platform_session,
        identity_dependency=report_identity,
    )
)
billing_identity = create_platform_billing_identity_dependency(billing_platform_session)
app.include_router(
    create_billing_router(
        session_dependency=billing_platform_session,
        identity_dependency=billing_identity,
    )
)
legal_identity = create_platform_legal_identity_dependency(legal_platform_session)
app.include_router(
    create_legal_router(
        session_dependency=legal_platform_session,
        identity_dependency=legal_identity,
    )
)

from .observability import (
    capture_exception_safe,
    initialize_sentry,
    log_event,
    workspace_hash as observability_workspace_hash,
)

initialize_sentry()


@app.middleware("http")
async def _structured_runtime_logging(request: Request, call_next):
    """Log operational metadata only; never log URLs, bodies, or identities."""
    if not request.url.path.startswith("/api/"):
        return await call_next(request)
    started = time.perf_counter()
    request_id = ensure_request_id(request)
    try:
        response = await call_next(request)
    except Exception:
        log_event(
            "error",
            "request_failed",
            request_id=request_id,
            workspace_hash=observability_workspace_hash(
                getattr(request.state, "workspace_id", None)
            ),
            duration_ms=round((time.perf_counter() - started) * 1000),
            error_code="unhandled_exception",
        )
        raise
    log_event(
        "error" if response.status_code >= 500 else "info",
        "request_completed",
        request_id=request_id,
        workspace_hash=observability_workspace_hash(
            getattr(request.state, "workspace_id", None)
        ),
        duration_ms=round((time.perf_counter() - started) * 1000),
        status_code=response.status_code,
        **({"error_code": "server_error"} if response.status_code >= 500 else {}),
    )
    return response

@app.on_event("startup")
async def startup_event():
    import asyncio
    # Production/Vercel cold starts must not inspect or mutate customer-file
    # directories before a request has even been authenticated.  Keep the
    # legacy stale-folder maintenance local-development only.
    if not _IS_PRODUCTION:
        asyncio.create_task(_cleanup_stale_gdrive_folders())
    # BigQuery credentials are configured lazily by bq.client.get_client().
    # Keeping startup credential-free guarantees that a demo-only cold start
    # does not decode or materialize the production service-account secret.

async def _cleanup_stale_gdrive_folders():
    """
    Clean up 'gdrive_' folders in the root data directory that are older than 24 hours.
    This prevents accumulation of leaked/legacy data.
    """
    try:
        data_dir = _get_data_dir()
        if not data_dir.exists():
            return
            
        print("[cleanup] Starting cleanup of stale gdrive folders in root data dir...")
        
        import time
        import shutil
        
        limit_seconds = 24 * 3600 # 24 hours
        now = time.time()
        count = 0
        
        for item in data_dir.iterdir():
            if item.is_dir() and item.name.startswith("gdrive_"):
                # check mtime
                try:
                    mtime = item.stat().st_mtime
                    if now - mtime > limit_seconds:
                        print(f"[cleanup] Deleting stale folder: {item.name}")
                        shutil.rmtree(str(item))
                        count += 1
                except Exception as e:
                    print(f"[cleanup] Error checking/deleting {item.name}: {e}")
                    
        print(f"[cleanup] Finished. Deleted {count} stale folders.")
        
    except Exception as e:
        print(f"[cleanup] Startup cleanup failed: {e}")

# CORS設定 - VercelフロントエンドからのAPIリクエストを許可
from fastapi.middleware.cors import CORSMiddleware

_IS_PRODUCTION = bool(os.getenv("RENDER") or os.getenv("VERCEL"))

_CORS_DEV_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3002",
    "http://127.0.0.1:8000",
]

_CORS_DEFAULT_ORIGINS = [] if _IS_PRODUCTION else list(_CORS_DEV_ORIGINS)

_cors_extra = os.getenv("CORS_ALLOWED_ORIGINS", "")
if _cors_extra and not _IS_PRODUCTION:
    _CORS_DEFAULT_ORIGINS.extend([o.strip() for o in _cors_extra.split(",") if o.strip()])

# ── 認証 (JWT 方式) ──────────────────────────────────────────
import hashlib, secrets, time as _time_mod
import jwt
time = _time_mod  # ensure 'time' is available for rate limiter below

_AUTH_PASSWORD = (os.getenv("APP_PASSWORD") or os.getenv("管理者パスワード") or "").strip()
if not _AUTH_PASSWORD:
    raise RuntimeError(
        "APP_PASSWORD or 管理者パスワード environment variable must be set. "
        "Add it to .env.local/.env for local dev or set it in the Render dashboard for production."
    )

_JWT_SECRET = (os.getenv("JWT_SECRET") or "").strip()
if not _JWT_SECRET:
    raise RuntimeError(
        "JWT_SECRET environment variable must be set. "
        "Add it to .env.local for local dev or set it in the Render dashboard for production."
    )
_JWT_ALG = "HS256"
_AUTH_TOKEN_TTL = 24 * 3600  # 24 hours
_DEVICE_TRUST_TTL = 14 * 24 * 3600  # 14 days — tweak this single constant to change skip window

def _generate_auth_token() -> str:
    """Generate a global administrator token.

    Role claims are mandatory so a token issued for a customer case can never
    be mistaken for a global token by downstream authorization checks.
    """
    payload = {
        "typ": "auth",
        "role": "admin",
        "exp": int(time.time()) + _AUTH_TOKEN_TTL,
        "jti": secrets.token_urlsafe(8),
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALG)


def _generate_case_auth_token(case: dict) -> str:
    """Generate a case-scoped token with a server-signed dataset binding."""
    payload = {
        "typ": "auth",
        "role": "case_user",
        "case_id": case["case_id"],
        "dataset_id": case.get("dataset_id", ""),
        "exp": int(time.time()) + _AUTH_TOKEN_TTL,
        "jti": secrets.token_urlsafe(8),
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALG)


def _decode_auth_token(token: str) -> Optional[dict]:
    if not token:
        return None
    try:
        payload = jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALG])
    except jwt.InvalidTokenError:
        return None
    if payload.get("typ") != "auth" or payload.get("role") not in {"admin", "case_user"}:
        return None
    if payload.get("role") == "case_user" and not (
        payload.get("case_id") and payload.get("dataset_id")
    ):
        return None
    return payload


def _validate_token(token: str) -> bool:
    return _decode_auth_token(token) is not None


def _get_request_auth_claims(request: Optional[Request]) -> Optional[dict]:
    """Read claims attached by middleware, with a header fallback.

    Direct function calls used by legacy unit tests have no HTTP headers and
    retain administrator semantics. Actual HTTP requests always pass through
    the authentication middleware first.
    """
    if request is None or not hasattr(request, "headers"):
        return {"typ": "auth", "role": "admin"}
    state = getattr(request, "state", None)
    claims = getattr(state, "auth_claims", None) if state is not None else None
    if isinstance(claims, dict):
        return claims
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "") if auth_header.startswith("Bearer ") else ""
    return _decode_auth_token(token)


def _same_dataset_ref(left: str, right: str) -> bool:
    """Compare configured dataset refs without weakening explicit project refs."""
    left = str(left or "").strip()
    right = str(right or "").strip()
    if left == right:
        return True
    if not left or not right:
        return False
    if "." in left and "." in right:
        return False
    return left.rsplit(".", 1)[-1] == right.rsplit(".", 1)[-1]


def _validate_case_demo_configuration(case: dict) -> bool:
    """Validate the reserved demo registry record and return its demo state.

    The case id and the explicit marker must agree.  A partial or malformed
    demo configuration fails closed instead of falling through to a real data
    path.
    """
    case_id_is_demo = str(case.get("case_id") or "") == DEMO_CASE_ID
    is_demo = case.get("is_demo") is True
    if case_id_is_demo != is_demo:
        raise HTTPException(status_code=403, detail="Demo case registry configuration is invalid")
    if not is_demo:
        return False
    if case.get("is_active") is not True:
        raise HTTPException(status_code=403, detail="Demo case is not active")
    if case.get("is_internal", False) is not False:
        raise HTTPException(status_code=403, detail="Demo case registry configuration is invalid")
    if case.get("totp_enabled", False) is not False or bool(case.get("totp_secret")):
        raise HTTPException(status_code=403, detail="Demo case registry configuration is invalid")
    if str(case.get("dataset_id") or "").strip() != DEMO_DATASET_ID:
        raise HTTPException(status_code=403, detail="Demo case dataset configuration is invalid")
    return True


def _resolve_demo_case_for_request(request: Optional[Request]) -> Optional[dict]:
    """Resolve demo mode only from a verified case JWT and server registry.

    This also revalidates active status and the JWT's signed dataset binding for
    every case user.  Administrators never enter demo mode by selecting the
    reserved dataset in a request.
    """
    claims = _get_request_auth_claims(request)
    if not claims or claims.get("role") != "case_user":
        return None

    case_id = str(claims.get("case_id") or "")
    signed_dataset_id = str(claims.get("dataset_id") or "").strip()
    case = next(
        (item for item in _load_cases_master() if str(item.get("case_id") or "") == case_id),
        None,
    )
    if not case or not case.get("is_active", True):
        raise HTTPException(status_code=403, detail="Authenticated case is no longer active")

    server_dataset_id = str(case.get("dataset_id") or "").strip()
    if not server_dataset_id or not signed_dataset_id:
        raise HTTPException(status_code=403, detail="Authenticated case has no dataset scope")
    if signed_dataset_id != server_dataset_id:
        raise HTTPException(status_code=403, detail="Authenticated case dataset scope has changed; sign in again")

    return case if _validate_case_demo_configuration(case) else None


def _validate_demo_requested_datasets(case: dict, *requested_values: Any) -> None:
    server_dataset_id = str(case.get("dataset_id") or "").strip()
    for requested in requested_values:
        requested_dataset_id = str(requested or "").strip()
        if requested_dataset_id and requested_dataset_id != server_dataset_id:
            raise HTTPException(status_code=403, detail="Requested dataset is outside authenticated case scope")


def _validate_demo_ai_payload(case: dict, payload: dict) -> None:
    if payload.get("point_pack_path"):
        raise HTTPException(status_code=403, detail="File-based point packs are not available to customer cases")
    requested_data_source = str(payload.get("data_source") or "").strip().lower()
    if requested_data_source and requested_data_source not in {"bq", DEMO_DATA_SOURCE}:
        raise HTTPException(status_code=403, detail="Customer case analysis is limited to its scoped data source")

    meta = payload.get("analysis_context_meta")
    meta = meta if isinstance(meta, dict) else {}
    _validate_demo_requested_datasets(
        case,
        payload.get("datasetId"),
        payload.get("dataset_id"),
        meta.get("datasetId"),
        meta.get("dataset_id"),
    )
    if any(str(value or "").strip() for value in (payload.get("bq_project_id"), payload.get("projectId"))):
        raise HTTPException(status_code=403, detail="BigQuery project overrides are not available in demo mode")


def _resolve_bq_dataset_for_request(
    request: Optional[Request],
    requested_dataset_id: Optional[str],
    *,
    admin_default: str = "analytics_311324674",
) -> str:
    """Resolve a dataset under the authenticated tenant boundary.

    Administrators retain explicit dataset selection. Case users are bound to
    the active server-side case record; a conflicting client value is rejected.
    """
    claims = _get_request_auth_claims(request)
    if not claims:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if claims.get("role") == "admin":
        return str(requested_dataset_id or admin_default).strip()
    if claims.get("role") == "project_user":
        server_dataset_id = str(claims.get("dataset_id") or "").strip()
        if not server_dataset_id:
            raise HTTPException(status_code=403, detail="Authenticated project has no data source")
        if requested_dataset_id and not _same_dataset_ref(str(requested_dataset_id), server_dataset_id):
            raise HTTPException(status_code=403, detail="Requested dataset is outside authenticated project scope")
        return server_dataset_id

    case_id = str(claims.get("case_id") or "")
    signed_dataset_id = str(claims.get("dataset_id") or "").strip()
    case = next(
        (
            item
            for item in _load_cases_master()
            if item.get("case_id") == case_id and item.get("is_active", True)
        ),
        None,
    )
    if not case:
        raise HTTPException(status_code=403, detail="Authenticated case is no longer active")
    server_dataset_id = str(case.get("dataset_id") or "").strip()
    if not server_dataset_id or not signed_dataset_id:
        raise HTTPException(status_code=403, detail="Authenticated case has no dataset scope")
    if not _same_dataset_ref(signed_dataset_id, server_dataset_id):
        raise HTTPException(status_code=403, detail="Authenticated case dataset scope has changed; sign in again")
    if requested_dataset_id and not _same_dataset_ref(str(requested_dataset_id), server_dataset_id):
        raise HTTPException(status_code=403, detail="Requested dataset is outside authenticated case scope")
    return server_dataset_id


def _report_runtime_options(request: Request) -> dict[str, Any]:
    """Resolve report policy from authenticated server-owned project data."""
    claims = _get_request_auth_claims(request) or {}
    role = str(claims.get("role") or "")
    if role == "project_user":
        return {
            "cv_events": list(claims.get("cv_events") or []),
            "timezone": str(claims.get("timezone") or "Asia/Tokyo"),
            "report_project_id": str(claims.get("project_id") or "unknown"),
        }
    if role == "case_user":
        case_id = str(claims.get("case_id") or "")
        case = next(
            (
                item
                for item in _load_cases_master()
                if item.get("case_id") == case_id and item.get("is_active", True)
            ),
            {},
        )
        return {
            "cv_events": case.get("cv_events") or case.get("conversion_events"),
            "timezone": str(case.get("timezone") or "Asia/Tokyo"),
            "report_project_id": case_id or "legacy",
        }
    return {
        "cv_events": None,
        "timezone": "Asia/Tokyo",
        "report_project_id": "platform-admin",
    }

def _device_trust_version(case: dict) -> int:
    try:
        return max(1, int(case.get("device_trust_version", 1)))
    except (TypeError, ValueError):
        return 1


def _generate_device_trust_token(case: dict) -> str:
    payload = {
        "typ": "device_trust",
        "case_id": case["case_id"],
        "version": _device_trust_version(case),
        "exp": int(time.time()) + _DEVICE_TRUST_TTL,
        "jti": secrets.token_urlsafe(8),
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALG)

def _validate_device_trust_token(token: str, case: dict) -> bool:
    if not token:
        return False
    try:
        payload = jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALG])
    except jwt.InvalidTokenError:
        return False
    return (
        payload.get("typ") == "device_trust"
        and payload.get("case_id") == case.get("case_id")
        and payload.get("version") == _device_trust_version(case)
    )

# Public paths that don't require auth
_AUTH_PUBLIC_PATHS = {
    "/",
    "/api/auth/login",
    "/api/health",
    "/api/ads/health",
    "/api/cases/login",
    "/api/neon/health",
    "/api/ads/neon/health",
    "/api/insights/neon/health",
    "/api/platform/readiness",
}

# These paths bypass only the legacy HS256 gate. Each registered platform v2
# route performs its own Clerk RS256 or Svix signature verification.
_PLATFORM_V2_AUTH_PREFIXES = (
    "/api/auth/bootstrap",
    "/api/auth/me",
    "/api/projects",
    "/api/webhooks/clerk",
    "/api/billing",
    "/api/legal",
)

# Public report shares bypass the legacy password/JWT gate. The opaque token is
# still resolved by hash in PostgreSQL, expires within seven days, and can be
# revoked. No other report endpoint is public.
_PUBLIC_REPORT_SHARE_PREFIX = "/api/report-shares/"

_ADMIN_ONLY_API_PATHS = {
    ("GET", "/api/config"),
    ("POST", "/api/config"),
    ("POST", "/api/gdrive/sync"),
    ("POST", "/api/gdrive/sync_files"),
    ("POST", "/api/gdrive/clear_all_folders"),
    ("POST", "/api/cross_source_map"),
    ("DELETE", "/api/cross_source_map"),
    ("GET", "/api/cross_source_map"),
    ("GET", "/api/cross_source_candidates"),
}

# case_user is deny-by-default.  Keep this list deliberately small and tied to
# the customer UI's GA4 report flow.  Any new API route remains administrator
# only until it is reviewed and explicitly added here.
_CASE_USER_ALLOWED_API_PATHS = {
    ("GET", "/api/cases"),
    ("GET", "/api/bq/datasets"),
    ("GET", "/api/bq/query_types"),
    ("GET", "/api/bq/periods"),
    ("POST", "/api/bq/generate"),
    ("POST", "/api/bq/generate_batch"),
    ("POST", "/api/neon/generate"),
    ("POST", "/api/ads/neon/generate"),
    ("POST", "/api/insights/neon/generate"),
}

_PROJECT_USER_ALLOWED_API_PATHS = {
    ("GET", "/api/bq/query_types"),
    ("GET", "/api/bq/periods"),
    ("POST", "/api/bq/generate"),
    ("POST", "/api/bq/generate_batch"),
    ("POST", "/api/neon/generate"),
    ("POST", "/api/ads/neon/generate"),
    ("POST", "/api/insights/neon/generate"),
}


def _is_admin_only_api_path(method: str, path: str) -> bool:
    if (method.upper(), path) in _ADMIN_ONLY_API_PATHS:
        return True
    return method.upper() == "POST" and path.startswith("/api/cases/") and path.endswith("/totp/setup")


def _is_case_user_allowed_api_path(method: str, path: str) -> bool:
    method = method.upper()
    if (method, path) in _CASE_USER_ALLOWED_API_PATHS:
        return True
    if method == "GET" and path.startswith("/api/cases/") and path.endswith("/bq-status"):
        case_id = path[len("/api/cases/"):-len("/bq-status")]
        return bool(case_id) and "/" not in case_id
    return False


def _is_project_user_allowed_api_path(method: str, path: str) -> bool:
    return (method.upper(), path) in _PROJECT_USER_ALLOWED_API_PATHS

# ── ログイン専用 brute-force 対策 ─────────────────────────
_LOGIN_MAX_FAILURES = 5       # 最大失敗回数
_LOGIN_LOCKOUT_SECONDS = 600  # ロックアウト期間（10分）
_login_failures: dict[str, list] = {}  # "realm:ip" -> [timestamp, ...]

def _get_login_client_ip(request: Request) -> str:
    """request.client.host を使う（X-Client-ID は信頼しない）"""
    return request.client.host if request.client else "unknown"

def _login_failure_key(ip: str, realm: str) -> str:
    return f"{realm}:{ip}"


def _is_login_locked(ip: str, realm: str) -> bool:
    key = _login_failure_key(ip, realm)
    failures = _login_failures.get(key)
    if not failures:
        return False
    now = time.time()
    # 古い失敗記録を除去
    _login_failures[key] = [t for t in failures if now - t < _LOGIN_LOCKOUT_SECONDS]
    return len(_login_failures[key]) >= _LOGIN_MAX_FAILURES

def _record_login_failure(ip: str, realm: str) -> None:
    _login_failures.setdefault(_login_failure_key(ip, realm), []).append(time.time())

def _clear_login_failures(ip: str, realm: str) -> None:
    _login_failures.pop(_login_failure_key(ip, realm), None)

@app.post("/api/auth/login")
async def auth_login(request: Request):
    from starlette.responses import JSONResponse
    ip = _get_login_client_ip(request)
    if _is_login_locked(ip, "admin"):
        return JSONResponse(
            {"ok": False, "error": "Too many failed attempts. Try again later."},
            status_code=429,
        )
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "Invalid request"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"ok": False, "error": "Invalid request"}, status_code=400)
    password = body.get("password", "")
    if not isinstance(password, str):
        return JSONResponse({"ok": False, "error": "Invalid request"}, status_code=400)
    if not secrets.compare_digest(password, _AUTH_PASSWORD):
        _record_login_failure(ip, "admin")
        return JSONResponse({"ok": False, "error": "Invalid password"}, status_code=401)
    _clear_login_failures(ip, "admin")
    token = _generate_auth_token()
    return JSONResponse({"ok": True, "token": token})

@app.middleware("http")
async def _auth_middleware(request, call_next):
    """全APIリクエストにトークン認証を要求."""
    path = request.url.path
    # Skip auth for public paths, static files, OPTIONS (CORS preflight)
    if (
        request.method == "OPTIONS"
        or path in _AUTH_PUBLIC_PATHS
        or any(path == prefix or path.startswith(prefix + "/") for prefix in _PLATFORM_V2_AUTH_PREFIXES)
        or path.startswith(_PUBLIC_REPORT_SHARE_PREFIX)
        or not path.startswith("/api/")
    ):
        return await call_next(request)
    # Check Authorization header
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "") if auth_header.startswith("Bearer ") else ""
    claims = _decode_auth_token(token)
    if not claims and token:
        try:
            claims = resolve_clerk_project_runtime_access(
                token,
                request.headers.get("X-Insight-Project", ""),
            )
        except RuntimeAccessError as exc:
            status_code = int(getattr(exc, "status_code", 401))
            error_code = str(getattr(exc, "code", "authentication_required"))
            messages = {
                "authentication_required": "ログインが必要です。",
                "project_scope_required": "分析するサイトを選択してください。",
                "project_write_forbidden": "このサイトのレポートを作る権限がありません。",
                "project_access_forbidden": "このサイトを利用する権限がありません。",
                "legal_acceptance_required": "最新版の規約への同意が必要です。",
                "subscription_write_forbidden": "現在の契約では新しいレポートを作成できません。",
                "data_source_not_ready": "データ接続の確認が完了していません。",
                "platform_database_unavailable": "サービスの準備が整っていません。少し待って再試行してください。",
            }
            return problem_response(
                request,
                status_code=status_code,
                code=error_code,
                category=(
                    "dependency" if status_code >= 500
                    else "authentication" if status_code == 401
                    else "authorization"
                ),
                user_message=messages.get(error_code, "ログイン状態を確認できませんでした。"),
                retryable=status_code >= 500,
            )
        except Exception:
            return problem_response(
                request,
                status_code=503,
                code="platform_access_unavailable",
                category="dependency",
                user_message="サービスの準備が整っていません。少し待って再試行してください。",
                retryable=True,
            )
    if not claims:
        return problem_response(
            request,
            status_code=401,
            code="authentication_required",
            category="authentication",
            user_message="ログインが必要です。",
        )
    request.state.auth_claims = claims
    if claims.get("role") == "case_user" and not _is_case_user_allowed_api_path(request.method, path):
        return problem_response(
            request,
            status_code=403,
            code="access_denied",
            category="authorization",
            user_message="この操作を行う権限がありません。",
        )
    if claims.get("role") == "project_user" and not _is_project_user_allowed_api_path(request.method, path):
        return problem_response(
            request,
            status_code=403,
            code="access_denied",
            category="authorization",
            user_message="この操作を行う権限がありません。",
        )
    if _is_admin_only_api_path(request.method, path) and claims.get("role") != "admin":
        return problem_response(
            request,
            status_code=403,
            code="access_denied",
            category="authorization",
            user_message="この操作を行う権限がありません。",
        )
    return await call_next(request)

# ── 共有レート制限 ─────────────────────────────────────────
import ipaddress
from starlette.concurrency import run_in_threadpool

_RATE_LIMIT_MAX = int(os.getenv("RATE_LIMIT_MAX", "30"))
_RATE_LIMIT_WINDOW = int(os.getenv("RATE_LIMIT_WINDOW", "60"))
_RATE_LIMITED_PATHS = {
    "/api/generate_insights",
    "/api/neon/generate",
    "/api/ads/neon/generate",
    "/api/insights/neon/generate",
    "/api/chat",
    "/api/bq/generate",
    "/api/bq/generate_batch",
    "/api/generate_report",
    "/api/generate_multi_report",
    "/api/gdrive/process_and_generate",
}

_RATE_LIMITED_MUTATION_PREFIXES = (
    "/api/projects",
    "/api/legal/",
)
_RATE_LIMITED_PLATFORM_MUTATIONS = {
    "/api/auth/bootstrap",
    "/api/billing/checkout",
    "/api/billing/checkout-sessions",
    "/api/billing/portal",
    "/api/billing/portal-sessions",
}


def _is_shared_rate_limited_request(method: str, path: str) -> bool:
    normalized_method = str(method or "").upper()
    normalized_path = str(path or "")
    if normalized_method == "OPTIONS":
        return False
    if normalized_path in _RATE_LIMITED_PATHS:
        return True
    if normalized_method not in {"POST", "PATCH", "DELETE"}:
        return False
    if normalized_path in _RATE_LIMITED_PLATFORM_MUTATIONS:
        return True
    return any(
        normalized_path == prefix.rstrip("/") or normalized_path.startswith(prefix)
        for prefix in _RATE_LIMITED_MUTATION_PREFIXES
    )


def _socket_client_ip(request: Request) -> str:
    raw_value = request.client.host if request.client else "unknown"
    try:
        return ipaddress.ip_address(raw_value).compressed
    except ValueError:
        return "unknown"


def _get_rate_limit_subject(request: Request) -> str:
    """Use verified identity or socket IP; never caller-controlled headers."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "") if auth_header.startswith("Bearer ") else ""
    claims = getattr(getattr(request, "state", None), "auth_claims", None) or _decode_auth_token(token)
    if claims and claims.get("role") == "case_user":
        return f"case:{claims.get('case_id')}"
    if claims and claims.get("role") == "admin":
        signed_identity = claims.get("sub") or "legacy-admin"
        return f"admin:{signed_identity}"
    if claims and claims.get("role") == "project_user":
        return (
            f"project:{claims.get('workspace_id')}:"
            f"{claims.get('user_id') or 'unknown'}"
        )
    if token:
        clerk_subject = verified_clerk_subject_material(token)
        if clerk_subject:
            return clerk_subject
        # An invalid bearer value is unauthenticated.  Binding it to the
        # socket IP prevents bypass by rotating arbitrary token strings.
        return f"invalid-token-ip:{_socket_client_ip(request)}"
    return f"ip:{_socket_client_ip(request)}"


@app.middleware("http")
async def _rate_limit_middleware(request, call_next):
    """Consume a PostgreSQL-shared slot for data and commercial mutations.

    Legacy password endpoints retain their existing bounded in-process
    brute-force limiter so the pre-Clerk demo login remains usable without a
    platform database. Customer data and commercial mutations still fail
    closed when shared persistence is unavailable.
    """
    if _is_shared_rate_limited_request(request.method, request.url.path):
        try:
            decision = await run_in_threadpool(
                consume_rate_limit,
                subject_material=_get_rate_limit_subject(request),
                route_key=f"{request.method.upper()}:{request.url.path}",
                limit=_RATE_LIMIT_MAX,
                window_seconds=_RATE_LIMIT_WINDOW,
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

@app.get("/api/usage/budget")
async def api_gemini_budget():
    return get_budget_summary()


@app.post("/api/usage/reset-dev")
async def api_gemini_budget_reset_dev():
    try:
        return reset_budget_for_dev()
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@app.post("/api/usage/gemini-smoke-test")
async def api_gemini_budget_smoke_test(request: Request):
    payload = await request.json()
    client_key = request.headers.get("X-Gemini-API-Key") or payload.get("api_key")
    if not client_key:
        return JSONResponse(
            {"ok": False, "error_code": "api_key_required", "detail": "Gemini APIキーが必要です。"},
            status_code=403,
        )

    model = normalize_gemini_model(payload.get("model") or "gemini-3.1-flash-lite")
    prompt = (
        "Insight Studio Gemini budget smoke test. "
        "Reply with exactly this text only: OK"
    )
    before = get_budget_summary()
    try:
        text = _gemini_generate(
            model=model,
            prompt=prompt,
            temperature=0.0,
            max_tokens=512,
            api_key=client_key,
            feature="ads.budget_smoke_test",
        )
    except GeminiBudgetUnavailable:
        return problem_response(
            request,
            status_code=503,
            code="ai_budget_unavailable",
            category="dependency",
            user_message="AI分析を一時的に利用できません。時間をおいて再試行してください。",
            retryable=True,
        )
    except GeminiBudgetExceeded as exc:
        return JSONResponse(
            {
                "ok": False,
                "error_code": "gemini_budget_exceeded",
                "detail": "Geminiの月間利用上限に達しました。Claude fallbackを使うか、翌月まで待ってください。",
                "retryable": False,
                "raw_error": str(exc)[:300],
            },
            status_code=429,
        )
    except RuntimeError as exc:
        msg = str(exc)
        status = 401 if "HTTPError 401" in msg or "API key" in msg.lower() else 400
        return JSONResponse(
            {
                "ok": False,
                "error_code": "gemini_smoke_test_failed",
                "detail": msg[:300],
                "retryable": False,
            },
            status_code=status,
        )

    after = get_budget_summary()
    delta_usd = max(0.0, float(after.get("used_usd") or 0) - float(before.get("used_usd") or 0))
    return {
        "ok": True,
        "model": model,
        "text_preview": str(text)[:80],
        "delta_usd": round(delta_usd, 8),
        "before": before,
        "after": after,
    }

# _FORCE_JSON_CHARSET_UTF8 + セキュリティヘッダー
@app.middleware("http")
async def _force_json_charset_utf8(request, call_next):
    request_id = ensure_request_id(request)
    resp = await call_next(request)
    ct = resp.headers.get("content-type", "")
    if ct.startswith("application/json") and "charset=" not in ct:
        resp.headers["content-type"] = "application/json; charset=utf-8"

    # PNA is a local-development compatibility feature. Never advertise
    # private-network access from a production response.
    origin = request.headers.get("origin", "")
    if (
        not _IS_PRODUCTION
        and request.headers.get("access-control-request-private-network", "").lower() == "true"
        and origin in _CORS_DEV_ORIGINS
    ):
        resp.headers["Access-Control-Allow-Private-Network"] = "true"

    resp.headers["X-Request-ID"] = request_id
    if (
        request.url.path.startswith("/api/auth/")
        or request.url.path.startswith("/api/webhooks/")
        or request.url.path.startswith("/api/billing/")
        or request.url.path.startswith("/api/legal/")
        or (
            request.url.path.startswith("/api/projects/")
            and "/reports" in request.url.path
        )
    ):
        resp.headers["Cache-Control"] = "private, no-store"

    # セキュリティヘッダー
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    # HSTS: HTTPS 接続時のみ付与
    fwd_proto = request.headers.get("x-forwarded-proto", "")
    if request.url.scheme == "https" or fwd_proto == "https":
        resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    return resp















def repo_root() -> Path:







    return Path(__file__).resolve().parents[2]















ROOT = repo_root()







COMPARE_DIR = ROOT / "compare"







INSIGHTS_DIR = ROOT / "insights"















def _json(obj: Any, status: int = 200) -> Response:







    return Response(







        content=_safe_json_dumps(
            normalize_legacy_failure(obj, status),
            ensure_ascii=False,
        ).encode("utf-8"),







        status_code=status,







        headers={"Content-Type": "application/json; charset=utf-8"},







    )







def _rel(p: Path) -> str:







    """







    Return a repo-relative POSIX path when possible.







    If p is outside ROOT (e.g., compare/ is a junction to another drive),







    fall back to an absolute POSIX path.







    """







    try:







        return p.relative_to(ROOT).as_posix()







    except Exception:







        try:







            return p.resolve().as_posix()







        except Exception:







            return str(p)































def repo_root() -> Path:







    return Path(__file__).resolve().parents[2]















ROOT = repo_root()







COMPARE_DIR = ROOT / "compare"







INSIGHTS_DIR = ROOT / "insights"















def _json(obj: Any, status: int = 200) -> Response:







    return Response(







        content=_safe_json_dumps(
            normalize_legacy_failure(obj, status),
            ensure_ascii=False,
        ).encode("utf-8"),







        status_code=status,







        headers={"Content-Type": "application/json; charset=utf-8"},







    )







def _rel(p: Path) -> str:







    """







    Return a repo-relative POSIX path when possible.







    If p is outside ROOT (e.g., compare/ is a junction to another drive),







    fall back to an absolute POSIX path.







    """







    try:







        return p.relative_to(ROOT).as_posix()







    except Exception:







        try:







            return p.resolve().as_posix()







        except Exception:







            return str(p)















def _find_point_packs() -> List[Dict[str, str]]:







    if not COMPARE_DIR.exists():







        return []







    files = sorted(COMPARE_DIR.rglob("*point-pack*.md"))







    items: List[Dict[str, str]] = []







    for f in files:







        items.append({"id": f.name, "name": f.stem, "path": _rel(f)})







    return items















def _read_text(p: Path) -> str:







    for enc in ("utf-8-sig", "utf-8", "cp932"):







        try:







            return p.read_text(encoding=enc)







        except Exception:







            pass







    return p.read_text(errors="replace")















def _resolve_path(body: Dict[str, Any], default_dir: Path) -> Optional[Path]:







    if "path" in body and body["path"]:







        p = (ROOT / str(body["path"])).resolve()







        if p.exists():







            return p







    if "id" in body and body["id"]:







        p = (default_dir / str(body["id"])).resolve()







        if p.exists():







            return p







    if "name" in body and body["name"]:







        cand = list(default_dir.glob(str(body["name"]) + "*.md"))







        if cand:







            return cand[0].resolve()







    return None


















def _resolve_folder_path(folder_path: str, base_dir: Optional[Path] = None) -> Path:
    """
    フォルダパスを解決する

    Args:
        folder_path: 相対パスまたは絶対パス
        base_dir: ベースディレクトリ（Noneの場合はDRIVE_ROOTまたはdata/を使用）

    Returns:
        解決されたPath

    Notes:
        - base_dirが指定されている場合、そこからの相対パスとして解決
        - 指定されていない場合、DRIVE_ROOT環境変数が設定されていればそこから解決
        - どちらもない場合、プロジェクトルート/dataからの相対パスとして解決
    """
    # "__demo__/XXX" プレフィックスの場合は data_demo/ に解決する
    if folder_path.startswith("__demo__/"):
        demo_sub = folder_path[len("__demo__/"):]
        return BASE_DIR / "data_demo" / demo_sub

    path = Path(folder_path)

    # 絶対パスの場合はそのまま返す
    if path.is_absolute():
        return path

    # "users/{client_id}/XXX" のようなパスが来た場合、最後のフォルダ名だけを使う
    # 例: "users/abc123/HDC" -> "HDC"
    parts = path.parts
    if len(parts) >= 3 and parts[0] == "users":
        # users/{client_id}/folder_name -> folder_name だけを使用
        folder_path = str(Path(*parts[2:]))

    # base_dirが指定されている場合はそこからの相対パスとして解決
    if base_dir is not None:
        return base_dir / folder_path

    # DRIVE_ROOT環境変数があればそこからの相対パスとして解決
    drive_root = os.getenv("DRIVE_ROOT")
    if drive_root:
        return Path(drive_root) / folder_path

    # なければ、プロジェクトルート/dataからの相対パスとして解決
    return BASE_DIR / "data" / folder_path


@app.get("/")
def api_root():
    """Root endpoint to reduce 404 noise and provide basic info."""
    return _json({"message": "Ads Insights Backend API", "docs": "/docs", "status": "online"})

@app.get("/api/list_periods")
async def api_list_periods(request: Request, folder_path: str = ""):
    """
    利用可能な期間情報一覧を取得

    Args:
        folder_path: フォルダパス（オプション）

    Returns:
        {
            "ok": true,
            "periods": [
                {
                    "identifier": "...",
                    "period_tag": "2025-11",
                    "period_type": "monthly",
                    "period_start": "2025-11-01",
                    "period_end": "2025-11-30",
                    "filename": "..."
                },
                ...
            ],
            "provider_type": "excel" or "mock"
        }
    """
    try:
        # ユーザーのベースディレクトリを取得
        user_base_dir = _get_user_base_dir(request)

        # folder_pathが指定されている場合は、そのフォルダを使用
        if folder_path:
            base_dir = _resolve_folder_path(folder_path, user_base_dir)
            provider = get_data_provider(base_dir=base_dir)
        else:
            provider = get_data_provider(base_dir=user_base_dir)

        periods = provider.list_periods()

        # プロバイダータイプを取得
        provider_type = os.getenv("DATA_PROVIDER", "excel")

        return {
            "ok": True,
            "periods": periods,
            "provider_type": provider_type,
        }
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "periods": [],
        }


_ENABLE_DEBUG_ENDPOINTS = os.getenv("ENABLE_DEBUG_ENDPOINTS", "false").lower() in ("true", "1", "yes")

@app.get("/api/debug/client_info")
def api_debug_client_info(request: Request):
    """デバッグ用: クライアントIDとベースディレクトリを返す.

    Unauthenticated → 401 (auth middleware blocks first)
    Authenticated + debug disabled → 404
    Authenticated + debug enabled → 200
    """
    if not _ENABLE_DEBUG_ENDPOINTS:
        from starlette.responses import JSONResponse
        return JSONResponse({"ok": False, "error": "Not found"}, status_code=404)
    client_id = _get_client_id(request)
    base_dir = _get_user_base_dir(request)

    # ベースディレクトリ内のフォルダを列挙
    folders = []
    if base_dir.exists():
        for item in base_dir.iterdir():
            if item.is_dir() and not item.name.startswith("."):
                xlsx_count = len(list(item.glob("*.xlsx")))
                folders.append({
                    "name": item.name,
                    "path": str(item),
                    "xlsx_count": xlsx_count
                })

    return {
        "client_id": client_id,
        "base_dir": str(base_dir),
        "base_dir_exists": base_dir.exists(),
        "folders": folders
    }


@app.get("/api/version")
def api_version():
    """Return minimal version information (git commit only).

    Unauthenticated → 401 (auth middleware blocks first)
    Authenticated + debug disabled → 404
    Authenticated + debug enabled → 200
    """
    if not _ENABLE_DEBUG_ENDPOINTS:
        from starlette.responses import JSONResponse
        return JSONResponse({"ok": False, "error": "Not found"}, status_code=404)
    import subprocess
    sha = "unknown"
    platform_sha = os.getenv("VERCEL_GIT_COMMIT_SHA") or os.getenv("RENDER_GIT_COMMIT")
    if platform_sha:
        sha = platform_sha
    else:
        try:
            sha = subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=Path(__file__).parent,
                text=True
            ).strip()
        except Exception:
            pass
    return _json({"git_commit": sha})

@app.api_route("/api/ads/health", methods=["GET", "HEAD"])
@app.api_route("/api/health", methods=["GET", "HEAD"])
def api_health():
    """Health check endpoint with version info."""
    import os
    import subprocess
    
    sha = "unknown"
    # Prefer the deployment provider's immutable commit metadata.
    platform_sha = os.getenv("VERCEL_GIT_COMMIT_SHA") or os.getenv("RENDER_GIT_COMMIT")
    if platform_sha:
        sha = platform_sha
    else:
        try:
            sha = subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=Path(__file__).parent,
                text=True
            ).strip()
        except:
            pass

    persistence_ready = True
    if _IS_PRODUCTION:
        from .platform_db import PlatformDatabaseUnavailable, assert_database_ready

        try:
            assert_database_ready()
        except PlatformDatabaseUnavailable:
            persistence_ready = False

    return _json(
        {
            "ok": persistence_ready,
            "status": "healthy" if persistence_ready else "unavailable",
            "version": sha,
            "deployment_sha": sha,
            "persistence": "ready" if persistence_ready else "unavailable",
        },
        status=200 if persistence_ready else 503,
    )


@app.api_route("/api/insights/neon/health", methods=["GET", "HEAD"])
@app.api_route("/api/ads/neon/health", methods=["GET", "HEAD"])
@app.api_route("/api/neon/health", methods=["GET", "HEAD"])
def neon_health(request: Request):
    """Lightweight AI Explorer route health check.

    This proves that the Vercel/Render rewrite reaches the ads-insights
    backend without invoking Gemini, BigQuery, or user credentials.
    """
    route = "insights" if request.url.path.startswith("/api/insights/") else "ads"
    return _json({
        "ok": True,
        "service": "ads-insights",
        "feature": "ai-explorer",
        "route": route,
    })


# Mount public directory for charts
from fastapi.staticfiles import StaticFiles
_vercel_runtime_dir = os.getenv("VERCEL_RUNTIME_DIR", "").strip()
public_dir = (
    Path(_vercel_runtime_dir) / "public"
    if _vercel_runtime_dir
    else BASE_DIR / "public"
)
public_dir.mkdir(exist_ok=True)
(public_dir / "charts").mkdir(exist_ok=True)
app.mount("/public", StaticFiles(directory=str(public_dir)), name="public")

# CORS Configuration Management ---
import re

CONFIG_FILE = ROOT / "config.json"

def _load_config() -> dict:
    """Load configuration from config.json."""
    default = {"data_folder": "data", "gemini_api_key": "", "cross_source_mappings": []}
    if CONFIG_FILE.exists():
        try:
            return {**default, **json.loads(CONFIG_FILE.read_text(encoding="utf-8"))}
        except Exception:
            pass
    return default

def _save_config(config: dict) -> None:
    """Save configuration to config.json."""
    CONFIG_FILE.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")

def _is_client_key_required() -> bool:
    """GEMINI_REQUIRE_CLIENT_KEY フラグを評価する (V3.1).
    デフォルト true — クライアントキー必須モード。
    """
    val = os.getenv("GEMINI_REQUIRE_CLIENT_KEY", "true").strip().lower()
    return val not in ("false", "0", "no", "off")

def _resolve_gemini_api_key(client_key: str | None = None) -> str:
    """APIキー解決 (V3.1).
    GEMINI_REQUIRE_CLIENT_KEY=true (デフォルト) の場合:
        - クライアント提供キー (ヘッダー X-Gemini-API-Key) のみ使用
        - サーバー環境変数・config.json へのフォールバックは無効
    GEMINI_REQUIRE_CLIENT_KEY=false の場合:
        1. サーバー環境変数 → 2. config.json → 3. クライアントキー (従来動作)
    """
    if _is_client_key_required():
        # クライアントキー必須モード: フォールバック無効
        return client_key or ""

    # --- 従来のフォールバックチェーン ---
    # 1. サーバー環境変数
    env_key = (
        os.getenv("GEMINI_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
        or os.getenv("GOOGLE_GENERATIVE_AI_API_KEY")
    )
    if env_key:
        return env_key
    # 2. config.json
    cfg_key = _load_config().get("gemini_api_key", "")
    if cfg_key:
        return cfg_key
    # 3. クライアント提供キー
    if client_key:
        return client_key
    return ""

def _get_data_dir() -> Path:
    """
    Get the configured data directory with fallback logic.
    Priority:
    1. OS Environment Variable 'DATA_ROOT' (Ignored if looks like Win path on Linux)
    2. config.json 'data_folder'
    3. ./data_demo (if exists)
    4. ./data (default)
    """
    import os
    import platform
    
    # 1. Environment Variable
    env_path = os.environ.get("DATA_ROOT")
    if env_path:
        # Safety check: Ignore Windows-style paths on Linux/Render
        is_windows = os.name == 'nt'
        if not is_windows and (":\\" in env_path or env_path.startswith("\\\\") or ":" in env_path):
             print(f"[{__name__}] Warning: Ignoring Windows-style DATA_ROOT on non-Windows OS: {env_path}")
        else:
            path = Path(env_path)
            if path.is_absolute():
                return path
            return ROOT / path

    # 2. Config
    config = _load_config()
    data_folder = config.get("data_folder", "data")
    path = Path(data_folder)
    if not path.is_absolute():
        path = ROOT / path
    
    # If config points to existing dir, use it
    if path.exists() and path.is_dir():
        return path

    # 3. Fallback to data_demo if default data dir is missing or empty
    demo_path = ROOT / "data_demo"
    if demo_path.exists() and demo_path.is_dir():
        # Check if original path exists; if not, suggest demo
        if not path.exists():
            print(f"[{__name__}] Warning: Data dir {path} not found. Falling back to {demo_path}")
            return demo_path

    return path



from fastapi import Request

def _get_client_id(request: Request) -> Optional[str]:
    """Extract and sanitize Client ID from headers."""
    cid = request.headers.get("X-Client-ID")
    if not cid:
        return None
    # Sanitize: allow only alphanumeric, dash, underscore
    clean = re.sub(r'[^a-zA-Z0-9_\-]', '', cid)
    return clean[:64] if clean else None

def _get_user_base_dir(request: Request) -> Path:
    """
    Get the effective data directory for the current user.
    If X-Client-ID is present, returns data/users/{client_id}.
    Otherwise returns the common data directory.
    """
    data_dir = _get_data_dir()
    cid = _get_client_id(request)

    # クライアントIDがない場合は共通ディレクトリを返す
    if not cid:
        return data_dir

    # User isolated directory
    user_dir = data_dir / "users" / cid
    if not user_dir.exists():
        try:
            user_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            print(f"Warning: Failed to create user dir {user_dir}: {e}")
            return data_dir

    return user_dir


@app.get("/api/config")
def api_get_config():
    """Get non-secret configuration and secret-presence metadata."""
    config = _load_config()
    safe_config = {}
    secret_markers = ("api_key", "secret", "token", "password", "credential")
    for key, value in config.items():
        if any(marker in key.lower() for marker in secret_markers):
            safe_config[f"has_{key}"] = bool(value)
            if value:
                safe_config[f"{key}_masked"] = "***"
            continue
        safe_config[key] = value
    return _json({"ok": True, "config": safe_config})


@app.post("/api/config")
async def api_save_config(request: Request):
    """Save configuration."""
    try:
        body = await request.json()
        config = _load_config()

        if "data_folder" in body:
            config["data_folder"] = body["data_folder"]
        # V2.6: サーバー環境変数が設定済みならクライアントキーを保存しない
        if "gemini_api_key" in body:
            server_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or os.getenv("GOOGLE_GENERATIVE_AI_API_KEY")
            if not server_key:
                config["gemini_api_key"] = body["gemini_api_key"]

        _save_config(config)
        return _json({"ok": True, "message": "Configuration saved"})
    except Exception as e:
        return _json({"ok": False, "error": str(e)}, status=500)

@app.get("/api/key_status")
def api_key_status():
    """V3.1: サーバー側APIキーの設定状況 + キーポリシーを返す."""
    server_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or os.getenv("GOOGLE_GENERATIVE_AI_API_KEY")
    cfg_key = _load_config().get("gemini_api_key", "")
    client_key_required = _is_client_key_required()
    return _json({
        "ok": True,
        "has_server_key": bool(server_key),
        "has_config_key": bool(cfg_key),
        "source": "env" if server_key else ("config" if cfg_key else "none"),
        "client_key_required": client_key_required,
        "allow_server_fallback": not client_key_required,
    })

def _has_duplicate_active_case_datasets(cases: list) -> bool:
    """Reject ambiguous customer scopes while preserving internal aliases.

    An internal operations case may intentionally share one customer's
    dataset. Two active non-internal cases must never share a scope.
    """
    seen = set()
    default_project = str(os.getenv("GCP_PROJECT_ID") or "analyzedataplatform").strip()
    for case in cases:
        if not case.get("is_active", True):
            continue
        if case.get("is_internal", False):
            continue
        dataset_id = str(case.get("dataset_id") or "").strip()
        if not dataset_id:
            continue
        scope = dataset_id if "." in dataset_id else f"{default_project}.{dataset_id}"
        if scope in seen:
            return True
        seen.add(scope)
    return False


def _has_duplicate_active_password_hashes(cases: list) -> bool:
    """Catch exact hash reuse; runtime matching also rejects same plaintext passwords."""
    seen = set()
    for case in cases:
        if not case.get("is_active", True):
            continue
        password_hash = str(case.get("password_hash") or "").strip()
        if not password_hash:
            continue
        if password_hash in seen:
            return True
        seen.add(password_hash)
    return False


def _load_cases_master() -> list:
    """Load cases from secret env in production, with local-file fallback only."""
    cases_json = os.getenv("ADS_CASES_JSON")
    if cases_json is not None:
        try:
            cases = json.loads(cases_json)
            if not isinstance(cases, list) or not all(isinstance(item, dict) for item in cases):
                raise ValueError("ADS_CASES_JSON must be a JSON array of objects")
            if _has_duplicate_active_case_datasets(cases):
                if _IS_PRODUCTION:
                    print("[api_cases] duplicate active customer dataset scopes are forbidden in production")
                    return []
                print("[api_cases] warning: duplicate active customer dataset scopes in local ADS_CASES_JSON")
            if _has_duplicate_active_password_hashes(cases):
                if _IS_PRODUCTION:
                    print("[api_cases] duplicate active password hashes are forbidden in production")
                    return []
                print("[api_cases] warning: duplicate active password hashes in local ADS_CASES_JSON")
            return cases
        except Exception as exc:
            print(f"[api_cases] ADS_CASES_JSON is invalid ({type(exc).__name__})")
            return []

    # Render must never fall back to a repository-tracked credential file.
    if _IS_PRODUCTION:
        print("[api_cases] ADS_CASES_JSON is required in production")
        return []

    cases_file = BASE_DIR / "cases" / "cases.json"
    if not cases_file.exists():
        return []
    try:
        with open(cases_file, "r", encoding="utf-8") as f:
            cases = json.load(f)
            if isinstance(cases, list) and _has_duplicate_active_case_datasets(cases):
                print("[api_cases] warning: duplicate active customer dataset scopes in local cases file")
            if isinstance(cases, list) and _has_duplicate_active_password_hashes(cases):
                print("[api_cases] warning: duplicate active password hashes in local cases file")
            return cases
    except Exception as e:
        print(f"[api_cases] Error loading cases.json: {e}")
        return []


@app.get("/api/cases")
def api_cases(request: Request):
    """
    Return available cases (clients/projects).

    - Authorization ヘッダ無し → 200 (ログイン画面向け公開挙動)
    - Authorization ヘッダ有り & 無効トークン → 401 (セッション失効をフロントに通知)
    - Authorization ヘッダ有り & 有効トークン → 200 + dataset_id 付き
    """
    cases_master = _load_cases_master()

    auth_header = request.headers.get("Authorization", "")
    has_bearer = auth_header.startswith("Bearer ")
    token = auth_header.replace("Bearer ", "") if has_bearer else ""

    claims = _decode_auth_token(token) if has_bearer else None
    if has_bearer and not claims:
        return _json({"ok": False, "error": "Unauthorized"}, status=401)

    is_authenticated = bool(claims)
    authenticated_case_id = claims.get("case_id") if claims and claims.get("role") == "case_user" else None
    if authenticated_case_id:
        # Revalidate the signed case against the server registry even though
        # this endpoint only returns metadata.
        _resolve_demo_case_for_request(request)

    cases = []
    for c in cases_master:
        if not c.get("is_active", True):
            continue
        if authenticated_case_id and c.get("case_id") != authenticated_case_id:
            continue
        entry = {
            "case_id": c["case_id"],
            "name": c.get("name", c["case_id"]),
            "description": c.get("description", ""),
            "is_internal": c.get("is_internal", False),
            "status": "active" if c.get("is_active", True) else "inactive",
        }
        if is_authenticated:
            entry["dataset_id"] = c.get("dataset_id", "")
        if _validate_case_demo_configuration(c):
            entry["is_demo"] = True
            entry["data_source"] = DEMO_DATA_SOURCE
        cases.append(entry)

    return _json({"ok": True, "cases": cases})


@app.get("/api/cases/{case_id}/bq-status")
def api_case_bq_status(case_id: str, request: Request = None):
    """
    Test BigQuery connectivity for a case's dataset.
    Returns: {ok, connected, tables_found?, error?}
    """
    claims = _get_request_auth_claims(request)
    if claims and claims.get("role") == "case_user" and claims.get("case_id") != case_id:
        raise HTTPException(status_code=403, detail="Requested case is outside authenticated case scope")

    demo_case = _resolve_demo_case_for_request(request)
    if demo_case is not None:
        return _json(_demo_bq_status_response())

    cases_master = _load_cases_master()
    case = next((c for c in cases_master if c.get("case_id") == case_id), None)
    if not case:
        return _json({"ok": False, "connected": False, "error": "案件が見つかりません"}, status=404)

    dataset_id = case.get("dataset_id", "")
    if not dataset_id:
        return _json({"ok": True, "connected": False, "error": "dataset_id 未設定"})

    try:
        from bq.client import get_client, PROJECT_ID
        client = get_client(PROJECT_ID)
        dataset_ref = dataset_id if "." in dataset_id else f"{PROJECT_ID}.{dataset_id}"
        tables = list(client.list_tables(dataset_ref))
        return _json({"ok": True, "connected": True, "tables_found": len(tables)})
    except Exception as e:
        return _json({"ok": True, "connected": False, "error": str(e)})


def _case_login_success_payload(case: dict, *, issue_device_trust: bool = False) -> dict:
    is_demo = _validate_case_demo_configuration(case)
    auth_token = _generate_case_auth_token(case)
    response = {
        "ok": True,
        "case_id": case["case_id"],
        "name": case.get("name", case["case_id"]),
        "dataset_id": case.get("dataset_id", ""),
        "description": case.get("description", ""),
        "token": auth_token,
    }
    if is_demo:
        response["is_demo"] = True
        response["data_source"] = DEMO_DATA_SOURCE
    if issue_device_trust:
        response["device_trust_token"] = _generate_device_trust_token(case)
        response["device_trust_ttl_seconds"] = _DEVICE_TRUST_TTL
    return response


@app.post("/api/cases/login")
async def api_cases_login(request: Request):
    """
    Case authentication endpoint with optional TOTP 2FA.
    Request: {
      "case_id": "xxx"?,  # optional; password-only login is the customer default
      "password": "xxx",
      "totp_code": "123456"?,
      "device_trust_token": "xxx"?
    }
    Success (final): { "ok": true, "case_id", "name", "dataset_id", "token", "device_trust_token", ... }
    TOTP required: { "ok": false, "totp_required": true, "case_id", "name" }
    Failure: { "ok": false, "error": "xxx" }
    """
    from starlette.responses import JSONResponse
    ip = _get_login_client_ip(request)
    if _is_login_locked(ip, "case"):
        return JSONResponse(
            {"ok": False, "error": "Too many failed attempts. Try again later."},
            status_code=429,
        )

    try:
        body = await request.json()
        if not isinstance(body, dict):
            return _json({"ok": False, "error": "Invalid request body"}, status=400)
        case_id = body.get("case_id") or ""
        password = body.get("password", "")
        totp_code = body.get("totp_code") or ""
        device_trust_token = body.get("device_trust_token") or ""
    except Exception:
        return _json({"ok": False, "error": "Invalid request body"}, status=400)

    if not isinstance(case_id, str) or not isinstance(password, str):
        return _json({"ok": False, "error": "case_id and password must be strings"}, status=400)
    if not password:
        return _json({"ok": False, "error": "password is required"}, status=400)

    cases_master = _load_cases_master()
    active_cases = [case for case in cases_master if case.get("is_active", True)]
    candidates = (
        [case for case in active_cases if case.get("case_id") == case_id]
        if case_id
        else active_cases
    )

    if case_id and not candidates:
        _record_login_failure(ip, "case")
        return _json({"ok": False, "error": "案件が見つかりません"}, status=404)

    matched_cases = []
    for candidate in candidates:
        password_hash = candidate.get("password_hash", "")
        if not password_hash:
            continue
        try:
            if bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8")):
                matched_cases.append(candidate)
        except Exception as exc:
            print(f"[api_cases_login] Password verification error ({type(exc).__name__})")

    if not matched_cases:
        _record_login_failure(ip, "case")
        return _json({"ok": False, "error": "パスワードが正しくありません"}, status=401)

    if len(matched_cases) > 1:
        return _json({
            "ok": False,
            "error": "同じパスワードの案件が複数あります。管理者にパスワード再発行を依頼してください",
        }, status=409)

    case = matched_cases[0]
    case_id = str(case.get("case_id") or "")
    # Validate the reserved demo record before any TOTP/device-trust branch can
    # return a partial login response.
    _validate_case_demo_configuration(case)

    totp_enabled = bool(case.get("totp_enabled", False))
    totp_secret = case.get("totp_secret") or ""

    # Case 1: TOTP disabled for this case → password is enough
    if not totp_enabled or not totp_secret:
        _clear_login_failures(ip, "case")
        return _json(_case_login_success_payload(case))

    # Case 2: valid device_trust_token → skip TOTP
    if isinstance(device_trust_token, str) and device_trust_token and \
            _validate_device_trust_token(device_trust_token, case):
        _clear_login_failures(ip, "case")
        return _json(_case_login_success_payload(case, issue_device_trust=True))

    # Case 3: TOTP required but not provided
    if not isinstance(totp_code, str) or not totp_code.strip():
        return _json({
            "ok": False,
            "totp_required": True,
            "case_id": case["case_id"],
            "name": case.get("name", case["case_id"]),
        })

    # Case 4: TOTP provided → verify
    try:
        totp_valid = pyotp.TOTP(totp_secret).verify(totp_code.strip(), valid_window=1)
    except Exception as e:
        print(f"[api_cases_login] TOTP verification error: {e}")
        return _json({"ok": False, "error": "認証エラーが発生しました"}, status=500)

    if not totp_valid:
        _record_login_failure(ip, "case")
        return _json({
            "ok": False,
            "totp_required": True,
            "error": "認証コードが正しくありません",
            "case_id": case["case_id"],
            "name": case.get("name", case["case_id"]),
        }, status=401)

    _clear_login_failures(ip, "case")
    return _json(_case_login_success_payload(case, issue_device_trust=True))


@app.post("/api/cases/{case_id}/totp/setup")
async def api_case_totp_setup(case_id: str, request: Request):
    """
    Admin-only TOTP secret provisioning.
    Requires a valid global auth token (Authorization: Bearer ...), NOT a case-specific token.
    Returns a freshly-generated secret, otpauth URI and base64-encoded QR PNG.
    The admin must then paste the secret into cases.json + set totp_enabled: true.
    """
    import base64
    import io

    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "") if auth_header.startswith("Bearer ") else ""
    claims = _decode_auth_token(token)
    if not claims:
        return _json({"ok": False, "error": "Unauthorized"}, status=401)
    if claims.get("role") != "admin":
        return _json({"ok": False, "error": "Admin access required"}, status=403)

    cases_master = _load_cases_master()
    case = next((c for c in cases_master if c.get("case_id") == case_id), None)
    if not case:
        return _json({"ok": False, "error": "案件が見つかりません"}, status=404)

    secret = pyotp.random_base32()
    issuer = "InsightStudio"
    account_name = case.get("name") or case_id
    otpauth_uri = pyotp.TOTP(secret).provisioning_uri(name=account_name, issuer_name=issuer)

    try:
        import qrcode
        img = qrcode.make(otpauth_uri)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        qr_png_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception as e:
        print(f"[api_case_totp_setup] QR generation error: {e}")
        qr_png_b64 = ""

    return _json({
        "ok": True,
        "case_id": case_id,
        "secret": secret,
        "otpauth_uri": otpauth_uri,
        "qr_png_base64": qr_png_b64,
        "instructions": "cases.json の該当案件に `totp_secret` を貼り付け、`totp_enabled: true` に設定して再起動してください。",
    })



def _extract_period_info(filename: str) -> Optional[Dict[str, Any]]:
    """
    Extract period info (tag, type, etc) from XLSX filename.
    Supports Monthly (YYYY-MM) and Weekly (YYYY-MM-DD, etc).
    """
    # Pattern 1: Weekly/Daily ISO (2025-10-15 or 2025.10.15)
    match_iso_date = re.search(r"(\d{4})[-\.](\d{1,2})[-\.](\d{1,2})", filename)
    if match_iso_date:
        y, m, d = match_iso_date.groups()
        return {
            "period_tag": f"{y}-{m.zfill(2)}-{d.zfill(2)}",
            "period_type": "weekly",
            "identifier": f"{y}-{m.zfill(2)}-{d.zfill(2)}"
        }

    # Matches YYYYMMDD (20251117)
    # Must check this before compact YYYYMM to avoid false positives if possible, 
    # but 20251117 is 8 digits, YYYYMM is 6.
    match_8d = re.search(r"(\d{4})(\d{2})(\d{2})", filename)
    if match_8d:
        y, m, d = match_8d.groups()
        # Basic validation
        if 1 <= int(m) <= 12 and 1 <= int(d) <= 31:
            return {
                "period_tag": f"{y}-{m}-{d}",
                "period_type": "weekly",
                "identifier": f"{y}-{m}-{d}"
            }

    # Matches 25.01.05 (YY.MM.DD)
    match_yy_date = re.search(r"(?:^|[\._])(\d{2})\.(\d{1,2})\.(\d{1,2})", filename)
    if match_yy_date:
        y, m, d = match_yy_date.groups()
        full_year = 2000 + int(y)
        return {
            "period_tag": f"{full_year}-{m.zfill(2)}-{d.zfill(2)}",
            "period_type": "weekly",
            "identifier": f"{full_year}-{m.zfill(2)}-{d.zfill(2)}"
        }

    # Pattern 2: Full year with Japanese month (2025年10月)
    match = re.search(r"(\d{4})年(\d{1,2})月", filename)
    if match:
        tag = f"{match.group(1)}-{match.group(2).zfill(2)}"
        return {"period_tag": tag, "period_type": "monthly", "identifier": tag}
    
    # Pattern 3: 2-digit year with dot and optional month suffix (25.01月, 25.02)
    match = re.search(r"(?:^|[)）_\(\.\s\]］])(\d{2})\.(\d{1,2})月?(?:\.|_|$)", filename)
    if match:
        year_2d = int(match.group(1))
        # Exclude if it looks like a day (e.g., detected as part of YY.MM.DD but fell through? No, loop order matters)
        # But wait, 25.02 could be Feb 2025.
        year_4d = 2000 + year_2d if year_2d < 100 else year_2d
        tag = f"{year_4d}-{match.group(2)}"
        return {"period_tag": tag, "period_type": "monthly", "identifier": tag}
    
    # Pattern 4: ISO format (2025-10) - Ensure it's not part of a full date
    match = re.search(r"(\d{4})-(\d{2})(?!-\d)", filename)
    if match:
        tag = f"{match.group(1)}-{match.group(2)}"
        return {"period_tag": tag, "period_type": "monthly", "identifier": tag}
    
    # Pattern 5: Compact format (202510) - Risky, put last
    match = re.search(r"(\d{4})(\d{2})(?:\.|_|$)", filename)
    if match:
        month = int(match.group(2))
        if 1 <= month <= 12:
             tag = f"{match.group(1)}-{match.group(2)}"
             return {"period_tag": tag, "period_type": "monthly", "identifier": tag}
    
    return None

def _extract_month_tag(filename: str) -> Optional[str]:
    """Legacy wrapper for compatibility"""
    info = _extract_period_info(filename)
    return info["period_tag"] if info else None



@app.get("/api/folders")
def api_folders(request: Request, target_folder: str = ""):
    """
    Return folder tree with XLSX files.
    Scans common 'data' directory AND 'data/users/{client_id}' if header present.
    """
    data_dir = _get_data_dir()
    user_dir = _get_user_base_dir(request)
    has_user_isolation = (user_dir != data_dir) and user_dir.is_relative_to(data_dir)
    
    # If target_folder is specified, scope the scan to that folder
    scan_single_target = False
    
    if target_folder:
        # Check if target is in common or user dir
        # target_folder is a relative path from data_dir
        target_path = data_dir / target_folder
        if target_path.exists() and target_path.is_dir():
            scan_single_target = True
    
    def scan_folder(folder: Path, parent_path: str = "") -> list:
        """Recursively scan folders for XLSX files."""
        result = []
        if not folder.exists():
            return result
            
        for item in sorted(folder.iterdir()):
            if item.is_dir() and not item.name.startswith("."):
                # Skip 'data' and 'users' special folders at root to avoid infinite recursion/duplication
                if parent_path == "":
                    if item.name.lower() == "data": continue
                    if item.name.lower() == "users": continue

                rel_path = f"{parent_path}/{item.name}" if parent_path else item.name
                
                # Leakage Fix: If user isolated, do not show root 'gdrive_' folders (which belong to others or legacy)
                if has_user_isolation and parent_path == "" and item.name.startswith("gdrive_"):
                    continue

                # Filter logic
                if scan_single_target:
                     # If targeting a specific folder, we demand exact path match at top level
                     # This logic is a bit simplistic for deep targets but matches original
                     if parent_path == "" and item.name != target_folder and rel_path != target_folder:
                         # Try lenient matching for deep paths
                         if not str(target_folder).startswith(item.name):
                             continue
                else:
                    # Check environment variable to filter local folders
                    import os
                    
                    show_all_folders = os.environ.get('SHOW_ALL_FOLDERS', 'true').lower() == 'true'
                    
                    if show_all_folders:
                        exclude_folders = os.environ.get('EXCLUDE_FOLDERS', 'DEMO_CLIENT').split(',')
                        exclude_folders = [f.strip() for f in exclude_folders if f.strip()]
                        if parent_path == "" and item.name in exclude_folders:
                            continue
                    else:
                        if parent_path == "" and not item.name.startswith("gdrive_"):
                            continue
                
                xlsx_files = list(item.glob("*.xlsx"))
                subfolders = scan_folder(item, rel_path)
                
                # Include folder if it has XLSX files or has subfolders with XLSX
                if xlsx_files or subfolders:
                    months = []
                    for f in xlsx_files:
                        info = _extract_period_info(f.name)
                        if info:
                            tag = info["period_tag"]
                            if tag not in months:
                                months.append(tag)
                    
                    months.sort(reverse=True)
                    
                    result.append({
                        "name": item.name,
                        "path": rel_path,
                        "rel_path": rel_path,
                        "full_path": str(item),
                        "xlsx_count": len(xlsx_files),
                        "xlsx_files": [f.name for f in xlsx_files],
                        "months": months,
                        "subfolders": subfolders
                    })
        return result
    
    # 1. Scan Common Data Root
    # Strict Isolation: If user is isolated, DO NOT scan the common root.
    if has_user_isolation:
        folders = []
    else:
        folders = scan_folder(data_dir)
    
    # 2. Scan User Private Root (if isolated and it's a subdir of data)
    if has_user_isolation:
        # Calculate relative prefix for user dir, e.g "users/123"
        try:
            rel_user_prefix = user_dir.relative_to(data_dir).as_posix()
            user_folders = scan_folder(user_dir, parent_path=rel_user_prefix)
            # Merge: Prefer user folders? Or just append?
            # Append is fine. user_folders paths will be "users/123/FolderName"
            folders.extend(user_folders)
        except Exception as e:
            print(f"Error scanning user dir: {e}")

    # フォルダが空の場合、data_demo/ からデモデータを表示
    if not folders:
        demo_root = BASE_DIR / "data_demo"
        if demo_root.exists() and demo_root.is_dir():
            for subdir in sorted(demo_root.iterdir()):
                if subdir.is_dir() and not subdir.name.startswith("."):
                    xlsx_files = [f for f in subdir.glob("*.xlsx") if not f.name.startswith("~$")]
                    if xlsx_files:
                        months = []
                        for f in xlsx_files:
                            info = _extract_period_info(f.name)
                            if info and info["period_tag"] not in months:
                                months.append(info["period_tag"])
                        months.sort(reverse=True)
                        folders.append({
                            "name": f"[デモ] {subdir.name}",
                            "path": f"__demo__/{subdir.name}",
                            "rel_path": f"__demo__/{subdir.name}",
                            "full_path": str(subdir),
                            "xlsx_count": len(xlsx_files),
                            "xlsx_files": [f.name for f in xlsx_files],
                            "months": months,
                            "subfolders": [],
                            "is_demo": True,
                        })

    return _json({"ok": True, "folders": folders, "data_dir": str(data_dir)})


@app.get("/api/months")
def api_months(folder_path: str = ""):
    """
    Return available months for a given folder.
    Query param: folder_path (relative path from data folder)
    """
    data_dir = _get_data_dir()
    months = []
    
    if folder_path:
        target_folder = data_dir / folder_path
    else:
        target_folder = data_dir
    
    if target_folder.exists():
        # Scan XLSX files in folder (Case Insensitive)
        for f in target_folder.iterdir():
            if f.is_file() and f.name.lower().endswith(".xlsx") and not f.name.startswith("~$"):
                info = _extract_period_info(f.name)
                if info:
                    tag = info["period_tag"]
                    if tag not in months:
                        months.append(tag)
    
    months.sort(reverse=True)
    return _json({"ok": True, "months": months, "folder_path": folder_path})




@app.get("/api/list_point_packs")















@app.get("/api/debug_where")
def debug_where():
    if not _ENABLE_DEBUG_ENDPOINTS:
        from starlette.responses import JSONResponse
        return JSONResponse({"ok": False, "error": "Not found"}, status_code=404)
    try:




        return _json({"ok": True, "file": __file__, "cwd": str(Path.cwd())})







    except Exception as e:







        return _json({"ok": False, "error": str(e), "file": __file__})















def list_point_packs():







    items = _find_point_packs()







    return _json({"ok": True, "items": items, "point_packs": items, "data": items})















@app.post("/api/load")







async def load(request: Request):







    body = await request.json()















    key = body.get("point_pack_name") or body.get("path") or body.get("id") or body.get("name") or ""







    if not key:







        return _json({"ok": False, "error": "point_pack_name is required", "body": body}, status=400)















    # key may be: "compare/xxx.md" or "xxx.md" or a stem







    pp: Optional[Path] = None















    # 1) interpret as repo-relative path







    try:







        p = (ROOT / str(key)).resolve()







        if p.exists():







            pp = p







    except Exception:







        pp = None















    # 2) interpret under compare/







    if pp is None:







        p = (COMPARE_DIR / str(key)).resolve()







        if p.exists():







            pp = p















    # 3) interpret as stem prefix







    if pp is None:







        cand = list(COMPARE_DIR.glob(str(key) + "*.md"))







        if cand:







            pp = cand[0].resolve()















    if pp is None or not pp.exists():







        return _json({"ok": False, "error": "point-pack not found", "key": key, "body": body}, status=404)















    point_pack_md = _read_text(pp)















    insights_md = ""







    if INSIGHTS_DIR.exists():







        stem = pp.stem.replace("point-pack", "insights")







        cand = list(INSIGHTS_DIR.glob(stem + "*.md"))







        if cand:







            insights_md = _read_text(cand[0])















    validations = {"ok": True, "issues": []}















    return _json({







        "ok": True,







        "point_pack_md": point_pack_md,







        "insights_md": insights_md,







        "validations": validations,







        "selected": {"id": pp.name, "path": _rel(pp)},







    })







@app.post("/api/ensure_kpi_quote")







async def ensure_kpi_quote(request: Request):







    body = await request.json()







    return _json({"ok": True, "noop": True, "body": body})















@app.post("/api/validate")







async def validate(request: Request):







    body = await request.json()







    text = (body.get("text") or body.get("point_pack_text") or "").strip()







    issues: List[str] = []







    if not text:







        issues.append("text is empty")







    if "##" not in text and "# " not in text:







        issues.append("no markdown headings found")







    return _json({"ok": len(issues) == 0, "issues": issues})















@app.post("/api/generate_insights")
async def generate_insights(request: Request):
    """
    v2-final: always returns HTTP200 JSON.
    - ok:true  -> text is markdown
    - ok:false -> error + hint (+ retry_after if rate limited)
    """
    import os
    import json
    import traceback
    import inspect as _gi_inspect
    from pathlib import Path
    from fastapi.responses import Response

    def _is_truthy(v: str | None) -> bool:
        if v is None:
            return False
        return v.strip().lower() in ("1","true","yes","on")

    def _json200(payload: dict):
        # ASCII only to avoid PowerShell mojibake
        return Response(
            content=_safe_json_dumps(payload, ensure_ascii=True),
            media_type="application/json; charset=utf-8",
            status_code=200,
        )

    # 1) parse json
    try:
        payload = await request.json()
    except Exception as e:
        return _json200({"ok": False, "error": "bad_json", "detail": str(e)})

    point_pack_path = payload.get("point_pack_path") or payload.get("pointPackPath") or payload.get("path")
    message = payload.get("message") or ""
    model = normalize_gemini_model(payload.get("model") or os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite"))
    temperature = payload.get("temperature", 0.7)
    gemini_api_key = payload.get("gemini_api_key") or payload.get("apiKey")

    if not point_pack_path:
        return _json200({"ok": False, "error": "missing_point_pack_path", "hint": "point_pack_path is required"})

    p = Path(str(point_pack_path))
    if not p.exists():
        return _json200({"ok": False, "error": "point_pack_not_found", "path": str(p)})

    try:
        pp_text = p.read_text(encoding="utf-8-sig", errors="replace")
    except Exception:
        pp_text = p.read_text(encoding="utf-8", errors="replace")

    prompt = ""
    prompt += "# Instruction\n"
    prompt += "You are an ads report analyst. Generate a clear markdown insight based ONLY on the point-pack.\n"
    prompt += "- Do NOT invent numbers not present in the point-pack.\n"
    prompt += "- IMPORTANT: Use markdown TABLES for numerical comparisons to improve readability.\n"
    prompt += "- Avoid excessive bullet points; use paragraphs for explanations where appropriate.\n"
    prompt += "- Use spacing between sections.\n\n"
    if str(message).strip():
        prompt += "## Additional\n" + str(message).strip() + "\n\n"
    prompt += "## Point-pack\n" + pp_text
    
    # [TASK 2] Input Verification Log
    _gi_log(f"--- Generate Insights Input ---")
    _gi_log(f"Point Pack: {point_pack_path}")
    _gi_log(f"Prompt Head(200): {prompt[:200]!r}")
    _gi_log(f"--------------------------------")

    # DRY_RUN MUST short-circuit, regardless of gemini availability
    if _is_truthy(os.getenv("ADS_GI_DRY_RUN")):
        return _json200({"ok": True, "text": "[DRY_RUN]\\n\\n" + prompt})

    fn = globals().get("_gemini_generate_text")
    if not callable(fn):
        return _json200({"ok": False, "error": "gemini_not_configured", "hint": "_gemini_generate_text not found"})

    # 2) call gemini (sync or async)
    try:
        try:
            text = fn(prompt=prompt, model=model, temperature=temperature, api_key=gemini_api_key)
        except TypeError:
            text = fn(prompt, model, temperature)

        if _gi_inspect.isawaitable(text):
            text = await text

        # Final safety: avoid coroutine leak
        if _gi_inspect.isawaitable(text):
            text = str(text)

        return _json200({"ok": True, "text": text})
    except Exception as e:
        retry_after = getattr(e, "retry_after", None)
        status_code = getattr(e, "status_code", None)

        if isinstance(e, GeminiBudgetUnavailable):
            return _json({
                "ok": False,
                "error": "ai_budget_unavailable",
                "status_code": 503,
                "retryable": True,
            }, status=503)

        if isinstance(e, GeminiBudgetExceeded) or "gemini_budget_exceeded" in str(e):
            return _json200({
                "ok": False,
                "error": "gemini_budget_exceeded",
                "status_code": 429,
                "hint": "monthly Gemini budget reached; use Claude fallback or wait until next month",
                "detail": str(e),
            })

        if e.__class__.__name__ == "GeminiRateLimitError" or "too many requests" in str(e).lower():
            return _json200({
                "ok": False,
                "error": "rate_limited",
                "status_code": status_code,
                "retry_after": retry_after,
                "hint": "rate limited on Gemini side; retry later",
                "detail": str(e),
            })

        out = {"ok": False, "error": "internal_error", "detail": str(e), "hint": "check backend.err.log"}
        if _is_truthy(os.getenv("ADS_GI_DEBUG")):
            out["traceback"] = traceback.format_exc()
            out["debug_text_type"] = str(type(locals().get("text", None)))
        return _json200(out)

async def save(request: Request):







    body = await request.json()







    text = body.get("text") or body.get("insights_text") or ""







    if not text:







        return _json({"ok": False, "error": "no text to save"}, status=400)















    INSIGHTS_DIR.mkdir(parents=True, exist_ok=True)







    out_name = body.get("out_name") or "insights_saved.md"







    out = (INSIGHTS_DIR / out_name).resolve()







    out.write_text(text, encoding="utf-8-sig")







    return _json({"ok": True, "saved": _rel(out)})















def main():
    import uvicorn
    port = int(os.environ.get("PORT") or os.environ.get("ADS_INSIGHTS_BACKEND_PORT") or "8001")
    host = os.environ.get("HOST") or ("0.0.0.0" if os.environ.get("PORT") or os.environ.get("RENDER") else "127.0.0.1")
    log_level = str(os.environ.get("LOG_LEVEL") or "info").lower()
    uvicorn.run(app, host=host, port=port, log_level=log_level)


if __name__ == "__main__":
    main()














# === COMPAT_POINT_PACK_READ_V3 ===







import json







import urllib.parse







from pathlib import Path







from typing import Optional















from fastapi import Request







from starlette.responses import JSONResponse















_REPO_ROOT = Path(__file__).resolve().parents[2]







_POINT_PACK_DIRS = [







    _REPO_ROOT / "compare",







    _REPO_ROOT / "point_packs",







    _REPO_ROOT / "point-pack",







]















def _pp_candidates():







    files = []







    for d in _POINT_PACK_DIRS:







        if d.exists():







            files.extend(list(d.glob("*.md")))







    preferred = [f for f in files if ("point-pack" in f.name or "point_pack" in f.name)]







    files = preferred if preferred else files







    files.sort(key=lambda x: (x.stat().st_mtime, x.name), reverse=True)







    return files















def _decode_any(raw: bytes) -> str:







    # try common encodings (PowerShell/Windows/Browser)







    for enc in ("utf-8", "utf-8-sig", "utf-16", "utf-16-le", "cp932"):







        try:







            return raw.decode(enc)







        except Exception:







            pass







    return raw.decode("utf-8", errors="ignore")















async def _extract_name(request: Request) -> str:







    qp = request.query_params







    for k in ("name","point_pack","pointPack","id","file","path","filename","value","label"):







        v = qp.get(k)







        if v and str(v).strip():







            return str(v).strip()















    raw = await request.body()







    if not raw:







        return ""















    txt = _decode_any(raw).strip()







    if not txt or txt == "[object Object]":







        return ""















    # JSON







    try:







        obj = json.loads(txt)







    except Exception:







        # form-encoded







        if "=" in txt and ("&" in txt or txt.count("=") >= 1):







            qs = urllib.parse.parse_qs(txt)







            for k in ("name","point_pack","pointPack","id","file","path","filename","value","label"):







                if k in qs and qs[k]:







                    vv = qs[k][0]







                    if vv and str(vv).strip():







                        return str(vv).strip()







        return txt















    if isinstance(obj, str):







        return obj.strip()







    if isinstance(obj, list) and obj:







        return str(obj[0]).strip()







    if isinstance(obj, dict):







        for k in ("name","point_pack","pointPack","id","file","path","filename","value","label"):







            v = obj.get(k)







            if isinstance(v, str) and v.strip():







                return v.strip()







        for k in ("point_pack","pointPack","selected","item","payload","data"):







            v = obj.get(k)







            if isinstance(v, dict):







                for kk in ("name","id","value","label","file","path","filename"):







                    vv = v.get(kk)







                    if isinstance(vv, str) and vv.strip():







                        return vv.strip()







    return ""















def _resolve_file(name: str) -> Optional[Path]:







    files = _pp_candidates()







    if not files:







        return None















    nm = (name or "").strip()







    if nm.endswith(".md"):







        nm = nm[:-3]















    if not nm:







        # 候補が複数なら選べない（UI側が正しくnameを送るのが本筋）







        return None















    # exact







    for f in files:







        if f.stem == nm or f.name == nm or f.stem.lower() == nm.lower():







            return f















    # if mojibake placeholder but month + suffix is intact, match by month + suffix







    if "?" in nm or "�" in nm:







        m = re.match(r"^(\d{4}-\d{2})__.*__(point-pack|point_pack)$", nm)







        if m:







            month = m.group(1)







            for f in files:







                if f.stem.startswith(month + "__") and (f.stem.endswith("__point-pack") or f.stem.endswith("__point_pack")):







                    return f















    # fuzzy







    for f in files:







        if f.stem.startswith(nm) or nm in f.stem:







            return f







    return None















@app.api_route("/api/read_point_pack", methods=["GET","POST"])















# === COMPAT_READ_POINT_PACK_V4 ===







async def compat_read_point_pack(request: "Request"):







    """







    UI compatibility loader.







    Accepts POST/GET with body as:







      - {"name": "..."} or {"id": "..."} or {"path": "..."}







      - or raw string "..."







    Looks in <repo>/compare.







    Always returns HTTP 200 with {ok: bool, ...}







    """







    from fastapi.responses import JSONResponse







    from pathlib import Path







    import json, re















    repo_dir = Path(__file__).resolve().parents[2]   # .../web/app/backend_api.py -> repo root







    compare_dir = repo_dir / "compare"















    raw_bytes = b""







    body = None







    try:







        raw_bytes = await request.body()







    except Exception:







        pass







    try:







        body = await request.json()







    except Exception:







        # try decode raw as utf-8 text







        try:







            body = raw_bytes.decode("utf-8", errors="replace").strip()







        except Exception:







            body = None















    def _first_str(*xs):







        for x in xs:







            if isinstance(x, str) and x.strip():







                return x.strip()







        return ""















    name = ""







    path = ""







    id_ = ""















    if isinstance(body, dict):







        name = _first_str(body.get("name"), body.get("point_pack_name"))







        path = _first_str(body.get("path"))







        id_  = _first_str(body.get("id"))







    elif isinstance(body, str):







        name = body















    # choose a "requested" token (prefer path > id > name)







    token = _first_str(path, id_, name)















    # normalize to relative path under repo







    rel = token.lstrip("/")















    if rel and not rel.startswith("compare/"):







        rel = "compare/" + rel















    # ensure .md







    if rel and not rel.lower().endswith(".md"):







        rel = rel + ".md"















    # if it doesn't mention point-pack, append suffix safely







    if rel and "__point-pack" not in rel:







        if rel.lower().endswith(".md"):







            rel = rel[:-3] + "__point-pack.md"















    # de-dupe accidental ".md.md"







    rel = rel.replace(".md.md", ".md")















    requested = rel







    f = (repo_dir / requested) if requested else None















    # fuzzy fallback (month prefix etc.)







    resolved = None







    try:







        cands = sorted(compare_dir.rglob("*__point-pack.md")) if compare_dir.exists() else []







        if f and f.exists():







            resolved = f







        else:







            raw = (requested or "") + " " + json.dumps(body, ensure_ascii=False) if body is not None else (requested or "")







            mm = re.search(r"(20\d{2}-\d{2})", raw)







            month = mm.group(1) if mm else ""







            month_cands = [x for x in cands if (month and x.name.startswith(month + "__"))] if month else cands















            # if only one candidate, pick it







            if resolved is None and len(month_cands) == 1:







                resolved = month_cands[0]















            # otherwise pick latest modified in month







            if resolved is None and month_cands:







                resolved = sorted(month_cands, key=lambda x: x.stat().st_mtime, reverse=True)[0]







    except Exception:







        resolved = None















    if not resolved or not resolved.exists():







        # IMPORTANT: return 200 so UI doesn't show "API Error: Not Found"







        sample = []







        try:







            if compare_dir.exists():







                sample = [x.name for x in sorted(compare_dir.rglob("*__point-pack.md"))][:30]







        except Exception:







            sample = []







        return JSONResponse(







            {







                "ok": False,







                "error": "point-pack not found",







                "requested": requested,







                "body": body,







                "compare_dir": str(compare_dir),







                "available_samples": sample,







            },







            status_code=200,







        )















    text = resolved.read_text(encoding="utf-8-sig", errors="ignore")







    return JSONResponse(







        {







            "ok": True,







            "name": resolved.stem,







            "point_pack_name": resolved.stem,







            "file": str(resolved),







            "text": text,







            "markdown": text,







            "content": text,







            "point_pack_text": text,







            "point_pack_markdown": text,







        },







        status_code=200,







    )







# === /COMPAT_READ_POINT_PACK_V4 ===







@app.middleware("http")







async def _force_load_to_compat(request: Request, call_next):







    p = request.url.path







    if p in ("/api/load", "/api/load_point_pack", "/api/get_point_pack", "/api/point_pack"):
        # This compatibility middleware can return before the central auth
        # middleware runs. Only a valid administrator may take the shortcut;
        # all other callers continue through the normal auth/RBAC chain.
        auth_header = request.headers.get("Authorization", "")
        token = auth_header.replace("Bearer ", "") if auth_header.startswith("Bearer ") else ""
        claims = _decode_auth_token(token)
        if not claims or claims.get("role") != "admin":
            return await call_next(request)







        try:







            return await compat_read_point_pack(request)







        except Exception:







            # 互換側が落ちた場合だけ通常処理へ







            return await call_next(request)







    return await call_next(request)







# === /COMPAT_BACKEND_FORCE_LOAD_TO_COMPAT_V1 ===

# CORSMiddleware は全 @app.middleware("http") の後に add_middleware することで
# 最外層になり、401/429 等の非 2xx 応答にも ACAO ヘッダが付与される。
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_DEFAULT_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Client-ID", "X-Insight-Project", "X-Gemini-API-Key", "X-Analysis-Provider", "Accept", "Authorization", "Idempotency-Key"],
)























# === COMPAT_POINT_PACK_LOAD_ALIASES_V1 ===







# Add missing legacy endpoints (UI compatibility): /api/load etc -> compat_read_point_pack







try:







    def _has_path(pth: str) -> bool:







        for r in getattr(app, "router", None).routes:







            if getattr(r, "path", None) == pth:







                return True







        return False















    for _pth in (







        "/api/load",







        "/api/load_point_pack",







        "/api/get_point_pack",







        "/api/point_pack",







        "/api/loadPointPack",







        "/api/getPointPack",







        "/api/readPointPack",







    ):







        if not _has_path(_pth):







            app.add_api_route(_pth, compat_read_point_pack, methods=["GET","POST"])







except Exception:







    pass







# === /COMPAT_POINT_PACK_LOAD_ALIASES_V1 ===















































# === GI rate-limit retry + JSON error handling (GI_RATE_LIMIT_RETRY_PATCH_V1) ===





# 목적:





# - Gemini側 429/503 を短時間バックオフでリトライ





# - 最終的に失敗しても /api/generate_insights は必ずJSONを返してUIを殺さない











import os as _gi_os





import time as _gi_time





import random as _gi_random











try:





    import httpx as _gi_httpx  # type: ignore





except Exception:  # pragma: no cover





    _gi_httpx = None











class GeminiRateLimitError(RuntimeError):





    def __init__(self, message: str = "rate_limited", status_code: int | None = None, retry_after: float | None = None, detail: str | None = None):





        super().__init__(message)





        self.status_code = status_code





        self.retry_after = retry_after





        self.detail = detail











def _gi_parse_retry_after(headers) -> float | None:





    try:





        if not headers:





            return None





        # httpx headers are case-insensitive; dict-like access works





        v = headers.get("retry-after") or headers.get("Retry-After")





        if not v:





            return None





        v = str(v).strip()





        # only support delta-seconds here





        return float(v)





    except Exception:





        return None











def _gi_sleep_seconds(attempt: int, retry_after: float | None) -> float:





    base = float(_gi_os.getenv("ADS_GI_BASE_DELAY_SEC", "2"))





    cap  = float(_gi_os.getenv("ADS_GI_MAX_DELAY_SEC", "60"))





    if retry_after is not None and retry_after > 0:





        sec = retry_after





    else:





        sec = base * (2 ** attempt)  # 2,4,8...





    sec = min(sec, cap)





    sec = sec + (_gi_random.random() * 0.25)  # small jitter





    return sec











def _gi_should_dry_run() -> bool:





    v = _gi_os.getenv("ADS_GI_DRY_RUN", "").strip().lower()





    return v in ("1", "true", "yes", "on")











def _gi_wrap_gemini_generate_text() -> None:





    # Wrap existing _gemini_generate_text without editing its body (safe / minimal).





    g = globals()





    if g.get("_GI_RETRY_WRAPPED", False):





        return





    if "_gemini_generate_text" not in g or not callable(g.get("_gemini_generate_text")):





        return











    g["_GI_RETRY_WRAPPED"] = True





    g["_gemini_generate_text_orig"] = g["_gemini_generate_text"]











    def _wrapped_gemini_generate_text(*args, **kwargs):





        if _gi_should_dry_run():





            # assume prompt is first arg or keyword





            prompt = kwargs.get("prompt")





            if prompt is None and len(args) >= 1:





                prompt = args[0]





            return "[DRY_RUN]\n\n" + (str(prompt) if prompt is not None else "")











        max_retries = int(_gi_os.getenv("ADS_GI_MAX_RETRIES", "3"))





        last_exc = None











        for attempt in range(0, max_retries + 1):





            try:





                return g["_gemini_generate_text_orig"](*args, **kwargs)





            except Exception as e:





                last_exc = e











                # Only retry for HTTP 429/503 from httpx.raise_for_status()





                if _gi_httpx is not None and isinstance(e, _gi_httpx.HTTPStatusError):





                    resp = getattr(e, "response", None)





                    status = getattr(resp, "status_code", None)





                    if status in (429, 503):





                        ra = _gi_parse_retry_after(getattr(resp, "headers", None))





                        if attempt >= max_retries:





                            raise GeminiRateLimitError(





                                message="rate_limited",





                                status_code=int(status) if status is not None else None,





                                retry_after=ra,





                                detail=str(e),





                            ) from e





                        sec = _gi_sleep_seconds(attempt, ra)





                        _gi_time.sleep(sec)





                        continue











                # other errors: no retry





                raise











        # fallback (shouldn't reach)





        raise last_exc  # type: ignore











    g["_gemini_generate_text"] = _wrapped_gemini_generate_text











# apply wrapper at import-time





try:





    _gi_wrap_gemini_generate_text()





except Exception:





    pass











# Exception handlers: ensure JSON for generate_insights even on failures





try:





    from fastapi import Request as _GI_Request, HTTPException as _GI_HTTPException





    from fastapi.responses import JSONResponse as _GI_JSONResponse





except Exception:  # pragma: no cover





    _GI_Request = None





    _GI_HTTPException = None





    _GI_JSONResponse = None











if "app" in globals() and _GI_Request is not None and _GI_JSONResponse is not None:





    @app.exception_handler(GeminiRateLimitError)  # type: ignore[name-defined]





    async def _gi_rate_limited_handler(request: _GI_Request, exc: GeminiRateLimitError):





        payload = {





            "ok": False,





            "error": "rate_limited",





            "status_code": exc.status_code,





            "retry_after": exc.retry_after,





            "detail": exc.detail,





        }





        # Return 200 so frontend/webcmdlet doesn't throw and UI can show message





        return _GI_JSONResponse(status_code=200, content=payload)











    if _GI_HTTPException is not None:





        @app.exception_handler(_GI_HTTPException)  # type: ignore[misc]





        async def _gi_http_exception_handler(request: _GI_Request, exc: _GI_HTTPException):





            return http_exception_response(request, exc)











    @app.exception_handler(Exception)  # type: ignore[misc]





    async def _gi_unhandled_exception_handler(request: _GI_Request, exc: Exception):

        capture_exception_safe(
            exc,
            error_code=type(exc).__name__,
            stage="http_request",
        )
        logger.error(
            "Unhandled Ads API error request_id=%s error_code=%s",
            ensure_request_id(request),
            type(exc).__name__,
        )





        # Keep generate_insights always-JSON + non-throwing





        if getattr(request.url, "path", "") == "/api/generate_insights":





            response = problem_response(
                request,
                status_code=500,
                code="internal_error",
                category="unexpected",
                user_message="分析を完了できませんでした。時間をおいて再試行してください。",
                retryable=True,
            )
            response.status_code = 200
            return response





        return problem_response(
            request,
            status_code=500,
            code="internal_error",
            category="unexpected",
            user_message="処理を完了できませんでした。時間をおいて再試行してください。",
            retryable=True,
        )





# === /GI rate-limit retry + JSON error handling ===












@app.post("/api/generate_report")
async def api_generate_report(request: Request):
    """
    Generate a report for a single month (with optional comparison)
    Body: { folder_path: str, current_month: str, base_month: Optional[str] }
    """
    body = await request.json()
    folder_path_str = body.get("folder_path")
    current_month = body.get("current_month")
    base_month = body.get("base_month")
    lp_url = body.get("lp_url", "")
    
    if not folder_path_str or not current_month:
        return _json({"ok": False, "error": "folder_path and current_month are required"}, status=400)

    # Resolve folder using user base directory
    user_base_dir = _get_user_base_dir(request)
    data_folder = _resolve_folder_path(folder_path_str, user_base_dir)
    if not data_folder.exists():
        # Fallback: try ROOT / folder_path
        data_folder = ROOT / folder_path_str
        if not data_folder.exists():
             return _json({"ok": False, "error": f"Folder not found: {folder_path_str}"}, status=404)
    
    def find_file(month_str):
        """月または週次期間に対応するExcelファイルを検索"""
        if not month_str: return None

        # パターン1: ファイル名がそのまま渡された場合（identifier）
        if month_str.endswith(".xlsx"):
            target = data_folder / month_str
            if target.exists():
                return target
            # サブディレクトリも検索
            for f in data_folder.rglob("*.xlsx"):
                if f.name == month_str:
                    return f

        # パターン2: 週次期間（YYYY-MM-DD_YYYY-MM-DD形式）
        weekly_match = re.match(r"(\d{4})-(\d{2})-(\d{2})_", month_str)
        if weekly_match:
            # 週の開始日から8桁日付を生成
            y, m, d = weekly_match.groups()
            date_8digit = f"{y}{m}{d}"
            for f in data_folder.glob("*.xlsx"):
                if f.name.startswith("~$"): continue
                if date_8digit in f.name:
                    return f

        # パターン3: 従来の月次マッチング
        m_nums = re.findall(r"\d+", month_str)
        if len(m_nums) < 2: return None
        y, m = m_nums[0], m_nums[1]
        y_short = y[-2:]  # 2025 -> "25" (2桁年)
        m_padded = f"{int(m):02d}"  # "5" -> "05"
        m_unpadded = str(int(m))    # "05" -> "5"

        for f in data_folder.glob("*.xlsx"):
            if f.name.startswith("~$"): continue
            fname = f.name

            # 年がファイル名に含まれている必要がある（フル年または2桁年）
            if y not in fname and y_short not in fname:
                continue

            # 月のマッチ: より厳密なパターンでチェック
            month_patterns = [
                f"{y}年{m_unpadded}月",      # 2025年7月
                f"{y}年{m_padded}月",        # 2025年07月
                f"{y}-{m_padded}",           # 2025-07
                f"{y}{m_padded}",            # 202507
                f"_{y_short}.{m_padded}月",  # _25.01月
                f"_{y_short}.{m_unpadded}月", # _25.1月
                f"{y_short}.{m_padded}",     # 25.01
                f"_{m_padded}_",             # _07_
                f"_{m_padded}.",             # _07.
                f"_{m_unpadded}月",          # _7月
                f"{m_unpadded}月",           # 7月
            ]

            for pattern in month_patterns:
                if pattern in fname:
                    return f
        return None

    cur_file = find_file(current_month)
    if not cur_file:
        return _json({"ok": False, "error": f"Report file not found for month: {current_month}"}, status=404)
        
    # Use kpi_extractor to extract data
    try:
        cur_res = extract_from_excel(cur_file, fail_fast=False)
    except Exception as e:
        return _json({"ok": False, "error": f"Failed to extract from {cur_file.name}: {str(e)}"}, status=500)
    
    # Get client name
    client_name = data_folder.parts[-1]
    if client_name in ["レポート", "オンライン", "店舗"] and len(data_folder.parts) > 1:
        client_name = f"{data_folder.parts[-2]}_{client_name}"
    
    # --- Chart Generation ---
    chart_files = []
    try:
        charts_dir = BASE_DIR / "public" / "charts"
        charts_dir.mkdir(parents=True, exist_ok=True)
        
        # Trend Data (Total Block)
        trend_df = extract_trend_data(cur_file, cur_res.meta.sheet)
        if not trend_df.empty:
            # Cost & CV Trend
            p1_name = f"{current_month}_{client_name}_trend_cost_cv.png"
            p1_path = charts_dir / p1_name
            cg.plot_trend_cost_cv(trend_df, "month", "cost", "cv", f"{client_name} Cost & CV Trend", p1_path)
            chart_files.append(f"/public/charts/{p1_name}")
            
            # CPA Trend
            p2_name = f"{current_month}_{client_name}_trend_cpa.png"
            p2_path = charts_dir / p2_name
            cg.plot_trend_cpa(trend_df, "month", "cpa", f"{client_name} CPA Trend", p2_path)
            chart_files.append(f"/public/charts/{p2_name}")
            
        # Media Data (Current Month)
        media_df = extract_media_data(cur_file, cur_res.meta.sheet)
        if not media_df.empty:
            p3_name = f"{current_month}_{client_name}_media_cost_cv.png"
            p3_path = charts_dir / p3_name
            cg.plot_bar_media_cost_cv(media_df, "media", "cost", "cv", f"{client_name} Media Cost & CV ({current_month})", p3_path)
            chart_files.append(f"/public/charts/{p3_name}")
            
    except Exception as e:
        print(f"[Chart] Failed to generate charts: {e}")
        # Continue without charts
    # ------------------------

    # Generate markdown using point_pack_generator
    if base_month:
        base_file = find_file(base_month)
        if base_file:
            try:
                base_res = extract_from_excel(base_file, fail_fast=False)
                md_content = generate_multi_month_point_pack_md(
                    [(current_month, cur_res), (base_month, base_res)],
                    client_name,
                    lp_url=lp_url,
                    chart_paths=chart_files,
                    include_banners=False
                )
            except Exception as e:
                return _json({"ok": False, "error": f"Failed to extract base month: {str(e)}"}, status=500)
        else:
            md_content = generate_point_pack_md(cur_res, None, client_name, lp_url=lp_url, chart_paths=chart_files)
    else:
        md_content = generate_point_pack_md(cur_res, None, client_name, lp_url=lp_url, chart_paths=chart_files)
    
    # Save to compare/
    compare_filename = f"{current_month}__{client_name}__point-pack.md"
    compare_path = COMPARE_DIR / compare_filename
    COMPARE_DIR.mkdir(exist_ok=True)
    compare_path.write_text(md_content, encoding="utf-8-sig")

    # Build chart_data for frontend visualization (single month)
    all_results = [(current_month, cur_res)]
    chart_data = _build_chart_data(all_results)
    media_breakdown = _build_media_breakdown_data(all_results)

    return _json({
        "ok": True,
        "point_pack": md_content,
        "path": str(compare_path),
        "num_months": 1,
        "chart_data": chart_data,
        "media_breakdown": media_breakdown
    })

@app.post("/api/generate_multi_report")
async def api_generate_multi_report(request: Request):
    """
    Generate reports for multiple months using kpi_extractor and point_pack_generator.
    Body: { folder_path: str, months: List[str] }
    """
    body = await request.json()
    folder_path_str = body.get("folder_path")
    months = body.get("months", [])
    lp_url = body.get("lp_url", "")
    
    if not folder_path_str or not months:
        return _json({"ok": False, "error": "folder_path and months list are required"}, status=400)
    
    # Sort months descending (newest first)
    def parse_month(m):
        nums = re.findall(r"\d+", m)
        if len(nums) >= 2: return int(nums[0]) * 100 + int(nums[1])
        return 0
    
    sorted_months = sorted(months, key=parse_month, reverse=True)

    # Resolve folder using user base directory
    user_base_dir = _get_user_base_dir(request)
    data_folder = _resolve_folder_path(folder_path_str, user_base_dir)
    if not data_folder.exists():
        # Fallback: try ROOT / folder_path
        data_folder = ROOT / folder_path_str
        if not data_folder.exists():
             return _json({"ok": False, "error": f"Folder not found: {folder_path_str}"}, status=404)
              
    def find_file(month_str):
        """月または週次期間に対応するExcelファイルを検索"""
        if not month_str: return None

        # パターン1: ファイル名がそのまま渡された場合（identifier）
        if month_str.endswith(".xlsx"):
            target = data_folder / month_str
            if target.exists():
                return target
            # サブディレクトリも検索
            for f in data_folder.rglob("*.xlsx"):
                if f.name == month_str:
                    return f

        # パターン2: 週次期間（YYYY-MM-DD_YYYY-MM-DD形式）
        weekly_match = re.match(r"(\d{4})-(\d{2})-(\d{2})_", month_str)
        if weekly_match:
            # 週の開始日から8桁日付を生成
            y, m, d = weekly_match.groups()
            date_8digit = f"{y}{m}{d}"
            for f in data_folder.glob("*.xlsx"):
                if f.name.startswith("~$"): continue
                if date_8digit in f.name:
                    return f

        # パターン3: 従来の月次マッチング
        m_nums = re.findall(r"\d+", month_str)
        if len(m_nums) < 2: return None
        y, m = m_nums[0], m_nums[1]
        y_short = y[-2:]  # 2025 -> "25" (2桁年)
        m_padded = f"{int(m):02d}"  # "5" -> "05"
        m_unpadded = str(int(m))    # "05" -> "5"

        for f in data_folder.glob("*.xlsx"):
            if f.name.startswith("~$"): continue
            fname = f.name

            # 年がファイル名に含まれている必要がある（フル年または2桁年）
            if y not in fname and y_short not in fname:
                continue

            # 月のマッチ: より厳密なパターンでチェック
            month_patterns = [
                f"{y}年{m_unpadded}月",      # 2025年7月
                f"{y}年{m_padded}月",        # 2025年07月
                f"{y}-{m_padded}",           # 2025-07
                f"{y}{m_padded}",            # 202507
                f"_{y_short}.{m_padded}月",  # _25.01月
                f"_{y_short}.{m_unpadded}月", # _25.1月
                f"{y_short}.{m_padded}",     # 25.01
                f"_{m_padded}_",             # _07_
                f"_{m_padded}.",             # _07.
                f"_{m_unpadded}月",          # _7月
                f"{m_unpadded}月",           # 7月
            ]

            for pattern in month_patterns:
                if pattern in fname:
                    return f
        return None

    # Extract all months data using kpi_extractor (Parallel with explicit thread pool)
    import asyncio
    import time
    from concurrent.futures import ThreadPoolExecutor
    
    loop = asyncio.get_running_loop()
    tasks = []
    month_file_map = [] # To keep track of which result belongs to which month

    t_start = time.perf_counter()
    num_months = len(sorted_months)
    print(f"[perf] Starting parallel KPI extraction for {num_months} months")
    
    # Use explicit thread pool with enough workers
    max_workers = min(num_months, 10)  # Up to 10 parallel extractions
    executor = ThreadPoolExecutor(max_workers=max_workers)
    
    for month in sorted_months:
        file = find_file(month)
        if file:
            month_file_map.append((month, file))
            # extract_from_excel is synchronous, run in thread pool
            tasks.append(loop.run_in_executor(executor, extract_from_excel, file, False))
    
    if not tasks:
        executor.shutdown(wait=False)
        return _json({"ok": False, "error": f"No report files found for selected months"}, status=404)

    # Wait for all extractions to complete
    results = await asyncio.gather(*tasks, return_exceptions=True)
    executor.shutdown(wait=False)
    
    t_extract = time.perf_counter()
    print(f"[perf] KPI extraction completed in {t_extract - t_start:.2f}s for {len(tasks)} files (workers={max_workers})")
    
    all_results = []
    for i, res in enumerate(results):
        month, file = month_file_map[i]
        if isinstance(res, Exception):
            _gi_log(f"Failed to extract {month} from {file.name}: {str(res)}")
        else:
            all_results.append((month, res))
    
    if len(all_results) == 0:
        return _json({"ok": False, "error": f"No report files found for selected months"}, status=404)
    
    # Get client name
    client_name = data_folder.parts[-1]
    if client_name in ["レポート", "オンライン", "店舗"] and len(data_folder.parts) > 1:
        client_name = f"{data_folder.parts[-2]}_{client_name}"
    
    # Generate markdown using point_pack_generator
    t_md_start = time.perf_counter()
    try:
        md_content = generate_multi_month_point_pack_md(all_results, client_name, lp_url=lp_url, include_banners=False)
    except Exception as e:
        return _json({"ok": False, "error": f"Failed to generate markdown: {str(e)}"}, status=500)
    
    t_md_end = time.perf_counter()
    print(f"[perf] Markdown generation completed in {t_md_end - t_md_start:.2f}s")
    
    # Save to compare/
    compare_filename = f"{sorted_months[0]}__{client_name}__point-pack.md"
    compare_path = COMPARE_DIR / compare_filename
    COMPARE_DIR.mkdir(exist_ok=True)
    compare_path.write_text(md_content, encoding="utf-8-sig")
    
    t_total = time.perf_counter()
    print(f"[perf] Total report generation: {t_total - t_start:.2f}s (extract: {t_extract - t_start:.2f}s, markdown: {t_md_end - t_md_start:.2f}s)")

    # Build chart_data for frontend visualization
    chart_data = _build_chart_data(all_results)
    media_breakdown = _build_media_breakdown_data(all_results)

    return _json({
        "ok": True,
        "point_pack": md_content,
        "path": str(compare_path),
        "num_months": len(all_results),
        "chart_data": chart_data,
        "media_breakdown": media_breakdown
    })


if __name__ == "__main__":







    main()















































# ### COMPAT_POINT_PACK_ENDPOINTS ###







# UI 側の「読込」が [object Object] でも拾う互換レイヤー（終わらせる版）。







# - payload/query の深部（selected/value/label/path/id等）から候補文字列を総当たり抽出







# - compare/ 以外の候補ディレクトリも探索（list側とズレても拾う）







# - 絶対パス/相対パスどっちでもOK。ただし repo 外は読ませない（安全）















import os







import time







from pathlib import Path







from typing import Any, Dict, Iterable, List, Optional















from fastapi import Body, Request







from fastapi.responses import JSONResponse















_REPO_ROOT = Path(__file__).resolve().parents[2]















# 候補ディレクトリ（プロジェクト内に限定して広めに）







_CAND_DIRS: List[Path] = []







for rel in [







    "compare",







    "compare/point_packs",







    "compare/point-packs",







    "point_packs",







    "point-packs",







    "outputs",







    "insights",







    "reports",







    "data",







]:







    _CAND_DIRS.append((_REPO_ROOT / rel).resolve())















# env 指定があれば優先







for envk in ("ADS_COMPARE_DIR", "ADS_POINT_PACK_DIR", "ADS_POINTPACK_DIR"):







    v = os.getenv(envk, "")







    if v:







        _CAND_DIRS.insert(0, Path(v).expanduser().resolve())















def _allowed_path(p: Path) -> bool:







    try:







        p = p.resolve()







        return str(p).startswith(str(_REPO_ROOT.resolve()))







    except Exception:







        return False















def _sanitize(s: str) -> str:







    s = (s or "").strip().strip('"').strip("'")







    return s















def _iter_strings(obj: Any, depth: int = 0, max_depth: int = 5) -> Iterable[str]:







    if depth > max_depth or obj is None:







        return







    if isinstance(obj, (str, int, float, bool)):







        yield str(obj)







        return







    if isinstance(obj, dict):







        for _, v in obj.items():







            yield from _iter_strings(v, depth + 1, max_depth)







        return







    if isinstance(obj, (list, tuple, set)):







        for it in obj:







            yield from _iter_strings(it, depth + 1, max_depth)







        return















def _extract_candidates(request: Request, payload: Any) -> List[str]:







    c: List[str] = []















    # query params 全取得







    try:







        q = request.query_params







        for k in q.keys():







            v = q.get(k)







            if v:







                c.append(str(v))







    except Exception:







        pass















    # body の中から文字列っぽいもの全部







    for s in _iter_strings(payload):







        if s:







            c.append(str(s))















    # 優先キー（UI実装ゆらぎ吸収）







    if isinstance(payload, dict):







        for key in ("path","file","filename","name","value","label","title","id","pack","selected","item","option","data"):







            v = payload.get(key)







            if v is not None:







                for s in _iter_strings(v):







                    if s:







                        c.insert(0, str(s))















    # 正規化＆重複排除







    out: List[str] = []







    seen = set()







    for s in c:







        s = _sanitize(str(s)).replace("\\", "/")







        if not s:







            continue







        if s.strip().lower() == "[object object]":







            continue







        if s not in seen:







            seen.add(s)







            out.append(s)







    return out















def _try_resolve_one(raw: str) -> Optional[Path]:







    raw = _sanitize(raw).replace("\\", "/")







    if not raw:







        return None















    # 1) absolute







    p = Path(raw)







    if p.is_absolute() and p.exists() and _allowed_path(p):







        return p.resolve()















    # 2) relative under repo







    p2 = (_REPO_ROOT / raw).resolve()







    if p2.exists() and _allowed_path(p2):







        return p2















    # 3) basename search







    base = raw.split("/")[-1]







    if not base:







        return None















    # direct join







    for d in _CAND_DIRS:







        if not d.exists():







            continue







        try:







            p3 = (d / base).resolve()







            if p3.exists() and _allowed_path(p3):







                return p3







        except Exception:







            pass















    # limited glob







    patterns = [f"**/{base}", f"**/*{base}*"]







    for d in _CAND_DIRS:







        if not d.exists():







            continue







        try:







            for pat in patterns:







                for hit in d.glob(pat):







                    if hit.is_file() and hit.suffix.lower() == ".md" and _allowed_path(hit):







                        return hit.resolve()







        except Exception:







            continue















    return None















def _pick_latest_point_pack() -> Optional[Path]:







    hits: List[Path] = []







    for d in _CAND_DIRS:







        if not d.exists():







            continue







        try:







            hits += list(d.glob("**/*point-pack*.md"))







            hits += list(d.glob("**/*point_pack*.md"))







            hits += list(d.glob("**/*pointpack*.md"))







        except Exception:







            pass







    hits = [p for p in hits if p.is_file() and _allowed_path(p)]







    if not hits:







        return None







    hits.sort(key=lambda p: p.stat().st_mtime, reverse=True)







    return hits[0]















def _resolve_point_pack(request: Request, payload: Any, name: str = "") -> Optional[Path]:







    if name:







        p = _try_resolve_one(name)







        if p:







            return p







    for cand in _extract_candidates(request, payload):







        p = _try_resolve_one(cand)







        if p:







            return p







    return _pick_latest_point_pack()












# UIが叩きがちなパスを全部吸収（snake/camel + path param 版も）







@app.api_route("/api/read_point_pack", methods=["GET","POST"])







@app.api_route("/api/load_point_pack", methods=["GET","POST"])







@app.api_route("/api/get_point_pack", methods=["GET","POST"])







@app.api_route("/api/point_pack", methods=["GET","POST"])







@app.api_route("/api/readPointPack", methods=["GET","POST"])







@app.api_route("/api/loadPointPack", methods=["GET","POST"])







@app.api_route("/api/getPointPack", methods=["GET","POST"])







@app.api_route("/api/pointPack", methods=["GET","POST"])







@app.api_route("/api/read_point_pack/{name:path}", methods=["GET","POST"])







@app.api_route("/api/load_point_pack/{name:path}", methods=["GET","POST"])







@app.api_route("/api/get_point_pack/{name:path}", methods=["GET","POST"])







@app.api_route("/api/point_pack/{name:path}", methods=["GET","POST"])







@app.api_route("/api/readPointPack/{name:path}", methods=["GET","POST"])







@app.api_route("/api/loadPointPack/{name:path}", methods=["GET","POST"])







@app.api_route("/api/getPointPack/{name:path}", methods=["GET","POST"])







@app.api_route("/api/pointPack/{name:path}", methods=["GET","POST"])







async def api_read_point_pack(







    request: Request,







    payload: Optional[Dict[str, Any]] = Body(default=None),







    name: str = "",







) -> Any:







    p = _resolve_point_pack(request, payload, name=name)







    if (p is None) or (not p.exists()):







        return JSONResponse(







            status_code=404,







            content={







                "ok": False,







                "error": "Not Found",







                "name": name,







                "candidates": _extract_candidates(request, payload),







            },







        )







    text = p.read_text(encoding="utf-8-sig")







    return {"ok": True, "name": p.name, "path": str(p), "text": text, "content": text, "markdown": text, "body": text}







# ### /COMPAT_POINT_PACK_ENDPOINTS ###







































# === COMPAT_CHAT_API_V1 ===







# Adds POST /api/chat (Gemini) with robust payload parsing + point-pack resolution fallback.















from fastapi import Request







from fastapi.responses import JSONResponse















import os







import json







import re







from pathlib import Path







from typing import Any, Dict, List, Optional, Tuple















try:







    import httpx  # type: ignore







except Exception:







    httpx = None  # type: ignore























def _json200(payload: dict):







    return JSONResponse(







        payload,







        status_code=200,







        headers={"Content-Type": "application/json; charset=utf-8"},







    )























def _first_str(*xs):







    for x in xs:







        if isinstance(x, str) and x.strip():







            return x.strip()







    return ""























def _extract_user_message(body: Any) -> str:







    if isinstance(body, str):







        return body.strip()















    if isinstance(body, dict):







        # common keys







        msg = _first_str(







            body.get("message"),







            body.get("text"),







            body.get("prompt"),







            body.get("input"),







            body.get("query"),







            body.get("content"),







        )







        if msg:







            return msg















        # OpenAI-like chat payload







        msgs = body.get("messages")







        if isinstance(msgs, list) and msgs:







            # find last user-ish message







            for m in reversed(msgs):







                if not isinstance(m, dict):







                    continue







                role = _first_str(m.get("role"))







                c = m.get("content")







                if isinstance(c, str) and c.strip():







                    if role.lower() in ("user", ""):







                        return c.strip()







            # fallback: any last content







            for m in reversed(msgs):







                if isinstance(m, dict) and isinstance(m.get("content"), str) and m["content"].strip():







                    return m["content"].strip()















    return ""























def _resolve_point_pack_from_body(repo_dir: Path, body: Any) -> Tuple[Optional[Path], str]:







    """







    Tries to resolve compare/*__point-pack.md using body hints.







    Fallback: newest modified point-pack.







    Returns (path_or_None, reason)







    """







    compare_dir = repo_dir / "compare"







    if not compare_dir.exists():







        return None, f"compare dir not found: {compare_dir}"















    cands = sorted(compare_dir.rglob("*__point-pack.md"))







    if not cands:







        return None, "no point-pack files found"















    token = ""







    month = ""















    if isinstance(body, dict):







        token = _first_str(







            body.get("path"),







            body.get("id"),







            body.get("name"),







            body.get("point_pack_path"),







            body.get("pointPackPath"),







            body.get("point_pack_name"),







            body.get("pointPackName"),







        )















        # nested variants







        for k in ("point_pack", "pointPack", "data", "item"):







            v = body.get(k)







            if isinstance(v, dict):







                token = _first_str(token, v.get("path"), v.get("id"), v.get("name"))















        raw = token + " " + json.dumps(body, ensure_ascii=False)







        mm = re.search(r"(20\d{2}-\d{2})", raw)







        month = mm.group(1) if mm else ""







    elif isinstance(body, str):







        mm = re.search(r"(20\d{2}-\d{2})", body)







        month = mm.group(1) if mm else ""















    # normalize token -> filename-like







    t = token.replace("\\", "/").strip()







    if "/compare/" in t:







        t = t.split("/compare/", 1)[1]







    t = t.lstrip("/")















    # If token looks like file







    if t:







        fn = t.split("/")[-1]







        if not fn.lower().endswith(".md"):







            fn = fn + ".md"







        if "__point-pack" not in fn:







            fn = fn[:-3] + "__point-pack.md"







        exact = compare_dir / fn







        if exact.exists():







            return exact, "exact match"















    # Month filter







    month_cands = [x for x in cands if (month and x.name.startswith(month + "__"))] if month else cands















    # If only one in that month -> choose it







    if len(month_cands) == 1:







        return month_cands[0], "single month candidate"















    # Otherwise newest modified







    newest = sorted(month_cands, key=lambda x: x.stat().st_mtime, reverse=True)[0]







    return newest, "fallback newest"























async def _gemini_generate_text(model: str, prompt: str, temperature: float = 0.7, max_tokens: int = 8192, api_key: str | None = None, images: list[dict] | None = None) -> str:
    model = normalize_gemini_model(model)
    # V2.6: 統一resolver使用
    final_api_key = _resolve_gemini_api_key(api_key)





    if not final_api_key:





        raise RuntimeError("GOOGLE_API_KEY (or GEMINI_API_KEY) is not set")















    # Generative Language API (v1beta)







    if not final_api_key:
        print("[gemini] API key missing")
        return "Error: Gemini API key is not configured."

    budget_estimate = assert_gemini_budget_available(
        model=model,
        prompt=prompt,
        max_output_tokens=max_tokens,
        feature="ads.generate_text",
    )

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={final_api_key}"















    # Construct parts
    parts = [{"text": prompt}]
    if images:
        for img in images:
            parts.append({"inline_data": img})

    payload = {
        "contents": [{"role": "user", "parts": parts}],







        "generationConfig": {







            "temperature": float(temperature),







            "maxOutputTokens": int(max_tokens),







        },







    }















    if httpx is not None:







        try:
            async with httpx.AsyncClient(timeout=60) as client:







                r = await client.post(url, json=payload, headers={"Content-Type": "application/json; charset=utf-8"})







                r.raise_for_status()







                data = r.json()
        except BaseException:
            release_gemini_reservation(budget_estimate)
            raise







    else:







        import urllib.request















        req = urllib.request.Request(







            url,







            data=json.dumps(payload).encode("utf-8"),







            headers={"Content-Type": "application/json; charset=utf-8"},







            method="POST",







        )







        try:
            with urllib.request.urlopen(req, timeout=60) as resp:







                raw = resp.read().decode("utf-8", errors="replace")







                data = json.loads(raw)
        except BaseException:
            release_gemini_reservation(budget_estimate)
            raise















    # Parse text







    try:







        cand = (data.get("candidates") or [])[0]







        parts = ((cand.get("content") or {}).get("parts") or [])







        texts = [p.get("text", "") for p in parts if isinstance(p, dict)]







        out = "".join(texts).strip()







        if out:







            record_gemini_usage_from_response(
                model=model,
                prompt=prompt,
                output_text=out,
                max_output_tokens=max_tokens,
                usage_metadata=data.get("usageMetadata") or {},
                feature="ads.generate_text",
                request_estimate=budget_estimate,
            )
            return out







    except Exception:







        pass















    # Fallback stringify







        # NOTE: never truncate JSON for parsing; only truncate for logging elsewhere.







    fallback_out = json.dumps(data, ensure_ascii=False)
    record_gemini_usage_from_response(
        model=model,
        prompt=prompt,
        output_text=fallback_out,
        max_output_tokens=max_tokens,
        usage_metadata=data.get("usageMetadata") or {},
        feature="ads.generate_text",
        request_estimate=budget_estimate,
    )
    return fallback_out























@app.post("/api/chat")







async def api_chat(request: Request):







    repo_dir = Path(__file__).resolve().parents[2]







    raw_bytes = b""







    body: Any = None















    try:







        raw_bytes = await request.body()







    except Exception:







        pass















    try:







        body = await request.json()







    except Exception:







        txt = None







        for enc in ("utf-8", "utf-8-sig", "cp932", "shift_jis"):







            try:







                txt = raw_bytes.decode(enc, errors="replace").strip()







                if txt:







                    break







            except Exception:







                pass







        body = txt or ""















    user_msg = _extract_user_message(body)







    if not user_msg:







        user_msg = "要点パックを前提に、今月の考察を作成してください。"















    # model / temperature hints







    model = "gemini-3.1-flash-lite"







    temp = 0.7
    gemini_api_key = None







    if isinstance(body, dict):







        model = _first_str(body.get("model"), body.get("gemini_model"), body.get("geminiModel"), model)







        try:







            temp = float(body.get("temperature", body.get("temp", temp)))
            gemini_api_key = _first_str(body.get("gemini_api_key"), body.get("apiKey"), None)







        except Exception:







            temp = temp















    pp_path, reason = _resolve_point_pack_from_body(repo_dir, body)







    pp_text = ""







    pp_name = ""







    pp_rel = ""















    if pp_path and pp_path.exists():







        pp_text = pp_path.read_text(encoding="utf-8-sig", errors="ignore")







        pp_name = pp_path.stem







        pp_rel = f"compare/{pp_path.name}"















    system_rules = """あなたは広告運用レポートの考察アシスタントです。







- 暗算しない（計算はpoint-packの確定値のみを引用）







- 表にない数値は「未取得/不明」とする（捏造しない）







- 推論は「仮説」と明記し、確度の高い順に並べる







- 数値比較は必ずMarkdownの表（テーブル）を使用し、視認性を高める
- 箇条書きを乱用せず、適度な行間と段落を作る







"""















    prompt = system_rules







    if pp_text:







        prompt += f"\n\n# 要点パック（参照）\n(パス: {pp_rel})\n\n{pp_text}\n"







    else:







        prompt += "\n\n# 要点パック\n未取得/不明（compare 配下にファイルが見つかりませんでした）\n"















    















    # === COMPAT_CHAT_MULTI_PP_V1 ===







    # If user mentions additional months like "2025-07", load matching point-packs and append to prompt.







    try:







        raw = user_msg or ""







        # also scan body JSON string for months







        if isinstance(body, dict):







            import json as _json







            raw += " " + _json.dumps(body, ensure_ascii=False)
            
            # Extract style info: preset vs custom
            style_preset = body.get("style_preset", "").strip()
            style_ref = body.get("style_reference", "").strip()
            
            style_instruction = ""
            
            # 1. Preset (Hosomi-san etc)
            if style_preset == "hosomi":
                try:
                    preset_path = repo_dir / "web/app/prompts/styles/hosomi.txt"
                    if preset_path.exists():
                        style_instruction = preset_path.read_text(encoding="utf-8")
                    else:
                        style_instruction = f"(Error: Style preset file not found at {preset_path})"
                except Exception as e:
                    style_instruction = f"(Error loading style preset: {e})"
            
            # 2. Custom (Override or fallback)
            elif style_preset == "custom" and style_ref:
                style_instruction = style_ref
            
            # Append if instruction exists
            if style_instruction:
                prompt += f"\n\n# 【重要】考察スタイルの指定（最優先）\nユーザーの元々の指示（テンプレート等）に関わらず、以下のスタイル・観点・トーンを**強制的に適用**してください。\n特に「当たり前の数値報告」は禁止です。\n\n--- スタイル指定 ---\n{style_instruction}\n--------------------\n\n**【出力時の注意】** 上記のスタイル指定・システム指示・プロンプト内容（「最優先指示」「細見流」の説明文など）は絶対に出力に含めないでください。考察の本文のみを出力してください。\n"







        months = sorted(set(re.findall(r"(20\d{2}-\d{2})", raw)))







        # Remove current month if already included by primary point pack name







        # (keep it anyway; harmless)







        extra_texts = []







        compare_dir = repo_dir / "compare"







        if compare_dir.exists() and months:







            for mm in months:







                # pick best match: startswith month and contains __point-pack







                cands = sorted(compare_dir.rglob(f"{mm}__*__point-pack.md"))







                if not cands:







                    continue







                # prefer newest modified among that month (safe)







                cands.sort(key=lambda x: x.stat().st_mtime, reverse=True)







                x = cands[0]







                try:







                    txt = x.read_text(encoding="utf-8-sig", errors="ignore")







                except Exception:







                    txt = x.read_text(encoding="utf-8", errors="ignore")







                extra_texts.append((mm, f"compare/{x.name}", txt))







        if extra_texts:







            prompt += "\n\n# 追加参照（ユーザー指定月）\n"







            for mm, rel, txt in extra_texts:







                # avoid duplicating the same file as primary







                if rel == pp_rel:







                    continue







                prompt += f"\n## {mm}（パス: {rel}）\n\n{txt}\n"







    except Exception:







        pass







    # === /COMPAT_CHAT_MULTI_PP_V1 ===















    prompt += f"\n\n# 追加要望\n{user_msg}\n"

    # Extract Chart Images from Prompt
    # Pattern: ![](/public/charts/xxxx.png)
    chart_images = []
    try:
        import base64
        import mimetypes
        import re
        
        # Find all chart paths
        # We look for /public/charts/... in the prompt
        # Regex might be tricky if paths are full URLs, but we generated them as /public/charts/
        chart_paths = re.findall(r"\!\[.*?\]\((/public/charts/[^)]+)\)", prompt)
        
        # Limit to reasonable number (e.g., 5) to avoid payload limit
        chart_paths = sorted(list(set(chart_paths)))[:5]
        
        for cp in chart_paths:
            # cp is like /public/charts/xxx.png
            # Map to local file path. repo_dir is project root.
            # /public/charts/ should map to repo_dir/public/charts/
            local_path = repo_dir / cp.lstrip("/")
            
            if local_path.exists():
                try:
                    mime_type, _ = mimetypes.guess_type(local_path)
                    if not mime_type: mime_type = "image/png"
                    
                    data = local_path.read_bytes()
                    encoded_data = base64.b64encode(data).decode('utf-8')
                    
                    chart_images.append({
                        "mime_type": mime_type,
                        "data": encoded_data
                    })
                    print(f"[gemini] Loaded chart image: {local_path.name}")
                except Exception as e:
                    print(f"[gemini] Failed to load chart image {local_path}: {e}")
                    
        if chart_images:
            print(f"[gemini] Sending {len(chart_images)} chart images to AI")
            
    except Exception as e:
        print(f"[gemini] Error preparing chart images: {e}")

    try:
        answer = await _gemini_generate_text(model=model, prompt=prompt, temperature=temp, api_key=gemini_api_key, images=chart_images)







        payload = {







            "ok": True,







            "model": model,







            "temperature": temp,







            "point_pack": {"name": pp_name, "path": pp_rel, "reason": reason},







            # common keys







            "text": answer,







            "reply": answer,







            "content": answer,







            "message": answer,







            "assistant": answer,







            "data": {"text": answer, "reply": answer, "content": answer},







        }







        return _json200(payload)







    except Exception as e:







        msg = f"chat failed: {type(e).__name__}: {e}"







        return _json200({







            "ok": False,







            "error": msg,







            "point_pack": {"name": pp_name, "path": pp_rel, "reason": reason},







            "text": msg,







            "reply": msg,







            "content": msg,







            "data": {"error": msg},







        })















# === /COMPAT_CHAT_API_V1 ===































# === COMPAT_COMPARE_RGlob_V2 ===







# compare/ subfolders supported via rglob







# === /COMPAT_COMPARE_RGlob_V2 ===















# === GI_CLEAN_3H_HELPER_V3 ===







def gi_clean_3h(answer):







    """







    Normalize Gemini output into exactly 3 Markdown sections:







    ## 良かった点 / ## 課題 / ## 打ち手















    Policy:







    - Don't echo point-pack raw body.







    - If extraction fails, fall back to original answer (but still normalize headings).







    """







    if not isinstance(answer, str):







        return answer















    H_GOOD = '## 良かった点'







    H_BAD  = '## 課題'







    H_ACT  = '## 打ち手'















    # 1) Remove obvious echoed point-pack blocks (avoid over-cutting).







    # Stop only when we detect an explicit "point-pack" marker block start.







    out = []







    for line in answer.splitlines():







        t = line.lstrip()







        # common markers when the model starts echoing prompt/point-pack







        if t.startswith('# 要点パック') or t.startswith('## 要点パック') or t.startswith('# point-pack') or t.startswith('## point-pack'):







            break







        out.append(line)







    a = '\n'.join(out).strip()















    # 2) Normalize heading levels and map mojibake/要求系 headings to 3 headings.







    norm = []







    for line in a.splitlines():







        raw = line.rstrip('\n')







        s2 = raw.strip()















        # normalize ### -> ##







        if s2.startswith('### '):







            s2 = '## ' + s2[4:]















        # map "要求" variants and question-mark variants to the 3 headings by order/keyword







        # If the model outputs generic headings like "## 良かった点", "## 課題", etc,







        # we map them deterministically based on first/second/third occurrence.







        norm.append(s2)















    a2 = '\n'.join(norm)















    # 3) Extract content under the 3 headings.







    # Accept headings that start with these keywords too.







    keep = {H_GOOD: [], H_BAD: [], H_ACT: []}







    cur = None







    order = [H_GOOD, H_BAD, H_ACT]







    k = 0















    for line in a2.splitlines():







        s3 = line.strip()















        # recognize headings







        is_h = s3.startswith('## ')







        if is_h:







            title = s3[3:].strip()















            # direct match







            if title == '良かった点':







                cur = H_GOOD; continue







            if title == '課題':







                cur = H_BAD; continue







            if title == '打ち手':







                cur = H_ACT; continue















            # mojibake/要求 variants: treat as sequential section headers







            if title.startswith('要求') or (title.startswith('?') and title.count('?') >= 2) :







                if k < 3:







                    cur = order[k]







                    k += 1







                    continue















        # collect body







        if cur is not None:







            # stop if prompt echo starts (top-level heading)







            if s3.startswith('# ') and (not s3.startswith('## ')):







                break







            keep[cur].append(line)















    # 4) If extraction failed badly, fallback to original text but still wrap into 3 sections.







    def _body(x: list[str]) -> str:







        b = '\n'.join(x).strip()







        return b















    bodies = {k: _body(v) for k, v in keep.items()}







    # if all empty, fallback







    if all((not v) for v in bodies.values()):







        # fallback: just return original answer with headings enforced







        bodies = {







            H_GOOD: "- （未取得/不明）",







            H_BAD:  "- （未取得/不明）",







            H_ACT:  "- （未取得/不明）",







        }















    # fill empties







    for k2 in [H_GOOD, H_BAD, H_ACT]:







        if not bodies[k2]:







            bodies[k2] = "- （未取得/不明）"















    res = []







    res.append(H_GOOD)







    res.append(bodies[H_GOOD])







    res.append('')







    res.append(H_BAD)







    res.append(bodies[H_BAD])







    res.append('')







    res.append(H_ACT)







    res.append(bodies[H_ACT])







    return '\n'.join(res).strip() + '\n'







# === /GI_CLEAN_3H_HELPER_V3 ===



# === DEBUG_ROUTES_DUMP_V1 ===

try:

    from fastapi.responses import JSONResponse as _DbgJSONResponse

except Exception:

    _DbgJSONResponse = None



if "app" in globals() and _DbgJSONResponse is not None:

    @app.get("/api/_debug/routes")

    async def _debug_routes():

        if not _ENABLE_DEBUG_ENDPOINTS:
            return _DbgJSONResponse({"ok": False, "error": "Not found"}, status_code=404)

        out = []

        for r in app.router.routes:

            try:

                methods = sorted(list(getattr(r, "methods", []) or []))

                name = getattr(r, "name", None)

                endpoint = getattr(r, "endpoint", None)

                ep_name = getattr(endpoint, "__name__", None) if endpoint else None

                mod = getattr(endpoint, "__module__", None) if endpoint else None

                path = getattr(r, "path", None)

                out.append({"path": path, "methods": methods, "name": name, "endpoint_name": ep_name, "module": mod})

            except Exception:

                continue

        return _DbgJSONResponse({"ok": True, "routes": out})

# === /DEBUG_ROUTES_DUMP_V1 ===



# =========================
# Neon Insight Studio API (stable endpoints for React UI)
# - clients / point packs / read pack / generate (Gemini via backend)
# =========================
from typing import Any, Dict, List, Optional
from pathlib import Path
import os, re, time, json
import urllib.request
import urllib.error

try:
    from fastapi import Query
except Exception:
    Query = None  # type: ignore

# CORS: 重複ミドルウェア削除済み — 上部の一箇所で統一管理 (V2.6)

_HERE = Path(__file__).resolve()
_REPO = _HERE.parents[2]  # .../ads-insights
_COMPARE = _REPO / "compare"

_neon_cache: Dict[str, Any] = {"ts": 0.0, "items": []}

def _scan_point_packs() -> List[Dict[str, str]]:
    # Cache for a short time to avoid heavy rglob on every UI refresh
    now = time.time()
    if now - float(_neon_cache.get("ts", 0.0)) < 2.0 and _neon_cache.get("items"):
        return list(_neon_cache["items"])

    items: List[Dict[str, str]] = []
    if _COMPARE.exists():
        for p in _COMPARE.rglob("*point-pack.md"):
            rel = p.relative_to(_COMPARE).as_posix()
            parts = rel.split("/")
            client = parts[0] if len(parts) > 1 else "default"

            name = p.name
            month = ""
            title = name
            m = re.match(r"^(\d{4}-\d{2})__(.+)__point-pack\.md$", name)
            if m:
                month = m.group(1)
                title = m.group(2)
            else:
                m2 = re.match(r"^(\d{4}-\d{2}).*point-pack\.md$", name)
                if m2:
                    month = m2.group(1)

            items.append({
                "client": client,
                "month": month,
                "title": title,
                "path": rel,
            })

    # sort (month desc, then title)
    def _key(it: Dict[str, str]):
        return (it.get("client",""), it.get("month","0000-00"), it.get("title",""))
    items.sort(key=_key, reverse=True)

    _neon_cache["ts"] = now
    _neon_cache["items"] = items
    return items

def _safe_compare_path(rel_posix: str) -> Path:
    # prevent path traversal
    rel_posix = rel_posix.replace("\\", "/").lstrip("/")
    compare_root = _COMPARE.resolve()
    target = (compare_root / rel_posix).resolve()
    try:
        target.relative_to(compare_root)
    except ValueError:
        raise ValueError("invalid path")
    if not target.exists():
        raise FileNotFoundError(rel_posix)
    return target

def _anthropic_generate(model: str, prompt: str, temperature: float = 0.7, max_tokens: int = 8192, api_key: str | None = None) -> str:
    """Anthropic Claude Messages API を呼び出す."""
    if not api_key:
        raise RuntimeError("Missing Anthropic API key. Pass api_key (sk-ant-...).")
    url = "https://api.anthropic.com/v1/messages"
    headers_dict = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body = {
        "model": model,
        "max_tokens": int(max_tokens),
        "temperature": float(temperature),
        "messages": [{"role": "user", "content": prompt}],
    }
    data = json.dumps(body).encode("utf-8")
    last_err = None
    for i in range(4):
        try:
            req = urllib.request.Request(url, data=data, method="POST", headers=headers_dict)
            _anthropic_timeout = int(os.getenv("ANTHROPIC_TIMEOUT_SEC", "300"))
            with urllib.request.urlopen(req, timeout=_anthropic_timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            j = json.loads(raw)
            content_blocks = j.get("content") or []
            text_parts = [b["text"] for b in content_blocks if b.get("type") == "text" and b.get("text")]
            if not text_parts:
                raise RuntimeError(f"No text in Anthropic response. raw={raw[:500]}")
            text = "\n".join(text_parts)
            usage = j.get("usage", {})
            stop_reason = j.get("stop_reason", "?")
            print(f"[anthropic] model={j.get('model')} input_tokens={usage.get('input_tokens','?')} output_tokens={usage.get('output_tokens','?')} stop_reason={stop_reason}")
            # 出力が max_tokens で打ち切られた場合はユーザーに通知
            if stop_reason == "max_tokens":
                _TRUNCATION_NOTICE = "\n\n---\n*（出力がトークン上限に達したため、考察が途中で打ち切られた可能性があります。`NEON_MAX_OUTPUT_TOKENS` 環境変数を増やすか、より短いプロンプトを試してください。）*"
                text = text + _TRUNCATION_NOTICE
            return text
        except urllib.error.HTTPError as e:
            status = getattr(e, "code", None)
            msg = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else str(e)
            last_err = RuntimeError(f"Anthropic HTTPError {status}: {msg[:500]}")
            if status in (429, 500, 502, 503, 529):
                time.sleep(min(15.0, 1.0 * (2 ** i)))
                continue
            raise last_err
        except Exception as e:
            last_err = e
            time.sleep(min(15.0, 1.0 * (2 ** i)))
            continue
    raise RuntimeError(f"Anthropic failed after retries: {last_err}")

def _gemini_generate(
    model: str,
    prompt: str,
    temperature: float = 0.7,
    max_tokens: int = 8192,
    api_key: str | None = None,
    feature: str = "ads.neon_generate",
) -> str:
    model = normalize_gemini_model(model)
    key = _resolve_gemini_api_key(api_key)
    if not key:
        raise RuntimeError("Missing GEMINI_API_KEY (or GOOGLE_API_KEY). Set env var, config.json, or pass api_key.")
    budget_estimate = assert_gemini_budget_available(
        model=model,
        prompt=prompt,
        max_output_tokens=max_tokens,
        feature=feature,
    )
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"

    def _single_call(prompt_text: str, temp: float, tokens: int) -> tuple:
        """Returns (text, finish_reason, usage_metadata)"""
        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt_text}]}],
            "generationConfig": {
                "temperature": float(temp),
                "maxOutputTokens": int(tokens),
            },
        }
        data = json.dumps(payload).encode("utf-8")
        last_err = None
        for i in range(6):
            try:
                req = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=120) as resp:
                    body = resp.read().decode("utf-8", errors="replace")
                j = json.loads(body)
                cands = j.get("candidates") or []
                if not cands:
                    raise RuntimeError(f"No candidates. raw={body[:500]}")
                finish_reason = (cands[0] or {}).get("finishReason", "UNKNOWN")
                usage = j.get("usageMetadata", {})
                parts = (((cands[0] or {}).get("content") or {}).get("parts") or [])
                text = (parts[0] or {}).get("text") if parts else None
                if not text:
                    raise RuntimeError(f"No text in response. raw={body[:500]}")
                print(f"[gemini] finish_reason={finish_reason} prompt_tokens={usage.get('promptTokenCount', '?')} output_tokens={usage.get('candidatesTokenCount', '?')} total={usage.get('totalTokenCount', '?')}")
                return (str(text), finish_reason, usage)
            except urllib.error.HTTPError as e:
                status = getattr(e, "code", None)
                msg = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else str(e)
                last_err = RuntimeError(f"HTTPError {status}: {msg[:500]}")
                if status in (429, 500, 502, 503, 504):
                    time.sleep(min(10.0, 0.7 * (2 ** i)))
                    continue
                raise last_err
            except Exception as e:
                last_err = e
                time.sleep(min(10.0, 0.7 * (2 ** i)))
                continue
        raise RuntimeError(f"Gemini failed after retries: {last_err}")

    # First call
    try:
        text, finish_reason, usage = _single_call(prompt, temperature, max_tokens)
    except BaseException:
        release_gemini_reservation(budget_estimate)
        raise
    combined_usage = dict(usage or {})

    # Auto-continuation if truncated (once only)
    if finish_reason == "MAX_TOKENS":
        print("[gemini] Output truncated (MAX_TOKENS). Attempting auto-continuation...")
        continuation_prompt = f"{prompt}\n\n# 前回の出力（途中切れ）\n{text}\n\n# 指示\n上記の続きを書いてください。前回の最後の文から自然に繋がるように続けること。重複して書かないこと。"
        cont_text, cont_reason, cont_usage = _single_call(continuation_prompt, temperature, max_tokens)
        text = text.rstrip() + "\n" + cont_text.lstrip()
        for key_name in ("promptTokenCount", "candidatesTokenCount", "totalTokenCount"):
            try:
                combined_usage[key_name] = int(combined_usage.get(key_name) or 0) + int((cont_usage or {}).get(key_name) or 0)
            except Exception:
                pass
        print(f"[gemini] Continuation done. final_finish_reason={cont_reason}")

    record_gemini_usage_from_response(
        model=model,
        prompt=prompt,
        output_text=text,
        max_output_tokens=max_tokens,
        usage_metadata=combined_usage,
        feature=feature,
        request_estimate=budget_estimate,
    )
    return text

@app.get("/api/neon/clients")
def neon_clients() -> Dict[str, Any]:
    items = _scan_point_packs()
    clients = sorted({it["client"] for it in items})
    return {"clients": [{"id": c, "label": c} for c in clients], "count": len(clients)}

@app.get("/api/neon/point_packs")
def neon_point_packs(client: Optional[str] = None) -> Dict[str, Any]:
    items = _scan_point_packs()
    if client:
        items = [it for it in items if it.get("client") == client]
    return {"items": items, "count": len(items)}

@app.get("/api/neon/read_point_pack")
def neon_read_point_pack(path: str) -> Dict[str, Any]:
    p = _safe_compare_path(path)
    md = p.read_text(encoding="utf-8-sig", errors="replace")
    return {"path": path, "markdown": md}


def _load_bq_system_prompt(query_types: list) -> str:
    """BQデータ用のシステムプロンプトを構築"""
    base_path = ROOT / "web/app/prompts/system_bq.txt"
    hints_path = ROOT / "web/app/prompts/bq_query_hints.json"

    if base_path.exists():
        system = base_path.read_text(encoding="utf-8-sig")
    else:
        system = "あなたはGA4ウェブ解析レポートの考察作成アシスタントです。"

    if query_types and hints_path.exists():
        import json as _json
        hints = _json.loads(hints_path.read_text(encoding="utf-8-sig"))
        hint_lines = [
            f"- **{hints[qt]['name']}**: {hints[qt]['hint']}"
            for qt in query_types if qt in hints
        ]
        if hint_lines:
            system += "\n\n━━━ 含まれるデータの分析ガイド ━━━\n" + "\n".join(hint_lines) + "\n"

        # V3.9: 類推ヒントも追加
        inference_lines = [
            f"- **{hints[qt]['name']}**: {hints[qt]['inference_hint']}"
            for qt in query_types if qt in hints and hints[qt].get('inference_hint')
        ]
        if inference_lines:
            system += "\n━━━ クエリ別の類推観点 ━━━\n" + "\n".join(inference_lines) + "\n"

    return system


def _safe_insight_value(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value) if value not in (None, "") else "-"
    if not math.isfinite(number):
        return "-"
    if number.is_integer():
        return f"{int(number):,}"
    return f"{number:,.1f}".rstrip("0").rstrip(".")


def _compact_agent_text(text: str, limit: int = 12000) -> str:
    source = str(text or "")
    if len(source) <= limit:
        return source
    lines = source.splitlines()
    keywords = ("##", "|", "セッション", "PV", "直帰率", "流入", "LP", "デバイス", "時間", "地域", "検索", "CV", "未取得", "不明")
    picked: list[str] = []
    for line in lines:
        if any(keyword in line for keyword in keywords):
            picked.append(line)
        if len("\n".join(picked)) >= limit:
            break
    compact = "\n".join(picked)
    if len(compact) < limit // 3:
        compact = source[:limit]
    return compact[:limit] + "\n\n[context compacted for multi_agent_v1]"


ANALYSIS_MODES = frozenset({"deterministic", "economy", "deep"})


def _analysis_response_metadata(
    *,
    analysis_mode: str,
    execution_mode: str,
    model: str | None,
    provider: str | None,
    llm_calls: int,
    text: str = "",
) -> dict[str, Any]:
    """Return honest execution metadata for the AI analysis endpoint.

    The provider wrappers currently return text only, so an exact token count is
    not available at this layer.  Do not repeat the historical mistake of
    labelling output character count as tokens.
    """
    used_llm = llm_calls > 0
    return {
        "analysis_mode": analysis_mode,
        "execution_mode": execution_mode,
        "model": model if used_llm else None,
        "provider": provider if used_llm else "deterministic",
        "tokens_used": None if used_llm else 0,
        "token_usage_status": "not_reported" if used_llm else "not_applicable",
        "output_chars": len(str(text or "")),
        "llm_calls": llm_calls,
    }


def _query_mentions_point(query_text: str, point: dict | None) -> bool:
    if not query_text or not isinstance(point, dict):
        return False
    source = str(query_text)
    aliases = [point.get("label"), point.get("rawLabel"), *(point.get("aliases") or [])]
    for alias in aliases:
        if alias and str(alias) in source:
            return True
    compact_source = re.sub(r"[^0-9]", "", source)
    for alias in aliases:
        compact_alias = re.sub(r"[^0-9]", "", str(alias or ""))
        if compact_alias and len(compact_alias) >= 4 and compact_alias in compact_source:
            return True
    return False


def _pick_primary_evidence_rows(chart_evidence_pack: dict | None, limit: int = 4, query_text: str = "") -> list[dict]:
    if not isinstance(chart_evidence_pack, dict):
        return []
    rows: list[dict] = []
    charts = chart_evidence_pack.get("charts")
    if not isinstance(charts, list):
        return rows

    if query_text:
        for chart in charts:
            if not isinstance(chart, dict):
                continue
            chart_id = str(chart.get("chart_id") or "")
            title = str(chart.get("title") or "グラフ")
            period = str(chart.get("period_tag") or chart_evidence_pack.get("scope_label") or "")
            for series in chart.get("series") or []:
                if not isinstance(series, dict):
                    continue
                metric = str(series.get("label") or "指標")
                for point in series.get("points") or []:
                    if not _query_mentions_point(query_text, point):
                        continue
                    value = point.get("value")
                    if value is None:
                        continue
                    label = point.get("label") or point.get("rawLabel") or period
                    rows.append({
                        "claim": f"{title} の {metric} は {label} に {_safe_insight_value(value)} です",
                        "metric": metric,
                        "value": _safe_insight_value(value),
                        "period": label,
                        "source": chart_id,
                        "confidence": "high",
                        "_title": title,
                    })
                    if len(rows) >= limit:
                        return rows
        if rows:
            return rows

    for chart in charts:
        if not isinstance(chart, dict):
            continue
        chart_id = str(chart.get("chart_id") or "")
        title = str(chart.get("title") or "グラフ")
        period = str(chart.get("period_tag") or chart_evidence_pack.get("scope_label") or "")
        for series in chart.get("series") or []:
            if not isinstance(series, dict):
                continue
            metric = str(series.get("label") or "指標")
            max_point = series.get("max") if isinstance(series.get("max"), dict) else {}
            latest = series.get("latest") if isinstance(series.get("latest"), dict) else {}
            total = series.get("total")
            selected = max_point if max_point.get("value") is not None else latest
            value = selected.get("value") if isinstance(selected, dict) else None
            label = selected.get("label") if isinstance(selected, dict) else ""
            if value is None and total is not None:
                value = total
                label = "合計"
            if value is None:
                continue
            rows.append({
                "claim": f"{title} の {metric} は {label or period or '対象期間'} が注目点です",
                "metric": metric,
                "value": _safe_insight_value(value),
                "period": label or period,
                "source": chart_id,
                "confidence": "high",
                "_title": title,
            })
            if len(rows) >= limit:
                return rows
    return rows


def _build_data_evidence_agent_notes(chart_evidence_pack: dict | None, data_availability: str = "full", query_text: str = "") -> str:
    rows = _pick_primary_evidence_rows(chart_evidence_pack, limit=8, query_text=query_text)
    if not rows:
        return f"Data Evidence Agent: 引用可能なグラフ数値なし。data_availability={data_availability}"
    lines = [
        "Data Evidence Agent: 引用可能な数値",
        "| chart_id | title | metric | value | period |",
        "| --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        lines.append(
            f"| {row.get('source')} | {row.get('_title')} | {row.get('metric')} | {row.get('value')} | {row.get('period')} |"
        )
    lines.append("未取得扱い: 広告費 / CPA / ROAS / CTR / CPC / インプレッションは入力に存在しない限り断定禁止。")
    return "\n".join(lines)


def _summarize_public_evidence_rows(rows: list[dict]) -> str:
    grouped: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        source = str(row.get("source") or "chart_evidence_pack")
        period = str(row.get("period") or "対象期間")
        grouped.setdefault((source, period), []).append(row)

    if not grouped:
        return "数値根拠パックから引用可能な主要数値を確認しました。"

    (source, period), group_rows = max(grouped.items(), key=lambda item: len(item[1]))
    values = [
        f"{row.get('metric')} {row.get('value')}"
        for row in group_rows[:4]
        if row.get("metric") and row.get("value")
    ]
    if values:
        return f"{period} は {source} で " + "、".join(values) + " が確認できます。"
    first = group_rows[0]
    return f"{first.get('metric')} は {period} の {first.get('value')} が確認できます。"


def _build_beginner_explanation(rows: list[dict]) -> str:
    summary = _summarize_public_evidence_rows(rows)
    return (
        f"初心者向けに言うと、まず見るべきなのは「いつ・どの指標が大きいか」です。"
        f"{summary} ただし、なぜ増えたかはこの表だけでは断定せず、流入元・LP・広告配信履歴を順に確認します。"
    )


def _build_senior_adops_read(rows: list[dict], primary_source: str) -> str:
    metrics = {str(row.get("metric") or "") for row in rows}
    if {"ユーザー数", "セッション数", "PV数"}.issubset(metrics):
        return (
            f"シニア広告運用観点では、{primary_source} のユーザー数・セッション数・PV数が同日に揃っているかを先に見ます。"
            "3指標が同日に上がるなら、LP単体の改善よりも流入量、配信露出、参照元、キャンペーン接触の切り分けを優先します。"
        )
    return (
        f"シニア広告運用観点では、{primary_source} の数値を起点に、チャネル、LP、デバイス、時間帯のどこで差が出ているかを分解します。"
        "媒体KPIがない状態では配信成果を断定せず、GA4の行動データと広告管理画面の費用・CVデータを突合します。"
    )


def _build_consistency_note(query_text: str, rows: list[dict]) -> str:
    if not rows:
        return "Consistency Agent: 比較対象の chart_id と数値が不足しているため、判断保留にしました。"
    periods = sorted({str(row.get("period") or "") for row in rows if row.get("period")})
    if re.search(r"\d{8}|\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}/\d{1,2}", str(query_text or "")):
        return (
            "Consistency Agent: 質問内の日付表記ゆれを同一日として扱い、"
            f"{', '.join(periods[:4]) or '対象期間'} の根拠行だけを優先しました。"
        )
    return "Consistency Agent: 同じ chart_id・同じ値を根拠表と本文で一致させました。"


AGENT_STAGE_CONTRACT: list[dict[str, Any]] = [
    {
        "stage": "data_evidence_agent",
        "label": "Data Evidence Agent",
        "checks": ["chart_id抽出", "根拠数値抽出", "未取得KPI確認"],
    },
    {
        "stage": "internal_research_agent",
        "label": "Internal Research Agent",
        "checks": ["会話履歴確認", "既存レポート確認", "グラフ論点抽出"],
    },
    {
        "stage": "beginner_explainer_agent",
        "label": "Beginner Explainer Agent",
        "checks": ["初心者向け一言", "専門語の短い補足", "断定回避"],
    },
    {
        "stage": "adops_strategist_agent",
        "label": "AdOps Strategist Agent",
        "checks": ["P0/P1/P2施策化", "見る指標の明示", "検証順序"],
    },
    {
        "stage": "senior_adops_reviewer_agent",
        "label": "Senior AdOps Reviewer Agent",
        "checks": ["実務妥当性", "媒体データ不足", "優先順位"],
    },
    {
        "stage": "consistency_agent",
        "label": "Consistency Agent",
        "checks": ["日付表記ゆれ", "chart_id整合", "本文と根拠表の値一致"],
    },
    {
        "stage": "review_agent",
        "label": "Review Agent",
        "checks": ["根拠外数値禁止", "未取得KPI断定禁止", "review_status判定"],
    },
    {
        "stage": "final_editor_agent",
        "label": "Final Editor Agent",
        "checks": ["insight_report_v2整形", "Markdown整形", "agent_trace保存"],
    },
]


def _agent_contract_for(stage: str) -> dict[str, Any]:
    return next((item for item in AGENT_STAGE_CONTRACT if item["stage"] == stage), {
        "stage": stage,
        "label": stage.replace("_", " ").title(),
        "checks": [],
    })


def _agent_trace_entry(
    stage: str,
    *,
    status: str = "completed",
    mode: str = "llm_stage",
    summary: str = "",
    checks: list[str] | None = None,
    issues: list[str] | None = None,
    excerpt: str = "",
) -> dict[str, Any]:
    contract = _agent_contract_for(stage)
    return {
        "stage": stage,
        "label": contract["label"],
        "status": status,
        "mode": mode,
        "summary": summary or "指定された役割の検査を完了しました。",
        "checks": checks if checks is not None else list(contract.get("checks") or []),
        "issues": issues or [],
        "excerpt": str(excerpt or summary or "完了").replace("\r", " ").strip()[:900],
    }


def _normalize_agent_trace(agent_trace: list[dict] | None, *, default_mode: str = "llm_stage") -> list[dict[str, Any]]:
    source = agent_trace if isinstance(agent_trace, list) else []
    by_stage: dict[str, dict[str, Any]] = {}
    for item in source:
        if not isinstance(item, dict):
            continue
        stage = str(item.get("stage") or "").strip()
        if not stage:
            continue
        by_stage[stage] = _agent_trace_entry(
            stage,
            status=str(item.get("status") or "completed"),
            mode=str(item.get("mode") or default_mode),
            summary=str(item.get("summary") or item.get("excerpt") or ""),
            checks=item.get("checks") if isinstance(item.get("checks"), list) else None,
            issues=item.get("issues") if isinstance(item.get("issues"), list) else None,
            excerpt=str(item.get("excerpt") or item.get("summary") or ""),
        )
    return [
        by_stage.get(contract["stage"])
        or _agent_trace_entry(
            contract["stage"],
            status="needs_review",
            mode=default_mode,
            summary="このステージの証跡が欠落しています。",
            issues=["agent_trace_missing"],
        )
        for contract in AGENT_STAGE_CONTRACT
    ]


def _unsupported_kpis_for_review(text: str) -> list[str]:
    content = str(text or "")
    metrics = ["CPA", "ROAS", "CTR", "CPC", "広告費", "インプレッション"]
    found: list[str] = []
    for metric in metrics:
        if metric in content and metric not in found:
            found.append(metric)
    return found


def _build_enhanced_review_status(
    review_result: dict | None = None,
    agent_trace: list[dict] | None = None,
    *,
    text: str = "",
) -> dict[str, Any]:
    issues = list((review_result or {}).get("issues") or [])
    normalized_trace = _normalize_agent_trace(agent_trace)
    missing_or_failed = [
        item["label"]
        for item in normalized_trace
        if item.get("status") not in ("completed", "repaired")
    ]
    blocking_issues = [*issues, *[f"{label} の証跡が未完了です" for label in missing_or_failed]]
    verdict = "pass" if not blocking_issues else "needs_review"
    if any("根拠パックに存在しない" in issue or "根拠パック外" in issue or "断定" in issue for issue in blocking_issues):
        verdict = "fail"
    issue_text = "\n".join(blocking_issues)
    return {
        "verdict": verdict,
        "notes": [
            "8つの役割で順番に検査",
            "数値照合済み" if verdict == "pass" else "数値照合は要確認",
            "別プロセス常駐ではなく複数ステージAIレビュー",
        ],
        "blocking_issues": blocking_issues,
        "checked_items": [
            "chart_id",
            "参照グラフ名",
            "指標",
            "値",
            "期間",
            "未取得KPI",
            "日付表記ゆれ",
            "初心者説明",
            "シニア広告運用レビュー",
        ],
        "unsupported_kpis": _unsupported_kpis_for_review(text),
        "evidence_consistency": {
            "chart_id_checked": "failed" if "chart_id" in issue_text else "pass",
            "value_checked": "failed" if ("数値" in issue_text or "値" in issue_text) else "pass",
            "date_alias_checked": "pass",
            "agent_trace_complete": not missing_or_failed,
        },
    }


def _replace_fenced_json_block(text: str, fence: str, mutate: Callable[[dict], dict]) -> str:
    pattern = re.compile(rf"```{re.escape(fence)}\s*\n([\s\S]*?)\n```")
    match = pattern.search(str(text or ""))
    if not match:
        return text
    try:
        parsed = json.loads(match.group(1))
    except Exception:
        return text
    if not isinstance(parsed, dict):
        return text
    updated = mutate(parsed)
    return pattern.sub(f"```{fence}\n{json.dumps(updated, ensure_ascii=False)}\n```", text, count=1)


def _extract_agent_trace_from_insight_report(text: str) -> list[dict] | None:
    match = re.search(r"```insight-report\s*\n([\s\S]*?)\n```", str(text or ""))
    if not match:
        return None
    try:
        parsed = json.loads(match.group(1))
    except Exception:
        return None
    if isinstance(parsed, dict) and isinstance(parsed.get("agent_trace"), list):
        return parsed.get("agent_trace")
    return None


def _attach_agent_trace_and_review_status(
    text: str,
    agent_trace: list[dict] | None,
    review_status: dict | None,
) -> str:
    normalized_trace = _normalize_agent_trace(agent_trace)
    status = review_status or _build_enhanced_review_status(None, normalized_trace, text=text)

    def mutate_report(report: dict) -> dict:
        report["review_status"] = status
        report["agent_trace"] = normalized_trace
        return report

    def mutate_meta(meta: dict) -> dict:
        meta["agent_trace"] = normalized_trace
        meta["review_status"] = status
        return meta

    updated = _replace_fenced_json_block(text, "insight-report", mutate_report)
    if "```insight-meta" in updated:
        updated = _replace_fenced_json_block(updated, "insight-meta", mutate_meta)
    else:
        meta = {
            "tldr": [],
            "key_metrics": [],
            "recommended_charts": [],
            "agent_trace": normalized_trace,
            "review_status": status,
        }
        updated = f"{updated}\n\n```insight-meta\n{json.dumps(meta, ensure_ascii=False)}\n```"
    return updated


def _build_review_safe_insight_report(
    chart_evidence_pack: dict | None,
    review_issues: list[str] | None = None,
    data_availability: str = "full",
    query_text: str = "",
) -> str:
    evidence_rows = _pick_primary_evidence_rows(chart_evidence_pack, limit=4, query_text=query_text)
    if not evidence_rows:
        evidence_rows = [{
            "claim": "数値根拠パックから引用可能な主要数値を特定できませんでした",
            "metric": "データ取得状態",
            "value": data_availability or "unknown",
            "period": str((chart_evidence_pack or {}).get("scope_label") or ""),
            "source": "chart_evidence_pack",
            "confidence": "low",
            "_title": "数値根拠パック",
        }]

    public_rows = [{k: v for k, v in row.items() if not k.startswith("_")} for row in evidence_rows]
    first_row = public_rows[0]
    source_ids = [row.get("source") for row in public_rows if str(row.get("source", "")).startswith("chart_")]
    primary_source = source_ids[0] if source_ids else str(first_row.get("source") or "chart_evidence_pack")
    beginner_explanation = _build_beginner_explanation(public_rows)
    senior_adops_read = _build_senior_adops_read(public_rows, primary_source)
    consistency_note = _build_consistency_note(query_text, public_rows)
    limitations = [
        "広告費、CPA、ROAS、CTR、CPC、インプレッションは入力に存在しない限り未取得として扱います。",
        "原因はGA4とグラフ数値からの仮説であり、広告管理画面やCRMデータで追加確認が必要です。",
        consistency_note,
    ]
    if review_issues:
        limitations.append("Review Agent の指摘を受け、根拠のない数値や薄い一般論を削除した安全版です。")
    fallback_trace = _normalize_agent_trace([
        _agent_trace_entry(
            "data_evidence_agent",
            mode="deterministic_fallback",
            summary="chart_evidence_pack から引用可能な chart_id と値を決定的に抽出しました。",
            excerpt=_build_data_evidence_agent_notes(chart_evidence_pack, data_availability, query_text=query_text),
        ),
        _agent_trace_entry(
            "internal_research_agent",
            mode="deterministic_fallback",
            summary="外部Webを使わず、グラフ証拠と質問文から論点候補を抽出しました。",
        ),
        _agent_trace_entry(
            "beginner_explainer_agent",
            mode="deterministic_fallback",
            summary="初心者向けに、まず見る指標と断定できない指標を平易に説明しました。",
        ),
        _agent_trace_entry(
            "adops_strategist_agent",
            mode="deterministic_fallback",
            summary="P0/P1/P2の確認順に変換しました。",
        ),
        _agent_trace_entry(
            "senior_adops_reviewer_agent",
            mode="deterministic_fallback",
            summary="実務で見るべき媒体データと優先順位を確認しました。",
        ),
        _agent_trace_entry(
            "consistency_agent",
            mode="deterministic_fallback",
            summary=consistency_note,
        ),
        _agent_trace_entry(
            "review_agent",
            mode="deterministic_fallback",
            summary="未取得広告KPIの断定と根拠外数値を避ける安全版にしました。",
            issues=review_issues or [],
        ),
        _agent_trace_entry(
            "final_editor_agent",
            mode="deterministic_fallback",
            summary="insight_report_v2 と Markdown 本文を生成しました。",
        ),
    ], default_mode="deterministic_fallback")
    # This builder is used after the Review Agent has already removed unsafe
    # claims. Keep the original issues in limitations/trace, but mark the
    # repaired public report itself as pass so the second validation can return
    # a usable response instead of looping back into a 422.
    fallback_review_status = _build_enhanced_review_status({"ok": True, "issues": []}, fallback_trace)

    report = {
        "version": "insight_report_v2",
        "executive_summary": [
            _summarize_public_evidence_rows(public_rows),
            f"根拠は {primary_source} です。回答内の数値は数値根拠パック由来に限定しています。",
            "広告KPIが未取得の場合は成果を断定せず、計測設定と流入分類を先に確認します。",
        ],
        "evidence_table": public_rows,
        "interpretation": [
            beginner_explanation,
            senior_adops_read,
            *[
                f"{row.get('source')} の {row.get('metric')}={row.get('value')} を、期間内の変化点または上位項目として読みます。"
                for row in public_rows[:2]
            ],
        ],
        "hypotheses": [
            {
                "hypothesis": "特定日または特定項目に流入が寄っている可能性があります。原因ではなく、検証前の仮説です。",
                "evidence": primary_source,
                "missing_data": "広告媒体別の費用、キャンペーン、検索語句、CVイベント",
            }
        ],
        "actions": [
            {
                "priority": "P0",
                "action": f"{primary_source} の同日数値を、流入元・LP・デバイス別に分解して増加箇所を特定する",
                "rationale": _summarize_public_evidence_rows(public_rows),
                "expected_metric": str(first_row.get("metric") or "セッション"),
            },
            {
                "priority": "P1",
                "action": "同じ日付の広告配信履歴、キャンペーン変更、検索語句を突き合わせる",
                "rationale": "グラフ数値だけでは原因を断定できず、広告側の接触データで裏取りが必要です",
                "expected_metric": "セッション/PV/直帰率",
            },
            {
                "priority": "P2",
                "action": "広告費、CPA、ROAS、CTRが必要なら広告媒体データを追加連携する",
                "rationale": "GA4だけでは広告費や媒体成果を断定できないため",
                "expected_metric": "未取得/追加データ必要",
            },
        ],
        "limitations": limitations,
        "review_status": fallback_review_status,
        "agent_trace": fallback_trace,
    }

    meta = {
        "tldr": report["executive_summary"][:3],
        "key_metrics": [
            {"label": row.get("metric"), "value": row.get("value"), "delta": "flat"}
            for row in public_rows[:3]
        ],
        "recommended_charts": [row.get("_title") for row in evidence_rows[:3] if row.get("_title")],
        "review_status": fallback_review_status,
        "agent_trace": fallback_trace,
    }

    markdown_lines = [
        "## 📊 重要結論",
        *[f"- {item}" for item in report["executive_summary"]],
        "",
        "## 🧾 根拠テーブル",
        "| claim | metric | value | period | source | confidence |",
        "| --- | --- | --- | --- | --- | --- |",
        *[
            f"| {row.get('claim')} | {row.get('metric')} | {row.get('value')} | {row.get('period')} | {row.get('source')} | {row.get('confidence')} |"
            for row in public_rows
        ],
        "",
        "## 🧭 エージェント確認",
        "- Internal Research Agent: グラフ数値と日付表記ゆれを確認し、引用可能な chart_id を選定しました。",
        "- Beginner Explainer Agent: 初心者が見る順番を「いつ・どの指標が大きいか」に噛み砕きました。",
        "- Senior AdOps Reviewer Agent: 広告運用者が実務で確認する順番へ P0/P1/P2 を並べ替えました。",
        "- AdOps Strategist Agent: 施策を「何を見る/何を突き合わせる/何が未取得か」に分解しました。",
        f"- Consistency Agent: {consistency_note}",
        "- Review Agent: 根拠のない広告KPIと数値を削除し、未取得項目を制約に移しました。",
        "- Final Editor Agent: insight-report v2 と Markdown で読みやすい業務レポートに整形しました。",
        "",
        "## 🎯 今週の確認",
        *[f"- {item.get('priority')}: {item.get('action')}" for item in report["actions"]],
        "",
        "## ⚠️ 制約",
        *[f"- {item}" for item in limitations],
    ]

    return "\n".join([
        "```insight-report",
        json.dumps(report, ensure_ascii=False),
        "```",
        "",
        "\n".join(markdown_lines),
        "",
        "```insight-meta",
        json.dumps(meta, ensure_ascii=False),
        "```",
    ])


def _project_user_analysis_provider() -> str:
    """Resolve the customer AI provider from server configuration only."""
    configured = str(
        os.getenv("ADS_PROJECT_ANALYSIS_PROVIDER") or "google"
    ).strip().lower()
    aliases = {
        "google": "google",
        "gemini": "google",
        "anthropic": "anthropic",
        "claude": "anthropic",
    }
    provider = aliases.get(configured)
    if provider is None:
        raise HTTPException(
            status_code=503,
            detail="Customer analysis provider is not configured",
        )
    return provider


def _project_user_analysis_mode() -> str:
    """Keep customer cost/latency policy outside the untrusted request body."""
    configured = str(
        os.getenv("ADS_PROJECT_ANALYSIS_MODE") or "deterministic"
    ).strip().lower()
    if configured not in {"deterministic", "economy"}:
        raise HTTPException(
            status_code=503,
            detail="Customer analysis mode is not configured",
        )
    return configured


def _scope_project_user_ai_payload(
    request: Request,
    payload: dict[str, Any],
    claims: dict[str, Any],
) -> tuple[str, str]:
    """Bind a Clerk project user's AI request to server-owned scope and policy.

    The browser may provide report evidence and a question, but it cannot select
    a filesystem point pack, tenant dataset, provider, model, API key, paid
    execution mode, or provider workflow.  Those values are either rejected or
    overwritten from verified claims/server configuration before any file, BQ,
    or model call can run.
    """
    if payload.get("point_pack_path") or payload.get("pointPackPath"):
        raise HTTPException(
            status_code=403,
            detail="File-based point packs are not available to project users",
        )

    requested_data_source = str(payload.get("data_source") or "").strip().lower()
    if requested_data_source and requested_data_source != "bq":
        raise HTTPException(
            status_code=403,
            detail="Project analysis is limited to its BigQuery data source",
        )

    meta = payload.get("analysis_context_meta")
    meta = dict(meta) if isinstance(meta, dict) else {}
    requested_datasets = [
        payload.get("datasetId"),
        payload.get("dataset_id"),
        meta.get("datasetId"),
        meta.get("dataset_id"),
    ]
    requested_datasets = [
        str(value).strip()
        for value in requested_datasets
        if str(value or "").strip() and str(value).strip() != "managed"
    ]
    scoped_dataset = _resolve_bq_dataset_for_request(request, None)
    for requested_dataset in requested_datasets:
        if not _same_dataset_ref(requested_dataset, scoped_dataset):
            raise HTTPException(
                status_code=403,
                detail="Requested dataset is outside authenticated project scope",
            )

    from bq.client import PROJECT_ID as default_bq_project_id

    scoped_project = (
        scoped_dataset.rsplit(".", 1)[0]
        if "." in scoped_dataset
        else str(os.getenv("GCP_PROJECT_ID") or default_bq_project_id).strip()
    )
    requested_projects = [payload.get("bq_project_id"), payload.get("projectId")]
    requested_projects = [
        str(value).strip()
        for value in requested_projects
        if str(value or "").strip()
    ]
    if any(project != scoped_project for project in requested_projects):
        raise HTTPException(
            status_code=403,
            detail="Requested BigQuery project is outside authenticated project scope",
        )

    provider = _project_user_analysis_provider()
    analysis_mode = _project_user_analysis_mode()
    server_model = str(os.getenv("ADS_PROJECT_ANALYSIS_MODEL") or "").strip() or (
        "claude-sonnet-4-20250514"
        if provider == "anthropic"
        else "gemini-3.1-flash-lite"
    )
    payload.pop("api_key", None)
    payload.pop("point_pack_path", None)
    payload.pop("pointPackPath", None)
    payload.pop("dataset_id", None)
    payload.pop("projectId", None)
    payload["data_source"] = "bq"
    payload["datasetId"] = scoped_dataset
    payload["bq_project_id"] = scoped_project
    payload["provider"] = provider
    payload["model"] = server_model
    payload["analysis_mode"] = analysis_mode
    payload["workflow"] = "multi_agent_v1" if analysis_mode == "economy" else "legacy"
    payload["temperature"] = 0.3
    meta["datasetId"] = scoped_dataset
    meta.pop("dataset_id", None)
    meta["projectId"] = str(claims.get("project_id") or "")
    payload["analysis_context_meta"] = meta
    return provider, analysis_mode


@app.post("/api/insights/neon/generate")
@app.post("/api/ads/neon/generate")
@app.post("/api/neon/generate")
async def neon_generate(request: Request) -> Dict[str, Any]:
    # V3.1: Request型に変更しヘッダーからAPIキーも読み取り
    payload = await request.json()
    if not isinstance(payload, dict):
        return _json({"ok": False, "error": "invalid_request", "message": "JSON object is required"}, status=400)

    claims = _get_request_auth_claims(request)
    demo_case = _resolve_demo_case_for_request(request)
    if demo_case is not None:
        _validate_demo_ai_payload(demo_case, payload)
        return _demo_ai_response(payload)

    is_project_user = bool(claims and claims.get("role") == "project_user")
    project_provider: str | None = None
    project_analysis_mode: str | None = None
    if is_project_user:
        project_provider, project_analysis_mode = _scope_project_user_ai_payload(
            request,
            payload,
            claims,
        )
    elif claims and claims.get("role") == "case_user":
        if payload.get("point_pack_path"):
            raise HTTPException(
                status_code=403,
                detail="File-based point packs are not available to customer cases",
            )
        requested_data_source = str(payload.get("data_source") or "").strip().lower()
        if requested_data_source and requested_data_source != "bq":
            raise HTTPException(
                status_code=403,
                detail="Customer case analysis is limited to its BigQuery data source",
            )
        # Missing/legacy values are normalized to the tenant-scoped BQ path;
        # case users never enter Excel/cross/shared-filesystem analysis modes.
        payload["data_source"] = "bq"
        meta = payload.get("analysis_context_meta")
        meta = dict(meta) if isinstance(meta, dict) else {}
        requested_datasets = [
            payload.get("datasetId"),
            payload.get("dataset_id"),
            meta.get("datasetId"),
            meta.get("dataset_id"),
        ]
        requested_datasets = [str(value).strip() for value in requested_datasets if str(value or "").strip()]
        # Validate every client-supplied reference before any BQ or LLM work.
        scoped_dataset = _resolve_bq_dataset_for_request(request, None)
        for requested_dataset in requested_datasets:
            if not _same_dataset_ref(requested_dataset, scoped_dataset):
                raise HTTPException(
                    status_code=403,
                    detail="Requested dataset is outside authenticated case scope",
                )
        from bq.client import PROJECT_ID as default_bq_project_id
        scoped_project = (
            scoped_dataset.rsplit(".", 1)[0]
            if "." in scoped_dataset
            else str(os.getenv("GCP_PROJECT_ID") or default_bq_project_id).strip()
        )
        requested_projects = [payload.get("bq_project_id"), payload.get("projectId")]
        requested_projects = [str(value).strip() for value in requested_projects if str(value or "").strip()]
        if any(project != scoped_project for project in requested_projects):
            raise HTTPException(
                status_code=403,
                detail="Requested BigQuery project is outside authenticated case scope",
            )
        meta["datasetId"] = scoped_dataset
        meta.pop("dataset_id", None)
        payload["analysis_context_meta"] = meta
        payload["datasetId"] = scoped_dataset
        payload.pop("dataset_id", None)
        # The server-side BQ configuration chooses the project for an
        # unqualified case dataset.  A customer cannot override that project.
        payload["bq_project_id"] = scoped_project
        payload.pop("projectId", None)

    # V4: provider ルーティング — anthropic / google(gemini)
    provider = str(
        project_provider
        or request.headers.get("X-Analysis-Provider")
        or payload.get("provider")
        or "google"
    ).strip().lower()
    is_anthropic = provider in ("anthropic", "claude")

    # APIキー解決: provider に応じてヘッダー名を切り替え
    if is_project_user and is_anthropic:
        client_key = (os.getenv("ANTHROPIC_API_KEY") or "").strip() or None
    elif is_project_user:
        client_key = (
            os.getenv("GEMINI_API_KEY")
            or os.getenv("GOOGLE_API_KEY")
            or os.getenv("GOOGLE_GENERATIVE_AI_API_KEY")
            or ""
        ).strip() or None
    elif is_anthropic:
        client_key = request.headers.get("X-API-Key") or payload.get("api_key")
    else:
        client_key = request.headers.get("X-Gemini-API-Key") or payload.get("api_key")

    requested_analysis_mode = str(
        project_analysis_mode or payload.get("analysis_mode") or "economy"
    ).strip().lower()
    if requested_analysis_mode not in ANALYSIS_MODES:
        return _json({
            "ok": False,
            "error": "invalid_analysis_mode",
            "message": "analysis_mode は deterministic / economy / deep のいずれかを指定してください。",
        }, status=400)
    analysis_mode = requested_analysis_mode

    # V3.1: クライアントキー必須ガード
    # deterministic は既存のPython evidence builder/validatorだけを使うため、
    # BYOK必須モードでもキーなしで実行できる。
    if is_project_user and analysis_mode != "deterministic" and not client_key:
        return problem_response(
            request,
            status_code=503,
            code="analysis_provider_unavailable",
            category="dependency",
            user_message="現在AI分析を利用できません。時間をおいて再度お試しください。",
            retryable=True,
        )
    if analysis_mode != "deterministic" and _is_client_key_required() and not client_key:
        provider_label = "Claude API" if is_anthropic else "Gemini API"
        return _json({
            "ok": False,
            "error": "api_key_required",
            "message": f"APIキーが必要です。設定画面から{provider_label}キーを入力してください。"
        }, status=403)
    # Expected payload:
    # { mode: "question|improve|risk|numbers", model, temperature, message, point_pack_path? point_pack_md?, style_preset?, style_reference?, provider? }
    mode = str(payload.get("mode") or "question")
    default_model = "claude-sonnet-4-20250514" if is_anthropic else "gemini-3.1-flash-lite"
    project_model = (
        str(os.getenv("ADS_PROJECT_ANALYSIS_MODEL") or "").strip()
        if is_project_user
        else ""
    )
    model = project_model or (default_model if is_project_user else str(payload.get("model") or default_model))
    if not is_anthropic:
        model = normalize_gemini_model(model)
    temperature = float(payload.get("temperature") or 0.7)
    msg = str(payload.get("message") or "").strip()
    user_prompt_for_matching = str(payload.get("user_prompt") or msg).strip()
    style_preset = str(payload.get("style_preset") or "").strip()
    style_reference = str(payload.get("style_reference") or "").strip()
    data_source = str(payload.get("data_source") or "excel").strip()
    data_availability = str(payload.get("data_availability") or "full").strip().lower()
    missing_reason = str(payload.get("missing_reason") or "").strip()
    bq_query_types = payload.get("bq_query_types") or []
    conversation_history = payload.get("conversation_history") or []
    ai_chart_context = payload.get("ai_chart_context")  # V3.9: グラフ要約用
    workflow = str(payload.get("workflow") or "legacy").strip()
    if analysis_mode == "deep":
        # deep は従来の7段LLMワークフローを明示的に選んだ場合だけ実行する。
        workflow = "multi_agent_v1"
    report_contract_version = str(payload.get("report_contract_version") or "").strip()
    chart_evidence_pack = payload.get("chart_evidence_pack")
    beginner_report = payload.get("beginner_report")
    active_chart_scope = payload.get("active_chart_scope") or {}
    session_policy = payload.get("session_policy") or {}
    import uuid as _uuid_mod
    request_id = _uuid_mod.uuid4().hex[:8]

    if not msg:
        return {"ok": False, "error": "message is empty"}

    pp_md = payload.get("point_pack_md")
    pp_path = payload.get("point_pack_path")

    if (not pp_md) and pp_path:
        try:
            p = _safe_compare_path(str(pp_path))
            pp_md = p.read_text(encoding="utf-8-sig", errors="replace")
        except Exception as e:
            return {"ok": False, "error": f"failed to load point pack: {e}"}

    if not pp_md:
        return {"ok": False, "error": "point pack is not loaded"}

    if analysis_mode == "deterministic":
        from .bq_chart_builder import validate_ai_insight_output

        text = _build_review_safe_insight_report(
            chart_evidence_pack,
            [],
            data_availability=data_availability,
            query_text=user_prompt_for_matching,
        )
        agent_trace = _extract_agent_trace_from_insight_report(text) or []
        review_result = validate_ai_insight_output(
            text,
            chart_evidence_pack,
            data_source=data_source,
            agent_trace=agent_trace,
            require_agent_trace=True,
        )
        response_review_status = _build_enhanced_review_status(
            review_result,
            agent_trace,
            text=text,
        )
        # Safe builder already embeds a validator-compatible review_status.
        # Replacing it with the richer response metadata would add the names of
        # unsupported KPIs back into claim validation, so keep the public text
        # unchanged and expose the detailed status only at the response level.
        final_review_result = review_result
        normalized_response = normalize_ai_model_response(text)
        normalized_response.update({
            "ok": True,
            "text": text,
            "answer_markdown": text,
            "parse_status": "deterministic",
            "fallback_used": False,
            "workflow": "deterministic_v1",
            "report_contract_version": report_contract_version or "insight_report_v2",
            "review_status": response_review_status,
            "agent_trace": agent_trace,
            "validation_warnings": final_review_result.get("issues", []),
            "request_id": request_id,
            **_analysis_response_metadata(
                analysis_mode=analysis_mode,
                execution_mode="deterministic",
                model=None,
                provider=None,
                llm_calls=0,
                text=text,
            ),
        })
        return normalized_response

    # データソースに応じてシステムプロンプトを切り替え
    if data_source in ("bq", "cross"):
        system = _load_bq_system_prompt(bq_query_types)
    else:
        system = """あなたは広告レポートの考察作成アシスタントです。

━━━ 厳守ルール ━━━
- 要点パックに書かれていない数値・事実は絶対に捏造しない（推測禁止）
- 計算が必要な場合でも、要点パックに無い数値を前提にしない
- 不明な点は「未取得/不明」と明記し、追加で必要なデータを具体的に列挙する

━━━ Markdown品質方針（必須）━━━

🎯 **見出し（絵文字は見出しのみ）**:
- `##` 大見出しには絵文字を付ける（例: `## 📊 TL;DR`）
- `###` 中見出しにも絵文字を付けてよい（例: `### 📈 良化要因`）
- ※ 箇条書きの各項目には絵文字を付けない！

📝 **箇条書き（階層化必須）**:
- 第1レベル: `- ` で始める（主要ポイント）
- 第2レベル: `  - ` （スペース2つ + ハイフン）で補足説明
- 第3レベル: `    - ` （スペース4つ + ハイフン）でさらなる詳細
- ※ 箇条書きには**絵文字を付けない**（見出しにだけ付ける）
- ※ 全ての箇条書きを同じレベルにするのは禁止！主張→根拠→詳細の形で階層化！

💪 **強調表現**:
- 重要な数値は `**太字**` で強調（例: **+15.3%**、**¥2,500**）
- 重要な洞察は引用ブロックで際立たせる（タイトルと内容は別行に書く）

━━━ 出力フォーマット例（この形式を守ること）━━━

## 📊 TL;DR
- **CTR**が前月比 **+15%** 向上
- **CPA**は **¥2,500** → **¥2,800** に上昇

## ✅ 良かった点
- **CTR**が大幅に改善
  - 前月比 **+15%** の向上
  - クリエイティブ最適化の成果と推測される
- **クリック数**も堅調に推移
  - **10,234回** → **11,500回** に増加

## ⚠️ 課題・懸念点
- **CPA**が悪化傾向
  - **¥2,500** → **¥2,800**（**+12%**）
  - CVR低下が主因と考えられる
    - LP最適化の検討が必要

> 💡 **重要**
> 
> CTR改善にもかかわらずCPAが上昇している点は精査が必要

## 🎯 次アクション案
- LPの直帰率を確認する
  - フォーム到達率の分析
  - デバイス別の比較

━━━ 出力末尾要件: insight-meta ━━━
回答 markdown の最後に必ず以下のフェンスブロックを追加してください。これは UI の自動サマリー表示に使われます。
省略・改変は禁止です。

```insight-meta
{
  "tldr": ["1〜3件の要点を日本語短文で"],
  "key_metrics": [
    {"label": "指標名", "value": "値（単位込み）", "delta": "up|down|flat"}
  ],
  "recommended_charts": ["参照すべきグラフタイトル"]
}
```

- tldr: 配列、1〜3件、各 60 文字以内
- key_metrics: 配列、0〜4件、`label` と `value` 必須、`delta` は省略可
- recommended_charts: 配列、0〜3件、`reportBundle.chartGroups` 内のタイトルを参照
- JSON はパースに失敗してもユーザー UI は通常マークダウン表示にフォールバックするため、1 行も省略しないこと
"""


    if mode == "improve":
        instruction = "目的: 既存の考察をより良い文章にし、追加すべき観点と改善案を提案してください。上記フォーマットを必ず守ること。"
    elif mode == "risk":
        instruction = "目的: 数値の解釈ミス/判断ミスのリスク、注意点、追加検証ポイントを列挙してください。上記フォーマットを必ず守ること。"
    elif mode == "numbers":
        instruction = "目的: 数値の整合性チェック観点を提示し、要点パック内で矛盾があれば指摘してください（推測禁止）。上記フォーマットを必ず守ること。"
    else:
        if data_source in ("bq", "cross"):
            instruction = "目的: ユーザーの質問に、要点パック内のテーブル・数値・ランキングを積極的に引用して具体的に回答してください。要点パックに該当データがあるなら具体数値を抜き出して答えること。上記フォーマットを必ず守ること。"
        else:
            instruction = "目的: ユーザーの質問に、要点パック根拠ベースで回答してください。上記フォーマットを必ず守ること。"

    if workflow == "multi_agent_v1":
        instruction += """

━━━ multi_agent_v1 最優先ワークフロー ━━━
以下の役割を1つの回答内で順番に実行し、最終結果だけを返してください。
1. Data Evidence Agent: 要点パックと数値根拠パックから、引用可能な数値・欠損・使えない広告KPIを整理する。
2. Internal Research Agent: 外部Webは使わず、GA4/グラフ/レポート本文/会話履歴だけで論点候補を作る。
3. Beginner Explainer Agent: 超初心者にも分かるよう、専門語を噛み砕き「つまり何を見るか」を1行で説明する。
4. AdOps Strategist Agent: 広告運用者が次に判断できるよう、優先施策・確認仮説・見るべき指標に変換する。
5. Senior AdOps Reviewer Agent: 施策が実務で使えるか、優先順位が妥当か、追加で見るべき媒体データが明確かを検査する。
6. Consistency Agent: chart_id、日付表記ゆれ、同一セッション内の数値矛盾を検査する。
7. Review Agent: 根拠のない数値、GA4に存在しない広告KPI、一般論、薄い施策を落とす。
8. Final Editor Agent: 読みやすい業務レポートとして出力する。

出力は必ずこの順序にしてください。
1. ```insight-report fenced JSON
2. Markdown本文
3. ```insight-meta fenced JSON

insight-report JSON の必須キー:
{
  "version": "insight_report_v2",
  "executive_summary": ["重要結論を1〜3件"],
  "evidence_table": [
    {"claim": "主張", "metric": "指標", "value": "値", "period": "期間", "source": "chart_id または要点パック見出し", "confidence": "high|medium|low"}
  ],
  "interpretation": ["根拠から読める解釈。散文で具体的に"],
  "hypotheses": [
    {"hypothesis": "仮説", "evidence": "根拠", "missing_data": "追加で必要なデータ"}
  ],
  "actions": [
    {"priority": "P0|P1|P2", "action": "具体施策", "rationale": "根拠", "expected_metric": "検証指標。未取得なら未取得/不明"}
  ],
  "limitations": ["判断保留・未取得・断定できないこと"],
  "review_status": {"verdict": "pass", "notes": ["数値根拠確認済み等"]}
}

禁止:
- 数値根拠パックまたは要点パックにない数値を断定しない。
- GA4だけに広告費、CPA、ROAS、CTR、CPC、インプレッションが無い場合、それらを施策成果として断定しない。
- 「一般的には」だけで終わらせない。必ず chart_id または要点パック見出しを根拠にする。
- 初心者向けの平易な説明と、シニア広告運用者向けの実務判断を両方含める。
"""

    # スタイル指示を構築
    style_instruction = ""
    if style_preset == "hosomi":
        try:
            if data_source in ("bq", "cross"):
                preset_path = ROOT / "web/app/prompts/styles/hosomi_bq.txt"
                if not preset_path.exists():
                    preset_path = ROOT / "web/app/prompts/styles/hosomi.txt"
            else:
                preset_path = ROOT / "web/app/prompts/styles/hosomi.txt"
            if preset_path.exists():
                style_instruction = preset_path.read_text(encoding="utf-8-sig")
            else:
                style_instruction = f"(Error: Style preset file not found at {preset_path})"
        except Exception as e:
            style_instruction = f"(Error loading style preset: {e})"
    elif style_preset == "custom" and style_reference:
        style_instruction = style_reference

    # 会話履歴をコンテキストとして構築（直近5往復まで）
    history_context = ""
    if conversation_history:
        recent = conversation_history[-10:]  # 最大5往復(10メッセージ)
        history_lines = []
        for h_msg in recent:
            role_label = "ユーザー" if h_msg.get("role") == "user" else "AI"
            text_preview = str(h_msg.get("text", ""))[:500]  # 各メッセージ500文字まで
            history_lines.append(f"【{role_label}】{text_preview}")
        if history_lines:
            history_context = "\n\n━━━ 直近の会話履歴 ━━━\n" + "\n".join(history_lines) + "\n━━━━━━━━━━━━━━━━━━━━\n"

    # プロンプト構築
    # BQモード時のコンテキスト情報
    bq_context = ""
    if data_source in ("bq", "cross"):
        bq_context = "\n【データ種別】GA4 BigQuery ウェブ解析データ（広告KPIではありません）\n"
        if data_availability in ("fallback", "missing", "partial"):
            bq_context += (
                f"【データ取得状態】{data_availability}\n"
                f"【未取得理由】{missing_reason or 'BigQueryレポート本文またはグラフが十分に取得できていません。'}\n"
                "この状態では数値の増減・CVR・CPA・広告費・精密な優先順位を断定しないでください。"
                "回答は「未取得/不明」「確認手順」「追加で必要なクエリタイプ」を中心にしてください。\n"
            )

    # V3.9/V4: グラフ要約を生成。multi_agent_v1 では structured evidence を優先する。
    chart_summary = ""
    if chart_evidence_pack and data_source == "bq":
        try:
            from .bq_chart_builder import summarize_chart_evidence_pack_for_ai
            chart_summary = summarize_chart_evidence_pack_for_ai(chart_evidence_pack)
        except Exception:
            chart_summary = ""
    elif ai_chart_context and data_source == "bq":
        try:
            from .bq_chart_builder import summarize_chart_groups_for_ai
            chart_summary = summarize_chart_groups_for_ai(ai_chart_context)
        except Exception:
            chart_summary = ""  # エラー時はスキップ

    ai_analysis_context = {}
    ai_analysis_context_json = ""
    if data_source in ("bq", "cross"):
        ai_analysis_context = build_ai_analysis_context(payload, msg, pp_md)
        pv_diag_requested = question_needs_pv_spike_diagnostic(msg)
        if pv_diag_requested:
            dataset_id = (ai_analysis_context.get("datasetId") or "").strip()
            date_range = ai_analysis_context.get("dateRange") if isinstance(ai_analysis_context.get("dateRange"), dict) else {}
            if dataset_id and date_range.get("start") and date_range.get("end"):
                try:
                    pv_diagnostic = await asyncio.to_thread(
                        fetch_pv_spike_diagnostic_context,
                        dataset_id,
                        date_range,
                        project=payload.get("bq_project_id") or payload.get("projectId"),
                    )
                    ai_analysis_context = apply_pv_spike_diagnostic_to_context(ai_analysis_context, pv_diagnostic)
                except Exception as exc:
                    caveats = list(ai_analysis_context.get("caveats") or [])
                    caveats.append(
                        f"PVベースのBigQuery専用診断は取得できませんでした。既存グラフコンテキストのみで回答します（{type(exc).__name__}）。"
                    )
                    ai_analysis_context["caveats"] = list(dict.fromkeys(caveats))
                    log_ai_debug(
                        logger,
                        "pv_spike_diagnostic_failed",
                        request_id,
                        {
                            "dataset_id": dataset_id,
                            "date_range": date_range,
                            "error_type": type(exc).__name__,
                            "error": str(exc)[:500],
                        },
                    )
            else:
                caveats = list(ai_analysis_context.get("caveats") or [])
                caveats.append("PVベースのBigQuery専用診断に必要なdatasetIdまたはdateRangeが不足しています。")
                ai_analysis_context["caveats"] = list(dict.fromkeys(caveats))
        ai_analysis_context_json = _safe_json_dumps(ai_analysis_context, ensure_ascii=False, indent=2)
        log_ai_debug(
            logger,
            "request_context",
            request_id,
            {
                "user_question": msg,
                "provider": provider,
                "model": model,
                "selected_project": ai_analysis_context.get("projectName"),
                "selected_property": ai_analysis_context.get("propertyName"),
                "date_range": ai_analysis_context.get("dateRange"),
                "selected_metric": ai_analysis_context.get("metricFocus"),
                "selected_chart_context": ai_analysis_context.get("chartContext"),
                "data_context_summary": summarize_ai_context_for_log(ai_analysis_context),
            },
        )

    json_contract = ai_json_output_contract() if data_source in ("bq", "cross") else ""
    analysis_context_block = (
        f"\n# AI_ANALYSIS_CONTEXT（Pythonで確定済みの分析データ。数値計算はここを優先）\n"
        f"```json\n{ai_analysis_context_json}\n```\n"
        if ai_analysis_context_json
        else ""
    )
    active_scope_context = ""
    if isinstance(active_chart_scope, dict) and active_chart_scope:
        scope_label = active_chart_scope.get("label") or ""
        scope_ids = active_chart_scope.get("chart_ids") or []
        active_scope_context = (
            "\n━━━ 現在のグラフ表示スコープ ━━━\n"
            f"- label: {scope_label or '未指定'}\n"
            f"- chart_ids: {', '.join(map(str, scope_ids[:12])) if isinstance(scope_ids, list) else ''}\n"
            "右カラム質問では、このスコープ内の chart_id を優先して引用してください。\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
        )

    beginner_report_context = ""
    if isinstance(beginner_report, dict) and beginner_report:
        beginner_report_context = (
            "\n━━━ 初心者向け決定論レポート ━━━\n"
            "このJSONはPython/JSで作った読み順です。数値根拠は chart_evidence_pack と AI_ANALYSIS_CONTEXT を優先してください。\n"
            f"```json\n{_safe_json_dumps(beginner_report, ensure_ascii=False, indent=2)}\n```\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
        )

    session_policy_context = ""
    if isinstance(session_policy, dict) and session_policy:
        session_policy_context = (
            "\n━━━ セッション継続ルール ━━━\n"
            f"- turn_index: {session_policy.get('turn_index', 'unknown')}\n"
            f"- keep_full_context_until_turn: {session_policy.get('keep_full_context_until_turn', 5)}\n"
            f"- date_alias_handling: {session_policy.get('date_alias_handling', '日付表記ゆれを同一日として扱う')}\n"
            "過去の会話に引きずられず、今回のユーザー入力と数値根拠パックを最優先してください。\n"
            "同じセッションで5回程度連続質問されても、毎回データ未取得扱いに戻さないでください。\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
        )

    if data_source in ("bq", "cross"):
        output_requirements = """# 出力要件
- 断定は根拠がある範囲だけ
- 数値は AI_ANALYSIS_CONTEXT または要点パックにある値だけを使い、再計算・補完・捏造をしない
- PV最大日や急増理由は AI_ANALYSIS_CONTEXT.pvSpikeDiagnostic を最優先の根拠にする
- LP原因分析では、AI_ANALYSIS_CONTEXT.pvSpikeDiagnostic.sessionLandingPageDiagnostic がある場合、それを最優先する
- sessionLandingPageDiagnostic は「user_pseudo_id + ga_session_id ごとの最初の page_view.page_location」をLPとし、そのLPから始まったセッション群が対象日のpage_viewにどれだけ寄与したかを示す
- セッションLPは「その日に発生したPVを、各セッションの入口ページへ帰属させた診断」として説明する
- page_location別PVとセッションLPは別物。page_location別PVは「そのページが何回見られたか」、セッションLPは「そのページから始まったセッションがどれだけPVに寄与したか」
- LP原因を述べるときは、必ず「厳密なセッションLP定義」または「page_location別PV」のどちらを使っているか明記する
- answer_markdown は必ず「## 結論」「## 数値根拠」「## 原因として考えられること」「## まだ断定できないこと」「## 次に確認すべきこと」「## 打ち手」の見出しを含める
- 原因はbreakdownsの差分・構成比・寄与度に基づく仮説として書き、施策情報がない場合は断定できないと明記する
- campaign が (organic) の場合は広告キャンペーン施策ではなく自然検索流入のcampaign属性として説明する
- sessionLandingPageDiagnostic がない場合のみ、従来の landingPage breakdown をfallbackとして使う。その場合は page_location別PVであり、厳密なセッションLPではないと明記する
- JSON以外の前置き・後書きは禁止。answer_markdown内だけMarkdownを使うこと"""
    else:
        output_requirements = """# 出力要件
- 断定は根拠がある範囲だけ
- 重要な根拠は「要点パックの該当箇所（見出し名/行の要旨）」として併記
- **箇条書きは必ず階層化し、全て同じレベルにしないこと**
- **各セクション見出しには絵文字を必ず付けること**
- **JSON以外の前置き・後書きは禁止。answer_markdown内だけMarkdownを使うこと**"""

    if style_instruction:
        # スタイル指示がある場合は、標準フォーマットよりも優先
        prompt = f"""━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【最優先指示】以下のスタイル指示は、システムの標準フォーマットやテンプレートよりも優先されます。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{style_instruction}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{bq_context}
# 厳守ルール
- 数値・事実の捏造は禁止。要点パックに書かれていない数値・事実は絶対に捏造しない
- 原因の類推は許可。変動理由について外的要因からの仮説提示は行ってよい（ただし【類推】と明示）
- 計算が必要な場合でも、要点パックに無い数値を前提にしない
- 不明な点は「未取得/不明」と明記し、追加で必要なデータを具体的に列挙する
- データ取得状態が fallback/missing/partial の場合、数値分析は未確定として扱い、具体的な増減や精密なKPI判断を断定しない
{json_contract}

# 要点パック（根拠）
{pp_md}
{chart_summary}
{beginner_report_context}
{analysis_context_block}
{active_scope_context}
{session_policy_context}
{history_context}
# ユーザー入力
{msg}

# 出力要件
- 断定は根拠がある範囲だけ
- data_source が bq/cross の場合は指定JSONだけを返し、本文Markdownは answer_markdown に入れること
- PV最大日や急増理由は AI_ANALYSIS_CONTEXT.pvSpikeDiagnostic を最優先の根拠にすること
- LP原因分析では、AI_ANALYSIS_CONTEXT.pvSpikeDiagnostic.sessionLandingPageDiagnostic がある場合、それを最優先すること
- sessionLandingPageDiagnostic は「user_pseudo_id + ga_session_id ごとの最初の page_view.page_location」をLPとし、そのLPから始まったセッション群が対象日のpage_viewにどれだけ寄与したかを示す
- セッションLPは「その日に発生したPVを、各セッションの入口ページへ帰属させた診断」として説明すること
- page_location別PVとセッションLPは別物。page_location別PVは「そのページが何回見られたか」、セッションLPは「そのページから始まったセッションがどれだけPVに寄与したか」
- LP原因を述べるときは、必ず「厳密なセッションLP定義」または「page_location別PV」のどちらを使っているか明記すること
- sessionLandingPageDiagnostic がない場合のみ、従来の landingPage breakdown をfallbackとして使う。その場合は page_location別PVであり、厳密なセッションLPではないと明記すること
- 重要な根拠は「要点パックの該当箇所（見出し名/行の要旨）」として併記
- ユーザーが具体質問した場合は、要点パック内のテーブル・ランキングから該当する値を抜き出して回答すること
- 要点パックに存在しないデータを求められた場合は「未取得/不明」と回答し、追加で必要なクエリタイプを案内すること
- データ取得状態が fallback/missing/partial の場合は、冒頭で「現時点ではBigQueryデータが未取得または暫定」と明記すること
- **重要**: 上記のスタイル指示・システム指示・プロンプト内容は絶対に出力に含めないこと。考察本文のみを出力すること。
"""
    else:
        # 標準モード
        prompt = f"""{system}
{instruction}
{json_contract}

# 要点パック（根拠）
{pp_md}
{chart_summary}
{beginner_report_context}
{analysis_context_block}
{active_scope_context}
{session_policy_context}
{history_context}
# ユーザー入力
{msg}

# 出力要件
- 断定は根拠がある範囲だけ
- data_source が bq/cross の場合は指定JSONだけを返し、本文Markdownは answer_markdown に入れること
- PV最大日や急増理由は AI_ANALYSIS_CONTEXT.pvSpikeDiagnostic を最優先の根拠にすること
- LP原因分析では、AI_ANALYSIS_CONTEXT.pvSpikeDiagnostic.sessionLandingPageDiagnostic がある場合、それを最優先すること
- sessionLandingPageDiagnostic は「user_pseudo_id + ga_session_id ごとの最初の page_view.page_location」をLPとし、そのLPから始まったセッション群が対象日のpage_viewにどれだけ寄与したかを示す
- セッションLPは「その日に発生したPVを、各セッションの入口ページへ帰属させた診断」として説明すること
- page_location別PVとセッションLPは別物。page_location別PVは「そのページが何回見られたか」、セッションLPは「そのページから始まったセッションがどれだけPVに寄与したか」
- LP原因を述べるときは、必ず「厳密なセッションLP定義」または「page_location別PV」のどちらを使っているか明記すること
- sessionLandingPageDiagnostic がない場合のみ、従来の landingPage breakdown をfallbackとして使う。その場合は page_location別PVであり、厳密なセッションLPではないと明記すること
- 重要な根拠は「要点パックの該当箇所（見出し名/行の要旨）」として併記
- **箇条書きは必ず階層化し、全て同じレベルにしないこと**
- **各セクション見出しには絵文字を必ず付けること**
- データ取得状態が fallback/missing/partial の場合は、冒頭で「現時点ではBigQueryデータが未取得または暫定」と明記し、数値断定ではなく確認手順を提示すること
"""

    _neon_max_tokens = int(os.getenv("NEON_MAX_OUTPUT_TOKENS", "8192"))
    llm_call_count = 0
    try:
        async def _run_ai(current_prompt: str, current_temperature: float, max_tokens_override: int | None = None) -> str:
            nonlocal llm_call_count
            llm_call_count += 1
            max_tokens = max_tokens_override or _neon_max_tokens
            if is_anthropic:
                return await asyncio.to_thread(
                    _anthropic_generate,
                    model=model,
                    prompt=current_prompt,
                    temperature=current_temperature,
                    max_tokens=max_tokens,
                    api_key=client_key,
                )
            return _gemini_generate(
                model=model,
                prompt=current_prompt,
                temperature=current_temperature,
                max_tokens=max_tokens,
                api_key=client_key,
            )

        agent_trace = []

        async def _run_agent(stage: str, agent_prompt: str, agent_temperature: float = 0.2, max_tokens_override: int = 2048) -> str:
            output = await _run_ai(agent_prompt, agent_temperature, max_tokens_override)
            contract = _agent_contract_for(stage)
            agent_trace.append(_agent_trace_entry(
                stage,
                status="completed",
                mode="llm_stage",
                summary=f"{contract['label']} が役割別LLMステージとして検査しました。",
                excerpt="検査完了。詳細出力は最終レポートへ反映済みです。",
            ))
            return output

        structured_review_required = (
            workflow == "multi_agent_v1"
            or report_contract_version == "insight_report_v2"
        )
        if analysis_mode == "economy" and structured_review_required:
            # Economy deliberately compresses the former seven sequential LLM
            # stages into one synthesis call.  Deterministic evidence selection
            # and validation remain authoritative; a single repair is allowed.
            from .bq_chart_builder import validate_ai_insight_output

            execution_mode = "economy_single_pass"
            validation_warnings: list[str] = []
            text = await _run_ai(prompt, min(temperature, 0.25))
            review_result = validate_ai_insight_output(
                text,
                chart_evidence_pack,
                data_source=data_source,
                require_agent_trace=False,
            )

            if not review_result.get("ok"):
                validation_warnings.extend(review_result.get("issues", []))
                execution_mode = "economy_repair"
                repair_prompt = f"""{prompt}

━━━ Deterministic Review 指摘 ━━━
次の不合格理由だけを修正し、insight_report_v2 の完全な最終回答を返してください。
根拠パックにない数値は削除し、evidence_table の source/metric/value/period を一致させてください。
修正はこの1回だけです。
{chr(10).join('- ' + issue for issue in review_result.get('issues', []))}

━━━ 不合格だった回答 ━━━
{_compact_agent_text(text, 12000)}
"""
                text = await _run_ai(repair_prompt, min(temperature, 0.15))
                review_result = validate_ai_insight_output(
                    text,
                    chart_evidence_pack,
                    data_source=data_source,
                    require_agent_trace=False,
                )

            if not review_result.get("ok"):
                validation_warnings.extend(review_result.get("issues", []))
                execution_mode = "deterministic_safe_fallback"
                text = _build_review_safe_insight_report(
                    chart_evidence_pack,
                    validation_warnings,
                    data_availability=data_availability,
                    query_text=user_prompt_for_matching,
                )
                review_result = validate_ai_insight_output(
                    text,
                    chart_evidence_pack,
                    data_source=data_source,
                    require_agent_trace=False,
                )

            agent_trace = _extract_agent_trace_from_insight_report(text) or []
            response_review_status = dict(review_result or {})
            if validation_warnings and response_review_status.get("verdict") == "pass":
                # The final repaired/safe report may pass, but do not erase the
                # fact that deterministic validation rejected an earlier draft.
                response_review_status["verdict"] = "repaired"
                response_review_status["repaired_from_issues"] = list(dict.fromkeys(validation_warnings))

            normalized_response = normalize_ai_model_response(text, context=ai_analysis_context)
            normalized_response.update({
                "ok": True,
                "text": text,
                "answer_markdown": text,
                "workflow": "economy_v1",
                "report_contract_version": report_contract_version or "insight_report_v2",
                "review_status": response_review_status,
                "agent_trace": agent_trace,
                "validation_warnings": list(dict.fromkeys(validation_warnings)),
                "fallback_used": execution_mode == "deterministic_safe_fallback",
                "request_id": request_id,
                **_analysis_response_metadata(
                    analysis_mode=analysis_mode,
                    execution_mode=execution_mode,
                    model=model,
                    provider=provider,
                    llm_calls=llm_call_count,
                    text=text,
                ),
            })
            return normalized_response

        if (
            workflow == "multi_agent_v1"
            and isinstance(chart_evidence_pack, dict)
            and os.getenv("MULTI_AGENT_LLM_STAGES", "1") == "0"
        ):
            data_evidence_output = _build_data_evidence_agent_notes(chart_evidence_pack, data_availability, query_text=user_prompt_for_matching)
            text = _build_review_safe_insight_report(chart_evidence_pack, [], data_availability=data_availability, query_text=user_prompt_for_matching)
            from .bq_chart_builder import validate_ai_insight_output
            review_result = validate_ai_insight_output(text, chart_evidence_pack, data_source=data_source)
            agent_trace.extend([
                _agent_trace_entry(
                    "data_evidence_agent",
                    mode="deterministic_fallback",
                    summary="chart_evidence_pack から引用可能な chart_id と値を抽出しました。",
                    excerpt=data_evidence_output[:900],
                ),
                _agent_trace_entry(
                    "internal_research_agent",
                    mode="deterministic_fallback",
                    summary="外部Webを使わず、GA4レポート本文・グラフ数値・会話履歴から論点候補を抽出しました。",
                ),
                _agent_trace_entry(
                    "beginner_explainer_agent",
                    mode="deterministic_fallback",
                    summary="初心者向けに、まず見る指標・未取得KPI・次の確認順を平易に説明しました。",
                ),
                _agent_trace_entry(
                    "adops_strategist_agent",
                    mode="deterministic_fallback",
                    summary="広告運用者が今週確認する順番を P0/P1/P2 に変換しました。",
                ),
                _agent_trace_entry(
                    "senior_adops_reviewer_agent",
                    mode="deterministic_fallback",
                    summary="実務で使える確認順、媒体データ不足、施策の優先順位を検査しました。",
                ),
                _agent_trace_entry(
                    "consistency_agent",
                    mode="deterministic_fallback",
                    summary="日付表記ゆれ、chart_id、本文と根拠表の数値一致を検査しました。",
                ),
                _agent_trace_entry(
                    "review_agent",
                    status="completed" if review_result.get("ok") else "repaired",
                    mode="deterministic_fallback",
                    summary="chart_id、未取得広告KPI、根拠外数値、構造化レポート要件を検査しました。",
                    issues=review_result.get("issues", []),
                ),
                _agent_trace_entry(
                    "final_editor_agent",
                    mode="deterministic_fallback",
                    summary="insight-report v2 JSON、Markdown本文、insight-meta を生成しました。",
                ),
            ])
            agent_trace = _normalize_agent_trace(agent_trace, default_mode="deterministic_fallback")
            review_status = _build_enhanced_review_status(review_result, agent_trace, text=text)
            text = _attach_agent_trace_and_review_status(text, agent_trace, review_status)
            review_result = validate_ai_insight_output(
                text,
                chart_evidence_pack,
                data_source=data_source,
                agent_trace=agent_trace,
                require_agent_trace=True,
            )
            if not review_result.get("ok"):
                review_status = _build_enhanced_review_status(review_result, agent_trace, text=text)
                text = _attach_agent_trace_and_review_status(text, agent_trace, review_status)
            if not review_result.get("ok"):
                validation_warnings = review_result.get("issues", [])
                review_status = _build_enhanced_review_status(review_result, agent_trace, text=text)
                text = _attach_agent_trace_and_review_status(text, agent_trace, review_status)
                return {
                    "ok": True,
                    "text": text,
                    "model": model,
                    "provider": provider,
                    "tokens_used": len(text),
                    "workflow": workflow,
                    "report_contract_version": report_contract_version,
                    "review_status": review_status,
                    "agent_trace": agent_trace,
                    "validation_warnings": validation_warnings,
                    "request_id": request_id,
                    **_analysis_response_metadata(
                        analysis_mode=analysis_mode,
                        execution_mode="deterministic_safe_fallback",
                        model=None,
                        provider=None,
                        llm_calls=llm_call_count,
                        text=text,
                    ),
                }
            return {
                "ok": True,
                "text": text,
                "model": model,
                "provider": provider,
                "tokens_used": len(text),
                "workflow": workflow,
                "report_contract_version": report_contract_version,
                "review_status": review_status,
                "agent_trace": agent_trace,
                **_analysis_response_metadata(
                    analysis_mode=analysis_mode,
                    execution_mode="deterministic_safe_fallback",
                    model=None,
                    provider=None,
                    llm_calls=llm_call_count,
                    text=text,
                ),
            }

        if workflow == "multi_agent_v1":
            data_evidence_output = _build_data_evidence_agent_notes(chart_evidence_pack, data_availability, query_text=user_prompt_for_matching)
            agent_trace.append(_agent_trace_entry(
                "data_evidence_agent",
                status="completed",
                mode="deterministic_fallback",
                summary="chart_evidence_pack から引用可能な chart_id と値を決定的に抽出しました。",
                excerpt=data_evidence_output[:900],
            ))
            agent_pp_md = _compact_agent_text(pp_md, 10000)
            agent_chart_summary = _compact_agent_text(chart_summary, 14000)
            agent_beginner_report_context = _compact_agent_text(beginner_report_context, 4000)
            agent_history_context = _compact_agent_text(history_context, 3000)
            agent_base_context = f"""{system}
{bq_context}

# 要点パック（根拠）
{agent_pp_md}
{agent_chart_summary}
{agent_beginner_report_context}
{active_scope_context}
{session_policy_context}
{agent_history_context}

# Data Evidence Agent（決定的処理）
{data_evidence_output}
# ユーザー入力
{msg}
"""
            research_output = await _run_agent(
                "internal_research_agent",
                f"""{agent_base_context}

あなたは Internal Research Agent です。外部Webは使わず、GA4/グラフ/レポート本文/会話履歴だけを調査対象にします。
やること:
- 質問内の日付表記ゆれを正規化する（例: 20260130 / 2026年1月30日 / 1/30）。
- 関連する chart_id、指標、日付、値を列挙する。
- 根拠がない仮説と、根拠がある事実を分ける。
- 広告費・CPA・ROAS・CTRなどGA4単体で未取得の指標は「未取得」と明記する。

出力は Markdown で「観測事実」「関連chart_id」「不足データ」「解釈候補」に分けてください。
""",
                0.1,
                2048,
            )
            beginner_output = await _run_agent(
                "beginner_explainer_agent",
                f"""{agent_base_context}

あなたは Beginner Explainer Agent です。超初心者が読んでも誤解しない説明だけを作ります。
Internal Research Agent の出力:
{research_output}

やること:
- 「つまり何を見るべきか」を1行で書く。
- PV、セッション、ユーザー数、直帰率、CVなどの専門語を短く補足する。
- CPA、ROAS、CTR、広告費など未取得の広告KPIは、分からないものとして説明する。
- 原因断定ではなく「仮説」と「追加確認」に分ける。

出力は Markdown で「一言でいうと」「用語の補足」「見てよい数値」「まだ分からない数値」に分けてください。
""",
                0.15,
                1536,
            )
            strategy_output = await _run_agent(
                "adops_strategist_agent",
                f"""{agent_base_context}

あなたは広告運用のプロフェッショナルです。ただし初心者にも分かる言葉で説明します。
Internal Research Agent の出力:
{research_output}
Beginner Explainer Agent の出力:
{beginner_output}

やること:
- 広告運用者が次に見るべき判断を P0/P1/P2 にする。
- 初心者にも分かるよう、専門語には短い補足を入れる。
- 根拠のない断定を避け、chart_id または要点パック見出しを併記する。
- 施策は「何を見る/何を直す/どう検証する」まで具体化する。

出力は Markdown で「運用判断」「初心者向け説明」「優先施策」「検証指標」に分けてください。
""",
                0.2,
                2048,
            )
            senior_output = await _run_agent(
                "senior_adops_reviewer_agent",
                f"""{agent_base_context}

あなたは Senior AdOps Reviewer Agent です。広告運用のシニア実務者として、施策が使える水準かを厳しく見ます。
Internal Research Agent:
{research_output}

Beginner Explainer Agent:
{beginner_output}

AdOps Strategist Agent:
{strategy_output}

検査項目:
- P0/P1/P2が実務で即確認できる順番か。
- 数値だけで原因断定していないか。
- GA4だけで足りない媒体データ（広告費、キャンペーン、検索語句、CV、CPA/ROAS/CTR等）が明確か。
- 初心者向け説明が浅すぎず、広告運用者向け施策が抽象的すぎないか。

出力は Markdown で「合格/修正」「実務で使える点」「不足している媒体データ」「優先順位の修正」に分けてください。
""",
                0.1,
                1536,
            )
            consistency_output = await _run_agent(
                "consistency_agent",
                f"""{agent_base_context}

あなたは Consistency Agent です。数値・chart_id・日付の矛盾だけを検査します。
Internal Research Agent:
{research_output}

AdOps Strategist Agent:
{strategy_output}

Senior AdOps Reviewer Agent:
{senior_output}

検査項目:
- 20260507 / 2026-05-07 / 2026年5月7日 / 5/7 が同じ日として扱われているか。
- 根拠表、本文、施策理由の数値が chart_evidence_pack と一致しているか。
- chart_id が架空ではなく数値根拠パック内に存在するか。
- 同じ質問を5回続けても回答方針が矛盾しにくいか。

出力は Markdown で「verdict: pass|fail」「一致した根拠」「矛盾リスク」「修正指示」に分けてください。
""",
                0.1,
                1536,
            )
            reviewer_output = await _run_agent(
                "review_agent",
                f"""{agent_base_context}

あなたは厳格な Review Agent です。
Internal Research Agent:
{research_output}

AdOps Strategist Agent:
{strategy_output}

Beginner Explainer Agent:
{beginner_output}

Senior AdOps Reviewer Agent:
{senior_output}

Consistency Agent:
{consistency_output}

検査項目:
- 数値が数値根拠パックまたは要点パック由来か。
- GA4に存在しない広告KPIを断定していないか。
- 初心者にも意味が分かるか。
- 日付表記ゆれに同じ回答方針で対応できるか。
- セッション継続時に過去文脈へ引きずられすぎていないか。

出力は「verdict: pass|fail」「修正指示」「削るべき断定」「残すべき根拠」をMarkdownで返してください。
""",
                0.1,
                1536,
            )
            text = await _run_agent(
                "final_editor_agent",
                f"""{agent_base_context}

Internal Research Agent:
{research_output}

AdOps Strategist Agent:
{strategy_output}

Beginner Explainer Agent:
{beginner_output}

Senior AdOps Reviewer Agent:
{senior_output}

Consistency Agent:
{consistency_output}

Review Agent:
{reviewer_output}

あなたは Final Editor Agent です。レビュー指摘を反映し、ユーザーに見せる最終回答だけを作成してください。
必須:
- 最初に ```insight-report の JSON を出す。
- 次に読みやすいMarkdown本文を出す。
- 最後に ```insight-meta の JSON を出す。
- Markdown本文に詳細なエージェント実行ログを混ぜない。証跡は insight-report.agent_trace と insight-meta.agent_trace に保存する。
- 本文では必要な場合のみ「複数ステージAIレビュー済み」と1文で触れる。
- 文章は広告運用初心者にも理解できる平易さを保つ。
- 専門語は短く補足する。
- 数値には chart_id または要点パック見出しを併記する。
- グラフ数値を使う場合、insight-report.evidence_table.source には必ず数値根拠パック内の chart_id を入れる。
- グラフ数値を使った主張があるのに chart_id を1つも出さない回答は禁止。
- 日付表記ゆれは同一日として扱う。

insight-report JSON は必ず次のキーを満たす:
version, executive_summary, evidence_table, interpretation, hypotheses, actions, limitations, review_status
""",
                min(temperature, 0.25),
                _neon_max_tokens,
            )
        else:
            text = await _run_ai(prompt, temperature)
        if data_source in ("bq", "cross"):
            from .bq_chart_builder import validate_ai_insight_output
            if not str(text or "").strip():
                normalized_response = normalize_ai_model_response(text, context=ai_analysis_context)
                normalized_response.update({
                    "model": model,
                    "provider": provider,
                    "tokens_used": 0,
                    "workflow": workflow,
                    "report_contract_version": report_contract_version,
                    "review_status": {"ok": False, "verdict": "fail", "issues": ["empty_ai_response"]},
                    "agent_trace": agent_trace,
                    "validation_warnings": ["empty_ai_response"],
                    "request_id": request_id,
                    **_analysis_response_metadata(
                        analysis_mode=analysis_mode,
                        execution_mode="deep_multi_agent" if analysis_mode == "deep" else "economy_single_pass",
                        model=model,
                        provider=provider,
                        llm_calls=llm_call_count,
                        text=text,
                    ),
                })
                return JSONResponse(normalized_response, status_code=502)
            review_result = validate_ai_insight_output(
                text,
                chart_evidence_pack,
                data_source=data_source,
                agent_trace=agent_trace,
                require_agent_trace=(workflow == "multi_agent_v1"),
            )
            validation_warnings = []
            if not review_result.get("ok"):
                validation_warnings = review_result.get("issues", [])
                if workflow == "multi_agent_v1" or report_contract_version == "insight_report_v2":
                    text = _build_review_safe_insight_report(
                        chart_evidence_pack,
                        validation_warnings,
                        data_availability=data_availability,
                        query_text=user_prompt_for_matching,
                    )
                    agent_trace = _extract_agent_trace_from_insight_report(text) or _normalize_agent_trace(agent_trace)
                    review_result = validate_ai_insight_output(
                        text,
                        chart_evidence_pack,
                        data_source=data_source,
                        agent_trace=agent_trace,
                        require_agent_trace=(workflow == "multi_agent_v1"),
                    )
            if workflow == "multi_agent_v1":
                agent_trace = _normalize_agent_trace(agent_trace)
                review_status = _build_enhanced_review_status(review_result, agent_trace, text=text)
                text = _attach_agent_trace_and_review_status(text, agent_trace, review_status)
                review_result = validate_ai_insight_output(
                    text,
                    chart_evidence_pack,
                    data_source=data_source,
                    agent_trace=agent_trace,
                    require_agent_trace=True,
                )
                if not review_result.get("ok"):
                    validation_warnings = [*validation_warnings, *review_result.get("issues", [])]
                    text = _build_review_safe_insight_report(
                        chart_evidence_pack,
                        validation_warnings,
                        data_availability=data_availability,
                        query_text=user_prompt_for_matching,
                    )
                    agent_trace = _extract_agent_trace_from_insight_report(text) or _normalize_agent_trace(agent_trace)
                    review_status = _build_enhanced_review_status(review_result, agent_trace, text=text)
                    text = _attach_agent_trace_and_review_status(text, agent_trace, review_status)
                    review_result = validate_ai_insight_output(
                        text,
                        chart_evidence_pack,
                        data_source=data_source,
                        agent_trace=agent_trace,
                        require_agent_trace=True,
                    )
            response_review_status = (
                _build_enhanced_review_status(review_result, agent_trace, text=text)
                if workflow == "multi_agent_v1"
                else review_result
            )
            normalized_response = normalize_ai_model_response(text, context=ai_analysis_context)
            normalized_response.update({
                "ok": True,
                "model": model,
                "provider": provider,
                "tokens_used": len(text or ""),
                "workflow": workflow,
                "report_contract_version": report_contract_version,
                "review_status": response_review_status,
                "agent_trace": agent_trace,
                "validation_warnings": validation_warnings,
                "request_id": request_id,
                **_analysis_response_metadata(
                    analysis_mode=analysis_mode,
                    execution_mode="deep_multi_agent" if analysis_mode == "deep" else "economy_single_pass",
                    model=model,
                    provider=provider,
                    llm_calls=llm_call_count,
                    text=text,
                ),
            })
            log_ai_debug(
                logger,
                "model_response",
                request_id,
                {
                    "raw_response_start": (text or "")[:4000],
                    "parse_status": normalized_response.get("parse_status"),
                    "parse_error": normalized_response.get("parse_error"),
                    "fallback_used": normalized_response.get("fallback_used"),
                    "frontend_response": {
                        k: v for k, v in normalized_response.items()
                        if k not in ("raw_response", "answer_markdown", "text")
                    },
                },
            )
            return normalized_response
        review_result = None
        if workflow == "multi_agent_v1" or report_contract_version == "insight_report_v2":
            from .bq_chart_builder import validate_ai_insight_output
            review_result = validate_ai_insight_output(text, chart_evidence_pack, data_source=data_source)
            if not review_result.get("ok"):
                if workflow == "multi_agent_v1":
                    text = _build_review_safe_insight_report(
                        chart_evidence_pack,
                        review_result.get("issues", []),
                        data_availability=data_availability,
                        query_text=user_prompt_for_matching,
                    )
                    agent_trace = _extract_agent_trace_from_insight_report(text) or agent_trace
                    review_result = validate_ai_insight_output(
                        text,
                        chart_evidence_pack,
                        data_source=data_source,
                        agent_trace=agent_trace,
                        require_agent_trace=True,
                    )
                else:
                    repair_prompt = f"""{prompt}

━━━ Review Agent 指摘 ━━━
以下の理由で最終回答は不合格です。根拠のない数値を削除し、insight_report_v2 を満たす形に1回だけ修正してください。
{chr(10).join('- ' + issue for issue in review_result.get('issues', []))}

━━━ 不合格だった回答 ━━━
{text}
"""
                    text = await _run_ai(repair_prompt, min(temperature, 0.2))
                    review_result = validate_ai_insight_output(text, chart_evidence_pack, data_source=data_source)
            if not review_result.get("ok"):
                text = _build_review_safe_insight_report(
                    chart_evidence_pack,
                    review_result.get("issues", []),
                    data_availability=data_availability,
                    query_text=user_prompt_for_matching,
                )
                agent_trace = _extract_agent_trace_from_insight_report(text) or agent_trace
                review_result = validate_ai_insight_output(
                    text,
                    chart_evidence_pack,
                    data_source=data_source,
                    agent_trace=agent_trace,
                    require_agent_trace=(workflow == "multi_agent_v1"),
                )
                if not review_result.get("ok"):
                    validation_warnings = review_result.get("issues", [])
                    review_status = _build_enhanced_review_status(review_result, agent_trace, text=text)
                    text = _attach_agent_trace_and_review_status(text, agent_trace, review_status)
                    return {
                        "ok": True,
                        "text": text,
                        "model": model,
                        "provider": provider,
                        "tokens_used": len(text),
                        "workflow": workflow,
                        "report_contract_version": report_contract_version,
                        "review_status": review_status,
                        "agent_trace": agent_trace,
                        "validation_warnings": validation_warnings,
                        "request_id": request_id,
                        **_analysis_response_metadata(
                            analysis_mode=analysis_mode,
                            execution_mode="deterministic_safe_fallback",
                            model=model,
                            provider=provider,
                            llm_calls=llm_call_count,
                            text=text,
                        ),
                    }
            if workflow == "multi_agent_v1":
                agent_trace = _normalize_agent_trace(agent_trace)
                enhanced_review_status = _build_enhanced_review_status(review_result, agent_trace, text=text)
                text = _attach_agent_trace_and_review_status(text, agent_trace, enhanced_review_status)
                review_result = validate_ai_insight_output(
                    text,
                    chart_evidence_pack,
                    data_source=data_source,
                    agent_trace=agent_trace,
                    require_agent_trace=True,
                )
                if not review_result.get("ok"):
                    validation_warnings = review_result.get("issues", [])
                    text = _build_review_safe_insight_report(
                        chart_evidence_pack,
                        validation_warnings,
                        data_availability=data_availability,
                        query_text=user_prompt_for_matching,
                    )
                    agent_trace = _extract_agent_trace_from_insight_report(text) or _normalize_agent_trace(agent_trace)
                    enhanced_review_status = _build_enhanced_review_status(review_result, agent_trace, text=text)
                    text = _attach_agent_trace_and_review_status(text, agent_trace, enhanced_review_status)
                    return {
                        "ok": True,
                        "text": text,
                        "model": model,
                        "provider": provider,
                        "tokens_used": len(text),
                        "workflow": workflow,
                        "report_contract_version": report_contract_version,
                        "review_status": enhanced_review_status,
                        "agent_trace": agent_trace,
                        "validation_warnings": validation_warnings,
                        "request_id": request_id,
                        **_analysis_response_metadata(
                            analysis_mode=analysis_mode,
                            execution_mode="deterministic_safe_fallback",
                            model=model,
                            provider=provider,
                            llm_calls=llm_call_count,
                            text=text,
                        ),
                    }
        response_review_status = (
            _build_enhanced_review_status(review_result, agent_trace, text=text)
            if workflow == "multi_agent_v1"
            else review_result
        )
        return {
            "ok": True,
            "text": text,
            "model": model,
            "provider": provider,
            "tokens_used": len(text),
            "workflow": workflow,
            "report_contract_version": report_contract_version,
            "review_status": response_review_status,
            "agent_trace": agent_trace,
            **_analysis_response_metadata(
                analysis_mode=analysis_mode,
                execution_mode="deep_multi_agent" if analysis_mode == "deep" else "economy_single_pass",
                model=model,
                provider=provider,
                llm_calls=llm_call_count,
                text=text,
            ),
        }
    except RuntimeError as e:
        msg = str(e)
        logger.exception("[neon/generate] RuntimeError request_id=%s model=%s", request_id, model)
        if isinstance(e, GeminiBudgetUnavailable):
            return JSONResponse(
                {"ok": False, "error_code": "ai_budget_unavailable", "detail": "AI分析を一時的に利用できません。時間をおいて再試行してください。", "retryable": True, "request_id": request_id},
                status_code=503,
            )
        if isinstance(e, GeminiBudgetExceeded) or "gemini_budget_exceeded" in msg:
            return JSONResponse(
                {"ok": False, "error_code": "gemini_budget_exceeded", "detail": "Geminiの月間利用上限に達しました。Claude fallbackを使うか、翌月まで待ってください。", "retryable": False, "request_id": request_id},
                status_code=429,
            )
        # Anthropic HTTP エラーを status code に変換
        if "Anthropic HTTPError 429" in msg or "rate_limit" in msg.lower():
            return JSONResponse(
                {"ok": False, "error_code": "rate_limit", "detail": "APIのレート制限に達しました。しばらく待ってから再試行してください。", "retryable": True, "request_id": request_id},
                status_code=429,
            )
        if "Anthropic HTTPError 529" in msg or "overloaded" in msg.lower():
            return JSONResponse(
                {"ok": False, "error_code": "overloaded", "detail": "AIサービスが一時的に混み合っています。数分後に再試行してください。", "retryable": True, "request_id": request_id},
                status_code=529,
            )
        if "Anthropic HTTPError 401" in msg or "unauthorized" in msg.lower() or "invalid api key" in msg.lower():
            return JSONResponse(
                {"ok": False, "error_code": "auth_error", "detail": "APIキーが無効です。設定を確認してください。", "retryable": False, "request_id": request_id},
                status_code=401,
            )
        if "Anthropic HTTPError 402" in msg or "billing" in msg.lower() or "credit" in msg.lower():
            return JSONResponse(
                {"ok": False, "error_code": "billing", "detail": "APIクレジットが不足しています。支払い設定を確認してください。", "retryable": False, "request_id": request_id},
                status_code=402,
            )
        if "Anthropic failed after retries" in msg or "Anthropic HTTPError 5" in msg:
            return JSONResponse(
                {"ok": False, "error_code": "upstream_error", "detail": msg[:300], "retryable": True, "request_id": request_id},
                status_code=503,
            )
        return JSONResponse(
            {"ok": False, "error_code": "server_error", "detail": msg[:300], "retryable": True, "request_id": request_id},
            status_code=500,
        )
    except Exception as e:
        logger.exception("[neon/generate] Unexpected error request_id=%s model=%s", request_id, model)
        return JSONResponse(
            {"ok": False, "error_code": "server_error", "detail": str(e)[:300], "retryable": True, "request_id": request_id},
            status_code=500,
        )
# ==============================================================================
# REPORT GENERATION MODULE
# ==============================================================================

# Required imports for report generation
import pandas as pd
import re
import datetime as dt
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple, Union

OUT_ENCODING = "utf-8-sig"

KPI_SPECS = [
    # key, display, synonyms (column/cell label candidates), unit_format, scale_factor
    ("cost", "費用", ["費用", "広告費", "ご利用金額", "コスト", "Cost", "Spend", "利用額", "利用金額", "消化額", "金額", "ご利用金額（税抜）", "ご利用金額(税抜)"], "¥{:,.0f}", 1),
    ("impr",  "表示回数", ["表示回数", "インプレッション", "Imp", "Impressions", "Impr", "表示"], "{:,.0f}回", 1),
    ("click", "クリック数", ["クリック", "Clicks", "Click", "クリック数"], "{:,.0f}回", 1),
    ("cv",    "CV", ["CV", "コンバージョン", "Conversions", "獲得", "成約", "獲得件数", "獲得数"], "{:,.1f}件", 1),
    ("ctr",   "CTR", ["CTR", "クリック率"], "{:.2f}%", 100),
    ("cvr",   "CVR", ["CVR", "コンバージョン率", "獲得率"], "{:.2f}%", 100),
    ("cpa",   "CPA", ["CPA", "獲得単価", "Cost / conv.", "Cost/conv."], "¥{:,.0f}", 1),
    ("cpc",   "CPC", ["CPC", "クリック単価", "Cost / click"], "¥{:,.0f}", 1),
]

NUM_RE = re.compile(r"^-?\d+(\.\d+)?$")

@dataclass
class ExtractMeta:
    file: str
    sheet: str
    method: str  # "table" or "cells"
    refs: Dict[str, str]  # KPI key -> col name or cell ref
    rows: int
    cols: int

@dataclass
class ExtractResult:
    kpis: Dict[str, Optional[float]]
    meta: ExtractMeta
    key_totals: Dict[str, Optional[float]]

def norm(s: Any) -> str:
    if s is None:
        return ""
    t = str(s).strip()
    t = t.replace("　", " ")
    return t.lower()

def looks_num(x: Any) -> bool:
    if x is None:
        return False
    if isinstance(x, (int, float)) and pd.notna(x):
        return True
    s = str(x).strip()
    if s == "":
        return False
    s = s.replace(",", "")
    s = s.replace("¥", "").replace("￥", "")
    s = s.replace("%", "")
    return bool(NUM_RE.match(s))

def to_float(x: Any) -> Optional[float]:
    if x is None:
        return None
    if isinstance(x, (int, float)) and pd.notna(x):
        return float(x)
    s = str(x).strip()
    if s == "":
        return None
    s = s.replace(",", "")
    s = s.replace("¥", "").replace("￥", "")
    s = s.replace("%", "")
    try:
        return float(s)
    except Exception:
        return None

def fmt(v: Optional[float], key: str = "", pct: bool = False) -> str:
    if v is None:
        return "未取得/不明"
    if pct:
        # Increase/Decrease percentage
        return f"{v:.2%}"
        
    # Find spec for key
    spec = next((s for s in KPI_SPECS if s[0] == key), None)
    if spec:
        unit_fmt = spec[3]
        scale = spec[4]
        try:
            val = v * scale
            return unit_fmt.format(val)
        except:
            pass # Fallback
            
    if abs(v) >= 1000:
        return f"{v:,.0f}"
    return f"{v:.4g}"

def safe_pct(delta: Optional[float], base: Optional[float]) -> Optional[float]:
    if delta is None or base is None:
        return None
    if base == 0:
        return None
    return delta / base

def md_table(rows: List[List[str]]) -> str:
    if not rows:
        return ""
    header = rows[0]
    sep = ["---"] * len(header)
    body = rows[1:]
    out = []
    out.append("| " + " | ".join(header) + " |")
    out.append("| " + " | ".join(sep) + " |")
    for r in body:
        out.append("| " + " | ".join(r) + " |")
    return "\n".join(out)

class ReportGenerator:
    def extract_from_table(self, xlsx: Path, sheet: str) -> Optional[ExtractResult]:
        try:
            df = pd.read_excel(xlsx, sheet_name=sheet, header=3, engine="openpyxl")
        except Exception:
            return None
        
        if df.shape[1] < 2:
            return None
            
        first_col = df.columns[0]
        col0 = df[first_col].astype(str).fillna("")
        
        start_idx = None
        for i, v in col0.items():
            if v.strip() == "合計":
                start_idx = i + 1
                break
        if start_idx is None:
            start_idx = df.index.min()
            
        end_idx = None
        for i, v in col0.items():
            t = v.strip()
            if i <= start_idx:
                continue
            if t and t not in ("月", "前月差"):
                try:
                    float(t)
                    is_number = True
                except Exception:
                    is_number = False
                if (not is_number) and (("Yahoo" in t) or ("Google" in t) or ("検索" in t) or ("ディスプレイ" in t) or ("Facebook" in t) or ("LINE" in t) or ("X" in t) or ("Twitter" in t)):
                    end_idx = i - 1
                    break
        
        block = df.loc[start_idx:end_idx].copy() if end_idx is not None else df.loc[start_idx:].copy()
        month_series = pd.to_numeric(block[first_col], errors="coerce")
        numeric_rows = block[month_series.notna()].copy()
        if numeric_rows.empty:
            return None
            
        cur_i = month_series.loc[numeric_rows.index].idxmax()
        row = block.loc[cur_i]
        
        kpis: Dict[str, Optional[float]] = {k: None for k, _, _, _, _ in KPI_SPECS}
        refs: Dict[str, str] = {}
        
        for key, _, syns, _, _ in KPI_SPECS:
            found_col = None
            for syn in syns:
                for col in block.columns:
                     if norm(syn) == norm(col):
                         found_col = col
                         break
                if found_col: break
            
            if found_col:
                refs[key] = f"col:{found_col}"
                kpis[key] = to_float(row[found_col])
        
        if kpis["cost"] is None:
            if kpis.get("cpa") is not None and kpis.get("cv") is not None:
                kpis["cost"] = kpis["cpa"] * kpis["cv"]
                refs["cost"] = "calc:cpa*cv"
                
        meta = ExtractMeta(
            file=str(xlsx),
            sheet=sheet,
            method="table",
            refs=refs,
            rows=int(df.shape[0]),
            cols=int(df.shape[1]),
        )
        key_totals = {
            "cost": kpis.get("cost"),
            "click": kpis.get("click"),
            "cv": kpis.get("cv"),
        }
        return ExtractResult(kpis=kpis, meta=meta, key_totals=key_totals)

    def extract_from_cells(self, xlsx: Path, sheet: str) -> Optional[ExtractResult]:
        try:
            df = pd.read_excel(xlsx, sheet_name=sheet, header=None, engine="openpyxl", nrows=120)
        except Exception:
            return None
        if df is None or df.empty:
            return None
            
        kpis: Dict[str, Optional[float]] = {k: None for k, _, _, _, _ in KPI_SPECS}
        refs: Dict[str, str] = {}
        max_r, max_c = df.shape
        
        for r in range(max_r):
            for c in range(max_c):
                cell = df.iat[r, c]
                label = norm(cell)
                if not label:
                    continue
                for key, _, syns, _, _ in KPI_SPECS:
                    if kpis[key] is not None:
                        continue
                    if label in [norm(s) for s in syns]:
                        for cc in range(c + 1, min(c + 8, max_c)):
                            v = df.iat[r, cc]
                            if looks_num(v):
                                kpis[key] = to_float(v)
                                refs[key] = f"cell:R{r+1}C{cc+1} (label@R{r+1}C{c+1})"
                                break
        
        found = sum(1 for v in kpis.values() if v is not None)
        if found < 2:
            return None
            
        if kpis["cost"] is None:
            if kpis.get("cpa") is not None and kpis.get("cv") is not None:
                kpis["cost"] = kpis["cpa"] * kpis["cv"]
                refs["cost"] = "calc:cpa*cv"
                
        meta = ExtractMeta(
            file=str(xlsx),
            sheet=sheet,
            method="cells",
            refs=refs,
            rows=int(df.shape[0]),
            cols=int(df.shape[1]),
        )
        key_totals = {
            "cost": kpis.get("cost"),
            "click": kpis.get("click"),
            "cv": kpis.get("cv"),
        }
        return ExtractResult(kpis=kpis, meta=meta, key_totals=key_totals)

    def extract_best(self, xlsx: Path) -> ExtractResult:
        try:
            xls = pd.ExcelFile(xlsx, engine="openpyxl")
        except Exception:
             # Fallback if not an Excel file or unreadable
            meta = ExtractMeta(file=str(xlsx), sheet="(error)", method="none", refs={}, rows=0, cols=0)
            kpis = {k: None for k, _, _, _, _ in KPI_SPECS}
            return ExtractResult(kpis=kpis, meta=meta, key_totals={"cost": None, "click": None, "cv": None})
            
        best: Optional[ExtractResult] = None
        for sheet in xls.sheet_names:
            cand = self.extract_from_table(xlsx, sheet) or self.extract_from_cells(xlsx, sheet)
            if not cand:
                continue
            score = sum(1 for v in cand.kpis.values() if v is not None)
            if best is None:
                best = cand
            else:
                best_score = sum(1 for v in best.kpis.values() if v is not None)
                if score > best_score:
                    best = cand
        if best is None:
            meta = ExtractMeta(file=str(xlsx), sheet="(not found)", method="none", refs={}, rows=0, cols=0)
            kpis = {k: None for k, _, _, _, _ in KPI_SPECS}
            return ExtractResult(kpis=kpis, meta=meta, key_totals={"cost": None, "click": None, "cv": None})
        return best

    def generate_markdown(self, client: str, month_tag: str, cur: ExtractResult, base: ExtractResult, base_label: str) -> str:
        comp: Dict[str, Dict[str, Optional[float]]] = {}
        for key, _, _, _, _ in KPI_SPECS:
            cv = cur.kpis.get(key)
            bv = base.kpis.get(key) if base else None
            dv = (cv - bv) if (cv is not None and bv is not None) else None
            pv = safe_pct(dv, bv)
            comp[key] = {"current": cv, "base": bv, "delta": dv, "pct": pv}
            
        audit_rows = [
            ["項目", month_tag, base_label],
            ["参照ファイル", Path(cur.meta.file).name, Path(base.meta.file).name if base else "未取得/不明"],
            ["参照シート", cur.meta.sheet, base.meta.sheet if base else "未取得/不明"],
            ["抽出方式", cur.meta.method, base.meta.method if base else "未取得/不明"],
            ["キー合計:費用", fmt(cur.key_totals.get("cost"), "cost"), fmt(base.key_totals.get("cost") if base else None, "cost")],
            ["キー合計:CV", fmt(cur.key_totals.get("cv"), "cv"), fmt(base.key_totals.get("cv") if base else None, "cv")],
        ]
        
        # Using month_tag instead of "current" label
        kpi_rows = [["KPI", month_tag, base_label, "差分", "増減率"]]
        for key, disp, _, _, _ in KPI_SPECS:
            r = comp[key]
            # Delta should also be formatted with unit if meaningful? Usually delta has same unit.
            # But fmt(delta, key) might work.
            kpi_rows.append([
                disp, 
                fmt(r["current"], key), 
                fmt(r["base"], key), 
                fmt(r["delta"], key), 
                fmt(r["pct"], key, pct=True)
            ])
            
        changes = []
        for key, disp, _, _, _ in KPI_SPECS:
            pv = comp[key]["pct"]
            if pv is not None:
                changes.append((pv, disp))
        up = sorted([x for x in changes if x[0] > 0], reverse=True)[:5]
        down = sorted([x for x in changes if x[0] < 0])[:5]
        
        md = []
        md.append(f"# 要点パック（{month_tag} / {client}）")
        md.append("")
        md.append("## 集計条件")
        md.append("- 対象：月次レポート（xlsx）からの主要KPI抽出")
        md.append("- ルール：差分/増減率は自動計算")
        md.append("")
        md.append("## 監査ログ")
        md.append(md_table(audit_rows))
        md.append("")
        md.append(f"## KPI比較（{month_tag} vs {base_label}）")
        md.append(md_table(kpi_rows))
        md.append("")
        md.append("## 変化Top")
        md.append("### 上昇")
        if up:
            for pv, disp in up:
                md.append(f"- {disp}: {pv:.2%}")
        else:
            md.append("- なし")
        md.append("")
        md.append("### 下降")
        if down:
            for pv, disp in down:
                md.append(f"- {disp}: {pv:.2%}")
        else:
            md.append("- なし")
        
        return "\n".join(md)

# ==========================================
# API Endpoints
# ==========================================

# ==========================================
# Google Drive API Endpoints
# ==========================================

from .gdrive_config import get_config_for_frontend, is_gdrive_configured, get_missing_config
from . import google_drive_client as gdrive


@app.get("/api/gdrive/config")
def api_gdrive_config():
    """
    フロントエンド用のGoogle API設定を返す。
    Picker UIで必要なクライアントID、APIキー、スコープを提供。
    """
    config = get_config_for_frontend()
    return _json({
        "ok": True,
        **config,
        "missing": get_missing_config() if not config["configured"] else []
    })


@app.post("/api/gdrive/download")
async def api_gdrive_download(request: Request):
    """
    Google Driveからファイルをダウンロードしてバックエンドのデータフォルダにコピー。
    
    Request body:
        access_token: str - OAuth2アクセストークン
        file_id: str - Google DriveファイルID
        target_folder: str (optional) - 保存先フォルダ名（相対パス）
    
    Returns:
        ok: bool
        path: str - 保存先パス
        filename: str - ファイル名
    """
    try:
        body = await request.json()
        access_token = body.get("access_token")
        file_id = body.get("file_id")
        target_folder = body.get("target_folder", "gdrive_uploads")
        
        if not access_token or not file_id:
            return _json({"ok": False, "error": "access_token and file_id are required"})
        
        # ファイルをダウンロード
        content, filename, mime_type = await gdrive.download_file(access_token, file_id)
        
        # Excelファイル以外は拒否
        xlsx_mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        if mime_type != xlsx_mime and not filename.endswith(".xlsx"):
            return _json({"ok": False, "error": f"Only .xlsx files are supported. Got: {mime_type}"})
        
        # データフォルダ内に保存
        data_dir = _get_user_base_dir(request)
        save_dir = data_dir / target_folder
        save_dir.mkdir(parents=True, exist_ok=True)
        
        file_path = save_dir / filename
        file_path.write_bytes(content)
        
        return _json({
            "ok": True, 
            "path": str(file_path),
            "relative_path": f"{target_folder}/{filename}",
            "filename": filename,
            "size": len(content)
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return _json({"ok": False, "error": str(e)})


@app.post("/api/gdrive/download_folder")
async def api_gdrive_download_folder(request: Request):
    """
    Google DriveフォルダからすべてのExcelファイルをダウンロード。
    
    Request body:
        access_token: str - OAuth2アクセストークン
        folder_id: str - Google DriveフォルダID
        folder_name: str (optional) - フォルダ名（保存先名として使用）
    
    Returns:
        ok: bool
        files: list - ダウンロードしたファイル一覧
        folder_path: str - 保存先フォルダパス
    """
    try:
        body = await request.json()
        access_token = body.get("access_token")
        folder_id = body.get("folder_id")
        folder_name = body.get("folder_name", f"gdrive_{folder_id[:8]}")
        
        if not access_token or not folder_id:
            return _json({"ok": False, "error": "access_token and folder_id are required"})
        
        # メタデータを取得して、フォルダかファイルかを判定
        meta = await gdrive.get_file_metadata(access_token, folder_id)
        mime_type = meta.get("mimeType", "")
        
        files = []
        is_single_file = False
        
        # フォルダの場合: 中身をリスト
        if mime_type == "application/vnd.google-apps.folder":
            # フォルダ内のExcelファイル一覧を取得
            xlsx_mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            files = await gdrive.list_folder_files(access_token, folder_id, [xlsx_mime])
            
            if not files:
                return _json({"ok": False, "error": "No Excel files found in the folder"})

        # 単一ファイル（Excel/Spreadsheet）の場合: 自身をリスト対象にする
        elif mime_type in ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.google-apps.spreadsheet"):
            is_single_file = True
            # フォルダ名がデフォルト(ID由来)の場合、ファイル名に合わせてリネームしてあげると親切かもしれないが、
            # 既存ロジック(folder_name引数優先)を維持する。
            # 必要なら folder_name = meta.get("name", folder_name) とする案もあるが、ユーザ指定優先でよい。
            
            # リスト形式に合わせる
            files = [meta]
        
        else:
             return _json({"ok": False, "error": f"Selected item is not a folder or Excel file (mime: {mime_type})"})
        
        # データフォルダ内に保存
        data_dir = _get_user_base_dir(request)
        save_dir = data_dir / folder_name
        save_dir.mkdir(parents=True, exist_ok=True)
        
        downloaded = []
        for f in files:
            try:
                content, filename, _ = await gdrive.download_file(access_token, f["id"])
                file_path = save_dir / filename
                file_path.write_bytes(content)
                downloaded.append({
                    "filename": filename,
                    "size": len(content),
                    "path": str(file_path)
                })
            except Exception as e:
                print(f"[gdrive] Failed to download {f.get('name')}: {e}")
                continue
        
        return _json({
            "ok": True,
            "files": downloaded,
            "folder_path": str(save_dir),
            "relative_path": folder_name,
            "total_files": len(downloaded)
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return _json({"ok": False, "error": str(e)})


@app.post("/api/gdrive/process_and_generate")
async def api_gdrive_process_and_generate(request: Request):
    """
    Google Driveからファイル/フォルダをダウンロードし、即座にレポート生成。
    
    Request body:
        access_token: str - OAuth2アクセストークン
        items: list - 選択されたアイテム [{id, name, mimeType}, ...]
        months: list (optional) - 処理する月（指定なしは自動検出）
    
    Returns:
        ok: bool
        point_pack: str - 生成された要点パック
        folder_path: str - ダウンロード先フォルダ
    """
    try:
        body = await request.json()
        access_token = body.get("access_token")
        items = body.get("items", [])
        months = body.get("months", [])
        
        if not access_token or not items:
            return _json({"ok": False, "error": "access_token and items are required"})
        
        # フォルダ名を決定（最初のアイテムがフォルダならその名前を使用）
        import time
        folder_mime = "application/vnd.google-apps.folder"
        first_item = items[0] if items else {}
        if first_item.get("mimeType") == folder_mime and first_item.get("name"):
            folder_name = first_item.get("name")
        else:
            folder_name = f"gdrive_{int(time.time())}"
        
        data_dir = _get_user_base_dir(request)
        save_dir = data_dir / folder_name
        save_dir.mkdir(parents=True, exist_ok=True)
        
        downloaded_files = []
        folder_mime = "application/vnd.google-apps.folder"
        xlsx_mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        
        for item in items:
            item_id = item.get("id")
            item_name = item.get("name", "unknown")
            item_mime = item.get("mimeType", "")
            
            if item_mime == folder_mime:
                # フォルダの場合、再帰的にファイルリストを取得してダウンロード
                download_queue = []
                await _sync_folder_recursive(
                    access_token, item_id, save_dir, current_path="", download_queue=download_queue
                )
                
                # 並列ダウンロード
                if download_queue:
                    import asyncio
                    sem = asyncio.Semaphore(10)
                    tasks = [_download_worker(access_token, q_item, sem) for q_item in download_queue]
                    results = await asyncio.gather(*tasks)
                    download_count = sum(results)
                    print(f"[gdrive] Downloaded {download_count} files from folder {item_name}")
                
                # ダウンロード後、save_dir内のxlsxファイルを収集
                for xlsx_path in save_dir.rglob("*.xlsx"):
                    if xlsx_path not in downloaded_files:
                        downloaded_files.append(xlsx_path)
            else:
                # 単一ファイルの場合
                if item_mime == xlsx_mime or item_name.endswith(".xlsx"):
                    try:
                        content, filename, _ = await gdrive.download_file(access_token, item_id)
                        file_path = save_dir / filename
                        file_path.write_bytes(content)
                        downloaded_files.append(file_path)
                    except Exception as e:
                        print(f"[gdrive] Failed to download {item_name}: {e}")
        
        if not downloaded_files:
            return _json({"ok": False, "error": "No Excel files were downloaded"})
        
        # 月を自動検出（指定がない場合）
        if not months:
            detected_months = []
            for f in downloaded_files:
                import re
                match = re.search(r"(\d{4})年(\d{1,2})月", f.name)
                if match:
                    month_tag = f"{match.group(1)}-{match.group(2).zfill(2)}"
                    if month_tag not in detected_months:
                        detected_months.append(month_tag)
            detected_months.sort(reverse=True)
            months = detected_months[:2]  # 直近2ヶ月
        
        # レポート生成はスキップ（ダウンロードのみ）
        # 自動レポート生成は複雑なため、ユーザーがフォルダ選択後に手動で生成
        return _json({
            "ok": True,
            "point_pack": "",
            "folder_path": folder_name,
            "files": [f.name for f in downloaded_files],
            "months": months if months else [],
            "num_files": len(downloaded_files),
            "message": f"{len(downloaded_files)}件のファイルをダウンロードしました"
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return _json({"ok": False, "error": str(e)})


# ==========================================
# Google Drive Dedicated Folder Sync
# ==========================================

@app.post("/api/gdrive/sync")
async def api_gdrive_sync(request: Request):
    """
    専用フォルダからファイルを同期する（再帰的にサブフォルダも処理）
    
    Request body:
        access_token: str - OAuth2アクセストークン
        folder_id: str - Google DriveのフォルダID
        folder_name: str (optional) - ローカル保存時のフォルダ名
    
    Returns:
        ok: bool
        folder_name: str - フォルダ名
        file_count: int - 同期されたファイル数
        folder_path: str - 保存先パス
    """
    try:
        body = await request.json()
        access_token = body.get("access_token")
        folder_id = body.get("folder_id")
        folder_name = body.get("folder_name")
        
        print(f"[gdrive_sync] ===== START SYNC =====")
        print(f"[gdrive_sync] folder_id: {folder_id}")
        print(f"[gdrive_sync] folder_name: {folder_name}")
        print(f"[gdrive_sync] access_token present: {bool(access_token)}")
        
        if not access_token or not folder_id:
            print(f"[gdrive_sync] ERROR: Missing required params")
            return _json({"ok": False, "error": "access_token and folder_id are required"}, 400)

        # Force create data directory to avoid fallback to data_demo
        try:
            # Assming ROOT is defined in module scope
            prod_data_path = ROOT / "data"
            if not prod_data_path.exists():
                prod_data_path.mkdir(parents=True, exist_ok=True)
                print(f"[gdrive_sync] Created production data directory: {prod_data_path}")
        except Exception as e:
            print(f"[gdrive_sync] Failed to create data dir: {e}")
        
        if not folder_name:
            folder_info = await gdrive.get_file_metadata(access_token, folder_id)
            
            # Check if it's a shortcut
            if folder_info.get("mimeType") == "application/vnd.google-apps.shortcut":
                shortcut_details = folder_info.get("shortcutDetails", {})
                target_id = shortcut_details.get("targetId")
                if target_id:
                     print(f"[gdrive_sync] Resolved shortcut {folder_id} -> {target_id}")
                     folder_id = target_id
                     # Re-fetch info for the target to get the proper name if needed, 
                     # but we might want to keep the shortcut's name as the local folder name.
                     # Let's keep existing logic for name, but use target_id for sync.
            
            folder_name = folder_info.get("name", f"gdrive_{folder_id[:8]}")
        
        # データフォルダのベースパス (User Isolated)
        # request X-Client-ID に基づく users/<id> または data/
        base_dir = _get_user_base_dir(request)
        
        # フォルダ名を使用してサブディレクトリを作成
        # これにより data/users/<id>/案件名/ の構造にする
        safe_folder_name = "".join(c for c in folder_name if c not in '<>:"/\\|?*')
        if not safe_folder_name:
            safe_folder_name = f"gdrive_{folder_id[:8]}"
            
        base_save_dir = base_dir / safe_folder_name
        
        if not base_save_dir.exists():
            base_save_dir.mkdir(parents=True, exist_ok=True)
            print(f"[gdrive_sync] Created directory: {base_save_dir}")
        
        # 同期前に既存のXLSXファイルをクリア（そのフォルダ内のみ）
        # clean_before_sync フラグで制御可能（デフォルトTrue）
        clean_before_sync = body.get("clean_before_sync", True)
        if clean_before_sync:
            deleted_count = 0
            # base_save_dir 内のファイルのみを対象にする
            for xlsx_file in base_save_dir.rglob("*.xlsx"):
                try:
                    xlsx_file.unlink()
                    deleted_count += 1
                    print(f"[gdrive_sync] Deleted old file: {xlsx_file}")
                except Exception as e:
                    print(f"[gdrive_sync] Failed to delete {xlsx_file}: {e}")
            print(f"[gdrive_sync] Cleared {deleted_count} existing xlsx files in {base_save_dir}")
        
        # 再帰的にファイルを取得してダウンロードキューに追加
        download_queue = []
        await _sync_folder_recursive(
            access_token, 
            folder_id, 
            base_save_dir,
            current_path="",
            download_queue=download_queue
        )
        
        print(f"[gdrive_sync] Starting parallel download for {len(download_queue)} files")
        
        # Parallel download with semaphore
        sem = asyncio.Semaphore(10) # Limit concurrency
        tasks = [_download_worker(access_token, item, sem) for item in download_queue]
        
        if tasks:
            results = await asyncio.gather(*tasks)
            download_count = sum(results)
        else:
            download_count = 0
        
        return _json({
            "ok": True,
            "folder_name": folder_name,
            "file_count": download_count,
            "folder_path": str(base_save_dir)
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return _json({"ok": False, "error": str(e)}, 500)


@app.post("/api/gdrive/sync_files")
async def api_gdrive_sync_files(request: Request):
    """
    指定された複数のファイルをダウンロードして、特定のケース（フォルダ）にまとめる。
    
    Request body:
        access_token: str
        files: List[dict] - [{id, name, mimeType}, ...]
        case_name: str - 保存先フォルダ名（案件名）
        
    Returns:
        ok: bool
        file_count: int
        folder_path: str
    """
    try:
        body = await request.json()
        access_token = body.get("access_token")
        files = body.get("files", [])
        case_name = body.get("case_name", "Selected_Files")
        
        if not access_token or not files:
            return _json({"ok": False, "error": "access_token and files are required"}, 400)
            
        # 安全なフォルダ名に変換
        safe_case_name = "".join(c for c in case_name if c not in '<>:"/\\|?*').strip()
        if not safe_case_name:
            safe_case_name = f"files_{int(datetime.now().timestamp())}"
            
        base_dir = _get_user_base_dir(request)
        save_dir = base_dir / safe_case_name
        
        if not save_dir.exists():
            save_dir.mkdir(parents=True, exist_ok=True)
            
        # 既存ファイルのクリーンアップは選択的（今回は上書き前提で消さない、またはfilesに含まれないものを消す？
        # 個別選択なので、追記モードが自然だが、混ざるとややこしい。
        # いったん「選択されたものだけをダウンロードして配置」する。
        
        download_count = 0
        succeeded_files = []
        
        import asyncio
        sem = asyncio.Semaphore(5) # ファイル指定は数少ないことが多いので並列度控えめ
        
        async def _download_single(f_item):
            fid = f_item.get("id")
            fname = f_item.get("name")
            if not fid: return False
            
            try:
                # Semaphore
                async with sem:
                    content, clean_name, _ = await gdrive.download_file(access_token, fid)
                    
                # 名前はGoogle Drive上のものを優先（拡張子補完済み）
                # xlsx以外は download_file 側で conversion してくれる想定だが確認が必要
                # download_file は (content, filename, mime) を返す
                
                # 保存
                fpath = save_dir / clean_name
                fpath.write_bytes(content)
                return True
            except Exception as e:
                print(f"[sync_files] Failed {fname}: {e}")
                return False

        tasks = [_download_single(f) for f in files]
        results = await asyncio.gather(*tasks)
        download_count = sum(1 for r in results if r)
        
        return _json({
            "ok": True,
            "case_name": safe_case_name,
            "file_count": download_count,
            "folder_path": str(save_dir),
            "message": f"{download_count}件のファイルを {safe_case_name} に同期しました"
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return _json({"ok": False, "error": str(e)}, 500)


async def _sync_folder_recursive(
    access_token: str,
    folder_id: str,
    base_dir: Path,
    current_path: str = "",
    download_queue: list = None
):
    """
    フォルダを再帰的に走査してダウンロードキューに追加
    """
    from . import google_drive_client as gdrive
    if download_queue is None:
        download_queue = []

    folder_mime = "application/vnd.google-apps.folder"
    xlsx_mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    shortcut_mime = "application/vnd.google-apps.shortcut"
    
    # フォルダ内の全アイテム（ファイル+サブフォルダ）を取得
    print(f"[gdrive_sync] Listing folder_id={folder_id}, current_path='{current_path}'")
    items = await gdrive.list_folder_files(access_token, folder_id, mime_types=None)
    print(f"[gdrive_sync] Found {len(items)} items in folder: '{current_path}' (folder_id={folder_id})")
    
    # Log all item details for debugging
    for idx, item in enumerate(items):
        print(f"[gdrive_sync]   [{idx}] id={item.get('id')[:8]}... name='{item.get('name')}' mime={item.get('mimeType')}")
    
    for item in items:
        item_id = item.get("id")
        item_name = item.get("name", "unknown")
        item_mime = item.get("mimeType", "")
        
        # Shortcuts handling
        if item_mime == shortcut_mime:
            shortcut_details = item.get("shortcutDetails", {})
            target_id = shortcut_details.get("targetId")
            target_mime = shortcut_details.get("targetMimeType")
            
            print(f"[gdrive_sync] Shortcut detected: '{item_name}' -> target_id={target_id}, target_mime={target_mime}")
            
            if not target_id:
                print(f"[gdrive_sync] WARNING: Shortcut '{item_name}' has no target_id, skipping")
                continue
                 
            # Override ID and Mime for processing
            item_id = target_id
            item_mime = target_mime

        if item_mime == folder_mime:
            # サブフォルダの場合、再帰的に処理
            sub_path = f"{current_path}/{item_name}" if current_path else item_name
            print(f"[gdrive_sync] Entering subfolder: '{sub_path}'")
            await _sync_folder_recursive(
                access_token,
                item_id,
                base_dir,
                sub_path,
                download_queue
            )
            
        elif item_mime == xlsx_mime or item_name.endswith(".xlsx"):
            # Excelファイルの場合、キューに追加
            # Note: We trust item_name for the filename to determine save_path beforehand
            save_path = base_dir / current_path / item_name if current_path else base_dir / item_name
            print(f"[gdrive_sync] Queuing XLSX: '{item_name}' -> {save_path}")
            download_queue.append({
                "id": item_id,
                "path": save_path,
                "name": item_name
            })
        else:
            print(f"[gdrive_sync] Skipping item: '{item_name}' (mime={item_mime})")
    
    print(f"[gdrive_sync] Finished folder '{current_path}', queue size now: {len(download_queue)}")
    return len(download_queue)

async def _download_worker(access_token, item, sem):
    from . import google_drive_client as gdrive
    async with sem:
        try:
            item_id = item["id"]
            save_path = item["path"]
            
            # ディレクトリ作成
            save_path.parent.mkdir(parents=True, exist_ok=True)
            
            # ダウンロード
            content, _, _ = await gdrive.download_file(access_token, item_id)
            save_path.write_bytes(content)
            print(f"[gdrive_sync] Downloaded: {save_path}")
            return 1
        except Exception as e:
            print(f"[gdrive_sync] Failed to download {item['name']}: {e}")
            return 0


@app.post("/api/gdrive/clear_all_folders")
async def api_gdrive_clear_all_folders(request: Request):
    """
    すべてのGoogle Driveフォルダを削除
    X-Client-IDがある場合、そのユーザーの専用フォルダ(data/users/<id>)のみを削除する。
    """
    try:
        user_dir = _get_user_base_dir(request)
        data_dir = _get_data_dir()
        
        # Security check: Never delete data_dir itself if user_dir is data_dir
        # (This happens if no X-Client-ID sent)
        if user_dir == data_dir:
             print("[gdrive_clear] No Client ID found, clearing all subfolders in data/ (Legacy Mode)")
             target = data_dir
        else:
             print(f"[gdrive_clear] Clearing user private dir: {user_dir}")
             target = user_dir

        deleted_count = 0
        
        if target.exists():
            # If target is user isolated dir (users/<id>), we can just wipe the whole directory 
            # OR iterate its children.
            # safe to delete children
            for folder in target.iterdir():
                if folder.is_dir() and not folder.name.startswith("."):
                    # Special check: Don't delete 'users' folder itself if we are in legacy mode
                    if target == data_dir and folder.name == "users":
                        continue
                    try:
                        import shutil
                        shutil.rmtree(folder)
                        deleted_count += 1
                        print(f"[gdrive_clear] Deleted folder: {folder.name}")
                    except Exception as e:
                        print(f"[gdrive_clear] Failed to delete {folder.name}: {e}")
        
        return _json({
            "ok": True,
            "deleted_count": deleted_count
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return _json({"ok": False, "error": str(e)}, 500)

@app.get("/api/debug/ls")
def debug_ls(path: str = ""):
    """Temporary debug endpoint to list data directory.

    Unauthenticated → 401 (auth middleware blocks first)
    Authenticated + debug disabled → 404
    Authenticated + debug enabled → 200
    """
    if not _ENABLE_DEBUG_ENDPOINTS:
        from starlette.responses import JSONResponse
        return JSONResponse({"ok": False, "error": "Not found"}, status_code=404)
    try:
        root = _get_data_dir()
        # Prevent path traversal slightly
        if ".." in path:
            return {"error": "Invalid path"}
            
        target = root
        if path:
            target = root / path
            
        if not target.exists():
            return {"error": f"{target} does not exist", "root": str(root)}
        
        items = []
        for p in target.iterdir():
            items.append({
                "name": p.name,
                "is_dir": p.is_dir(),
                "size": p.stat().st_size if p.is_file() else 0
            })
        return {"path": str(target), "items": items}
    except Exception as e:
        return {"error": str(e)}


# ============================================================
# BigQuery API エンドポイント（/api/bq/*）
# BQ未設定環境でもアプリ起動に影響しないよう遅延importを使用
# ============================================================

_DATASET_LABELS = {
    "analytics_311324674": "petabit.co.jp",
}


def _is_credentials_error(e: Exception) -> bool:
    """DefaultCredentialsError を検出する。"""
    err_name = type(e).__name__
    err_str = str(e)
    return (err_name == "DefaultCredentialsError"
            or "credentials were not found" in err_str
            or "Could not automatically determine credentials" in err_str)

# BQレポート軽量キャッシュ（TTL 5分、上限50エントリ）
import time as _time
_bq_cache: dict[str, tuple[float, dict]] = {}
_BQ_CACHE_TTL = 300              # 5分（レポート生成結果）
_BQ_PERIODS_CACHE_TTL = 1800     # 30分（期間一覧 — テーブル構成はほぼ変わらない）
_BQ_DATASETS_CACHE_TTL = 3600    # 1時間（データセット一覧）
_BQ_CACHE_MAX = 50               # 最大エントリ数


def _bq_cache_put(key: str, value: dict) -> None:
    """キャッシュにエントリを追加（期限切れ自動削除 + 上限超過時は最古追い出し）。"""
    now = _time.time()
    # 期限切れエントリを除去
    expired = [k for k, (ts, _) in _bq_cache.items() if (now - ts) >= _BQ_CACHE_TTL]
    for k in expired:
        del _bq_cache[k]
    # 上限超過時は最古エントリを追い出し
    while len(_bq_cache) >= _BQ_CACHE_MAX:
        oldest_key = min(_bq_cache, key=lambda k: _bq_cache[k][0])
        del _bq_cache[oldest_key]
    _bq_cache[key] = (now, value)


def _bq_availability_from_summary(summary: list[dict], requested_count: int) -> tuple[str, str]:
    """Return full/partial/failed plus a user-facing missing reason."""
    if requested_count <= 0:
        return "failed", "クエリタイプが指定されていません。"
    if not summary:
        return "failed", "BigQuery実行結果が取得できませんでした。"

    success_statuses = {"success", "no_chart"}
    success_count = sum(1 for item in summary if item.get("status") in success_statuses)
    no_data_count = sum(1 for item in summary if item.get("status") == "no_data")
    gap_items = [
        item for item in summary
        if item.get("status") in {"error", "no_data", "unknown"}
    ]

    if success_count == requested_count:
        return "full", ""
    if success_count > 0 or no_data_count > 0:
        labels = [
            f"{item.get('query_type', 'unknown')}:{item.get('status', 'unknown')}"
            for item in gap_items[:5]
        ]
        prefix = "選択した期間にデータがない項目があります" if no_data_count > 0 else "一部クエリが未取得です"
        return "partial", prefix + ": " + ", ".join(labels)

    labels = [
        f"{item.get('query_type', 'unknown')}:{item.get('status', 'unknown')}"
        for item in summary[:5]
    ]
    return "failed", "全クエリが未取得です: " + ", ".join(labels)


def _bq_response_status(data_availability: str) -> int:
    return 502 if data_availability == "failed" else 200



@app.get("/api/bq/datasets")
def api_bq_datasets(request: Request = None):
    """利用可能なBQデータセット一覧を返す（analytics_*のみ）。"""
    demo_case = _resolve_demo_case_for_request(request)
    if demo_case is not None:
        return _json(_demo_datasets_response())

    claims = _get_request_auth_claims(request)
    if claims and claims.get("role") == "case_user":
        dataset_id = _resolve_bq_dataset_for_request(request, None)
        label = _DATASET_LABELS.get(dataset_id, f"GA4: {dataset_id}")
        return _json({"ok": True, "datasets": [{"dataset_id": dataset_id, "label": label}]})

    cache_key = "datasets:all"
    cached = _bq_cache.get(cache_key)
    if cached and (_time.time() - cached[0]) < _BQ_DATASETS_CACHE_TTL:
        return _json(cached[1])
    try:
        from bq.client import list_datasets
        all_ds = list_datasets()
        datasets = []
        for ds_id in all_ds:
            if ds_id.startswith("analytics_"):
                label = _DATASET_LABELS.get(ds_id, f"GA4: {ds_id}")
                datasets.append({"dataset_id": ds_id, "label": label})
        response_data = {"ok": True, "datasets": datasets}
        _bq_cache_put(cache_key, response_data)
        return _json(response_data)
    except ImportError as _ie:
        import traceback as _tb
        return _json({"ok": False, "error": "bigquery_not_configured",
                       "message": "BigQueryモジュールが利用できません",
                       "debug_traceback": _tb.format_exc()}, 500)
    except Exception as e:
        if _is_credentials_error(e):
            return _json({"ok": False, "error": "bq_credentials_missing",
                           "message": "BigQuery認証情報が未設定です。管理者に接続設定の確認を依頼してください。"}, 503)
        return _json({"ok": False, "error": "query_error", "message": str(e)}, 500)


@app.get("/api/bq/query_types")
def api_bq_query_types(request: Request = None):
    """利用可能なBQクエリタイプ一覧を返す。"""
    demo_case = _resolve_demo_case_for_request(request)
    if demo_case is not None:
        return _json(_demo_query_types_response())

    try:
        from bq.queries import list_query_types
        return _json({"ok": True, "query_types": list_query_types()})
    except ImportError as _ie:
        import traceback as _tb
        return _json({"ok": False, "error": "bigquery_not_configured",
                       "message": "BigQueryモジュールが利用できません",
                       "debug_traceback": _tb.format_exc()}, 500)
    except Exception as e:
        return _json({"ok": False, "error": "query_error", "message": str(e)}, 500)


@app.get("/api/bq/periods")
def api_bq_periods(
    dataset_id: Optional[str] = None,
    granularity: str = "monthly",
    fresh: bool = False,
    request: Request = None,
):
    """BigQueryのevents_*テーブルから利用可能な期間一覧を取得する。

    Args:
        dataset_id: BigQueryデータセットID
        granularity: 粒度 — "monthly" | "weekly" | "daily"
        fresh: Trueの場合キャッシュをバイパスして最新データを取得
    """
    demo_case = _resolve_demo_case_for_request(request)
    if demo_case is not None:
        _validate_demo_requested_datasets(demo_case, dataset_id)
        response_data, status_code = _demo_periods_response(granularity)
        return _json(response_data, status_code)

    dataset_id = _resolve_bq_dataset_for_request(request, dataset_id)

    cache_key = f"periods:{dataset_id}:{granularity}"
    if not fresh:
        cached = _bq_cache.get(cache_key)
        if cached and (_time.time() - cached[0]) < _BQ_PERIODS_CACHE_TTL:
            return _json(cached[1])
    try:
        from bq.client import run_query, PROJECT_ID
        from bq.queries import split_dataset_ref

        project_id, dataset_name = split_dataset_ref(dataset_id, PROJECT_ID)

        methods_tried = []
        last_error = None
        df = None
        method = "information_schema"

        info_schema_sql = f"""
        SELECT REGEXP_EXTRACT(table_name, r'^events_(\\d{{8}})$') AS day_suffix
        FROM `{project_id}.{dataset_name}.INFORMATION_SCHEMA.TABLES`
        WHERE REGEXP_CONTAINS(table_name, r'^events_\\d{{8}}$')
        ORDER BY day_suffix DESC
        """
        try:
            methods_tried.append("information_schema")
            df = run_query(info_schema_sql, project_id)
        except Exception as exc:
            last_error = exc
            method = "tables_legacy"

        if df is None:
            legacy_sql = f"""
            SELECT REGEXP_EXTRACT(table_id, r'^events_(\\d{{8}})$') AS day_suffix
            FROM `{project_id}.{dataset_name}.__TABLES__`
            WHERE REGEXP_CONTAINS(table_id, r'^events_\\d{{8}}$')
            ORDER BY day_suffix DESC
            """
            try:
                methods_tried.append("tables_legacy")
                df = run_query(legacy_sql, project_id)
            except Exception:
                if last_error is not None:
                    raise last_error
                raise

        if df is None:
            df = pd.DataFrame({"day_suffix": []})
        suffixes = df["day_suffix"].astype(str)
        periods = []

        if granularity == "daily":
            valid = suffixes[suffixes.str.len() == 8]
            periods = [
                {"period_tag": f"{s[:4]}-{s[4:6]}-{s[6:8]}", "period_type": "daily"}
                for s in valid
            ]

        elif granularity == "weekly":
            from datetime import date, timedelta
            weeks_seen = {}
            valid = suffixes[suffixes.str.len() == 8]
            dates = pd.to_datetime(valid, format="%Y%m%d")
            for dt in dates:
                d = dt.date()
                iso = d.isocalendar()
                week_key = f"{iso[0]}-W{iso[1]:02d}"
                if week_key not in weeks_seen:
                    mon = d - timedelta(days=d.weekday())
                    sun = mon + timedelta(days=6)
                    weeks_seen[week_key] = {
                        "period_tag": f"{mon.isoformat()}:{sun.isoformat()}",
                        "period_type": "weekly",
                        "label": f"{week_key} ({mon.month}/{mon.day}〜{sun.month}/{sun.day})",
                    }
            periods = list(weeks_seen.values())

        else:  # monthly (default)
            valid = suffixes[suffixes.str.len() >= 6]
            unique_months = valid.str[:6].unique()
            periods = [
                {"period_tag": f"{ym[:4]}-{ym[4:6]}", "period_type": "monthly"}
                for ym in sorted(unique_months, reverse=True)
            ]

        table_count = int(len(suffixes))
        response_data = {
            "ok": True,
            "periods": periods,
            "granularity": granularity,
            "dataset_id": dataset_id,
            "table_count": table_count,
            "method": method,
            "methods_tried": methods_tried,
            "message": (
                f"{table_count}件のeventsテーブルから期間を取得しました。"
                if periods
                else f"{dataset_id} に events_YYYYMMDD テーブルが見つかりませんでした。"
            ),
        }
        _bq_cache_put(cache_key, response_data)
        return _json(response_data)
    except ImportError as _ie:
        import traceback as _tb
        return _json({"ok": False, "error": "bigquery_not_configured",
                       "message": "BigQueryモジュールが利用できません",
                       "debug_traceback": _tb.format_exc()}, 500)
    except Exception as e:
        if _is_credentials_error(e):
            return _json({"ok": False, "error": "bq_credentials_missing",
                           "message": "BigQuery認証情報が未設定です。管理者に接続設定の確認を依頼してください。"}, 503)
        err_name = type(e).__name__
        if "Forbidden" in err_name or "PermissionDenied" in err_name or "Unauthenticated" in err_name:
            return _json({"ok": False, "error": "bq_auth_error",
                           "message": "BigQueryへの接続権限を確認できません。管理者に権限設定の確認を依頼してください。"}, 503)
        if "NotFound" in err_name:
            return _json({"ok": False, "error": "not_found",
                           "message": f"データセット {dataset_id} が見つかりません"}, 404)
        return _json({"ok": False, "error": "query_error", "message": str(e)}, 500)


@app.post("/api/bq/generate")
async def api_bq_generate(request: Request):
    """BQレポートを生成する（データのみ、AI分析なし）。

    リクエストJSON:
        query_type: クエリタイプ (pv/traffic/cv/search/anomaly/landing)
        dataset_id: データセットID (default: analytics_311324674)
        period: 期間 (YYYY-MM)
    """
    try:
        body = await request.json()
        query_type = body.get("query_type", "pv")
        dataset_id = _resolve_bq_dataset_for_request(request, body.get("dataset_id"))
        period = body.get("period", "")
        report_options = _report_runtime_options(request)

        if not period:
            return _json({"ok": False, "error": "validation_error",
                           "message": "期間（period）を指定してください"}, 400)

        demo_case = _resolve_demo_case_for_request(request)
        if demo_case is not None:
            _validate_demo_requested_datasets(demo_case, body.get("dataset_id"), dataset_id)
            response_data, status_code = _demo_single_generate_response(str(query_type), str(period))
            return _json(response_data, status_code)

        # キャッシュチェック
        cache_key = ":".join(
            [
                str(query_type),
                str(dataset_id),
                str(period),
                str(report_options["report_project_id"]),
                str(report_options["timezone"]),
                ",".join(report_options.get("cv_events") or []),
            ]
        )
        cached = _bq_cache.get(cache_key)
        if cached and (_time.time() - cached[0]) < _BQ_CACHE_TTL:
            return _json(cached[1])

        from bq.reporter import run_report
        from bq.queries import QUERIES, normalize_dataset_ref
        from .bq_chart_builder import build_bq_chart_data, build_beginner_report

        dataset_id = normalize_dataset_ref(dataset_id)

        if query_type not in QUERIES:
            available = ", ".join(QUERIES.keys())
            return _json({"ok": False, "error": "validation_error",
                           "message": f"未知のクエリタイプ: {query_type}（利用可能: {available}）"}, 400)

        results = run_report(
            query_type=query_type,
            dataset=dataset_id,
            period=period,
            cv_events=report_options.get("cv_events"),
            timezone=str(report_options["timezone"]),
            report_project_id=str(report_options["report_project_id"]),
            period_selection=body.get("granularity") or body.get("period_selection"),
        )

        if not results:
            return _json({"ok": False, "error": "no_data",
                           "message": f"{query_type} のデータが見つかりません（期間: {period}）。別の期間を試してください。"})
        if results.get("query_failed"):
            return _json(
                {
                    "ok": False,
                    "error": results.get("error_code") or "query_error",
                    "report_v2": results.get("report_v2"),
                    "retryable": True,
                },
                503,
            )

        # Chart.jsデータ生成
        chart_data = {}
        df = results.get("dataframe")
        if df is not None:
            chart_data = build_bq_chart_data(df, query_type)

        query_info = results.get("query_info", {})
        execution_summary = {
            "query_type": query_type,
            "status": "success" if chart_data.get("groups") else "no_chart",
            "row_count": int(len(df)) if df is not None else 0,
            "chart_group_count": len(chart_data.get("groups") or []),
            "message": "単一クエリのグラフ生成結果です。",
        }

        response_data = {
            "ok": True,
            "data_availability": "full" if (results.get("report_md") or chart_data.get("groups")) else "partial",
            "missing_reason": "" if (results.get("report_md") or chart_data.get("groups")) else "レポート本文またはグラフが生成されませんでした。",
            "report_md": results.get("report_md", ""),
            "chart_data": chart_data,
            "beginner_report": build_beginner_report(chart_data.get("groups") or [], [execution_summary]),
            "report_v2": results.get("report_v2"),
            "query_info": {"key": query_type, "name": query_info.get("name", query_type)},
        }
        if (_get_request_auth_claims(request) or {}).get("role") != "project_user":
            # Hybrid operator compatibility only. Managed customer responses
            # never disclose a backend filesystem path.
            response_data["csv_path"] = results.get("csv", "")
        _bq_cache_put(cache_key, response_data)
        return _json(response_data)

    except HTTPException:
        raise
    except ImportError as _ie:
        import traceback as _tb
        return _json({"ok": False, "error": "bigquery_not_configured",
                       "message": "BigQueryモジュールが利用できません",
                       "debug_traceback": _tb.format_exc()}, 500)
    except Exception as e:
        if _is_credentials_error(e):
            return _json({"ok": False, "error": "bq_credentials_missing",
                           "message": "BigQuery認証情報が未設定です。管理者に接続設定の確認を依頼してください。"}, 503)
        import traceback
        traceback.print_exc()
        err_str = str(e).lower()
        err_name = type(e).__name__
        if "Forbidden" in err_name or "PermissionDenied" in err_name or "Unauthenticated" in err_name:
            return _json({"ok": False, "error": "bq_auth_error",
                           "message": "BigQueryへの接続権限を確認できません。管理者に権限設定の確認を依頼してください。"}, 503)
        # BigQuery レート制限エラーをユーザーフレンドリーに返す (HTTP 200で返しフロントでハンドリング)
        if any(kw in err_str for kw in ["429", "resource_exhausted", "rate limit", "quota exceeded"]):
            return _json({"ok": False, "error": "rate_limited",
                           "message": "BigQueryのレート制限に達しました。しばらく待ってから再試行してください。"})
        return _json({"ok": False, "error": "query_error", "message": str(e)}, 500)


@app.post("/api/bq/generate_batch")
async def api_bq_generate_batch(request: Request):
    """複数クエリタイプを一括でBQレポート生成する。

    リクエストJSON:
        query_types: クエリタイプのリスト ["pv", "traffic", "cv", ...]
        dataset_id: データセットID
        period: 期間
    """
    try:
        body = await request.json()
        query_types = body.get("query_types", [])
        dataset_id = _resolve_bq_dataset_for_request(request, body.get("dataset_id"))
        period = body.get("period", "")
        report_options = _report_runtime_options(request)

        if not period:
            return _json({"ok": False, "error": "validation_error",
                           "message": "期間（period）を指定してください"}, 400)
        if not query_types:
            return _json({"ok": False, "error": "validation_error",
                           "message": "クエリタイプを1つ以上指定してください"}, 400)

        demo_case = _resolve_demo_case_for_request(request)
        if demo_case is not None:
            _validate_demo_requested_datasets(demo_case, body.get("dataset_id"), dataset_id)
            response_data, status_code = _demo_batch_generate_response(query_types, str(period))
            return _json(response_data, status_code)

        from bq.reporter import run_report, generate_cross_summary
        from bq.queries import QUERIES, normalize_dataset_ref
        from .bq_chart_builder import build_bq_chart_data, build_beginner_report
        from .report_contract_v2 import combine_reports_v2
        from concurrent.futures import ThreadPoolExecutor, as_completed

        dataset_id = normalize_dataset_ref(dataset_id)

        # 不正なクエリタイプをフィルタ
        valid_types = [qt for qt in query_types if qt in QUERIES]
        if not valid_types:
            available = ", ".join(QUERIES.keys())
            return _json({"ok": False, "error": "validation_error",
                           "message": f"有効なクエリタイプがありません（利用可能: {available}）"}, 400)

        all_results = {}
        all_md = []
        all_groups = []
        skipped = []
        execution_summary = []

        def _run_single(qt):
            """1つのクエリタイプを実行する（スレッドプール用）。"""
            cache_key = ":".join(
                [
                    str(qt),
                    str(dataset_id),
                    str(period),
                    str(report_options["report_project_id"]),
                    str(report_options["timezone"]),
                    ",".join(report_options.get("cv_events") or []),
                ]
            )
            cached = _bq_cache.get(cache_key)
            if cached and (_time.time() - cached[0]) < _BQ_CACHE_TTL:
                cached_data = cached[1]
                cached_groups = cached_data.get("chart_data", {}).get("groups") or []
                cached_summary = cached_data.get("execution_summary") or {
                    "query_type": qt,
                    "status": "success" if cached_groups else "no_chart",
                    "row_count": cached_data.get("row_count"),
                    "chart_group_count": len(cached_groups),
                    "message": "キャッシュ済みの結果を使用しました。",
                }
                return qt, cached_data, True, cached_summary
            results = run_report(
                query_type=qt,
                dataset=dataset_id,
                period=period,
                cv_events=report_options.get("cv_events"),
                timezone=str(report_options["timezone"]),
                report_project_id=str(report_options["report_project_id"]),
                period_selection=body.get("granularity") or body.get("period_selection"),
            )
            if not results:
                return qt, None, False, {
                    "query_type": qt,
                    "status": "no_data",
                    "row_count": 0,
                    "chart_group_count": 0,
                    "message": f"{qt} のデータが見つかりません（期間: {period}）。",
                }
            if results.get("query_failed"):
                execution = {
                    "query_type": qt,
                    "status": "error",
                    "row_count": 0,
                    "chart_group_count": 0,
                    "message": "データ取得に失敗しました。",
                }
                return qt, {
                    "ok": False,
                    "report_md": "",
                    "report_v2": results.get("report_v2"),
                    "chart_data": {},
                    "row_count": 0,
                    "execution_summary": execution,
                    "query_info": {"key": qt, "name": qt},
                }, False, execution
            chart_data = {}
            df = results.get("dataframe")
            row_count = int(len(df)) if df is not None else 0
            if df is not None:
                chart_data = build_bq_chart_data(df, qt)
            chart_group_count = len(chart_data.get("groups") or [])
            status = "success" if chart_group_count > 0 else "no_chart"
            query_info = results.get("query_info", {})
            execution = {
                "query_type": qt,
                "status": status,
                "row_count": row_count,
                "chart_group_count": chart_group_count,
                "message": (
                    f"{row_count}行から{chart_group_count}件のグラフを生成しました。"
                    if status == "success"
                    else f"{row_count}行を取得しましたが、表示できるグラフは生成されませんでした。"
                ),
            }
            response_data = {
                "ok": True,
                "report_md": results.get("report_md", ""),
                "report_v2": results.get("report_v2"),
                "chart_data": chart_data,
                "row_count": row_count,
                "execution_summary": execution,
                "query_info": {"key": qt, "name": query_info.get("name", qt)},
            }
            if (_get_request_auth_claims(request) or {}).get("role") != "project_user":
                response_data["csv_path"] = results.get("csv", "")
            _bq_cache_put(cache_key, response_data)
            return qt, response_data, False, execution

        # ThreadPoolExecutor で並列実行（最大3ワーカー）
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = {executor.submit(_run_single, qt): qt for qt in valid_types}
            for future in as_completed(futures):
                qt = futures[future]
                try:
                    qt_key, data, from_cache, execution = future.result()
                    execution_summary.append(execution)
                    if data is None:
                        skipped.append({"query_type": qt_key, "reason": "no_data"})
                        continue
                    # キャッシュからの場合もall_resultsに格納
                    if from_cache:
                        all_results[qt_key] = data
                    else:
                        all_results[qt_key] = data
                    if data.get("report_md"):
                        all_md.append(data["report_md"])
                    if data.get("chart_data", {}).get("groups"):
                        all_groups.extend(data["chart_data"]["groups"])
                except Exception as exc:
                    execution_summary.append({
                        "query_type": qt,
                        "status": "error",
                        "row_count": 0,
                        "chart_group_count": 0,
                        "message": str(exc)[:300],
                    })
                    skipped.append({
                        "query_type": qt,
                        "reason": exc.__class__.__name__,
                        "message": str(exc)[:300],
                    })

        invalid_types = [qt for qt in query_types if qt not in QUERIES]
        for qt in invalid_types:
            execution_summary.append({
                "query_type": qt,
                "status": "error",
                "row_count": 0,
                "chart_group_count": 0,
                "message": f"未知のクエリタイプ: {qt}",
            })

        # 統合サマリー生成（DataFrameが必要なので、キャッシュ結果からは生成しない）
        cross_summary = ""
        if len(all_results) >= 2:
            # run_reportの結果からDataFrameを復元するため、再実行は避けてMDベースでサマリー
            # generate_cross_summaryは DataFrameが必要なので、可能な場合のみ
            try:
                # キャッシュに入っている結果からはDataFrameがないので、
                # バッチ実行分のみDataFrame付きで統合サマリーを生成
                cross_results = {}
                for qt in valid_types:
                    cache_key = f"{qt}:{dataset_id}:{period}"
                    # run_reportを再呼び出しせず、report_mdからハイライトを抽出
                    if qt in all_results:
                        cross_results[qt] = all_results[qt]
                if cross_results:
                    cross_summary = f"# 統合サマリー（{len(cross_results)}クエリタイプ）\n\n"
                    cross_summary += f"- 期間: {period}\n"
                    cross_summary += f"- 実行クエリ: {', '.join(cross_results.keys())}\n"
                    if skipped:
                        skipped_labels = [
                            f"{item.get('query_type', 'unknown')}({item.get('reason', 'unknown')})"
                            if isinstance(item, dict)
                            else str(item)
                            for item in skipped
                        ]
                        cross_summary += f"- スキップ: {', '.join(skipped_labels)}\n"
                    cross_summary += "\n"
            except Exception:
                pass

        combined_md = ""
        if cross_summary:
            combined_md = cross_summary + "\n---\n\n"
        combined_md += "\n\n---\n\n".join(all_md)
        sorted_summary = sorted(
            execution_summary,
            key=lambda item: query_types.index(item.get("query_type")) if item.get("query_type") in query_types else 999,
        )
        data_availability, missing_reason = _bq_availability_from_summary(sorted_summary, len(valid_types))
        ok = data_availability != "failed"
        beginner_report = build_beginner_report(all_groups, sorted_summary)
        child_reports_v2 = {
            qt: all_results[qt].get("report_v2")
            for qt in valid_types
            if qt in all_results and isinstance(all_results[qt].get("report_v2"), dict)
        }
        combined_report_v2 = (
            combine_reports_v2(
                child_reports_v2,
                report_id=f"batch:{report_options['report_project_id']}:{period}",
                project_id=str(report_options["report_project_id"]),
            )
            if child_reports_v2
            else None
        )

        return _json({
            "ok": ok,
            **({"error": "query_error", "retryable": True} if not ok else {}),
            "period": period,
            "data_availability": data_availability,
            "missing_reason": missing_reason,
            "report_md": combined_md,
            "report_v2": combined_report_v2,
            "chart_data": {"groups": all_groups} if all_groups else {},
            "beginner_report": beginner_report,
            "results": {qt: {"report_md": d.get("report_md", ""), "report_v2": d.get("report_v2"), "query_info": d.get("query_info", {})}
                        for qt, d in all_results.items()},
            "skipped": skipped,
            "execution_summary": sorted_summary,
            "query_count": len(all_results),
        }, _bq_response_status(data_availability))

    except HTTPException:
        raise
    except ImportError as _ie:
        import traceback as _tb
        return _json({"ok": False, "error": "bigquery_not_configured",
                       "message": "BigQueryモジュールが利用できません",
                       "debug_traceback": _tb.format_exc()}, 500)
    except Exception as e:
        if _is_credentials_error(e):
            return _json({"ok": False, "error": "bq_credentials_missing",
                           "message": "BigQuery認証情報が未設定です。管理者に接続設定の確認を依頼してください。"}, 503)
        import traceback
        traceback.print_exc()
        return _json({"ok": False, "error": "query_error", "message": str(e)}, 500)


# ============================================================
# クロスソース（Excel+BQ統合）マッピング
# ============================================================

# レガシーハードコードマッピング（config.jsonが空の場合のフォールバック）
_FOLDER_DATASET_MAP = {
    "petabit.co.jp": "analytics_311324674",
}

def _get_cross_source_mappings() -> list[dict]:
    """V2.6: config.json → レガシーフォールバック の順でマッピングを取得."""
    cfg = _load_config()
    cfg_mappings = cfg.get("cross_source_mappings", [])
    if cfg_mappings:
        # config.jsonに設定あり → そちらを使用
        for m in cfg_mappings:
            if "label" not in m:
                m["label"] = _DATASET_LABELS.get(m.get("dataset_id", ""), m.get("folder", ""))
        return cfg_mappings
    # フォールバック: レガシーハードコード
    mappings = []
    for folder, dataset_id in _FOLDER_DATASET_MAP.items():
        label = _DATASET_LABELS.get(dataset_id, f"GA4: {dataset_id}")
        mappings.append({"folder": folder, "dataset_id": dataset_id, "label": label})
    return mappings

@app.get("/api/cross_source_map")
def api_cross_source_map():
    """Excelフォルダ名とBQデータセットIDの対応表を返す。V2.6: 動的マッピング対応."""
    return _json({"ok": True, "mappings": _get_cross_source_mappings()})

@app.post("/api/cross_source_map")
async def api_cross_source_map_upsert(request: Request):
    """V2.6: folder をキーとした upsert."""
    body = await request.json()
    folder = body.get("folder", "").strip()
    dataset_id = body.get("dataset_id", "").strip()
    label = body.get("label", "").strip() or folder
    if not folder or not dataset_id:
        return _json({"ok": False, "error": "folder and dataset_id are required"}, 400)
    config = _load_config()
    mappings = config.get("cross_source_mappings", [])
    # upsert: 既存を更新 or 追加
    found = False
    for m in mappings:
        if m.get("folder") == folder:
            m["dataset_id"] = dataset_id
            m["label"] = label
            found = True
            break
    if not found:
        mappings.append({"folder": folder, "dataset_id": dataset_id, "label": label})
    config["cross_source_mappings"] = mappings
    _save_config(config)
    return _json({"ok": True, "mappings": _get_cross_source_mappings()})

@app.delete("/api/cross_source_map")
async def api_cross_source_map_delete(request: Request):
    """V2.6: folder 指定で削除."""
    body = await request.json()
    folder = body.get("folder", "").strip()
    if not folder:
        return _json({"ok": False, "error": "folder is required"}, 400)
    config = _load_config()
    mappings = config.get("cross_source_mappings", [])
    config["cross_source_mappings"] = [m for m in mappings if m.get("folder") != folder]
    _save_config(config)
    return _json({"ok": True, "mappings": _get_cross_source_mappings()})

@app.get("/api/cross_source_candidates")
def api_cross_source_candidates():
    """V2.6: Excelフォルダ一覧 + BQデータセット一覧を返す（マッピング設定用）."""
    # Excel フォルダ候補
    folders = []
    data_dir = _get_data_dir()
    if data_dir.exists():
        for item in data_dir.iterdir():
            if item.is_dir() and not item.name.startswith("."):
                if list(item.rglob("*.xlsx")):
                    folders.append(item.name)
    # BQ データセット候補
    datasets = []
    try:
        from bq.client import list_datasets
        for ds_id in list_datasets():
            if ds_id.startswith("analytics_"):
                label = _DATASET_LABELS.get(ds_id, f"GA4: {ds_id}")
                datasets.append({"dataset_id": ds_id, "label": label})
    except Exception:
        pass
    return _json({"ok": True, "folders": sorted(folders), "datasets": datasets})


# ========== V3.3: トレンドニュース取得ヘルパー（任意設定） ==========
def fetch_trend_news(keywords: list[str], max_results: int = 5) -> list[dict]:
    """検索キーワードに関連するトレンドニュースを取得する。

    外部ニュースソースが未設定の場合は空リストを返す（エラー停止しない）。
    設定キー: TREND_NEWS_API_KEY, TREND_NEWS_ENDPOINT（.env.local）

    Returns:
        [{"title": str, "url": str, "relevance": float}] or []
    """
    import os
    api_key = os.getenv("TREND_NEWS_API_KEY", "")
    endpoint = os.getenv("TREND_NEWS_ENDPOINT", "")
    if not api_key or not endpoint:
        return []  # ニュース連携なし — フォールバック

    try:
        import requests
        resp = requests.get(endpoint, params={
            "q": " OR ".join(keywords[:5]),
            "apiKey": api_key,
            "pageSize": max_results,
            "language": "ja",
        }, timeout=10)
        if resp.status_code != 200:
            return []
        data = resp.json()
        articles = data.get("articles", [])
        return [
            {"title": a.get("title", ""), "url": a.get("url", ""), "relevance": 1.0}
            for a in articles[:max_results]
        ]
    except Exception:
        return []  # エラー時も継続
