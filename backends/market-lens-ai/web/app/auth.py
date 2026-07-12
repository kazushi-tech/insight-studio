"""Market Lens authentication and verified tenant context.

Production Clerk tokens are verified fully offline with a pinned RS256 public
key and resolved against the platform database.  Advanced Market Lens routes
remain operator-only: a Clerk identity must have the database-backed
``platform_admin`` role.  Explicit integration API keys remain available for
server-to-server callers.  Legacy HS256 administrator JWTs exist only during
an explicit ``ML_AUTH_MODE=hybrid`` compatibility period in production.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass

import jwt
from fastapi import Header, HTTPException, Request, status

from .tenant_auth import (
    INTERNAL_PROJECT_ID,
    INTERNAL_WORKSPACE_ID,
    PLATFORM_ADMIN,
    ClerkJWTVerifier,
    TenantAuthConfigurationError,
    TenantAuthenticationError,
    TenantAuthorizationError,
    TenantContext,
    TenantDatabaseUnavailableError,
    TenantResourceNotFoundError,
    get_current_tenant_context,
    get_identity_resolver,
    set_current_tenant_context,
)


_TRUTHY = {"1", "true", "yes", "on"}
_PRODUCTION_ENVIRONMENTS = {"prod", "production", "staging"}
_COMPROMISED_INTEGRATION_KEYS = frozenset({"test_key_123", "prod_key_456"})


@dataclass(frozen=True)
class AuthPrincipal:
    """Authenticated caller plus its verified tenant ownership context."""

    kind: str
    role: str
    context: TenantContext


def _csv_keys(raw: str) -> set[str]:
    return {
        key
        for item in raw.split(",")
        if (key := item.strip()) and key not in _COMPROMISED_INTEGRATION_KEYS
    }


# Mutable compatibility hook retained for the existing unit suite.  Runtime
# requests also read the environment because dotenv loads after router imports.
API_KEYS: set[str] = set()
for _env_name in ("API_KEYS", "INTEGRATION_API_KEYS"):
    API_KEYS.update(_csv_keys(os.getenv(_env_name, "")))


def _configured_api_keys() -> set[str]:
    keys = set(API_KEYS) - _COMPROMISED_INTEGRATION_KEYS
    for env_name in ("API_KEYS", "INTEGRATION_API_KEYS"):
        keys.update(_csv_keys(os.getenv(env_name, "")))
    return keys


def _is_production() -> bool:
    if str(os.getenv("VERCEL", "")).strip().lower() in _TRUTHY:
        return True
    if str(os.getenv("RENDER", "")).strip().lower() in _TRUTHY:
        return True
    if os.getenv("RENDER_SERVICE_ID") or os.getenv("RENDER_EXTERNAL_URL"):
        return True
    environment = str(
        os.getenv("APP_ENV")
        or os.getenv("ENVIRONMENT")
        or os.getenv("ENV")
        or ""
    ).strip().lower()
    return environment in _PRODUCTION_ENVIRONMENTS


def _auth_mode() -> str:
    configured = (os.getenv("ML_AUTH_MODE") or "").strip().lower()
    if configured:
        return configured
    # Preserve the large local/test suite while making managed deployments
    # Clerk-first unless hybrid mode is explicitly enabled.
    return "clerk" if _is_production() else "hybrid"


def _legacy_hs256_enabled() -> bool:
    return _auth_mode() in {"hybrid", "legacy"}


def _allow_insecure_dev_auth() -> bool:
    if _is_production():
        return False
    raw = os.getenv("ALLOW_INSECURE_DEV_AUTH")
    if raw is None:
        return bool(os.getenv("PYTEST_CURRENT_TEST"))
    return raw.strip().lower() in _TRUTHY


def _bearer_credential(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, separator, value = authorization.partition(" ")
    if separator and scheme.lower() == "bearer":
        return value.strip() or None
    return authorization.strip() or None


def _deny_unauthenticated(*, configured: bool) -> None:
    if not configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Market Lens authentication is not configured.",
        )
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing authentication.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _operator_context(kind: str, owner_id: str) -> TenantContext:
    return TenantContext(
        auth_kind=kind,
        owner_id=owner_id,
        workspace_id=INTERNAL_WORKSPACE_ID,
        project_id=INTERNAL_PROJECT_ID,
        platform_role="operator",
    )


def _attach_request_context(
    request: Request | None,
    principal: AuthPrincipal,
) -> AuthPrincipal:
    context_token = set_current_tenant_context(principal.context)
    if request is not None:
        context = principal.context
        tokens = getattr(request.state, "tenant_context_tokens", None)
        if not isinstance(tokens, list):
            tokens = []
            request.state.tenant_context_tokens = tokens
        tokens.append(context_token)
        request.state.auth_principal = principal
        request.state.tenant_context = context
        request.state.clerk_user = (
            {
                "id": context.app_user_id,
                "clerk_user_id": context.clerk_user_id,
            }
            if context.clerk_user_id
            else None
        )
        request.state.workspace = {
            "id": context.workspace_id,
            "clerk_organization_id": context.clerk_organization_id,
        }
        request.state.project = {"id": context.project_id}
    return principal


def _translate_tenant_error(exc: RuntimeError) -> None:
    if isinstance(exc, (TenantAuthConfigurationError, TenantDatabaseUnavailableError)):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Market Lens identity service is unavailable.",
        ) from exc
    if isinstance(exc, TenantAuthenticationError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing authentication.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    if isinstance(exc, TenantResourceNotFoundError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found.",
        ) from exc
    if isinstance(exc, TenantAuthorizationError):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This identity is not authorized for Market Lens.",
        ) from exc
    raise exc


def _token_algorithm(token: str) -> str | None:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        return None
    algorithm = header.get("alg")
    return str(algorithm) if isinstance(algorithm, str) else None


async def verify_admin_or_integration(
    authorization: str | None = Header(None, alias="Authorization"),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
    x_insight_project: str | None = Header(None, alias="X-Insight-Project"),
    request: Request = None,
) -> AuthPrincipal:
    """Require an operator-equivalent principal and attach verified scope.

    ``X-Insight-User`` is deliberately absent.  It cannot affect ownership in
    Clerk, integration, or legacy-admin paths.
    """

    api_keys = _configured_api_keys()
    jwt_secret = str(os.getenv("JWT_SECRET", "")).strip()
    clerk_configured = all(
        str(os.getenv(name, "")).strip()
        for name in (
            "CLERK_JWT_PUBLIC_KEY",
            "CLERK_ISSUER",
            "CLERK_ALLOWED_AZP",
        )
    )
    legacy_configured = bool(jwt_secret and _legacy_hs256_enabled())
    auth_configured = bool(api_keys or clerk_configured or legacy_configured)
    bearer = _bearer_credential(authorization)
    provided_api_key = (x_api_key or "").strip()

    matched_api_key = None
    if provided_api_key and provided_api_key in api_keys:
        matched_api_key = provided_api_key
    elif bearer and bearer in api_keys:
        matched_api_key = bearer
    if matched_api_key:
        owner_hash = hashlib.sha256(matched_api_key.encode("utf-8")).hexdigest()[:24]
        return _attach_request_context(
            request,
            AuthPrincipal(
                kind="integration",
                role="integration",
                context=_operator_context("integration", f"integration:{owner_hash}"),
            ),
        )

    if bearer:
        algorithm = _token_algorithm(bearer)
        if algorithm == "RS256":
            try:
                clerk_principal = ClerkJWTVerifier.from_env().verify(bearer)
                context = get_identity_resolver().resolve(
                    clerk_principal,
                    requested_project_id=(
                        x_insight_project
                        if isinstance(x_insight_project, str)
                        else None
                    ),
                )
            except RuntimeError as exc:
                _translate_tenant_error(exc)
            if context.platform_role != PLATFORM_ADMIN:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Platform administrator access is required for Market Lens.",
                )
            return _attach_request_context(
                request,
                AuthPrincipal(kind="clerk", role=PLATFORM_ADMIN, context=context),
            )

        if algorithm == "HS256" and legacy_configured:
            try:
                claims = jwt.decode(
                    bearer,
                    jwt_secret,
                    algorithms=["HS256"],
                    options={"require": ["exp"]},
                )
            except jwt.InvalidTokenError:
                _deny_unauthenticated(configured=auth_configured)
            if claims.get("typ") != "auth":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="This token is not authorized for Market Lens.",
                )
            if claims.get("role") != "admin":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Administrator access is required for Market Lens.",
                )
            token_hash = hashlib.sha256(bearer.encode("utf-8")).hexdigest()[:24]
            return _attach_request_context(
                request,
                AuthPrincipal(
                    kind="legacy_hs256",
                    role="admin",
                    context=_operator_context("legacy_hs256", f"legacy:{token_hash}"),
                ),
            )

        _deny_unauthenticated(configured=auth_configured)

    if not auth_configured and _allow_insecure_dev_auth():
        # The legacy owner header is isolated to explicitly insecure local/test
        # mode so old file-repository tests remain meaningful.  Managed deploys
        # can never enter this branch.
        # Preserve the legacy anonymous behavior: no owner header means the
        # result is not listed in history.  This branch cannot run in a
        # managed deployment.
        local_owner = ""
        if request is not None:
            supplied = (request.headers.get("X-Insight-User") or "").strip()
            if supplied:
                local_owner = supplied
        return _attach_request_context(
            request,
            AuthPrincipal(
                kind="insecure_dev",
                role="admin",
                context=_operator_context("insecure_dev", local_owner),
            ),
        )

    _deny_unauthenticated(configured=auth_configured)


async def get_verified_owner_id(request: Request) -> str:
    context = getattr(request.state, "tenant_context", None)
    if context is None:
        try:
            context = get_current_tenant_context()
        except TenantAuthorizationError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Verified tenant context is unavailable.",
            ) from exc
    return context.owner_id


# Backward-compatible dependency names used across the existing routers.
async def verify_token(
    authorization: str | None = Header(None, alias="Authorization"),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
    x_insight_project: str | None = Header(None, alias="X-Insight-Project"),
    request: Request = None,
) -> str:
    principal = await verify_admin_or_integration(
        authorization,
        x_api_key,
        x_insight_project,
        request=request,
    )
    return "dev" if principal.kind == "insecure_dev" else principal.role


async def verify_byok_or_token(
    authorization: str | None = Header(None, alias="Authorization"),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
    x_insight_project: str | None = Header(None, alias="X-Insight-Project"),
    request: Request = None,
) -> str:
    principal = await verify_admin_or_integration(
        authorization,
        x_api_key,
        x_insight_project,
        request=request,
    )
    return "byok" if principal.kind == "insecure_dev" else principal.role


async def verify_auth_optional(
    authorization: str | None = Header(None, alias="Authorization"),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
    x_insight_project: str | None = Header(None, alias="X-Insight-Project"),
    request: Request = None,
) -> str:
    principal = await verify_admin_or_integration(
        authorization,
        x_api_key,
        x_insight_project,
        request=request,
    )
    return "dev" if principal.kind == "insecure_dev" else principal.role
