"""Shared authentication for paid-pilot Market Lens endpoints.

Market Lens does not yet persist tenant ownership for scans, reviews, or
creative assets.  Until those ownership claims exist, data-bearing endpoints
must only accept either:

* an Ads administrator JWT signed by the shared ``JWT_SECRET``; or
* a configured integration API key.

Customer ``case_user`` JWTs are intentionally rejected with HTTP 403.  Local
development can opt into the legacy open mode with
``ALLOW_INSECURE_DEV_AUTH=true``.  Render/production always fails closed,
regardless of that switch.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import jwt
from fastapi import Header, HTTPException, status


_TRUTHY = {"1", "true", "yes", "on"}
_PRODUCTION_ENVIRONMENTS = {"prod", "production", "staging"}


@dataclass(frozen=True)
class AuthPrincipal:
    """A deliberately small authenticated principal.

    Raw credentials are never retained, returned, or logged.
    """

    kind: str
    role: str


def _csv_keys(raw: str) -> set[str]:
    return {key.strip() for key in raw.split(",") if key.strip()}


# Kept as a mutable compatibility hook for the existing test suite.  Request
# authentication also reads the environment dynamically, because ``main``
# loads dotenv after importing router modules.
API_KEYS: set[str] = set()
for _env_name in ("API_KEYS", "INTEGRATION_API_KEYS"):
    API_KEYS.update(_csv_keys(os.getenv(_env_name, "")))


def _configured_api_keys() -> set[str]:
    keys = set(API_KEYS)
    for env_name in ("API_KEYS", "INTEGRATION_API_KEYS"):
        keys.update(_csv_keys(os.getenv(env_name, "")))
    return keys


def _is_production() -> bool:
    """Return true for Render and explicit production-like environments."""

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


def _allow_insecure_dev_auth() -> bool:
    """Allow a local-only compatibility bypass when explicitly enabled.

    Pytest receives a compatibility default so the existing isolated unit
    tests keep working.  Normal local development must opt in explicitly.
    Production markers always take precedence and force this off.
    """

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


async def verify_admin_or_integration(
    authorization: str | None = Header(None, alias="Authorization"),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
) -> AuthPrincipal:
    """Require an Ads admin JWT or a configured integration API key.

    No credential value is interpolated into errors or logs.  A valid signed
    non-admin token is an authenticated-but-forbidden request (403), while a
    missing or invalid credential is an authentication failure (401).
    """

    api_keys = _configured_api_keys()
    jwt_secret = str(os.getenv("JWT_SECRET", "")).strip()
    auth_configured = bool(api_keys or jwt_secret)
    bearer = _bearer_credential(authorization)
    provided_api_key = (x_api_key or "").strip()

    if provided_api_key and provided_api_key in api_keys:
        return AuthPrincipal(kind="integration", role="integration")
    if bearer and bearer in api_keys:
        return AuthPrincipal(kind="integration", role="integration")

    if bearer and jwt_secret:
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
        role = claims.get("role")
        if role == "admin":
            return AuthPrincipal(kind="ads_jwt", role="admin")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access is required for Market Lens.",
        )

    if not auth_configured and _allow_insecure_dev_auth():
        return AuthPrincipal(kind="insecure_dev", role="admin")

    _deny_unauthenticated(configured=auth_configured)


# Backward-compatible dependency names used by existing routers.  They are no
# longer optional/BYOK bypasses: every call now enforces the paid-pilot gate.
async def verify_token(
    authorization: str | None = Header(None, alias="Authorization"),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
) -> str:
    principal = await verify_admin_or_integration(authorization, x_api_key)
    return "dev" if principal.kind == "insecure_dev" else principal.role


async def verify_byok_or_token(
    authorization: str | None = Header(None, alias="Authorization"),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
) -> str:
    principal = await verify_admin_or_integration(authorization, x_api_key)
    return "byok" if principal.kind == "insecure_dev" else principal.role


async def verify_auth_optional(
    authorization: str | None = Header(None, alias="Authorization"),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
) -> str:
    principal = await verify_admin_or_integration(authorization, x_api_key)
    return "dev" if principal.kind == "insecure_dev" else principal.role
