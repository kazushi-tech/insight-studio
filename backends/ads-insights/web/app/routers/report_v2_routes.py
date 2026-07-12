"""Injectable FastAPI router for DB-backed report history and sharing.

The host application must supply its authenticated identity dependency.  The
public share route deliberately has no identity dependency and resolves only a
SHA-256 token hash stored in the database.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterator
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from ..platform_db import PlatformDatabaseUnavailable, platform_session
from ..reporting.contracts import (
    ReportCreateRequest,
    ReportImportRequest,
    ReportQuestionRequest,
    ReportShareRequest,
)
from ..reporting.csv_export import report_numeric_evidence_csv
from ..reporting.errors import ReportConflict, ReportServiceError
from ..reporting.identity import ReportIdentity, default_permission_check
from ..reporting.repository import ReportRepository
from ..reporting.questions import answer_report_question


SessionDependency = Callable[[], Iterator[Session]]
IdentityDependency = Callable[..., ReportIdentity]
PermissionChecker = Callable[[ReportIdentity, str, str], None]
RepositoryFactory = Callable[[Session], ReportRepository]

_PUBLIC_SHARE_HEADERS = {
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
}


def report_platform_session() -> Iterator[Session]:
    """Public shared session dependency for the router and identity adapter."""
    try:
        yield from platform_session()
    except (PlatformDatabaseUnavailable, SQLAlchemyError) as exc:
        raise HTTPException(status_code=503, detail="report_database_unavailable") from exc


def _missing_identity_dependency() -> ReportIdentity:
    raise HTTPException(status_code=503, detail="report_identity_dependency_not_configured")


def _idempotency_key(value: str | None) -> str:
    normalized = str(value or "").strip()
    if not 8 <= len(normalized) <= 255:
        raise HTTPException(
            status_code=400,
            detail="Idempotency-Key is required and must contain 8 to 255 characters",
        )
    return normalized


def _request_id(request: Request) -> str | None:
    value = getattr(request.state, "request_id", None) or request.headers.get("x-request-id")
    return str(value)[:100] if value else None


def _request_hash(value: str | None) -> str | None:
    if not value:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _raise_public_error(exc: Exception) -> None:
    if isinstance(exc, ReportServiceError):
        raise HTTPException(status_code=exc.status_code, detail=exc.code) from exc
    if isinstance(exc, IntegrityError):
        raise HTTPException(status_code=409, detail=ReportConflict.code) from exc
    if isinstance(exc, (SQLAlchemyError, PlatformDatabaseUnavailable)):
        raise HTTPException(status_code=503, detail="report_database_unavailable") from exc
    raise exc


def create_report_v2_router(
    *,
    session_dependency: SessionDependency | None = None,
    identity_dependency: IdentityDependency | None = None,
    permission_checker: PermissionChecker = default_permission_check,
    repository_factory: RepositoryFactory = ReportRepository,
) -> APIRouter:
    """Create the router without binding it to a particular auth provider."""
    router = APIRouter(tags=["report-v2"])
    get_session = session_dependency or report_platform_session
    get_identity = identity_dependency or _missing_identity_dependency

    def scoped_project(
        session: Session,
        identity: ReportIdentity,
        project_ref: str,
        action: str,
    ) -> tuple[ReportRepository, str]:
        repository = repository_factory(session)
        project = repository.resolve_project(identity.workspace_id, project_ref)
        project_id = str(project["id"])
        permission_checker(identity, project_id, action)
        return repository, project_id

    @router.get("/api/projects/{project_ref}/reports")
    def list_reports(
        project_ref: str,
        identity: ReportIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, project_id = scoped_project(session, identity, project_ref, "read")
            return {
                "ok": True,
                "project_id": project_id,
                "reports": repository.list_reports(identity.workspace_id, project_id),
            }
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.post("/api/projects/{project_ref}/reports", status_code=201)
    def create_report(
        project_ref: str,
        payload: ReportCreateRequest,
        request: Request,
        idempotency_header: str | None = Header(default=None, alias="Idempotency-Key"),
        identity: ReportIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, project_id = scoped_project(session, identity, project_ref, "create")
            report, created = repository.create_report(
                workspace_id=identity.workspace_id,
                project_id=project_id,
                actor_user_id=identity.user_id,
                client_entry_id=payload.client_entry_id,
                idempotency_key=_idempotency_key(idempotency_header),
                report=payload.report,
                title=payload.title,
                summary=payload.summary,
                messages=[item.model_dump() for item in payload.messages],
                request_id=_request_id(request),
            )
            return {"ok": True, "created": created, "report": report}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.post("/api/projects/{project_ref}/reports/import", status_code=201)
    def import_report(
        project_ref: str,
        payload: ReportImportRequest,
        request: Request,
        idempotency_header: str | None = Header(default=None, alias="Idempotency-Key"),
        identity: ReportIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, project_id = scoped_project(session, identity, project_ref, "import")
            report, created = repository.import_report(
                workspace_id=identity.workspace_id,
                project_id=project_id,
                actor_user_id=identity.user_id,
                client_entry_id=payload.client_entry_id,
                idempotency_key=_idempotency_key(idempotency_header),
                source_schema=payload.source_schema,
                report=payload.report,
                title=payload.title,
                summary=payload.summary,
                messages=[item.model_dump() for item in payload.messages],
                request_id=_request_id(request),
            )
            return {"ok": True, "created": created, "report": report}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.get("/api/projects/{project_ref}/reports/{report_id}")
    def get_report(
        project_ref: str,
        report_id: str,
        identity: ReportIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, project_id = scoped_project(session, identity, project_ref, "read")
            return {
                "ok": True,
                "report": repository.get_report(identity.workspace_id, project_id, report_id),
            }
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.post("/api/projects/{project_ref}/reports/{report_id}/questions")
    def ask_report_question(
        project_ref: str,
        report_id: str,
        payload: ReportQuestionRequest,
        identity: ReportIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        """Answer only from the stored report and return structured citations."""
        try:
            repository, project_id = scoped_project(session, identity, project_ref, "question")
            stored = repository.get_report(identity.workspace_id, project_id, report_id)
            return {
                "ok": True,
                "answer": answer_report_question(stored["report"], payload.question),
            }
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.delete("/api/projects/{project_ref}/reports/{report_id}")
    def delete_report(
        project_ref: str,
        report_id: str,
        request: Request,
        identity: ReportIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, project_id = scoped_project(session, identity, project_ref, "delete")
            repository.soft_delete_report(
                identity.workspace_id,
                project_id,
                report_id,
                actor_user_id=identity.user_id,
                request_id=_request_id(request),
            )
            return {"ok": True, "status": "deleted"}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.post("/api/projects/{project_ref}/reports/{report_id}/shares", status_code=201)
    def create_share(
        project_ref: str,
        report_id: str,
        payload: ReportShareRequest,
        request: Request,
        response: Response,
        identity: ReportIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, project_id = scoped_project(session, identity, project_ref, "share")
            share = repository.create_share(
                identity.workspace_id,
                project_id,
                report_id,
                actor_user_id=identity.user_id,
                expires_in_days=payload.expires_in_days,
                request_id=_request_id(request),
            )
            response.headers["Cache-Control"] = "no-store"
            return {"ok": True, "share": share}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.delete("/api/projects/{project_ref}/reports/{report_id}/shares/{share_id}")
    def revoke_share(
        project_ref: str,
        report_id: str,
        share_id: str,
        request: Request,
        identity: ReportIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict[str, Any]:
        try:
            repository, project_id = scoped_project(
                session,
                identity,
                project_ref,
                "revoke_share",
            )
            repository.revoke_share(
                identity.workspace_id,
                project_id,
                report_id,
                share_id,
                actor_user_id=identity.user_id,
                request_id=_request_id(request),
            )
            return {"ok": True, "status": "revoked"}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.get("/api/projects/{project_ref}/reports/{report_id}/export.csv")
    def export_report_csv(
        project_ref: str,
        report_id: str,
        identity: ReportIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> PlainTextResponse:
        try:
            repository, project_id = scoped_project(session, identity, project_ref, "export")
            report = repository.get_report(identity.workspace_id, project_id, report_id)
            csv_text = report_numeric_evidence_csv(report["report"])
            return PlainTextResponse(
                csv_text,
                media_type="text/csv; charset=utf-8",
                headers={
                    "Content-Disposition": f'attachment; filename="report-{report_id}.csv"',
                    "Cache-Control": "no-store",
                },
            )
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.get("/api/report-shares/{token}")
    def get_public_share(
        token: str,
        request: Request,
        session: Session = Depends(get_session),
    ) -> JSONResponse:
        try:
            repository = repository_factory(session)
            client_host = request.client.host if request.client else None
            payload = repository.access_share(
                token,
                request_id=_request_id(request),
                ip_hash=_request_hash(client_host),
                user_agent_hash=_request_hash(request.headers.get("user-agent")),
            )
            return JSONResponse(
                {"ok": True, "share": payload},
                headers=_PUBLIC_SHARE_HEADERS,
            )
        except ReportServiceError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail=exc.code,
                headers=_PUBLIC_SHARE_HEADERS,
            ) from exc
        except (SQLAlchemyError, PlatformDatabaseUnavailable) as exc:
            raise HTTPException(
                status_code=503,
                detail="report_database_unavailable",
                headers=_PUBLIC_SHARE_HEADERS,
            ) from exc
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    return router
