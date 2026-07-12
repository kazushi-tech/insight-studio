"""Offline Clerk verification and database-backed Market Lens tenant identity.

This module has no network discovery path.  Clerk session JWTs are verified
only with the configured local RSA public key, then mapped to the platform
tables created by Alembic 008.  The database is the sole RBAC source after
bootstrap; token role claims never grant Market Lens access.
"""

from __future__ import annotations

import os
from contextvars import ContextVar, Token
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Mapping

import jwt
import sqlalchemy as sa
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .tenant_schema import (
    app_users,
    project_memberships,
    projects,
    workspace_memberships,
    workspaces,
)


INTERNAL_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001"
INTERNAL_PROJECT_ID = "00000000-0000-0000-0000-000000000002"
PLATFORM_ADMIN = "platform_admin"

_TRUTHY = {"1", "true", "yes", "on"}
_PRODUCTION_ENVIRONMENTS = {"prod", "production", "staging"}
_POSTGRES_BACKENDS = {"postgresql", "postgres"}
_REQUIRED_TLS_MODES = {"require", "verify-ca", "verify-full"}

_REQUIRED_CLERK_CLAIMS = ("exp", "nbf", "iss", "azp", "sub", "org_id")
_WORKSPACE_MANAGER_ROLES = {"workspace_owner", "workspace_admin"}
_PROJECT_ROLES = {"project_editor", "project_viewer"}


class TenantAuthConfigurationError(RuntimeError):
    """Required local authentication configuration is missing or invalid."""


class TenantAuthenticationError(RuntimeError):
    """The supplied credential cannot be authenticated."""


class TenantAuthorizationError(RuntimeError):
    """The authenticated principal has no access to the selected scope."""


class TenantResourceNotFoundError(RuntimeError):
    """A requested resource is outside the active tenant scope or absent."""


class TenantDatabaseUnavailableError(RuntimeError):
    """The platform database cannot provide identity or ownership truth."""


@dataclass(frozen=True)
class ClerkPrincipal:
    clerk_user_id: str
    clerk_organization_id: str
    issuer: str
    authorized_party: str
    claims: Mapping[str, Any]


@dataclass(frozen=True)
class TenantContext:
    """Verified workspace/project scope attached to one request."""

    auth_kind: str
    owner_id: str
    workspace_id: str
    project_id: str
    app_user_id: str | None = None
    clerk_user_id: str | None = None
    clerk_organization_id: str | None = None
    platform_role: str | None = None
    workspace_role: str | None = None
    project_role: str | None = None

    @property
    def is_platform_admin(self) -> bool:
        return self.platform_role == PLATFORM_ADMIN


_tenant_context: ContextVar[TenantContext | None] = ContextVar(
    "market_lens_tenant_context",
    default=None,
)


def set_current_tenant_context(context: TenantContext) -> Token:
    return _tenant_context.set(context)


def reset_current_tenant_context(token: Token) -> None:
    _tenant_context.reset(token)


def clear_current_tenant_context() -> None:
    _tenant_context.set(None)


def get_current_tenant_context() -> TenantContext:
    context = _tenant_context.get()
    if context is None:
        raise TenantAuthorizationError("Verified tenant context is required")
    return context


class ClerkJWTVerifier:
    """Verify Clerk session tokens using a pinned local RS256 public key."""

    def __init__(
        self,
        *,
        public_key_pem: str,
        issuer: str,
        allowed_authorized_parties: set[str],
        leeway_seconds: int = 5,
    ) -> None:
        normalized_key = (public_key_pem or "").strip().replace("\\n", "\n")
        normalized_issuer = (issuer or "").strip().rstrip("/")
        normalized_parties = {
            value.strip().rstrip("/")
            for value in allowed_authorized_parties
            if value and value.strip()
        }
        if not normalized_key or not normalized_issuer or not normalized_parties:
            raise TenantAuthConfigurationError(
                "Clerk public key, issuer, and allowed azp values are required"
            )
        try:
            loaded_key = serialization.load_pem_public_key(
                normalized_key.encode("utf-8")
            )
        except (TypeError, ValueError) as exc:
            raise TenantAuthConfigurationError(
                "CLERK_JWT_PUBLIC_KEY is not valid PEM"
            ) from exc
        if not isinstance(loaded_key, RSAPublicKey):
            raise TenantAuthConfigurationError(
                "CLERK_JWT_PUBLIC_KEY must be an RSA public key"
            )

        self._public_key_pem = normalized_key
        self._issuer = normalized_issuer
        self._allowed_authorized_parties = frozenset(normalized_parties)
        self._leeway_seconds = max(0, int(leeway_seconds))

    @classmethod
    def from_env(cls) -> "ClerkJWTVerifier":
        parties = {
            value.strip()
            for value in (os.getenv("CLERK_ALLOWED_AZP") or "").split(",")
            if value.strip()
        }
        try:
            leeway = int(os.getenv("CLERK_JWT_LEEWAY_SECONDS", "5"))
        except ValueError as exc:
            raise TenantAuthConfigurationError(
                "CLERK_JWT_LEEWAY_SECONDS must be an integer"
            ) from exc
        return cls(
            public_key_pem=os.getenv("CLERK_JWT_PUBLIC_KEY", ""),
            issuer=os.getenv("CLERK_ISSUER", ""),
            allowed_authorized_parties=parties,
            leeway_seconds=leeway,
        )

    def verify(self, token: str) -> ClerkPrincipal:
        if not token or not token.strip():
            raise TenantAuthenticationError("Missing Clerk session token")
        try:
            claims = jwt.decode(
                token.strip(),
                self._public_key_pem,
                algorithms=["RS256"],
                issuer=self._issuer,
                leeway=self._leeway_seconds,
                options={
                    "require": list(_REQUIRED_CLERK_CLAIMS),
                    "verify_signature": True,
                    "verify_exp": True,
                    "verify_nbf": True,
                    "verify_iss": True,
                    "verify_aud": False,
                },
            )
        except jwt.PyJWTError as exc:
            raise TenantAuthenticationError("Invalid Clerk session token") from exc

        authorized_party = claims.get("azp")
        subject = claims.get("sub")
        organization_id = claims.get("org_id")
        issuer = str(claims.get("iss") or "").rstrip("/")
        if not isinstance(authorized_party, str) or (
            authorized_party.rstrip("/") not in self._allowed_authorized_parties
        ):
            raise TenantAuthenticationError("Clerk token azp is not allowed")
        if not isinstance(subject, str) or not subject.strip():
            raise TenantAuthenticationError("Clerk token sub is invalid")
        if not isinstance(organization_id, str) or not organization_id.strip():
            raise TenantAuthenticationError("Clerk token org_id is invalid")
        if issuer != self._issuer:
            raise TenantAuthenticationError("Clerk token issuer is invalid")

        return ClerkPrincipal(
            clerk_user_id=subject.strip(),
            clerk_organization_id=organization_id.strip(),
            issuer=issuer,
            authorized_party=authorized_party.rstrip("/"),
            claims=claims,
        )


class PlatformIdentityResolver:
    """Resolve Clerk identities against the platform database RBAC tables."""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def resolve(
        self,
        principal: ClerkPrincipal,
        *,
        requested_project_id: str | None = None,
    ) -> TenantContext:
        try:
            with self._session_factory() as session:
                return self._resolve_in_session(
                    session,
                    principal,
                    requested_project_id=(requested_project_id or "").strip() or None,
                )
        except (
            TenantAuthorizationError,
            TenantResourceNotFoundError,
        ):
            raise
        except SQLAlchemyError as exc:
            raise TenantDatabaseUnavailableError(
                "Platform identity database is unavailable"
            ) from exc

    @staticmethod
    def _resolve_in_session(
        session: Session,
        principal: ClerkPrincipal,
        requested_project_id: str | None,
    ) -> TenantContext:
        user = session.execute(
            sa.select(app_users).where(
                app_users.c.clerk_user_id == principal.clerk_user_id
            )
        ).mappings().first()
        workspace = session.execute(
            sa.select(workspaces).where(
                workspaces.c.clerk_organization_id
                == principal.clerk_organization_id
            )
        ).mappings().first()
        if user is None or workspace is None:
            raise TenantAuthorizationError(
                "Clerk identity is not provisioned for this organization"
            )
        if user["status"] != "active" or workspace["status"] != "active":
            raise TenantAuthorizationError("Platform identity is inactive")

        workspace_role = session.execute(
            sa.select(workspace_memberships.c.role).where(
                workspace_memberships.c.workspace_id == workspace["id"],
                workspace_memberships.c.app_user_id == user["id"],
            )
        ).scalar_one_or_none()
        project_role_rows = session.execute(
            sa.select(
                project_memberships.c.project_id,
                project_memberships.c.role,
            ).where(
                project_memberships.c.workspace_id == workspace["id"],
                project_memberships.c.app_user_id == user["id"],
            )
        ).all()
        project_roles = {
            str(row.project_id): str(row.role) for row in project_role_rows
        }
        platform_role = user["platform_role"]
        if (
            platform_role != PLATFORM_ADMIN
            and workspace_role not in _WORKSPACE_MANAGER_ROLES
            and not set(project_roles.values()).intersection(_PROJECT_ROLES)
        ):
            raise TenantAuthorizationError(
                "User has no role in the active Clerk organization"
            )

        project_query = sa.select(projects).where(
            projects.c.workspace_id == workspace["id"],
            projects.c.status == "active",
        )
        if requested_project_id:
            project_query = project_query.where(projects.c.id == requested_project_id)
        project_rows = session.execute(
            project_query.order_by(projects.c.created_at, projects.c.id)
        ).mappings().all()
        if requested_project_id and not project_rows:
            raise TenantResourceNotFoundError("Project not found")

        if platform_role != PLATFORM_ADMIN and workspace_role not in _WORKSPACE_MANAGER_ROLES:
            project_rows = [
                row for row in project_rows if str(row["id"]) in project_roles
            ]
        if not project_rows:
            raise TenantAuthorizationError("No active project is available")
        if len(project_rows) > 1 and not requested_project_id:
            raise TenantAuthorizationError(
                "X-Insight-Project is required when multiple projects are available"
            )

        project = project_rows[0]
        project_id = str(project["id"])
        app_user_id = str(user["id"])
        return TenantContext(
            auth_kind="clerk",
            owner_id=f"clerk:{app_user_id}",
            workspace_id=str(workspace["id"]),
            project_id=project_id,
            app_user_id=app_user_id,
            clerk_user_id=principal.clerk_user_id,
            clerk_organization_id=principal.clerk_organization_id,
            platform_role=str(platform_role) if platform_role else None,
            workspace_role=str(workspace_role) if workspace_role else None,
            project_role=project_roles.get(project_id),
        )


def _database_url() -> str:
    url = (os.getenv("DATABASE_URL") or "").strip()
    if not url:
        raise TenantAuthConfigurationError(
            "DATABASE_URL is required for Clerk tenant identity"
        )
    return url


def is_managed_runtime() -> bool:
    """Return whether persistence must satisfy the production DB policy."""

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


def _database_tls_mode(url: str) -> str:
    parsed = make_url(url)
    query_mode = parsed.query.get("sslmode")
    if isinstance(query_mode, tuple):
        query_mode = query_mode[-1] if query_mode else ""
    return str(os.getenv("DATABASE_SSLMODE") or query_mode or "require").strip().lower()


def validate_managed_database_url(
    url: str,
    *,
    managed_runtime: bool | None = None,
) -> str:
    """Validate and return the SSL mode used by the engine.

    SQLite remains available to explicit local/tests only.  In a managed
    runtime, validation happens before driver loading or connection attempts,
    so an unsafe URL cannot be hidden behind a cached engine or readiness
    fallback.
    """

    managed = is_managed_runtime() if managed_runtime is None else managed_runtime
    try:
        parsed = make_url(url)
    except (SQLAlchemyError, TypeError, ValueError) as exc:
        raise TenantAuthConfigurationError("DATABASE_URL is invalid") from exc
    backend = parsed.get_backend_name().lower()
    tls_mode = _database_tls_mode(url)
    if managed and backend not in _POSTGRES_BACKENDS:
        raise TenantAuthConfigurationError(
            "Managed Market Lens requires PostgreSQL"
        )
    if managed and tls_mode not in _REQUIRED_TLS_MODES:
        raise TenantAuthConfigurationError(
            "Managed Market Lens requires PostgreSQL TLS"
        )
    return tls_mode


def validate_managed_session_factory(factory: sessionmaker[Session]) -> None:
    """Reject externally supplied unsafe engines in managed runtimes."""

    if not is_managed_runtime():
        return
    engine = factory.kw.get("bind")
    if not isinstance(engine, Engine):
        raise TenantAuthConfigurationError(
            "Managed Market Lens requires a bound PostgreSQL session factory"
        )
    if engine.dialect.name.lower() not in _POSTGRES_BACKENDS:
        raise TenantAuthConfigurationError(
            "Managed Market Lens requires PostgreSQL"
        )
    tls_marker = bool(getattr(engine, "_insight_studio_tls_required", False))
    # URL text alone is insufficient for an externally built engine because
    # ``connect_args`` can silently override ``sslmode``.  Only engines built
    # by the validated factory above carry this marker; managed repositories
    # therefore cannot accept a caller-supplied engine with weaker transport.
    if not tls_marker:
        raise TenantAuthConfigurationError(
            "Managed Market Lens requires PostgreSQL TLS"
        )


@lru_cache(maxsize=16)
def _session_factory_for_url(
    url: str,
    managed_runtime: bool | None = None,
) -> sessionmaker[Session]:
    managed = is_managed_runtime() if managed_runtime is None else managed_runtime
    tls_mode = validate_managed_database_url(url, managed_runtime=managed)
    parsed = make_url(url)
    backend = parsed.get_backend_name().lower()
    connect_args: dict[str, Any] = {}
    engine_options: dict[str, Any] = {"pool_pre_ping": True}
    if backend == "sqlite":
        connect_args["check_same_thread"] = False
        if url in {"sqlite://", "sqlite:///:memory:"}:
            # Isolated tests run Starlette work in helper threads.  One shared
            # in-memory connection keeps the migration-owned tables visible to
            # every thread; managed runtimes reject SQLite in the stores that
            # consume these sessions.
            engine_options["poolclass"] = StaticPool
    elif backend in _POSTGRES_BACKENDS:
        connect_args.update(
            sslmode=tls_mode,
            connect_timeout=int(os.getenv("DATABASE_CONNECT_TIMEOUT_SECONDS", "5")),
        )
        engine_options.update(
            pool_size=int(os.getenv("DATABASE_POOL_SIZE", "3")),
            max_overflow=int(os.getenv("DATABASE_MAX_OVERFLOW", "2")),
            pool_timeout=int(os.getenv("DATABASE_POOL_TIMEOUT_SECONDS", "5")),
            pool_recycle=int(os.getenv("DATABASE_POOL_RECYCLE_SECONDS", "300")),
        )
    try:
        engine = sa.create_engine(
            url,
            connect_args=connect_args,
            **engine_options,
        )
    except (ImportError, SQLAlchemyError, ValueError) as exc:
        raise TenantDatabaseUnavailableError(
            "Platform identity database is unavailable"
        ) from exc
    if managed:
        setattr(engine, "_insight_studio_tls_required", True)
    return sessionmaker(bind=engine, expire_on_commit=False)


def get_managed_session_factory() -> sessionmaker[Session]:
    managed = is_managed_runtime()
    url = _database_url()
    # Validate on every call before the cache lookup.  This prevents a local
    # SQLite factory cached earlier in the process from being reused after a
    # managed runtime flag is enabled.
    validate_managed_database_url(url, managed_runtime=managed)
    factory = _session_factory_for_url(url, managed)
    validate_managed_session_factory(factory)
    return factory


def get_identity_resolver() -> PlatformIdentityResolver:
    return PlatformIdentityResolver(get_managed_session_factory())
