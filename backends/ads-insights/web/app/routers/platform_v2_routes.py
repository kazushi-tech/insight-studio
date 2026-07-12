"""Clerk-authenticated platform v2 routes.

The router is not imported by ``backend_api.py`` yet.  Its factory accepts
dependencies so tests can use SQLite while production uses ``platform_db``.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator, Mapping
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Request
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from ..platform.auth import ClerkJWTVerifier, ClerkPrincipal, bearer_token
from ..platform.contracts import (
    BootstrapRequest,
    DataSourceUpsert,
    ProjectArchiveRequest,
    ProjectCreate,
    ProjectMemberCreate,
    ProjectMemberPatch,
    ProjectPatch,
)
from ..platform.errors import (
    AuthenticationError,
    PlatformConfigurationError,
    PlatformDatabaseError,
    PlatformError,
)
from ..platform.invitations import (
    ClerkInvitationProvider,
    ClerkRESTInvitationProvider,
)
from ..platform.repository import PlatformRepository
from ..platform.runtime_access import (
    RuntimeAccessError,
    resolve_context_runtime_policy,
)
from ..platform.webhook import ClerkWebhookHeaders, ClerkWebhookVerifier
from ..request_body import read_bounded_body
from ..platform_db import PlatformDatabaseUnavailable, platform_session


DataSourceTester = Callable[[Mapping[str, Any]], Mapping[str, Any]]
SessionDependency = Callable[[], Iterator[Session]]
WriteAccessChecker = Callable[[Session, Any], None]
_PROJECT_MEMBER_REQUEST_BODY = {
    "requestBody": {
        "required": True,
        "content": {
            "application/json": {"schema": ProjectMemberCreate.model_json_schema()}
        },
    }
}


@lru_cache(maxsize=1)
def _environment_jwt_verifier() -> ClerkJWTVerifier:
    return ClerkJWTVerifier.from_env()


@lru_cache(maxsize=1)
def _environment_webhook_verifier() -> ClerkWebhookVerifier:
    return ClerkWebhookVerifier.from_env()


def _platform_session_dependency() -> Iterator[Session]:
    try:
        yield from platform_session()
    except (PlatformDatabaseUnavailable, SQLAlchemyError) as exc:
        raise HTTPException(status_code=503, detail="Platform database is unavailable") from exc


def _raise_public_error(exc: Exception) -> None:
    if isinstance(exc, PlatformError):
        raise HTTPException(status_code=exc.status_code, detail=exc.code) from exc
    if isinstance(exc, IntegrityError):
        raise HTTPException(status_code=409, detail="conflict") from exc
    if isinstance(exc, (SQLAlchemyError, PlatformDatabaseUnavailable, PlatformDatabaseError)):
        raise HTTPException(status_code=503, detail="platform_database_unavailable") from exc
    raise exc


def _idempotency_key(value: str | None) -> str:
    normalized = (value or "").strip()
    if len(normalized) < 8 or len(normalized) > 255:
        raise HTTPException(
            status_code=400,
            detail="Idempotency-Key must contain between 8 and 255 characters",
        )
    return normalized


def require_platform_write_access(session: Session, context: Any) -> None:
    """Apply the canonical legal/full-entitlement policy to platform writes."""
    try:
        policy = resolve_context_runtime_policy(session, context)
    except RuntimeAccessError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.code) from exc
    if policy["entitlement"]["access"] != "full":
        raise HTTPException(status_code=403, detail="subscription_write_forbidden")


def create_platform_v2_router(
    *,
    session_dependency: SessionDependency | None = None,
    jwt_verifier: ClerkJWTVerifier | None = None,
    webhook_verifier: ClerkWebhookVerifier | None = None,
    data_source_tester: DataSourceTester | None = None,
    invitation_provider: ClerkInvitationProvider | None = None,
    project_invite_hash_secret: str | None = None,
    write_access_checker: WriteAccessChecker | None = None,
) -> APIRouter:
    router = APIRouter(tags=["platform-v2"])
    get_session = session_dependency or _platform_session_dependency
    check_write_access = write_access_checker or require_platform_write_access

    def repository(session: Session) -> PlatformRepository:
        return PlatformRepository(
            session,
            project_invite_hash_secret=project_invite_hash_secret,
        )

    def verify_principal(
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> ClerkPrincipal:
        try:
            verifier = jwt_verifier or _environment_jwt_verifier()
            return verifier.verify(bearer_token(authorization))
        except (AuthenticationError, PlatformConfigurationError) as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    def context_repository(
        principal: ClerkPrincipal,
        session: Session,
    ) -> tuple[PlatformRepository, Any]:
        platform_repository = repository(session)
        return platform_repository, platform_repository.get_context(principal)

    def writable_context_repository(
        principal: ClerkPrincipal,
        session: Session,
    ) -> tuple[PlatformRepository, Any]:
        platform_repository, context = context_repository(principal, session)
        check_write_access(session, context)
        return platform_repository, context

    @router.post("/api/auth/bootstrap")
    def bootstrap(
        payload: BootstrapRequest,
        principal: ClerkPrincipal = Depends(verify_principal),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            return {"ok": True, **repository(session).bootstrap(principal, payload)}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.get("/api/auth/me")
    def me(
        principal: ClerkPrincipal = Depends(verify_principal),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            return {"ok": True, **repository(session).get_me(principal)}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.post("/api/webhooks/clerk")
    async def clerk_webhook(
        request: Request,
        svix_id: str | None = Header(default=None, alias="svix-id"),
        svix_timestamp: str | None = Header(default=None, alias="svix-timestamp"),
        svix_signature: str | None = Header(default=None, alias="svix-signature"),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        body = await read_bounded_body(request)
        try:
            verifier = webhook_verifier or _environment_webhook_verifier()
            verifier.verify(
                body,
                ClerkWebhookHeaders(
                    message_id=svix_id or "",
                    timestamp=svix_timestamp or "",
                    signature=svix_signature or "",
                ),
            )
            event = json.loads(body)
            if not isinstance(event, dict):
                raise AuthenticationError("Invalid Clerk webhook body")
            return repository(session).process_clerk_webhook(
                event,
                message_id=svix_id or "",
            )
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise HTTPException(status_code=400, detail="invalid_webhook_body") from exc
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.get("/api/projects")
    def list_projects(
        principal: ClerkPrincipal = Depends(verify_principal),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, context = context_repository(principal, session)
            return {"ok": True, "projects": repository.list_projects(context)}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.post("/api/projects", status_code=201)
    def create_project(
        payload: ProjectCreate,
        idempotency_header: str | None = Header(default=None, alias="Idempotency-Key"),
        principal: ClerkPrincipal = Depends(verify_principal),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, context = writable_context_repository(principal, session)
            project = repository.create_project(
                context,
                payload,
                _idempotency_key(idempotency_header),
            )
            return {"ok": True, "project": project}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.get("/api/projects/{project_id}")
    def get_project(
        project_id: str,
        principal: ClerkPrincipal = Depends(verify_principal),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, context = context_repository(principal, session)
            return {"ok": True, "project": repository.get_project(context, project_id)}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.patch("/api/projects/{project_id}")
    def patch_project(
        project_id: str,
        payload: ProjectPatch,
        principal: ClerkPrincipal = Depends(verify_principal),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, context = writable_context_repository(principal, session)
            return {
                "ok": True,
                "project": repository.update_project(context, project_id, payload),
            }
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.delete("/api/projects/{project_id}")
    def archive_project(
        project_id: str,
        payload: ProjectArchiveRequest = Body(...),
        principal: ClerkPrincipal = Depends(verify_principal),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, context = writable_context_repository(principal, session)
            return {
                "ok": True,
                "project": repository.archive_project(context, project_id, payload.version),
            }
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.get("/api/projects/{project_id}/members")
    def list_members(
        project_id: str,
        principal: ClerkPrincipal = Depends(verify_principal),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, context = context_repository(principal, session)
            return {
                "ok": True,
                "members": repository.list_project_members(context, project_id),
            }
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.post(
        "/api/projects/{project_id}/invite",
        status_code=201,
        openapi_extra=_PROJECT_MEMBER_REQUEST_BODY,
    )
    @router.post(
        "/api/projects/{project_id}/members",
        status_code=201,
        openapi_extra=_PROJECT_MEMBER_REQUEST_BODY,
    )
    async def create_member(
        project_id: str,
        request: Request,
        idempotency_header: str | None = Header(default=None, alias="Idempotency-Key"),
        principal: ClerkPrincipal = Depends(verify_principal),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            raw_body = await request.body()
            if not raw_body or len(raw_body) > 16_384:
                raise HTTPException(status_code=400, detail="invalid_request_body")
            try:
                raw_payload = json.loads(raw_body)
            except (json.JSONDecodeError, UnicodeDecodeError):
                raise HTTPException(
                    status_code=400,
                    detail="invalid_request_body",
                ) from None
            try:
                payload = ProjectMemberCreate.model_validate(raw_payload)
            except PydanticValidationError:
                # FastAPI's default request-validation response includes the
                # rejected input.  Invitation addresses must never be echoed.
                raise HTTPException(status_code=422, detail="validation_error") from None
            repository, context = writable_context_repository(principal, session)
            resolved_invitation_provider = invitation_provider
            if payload.email is not None and resolved_invitation_provider is None:
                resolved_invitation_provider = ClerkRESTInvitationProvider.from_env()
            member = repository.create_project_member(
                context,
                project_id,
                payload,
                _idempotency_key(idempotency_header),
                invitation_provider=resolved_invitation_provider,
            )
            if payload.email is not None and member.get("status") != "active":
                return {"ok": True, "invitation": member}
            return {"ok": True, "member": member}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.patch("/api/projects/{project_id}/members/{app_user_id}")
    def patch_member(
        project_id: str,
        app_user_id: str,
        payload: ProjectMemberPatch,
        principal: ClerkPrincipal = Depends(verify_principal),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, context = writable_context_repository(principal, session)
            return {
                "ok": True,
                "member": repository.update_project_member(
                    context, project_id, app_user_id, payload.role
                ),
            }
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.delete("/api/projects/{project_id}/members/{app_user_id}")
    def delete_member(
        project_id: str,
        app_user_id: str,
        principal: ClerkPrincipal = Depends(verify_principal),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, context = writable_context_repository(principal, session)
            repository.delete_project_member(context, project_id, app_user_id)
            return {"ok": True}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.get("/api/projects/{project_id}/data-source")
    def get_data_source(
        project_id: str,
        source_type: str = Query(default="ga4_bigquery", max_length=32),
        principal: ClerkPrincipal = Depends(verify_principal),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, context = context_repository(principal, session)
            return {
                "ok": True,
                "data_source": repository.get_data_source(
                    context, project_id, source_type
                ),
            }
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.put("/api/projects/{project_id}/data-source")
    def put_data_source(
        project_id: str,
        payload: DataSourceUpsert,
        principal: ClerkPrincipal = Depends(verify_principal),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, context = writable_context_repository(principal, session)
            return {
                "ok": True,
                "data_source": repository.put_data_source(context, project_id, payload),
            }
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.delete("/api/projects/{project_id}/data-source")
    def delete_data_source(
        project_id: str,
        source_type: str = Query(default="ga4_bigquery", max_length=32),
        principal: ClerkPrincipal = Depends(verify_principal),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, context = writable_context_repository(principal, session)
            repository.disable_data_source(context, project_id, source_type)
            return {"ok": True}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.post("/api/projects/{project_id}/data-source/test")
    def test_data_source(
        project_id: str,
        source_type: str = Query(default="ga4_bigquery", max_length=32),
        principal: ClerkPrincipal = Depends(verify_principal),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            if data_source_tester is None:
                raise PlatformConfigurationError("Data source tester is not configured")
            repository, context = writable_context_repository(principal, session)
            data_source = repository.get_data_source_for_test(
                context, project_id, source_type
            )
            raw_result = dict(data_source_tester(data_source))
            connected = bool(raw_result.get("connected"))
            repository.record_data_source_test(
                context,
                str(data_source["id"]),
                connected=connected,
            )
            return {
                "ok": True,
                "connected": connected,
                "status": "active" if connected else "error",
                "checked_at": datetime.now(timezone.utc).isoformat(),
                "latest_data_date": raw_result.get("latest_data_date"),
                "conversion_event_status": raw_result.get("conversion_event_status"),
                "conversion_events": (
                    raw_result.get("conversion_events")
                    if isinstance(raw_result.get("conversion_events"), list)
                    else []
                ),
                "detail": (
                    "接続を確認しました。"
                    if connected
                    else "接続を確認できませんでした。"
                ),
            }
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    return router
