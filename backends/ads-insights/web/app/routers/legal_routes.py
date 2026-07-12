"""Injectable legal consent and privacy-request routes."""

from __future__ import annotations

from collections.abc import Callable, Iterator

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from ..legal.config import LegalConfig
from ..legal.contracts import (
    DataExportRequest,
    DeletionRequestCreate,
    LegalAcceptanceRequest,
)
from ..legal.errors import LegalConflict, LegalError
from ..legal.export_access import PrivacyExportAccessService
from ..legal.identity import LegalIdentity
from ..legal.operations import PrivacyOpsConfig
from ..legal.service import LegalService
from ..platform_db import PlatformDatabaseUnavailable, platform_session


SessionDependency = Callable[[], Iterator[Session]]
IdentityDependency = Callable[..., LegalIdentity]
ServiceFactory = Callable[..., LegalService]
PrivacyAccessFactory = Callable[..., PrivacyExportAccessService]


def legal_platform_session() -> Iterator[Session]:
    try:
        yield from platform_session()
    except (PlatformDatabaseUnavailable, SQLAlchemyError) as exc:
        raise HTTPException(status_code=503, detail="legal_database_unavailable") from exc


def _missing_identity_dependency() -> LegalIdentity:
    raise HTTPException(status_code=503, detail="legal_identity_dependency_not_configured")


def _idempotency_key(value: str | None) -> str:
    normalized = str(value or "").strip()
    if not 8 <= len(normalized) <= 255:
        raise HTTPException(status_code=400, detail="legal_invalid_idempotency_key")
    return normalized


def _raise_public_error(exc: Exception) -> None:
    if isinstance(exc, LegalError):
        raise HTTPException(status_code=exc.status_code, detail=exc.code) from exc
    if isinstance(exc, IntegrityError):
        raise HTTPException(status_code=409, detail=LegalConflict.code) from exc
    if isinstance(exc, (SQLAlchemyError, PlatformDatabaseUnavailable)):
        raise HTTPException(status_code=503, detail="legal_database_unavailable") from exc
    raise exc


def create_legal_router(
    *,
    session_dependency: SessionDependency | None = None,
    identity_dependency: IdentityDependency | None = None,
    config: LegalConfig | None = None,
    service_factory: ServiceFactory = LegalService,
    privacy_config: PrivacyOpsConfig | None = None,
    privacy_access_factory: PrivacyAccessFactory = PrivacyExportAccessService,
) -> APIRouter:
    router = APIRouter(tags=["legal-privacy"])
    get_session = session_dependency or legal_platform_session
    get_identity = identity_dependency or _missing_identity_dependency

    def service(session: Session) -> LegalService:
        return service_factory(
            session,
            config=config if config is not None else LegalConfig.from_env(),
        )

    def privacy_access(session: Session) -> PrivacyExportAccessService:
        return privacy_access_factory(
            session,
            config=(
                privacy_config
                if privacy_config is not None
                else PrivacyOpsConfig.from_env()
            ),
        )

    @router.get("/api/legal/documents")
    def latest_documents(session: Session = Depends(get_session)) -> dict:
        try:
            return {"ok": True, "documents": service(session).latest_documents()}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.get("/api/legal/acceptance-status")
    def acceptance_status(
        identity: LegalIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict:
        try:
            return {
                "ok": True,
                **service(session).acceptance_status(identity),
            }
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.post("/api/legal/acceptances")
    def accept_document(
        payload: LegalAcceptanceRequest,
        request: Request,
        idempotency_header: str | None = Header(default=None, alias="Idempotency-Key"),
        identity: LegalIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict:
        try:
            result = service(session).accept_document(
                identity,
                document_key=payload.document_key,
                version=payload.version,
                idempotency_key=_idempotency_key(idempotency_header),
                client_ip=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
            return {"ok": True, "acceptance": result}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.post("/api/legal/data-exports")
    def request_data_export(
        payload: DataExportRequest,
        idempotency_header: str | None = Header(default=None, alias="Idempotency-Key"),
        identity: LegalIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict:
        try:
            result = service(session).request_data_export(
                identity,
                scope=payload.scope,
                idempotency_key=_idempotency_key(idempotency_header),
            )
            return {"ok": True, "export": result}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.get("/api/legal/data-exports")
    def list_data_exports(
        identity: LegalIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict:
        try:
            return {
                "ok": True,
                "exports": privacy_access(session).list_exports(identity),
            }
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.get("/api/legal/data-exports/{job_id}")
    def data_export_status(
        job_id: str,
        identity: LegalIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict:
        try:
            return {
                "ok": True,
                "export": privacy_access(session).get_export(
                    identity,
                    job_id=job_id,
                ),
            }
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.get("/api/legal/data-exports/{job_id}/download")
    def download_data_export(
        job_id: str,
        export_format: str = Query(default="json", alias="format", pattern="^(json|csv)$"),
        identity: LegalIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> Response:
        try:
            download = privacy_access(session).download(
                identity,
                job_id=job_id,
                export_format=export_format,
            )
            return Response(
                content=download.content,
                media_type=download.media_type,
                headers={
                    "Content-Disposition": f'attachment; filename="{download.filename}"',
                    "Cache-Control": "private, no-store, max-age=0",
                    "Pragma": "no-cache",
                    "X-Content-Type-Options": "nosniff",
                },
            )
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.get("/api/legal/deletion-requests")
    def list_deletions(
        identity: LegalIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict:
        try:
            return {
                "ok": True,
                "deletion_requests": service(session).list_deletion_requests(identity),
            }
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.post("/api/legal/deletion-requests")
    def request_deletion(
        payload: DeletionRequestCreate,
        idempotency_header: str | None = Header(default=None, alias="Idempotency-Key"),
        identity: LegalIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict:
        try:
            result = service(session).request_deletion(
                identity,
                scope=payload.scope,
                idempotency_key=_idempotency_key(idempotency_header),
            )
            return {"ok": True, "deletion_request": result}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.post("/api/legal/deletion-requests/{request_id}/cancel")
    def cancel_deletion(
        request_id: str,
        idempotency_header: str | None = Header(default=None, alias="Idempotency-Key"),
        identity: LegalIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict:
        try:
            result = service(session).cancel_deletion(
                identity,
                request_id=request_id,
                idempotency_key=_idempotency_key(idempotency_header),
            )
            return {"ok": True, "deletion_request": result}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    return router
