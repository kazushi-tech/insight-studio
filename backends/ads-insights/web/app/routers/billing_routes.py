"""Injectable Hosted Checkout, Portal, entitlement, and webhook routes."""

from __future__ import annotations

from collections.abc import Callable, Iterator

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from ..billing.config import BillingConfig
from ..billing.contracts import CheckoutRequest, PortalRequest
from ..billing.errors import BillingError, BillingConflict
from ..billing.identity import BillingIdentity
from ..billing.provider import BillingProvider, StripeBillingProvider
from ..billing.service import BillingService
from ..request_body import read_bounded_body
from ..platform_db import PlatformDatabaseUnavailable, platform_session


SessionDependency = Callable[[], Iterator[Session]]
IdentityDependency = Callable[..., BillingIdentity]
ServiceFactory = Callable[..., BillingService]


def billing_platform_session() -> Iterator[Session]:
    try:
        yield from platform_session()
    except (PlatformDatabaseUnavailable, SQLAlchemyError) as exc:
        raise HTTPException(status_code=503, detail="billing_database_unavailable") from exc


def _missing_identity_dependency() -> BillingIdentity:
    raise HTTPException(status_code=503, detail="billing_identity_dependency_not_configured")


def _idempotency_key(value: str | None) -> str:
    normalized = str(value or "").strip()
    if not 8 <= len(normalized) <= 255:
        raise HTTPException(status_code=400, detail="billing_invalid_idempotency_key")
    return normalized


def _raise_public_error(exc: Exception) -> None:
    if isinstance(exc, BillingError):
        raise HTTPException(status_code=exc.status_code, detail=exc.code) from exc
    if isinstance(exc, IntegrityError):
        raise HTTPException(status_code=409, detail=BillingConflict.code) from exc
    if isinstance(exc, (SQLAlchemyError, PlatformDatabaseUnavailable)):
        raise HTTPException(status_code=503, detail="billing_database_unavailable") from exc
    raise exc


def create_billing_router(
    *,
    session_dependency: SessionDependency | None = None,
    identity_dependency: IdentityDependency | None = None,
    provider: BillingProvider | None = None,
    config: BillingConfig | None = None,
    service_factory: ServiceFactory = BillingService,
) -> APIRouter:
    """Create a router without coupling billing to the host auth provider."""
    router = APIRouter(tags=["billing"])
    get_session = session_dependency or billing_platform_session
    get_identity = identity_dependency or _missing_identity_dependency
    resolved_provider = provider or StripeBillingProvider.from_env()

    def service(session: Session) -> BillingService:
        return service_factory(
            session,
            provider=resolved_provider,
            config=config or BillingConfig.from_env(),
        )

    @router.post("/api/billing/checkout", include_in_schema=False)
    @router.post("/api/billing/checkout-sessions")
    def create_checkout(
        payload: CheckoutRequest,
        idempotency_header: str | None = Header(default=None, alias="Idempotency-Key"),
        identity: BillingIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict:
        try:
            return {
                "ok": True,
                **service(session).create_checkout(
                    identity,
                    plan_key=payload.plan_key,
                    idempotency_key=_idempotency_key(idempotency_header),
                ),
            }
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.post("/api/billing/portal", include_in_schema=False)
    @router.post("/api/billing/portal-sessions")
    def create_portal(
        _payload: PortalRequest,
        idempotency_header: str | None = Header(default=None, alias="Idempotency-Key"),
        identity: BillingIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict:
        try:
            return {
                "ok": True,
                **service(session).create_portal(
                    identity,
                    idempotency_key=_idempotency_key(idempotency_header),
                ),
            }
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.get("/api/billing/entitlement", include_in_schema=False)
    @router.get("/api/billing/subscription")
    def get_entitlement(
        identity: BillingIdentity = Depends(get_identity),
        session: Session = Depends(get_session),
    ) -> dict:
        try:
            entitlement = service(session).entitlement(identity)
            return {
                "ok": True,
                "subscription": entitlement,
                # Hybrid compatibility for pre-commercial clients.
                "entitlement": entitlement,
            }
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    @router.post("/api/billing/webhooks/stripe")
    async def stripe_webhook(
        request: Request,
        stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
        session: Session = Depends(get_session),
    ) -> dict:
        try:
            raw_body = await read_bounded_body(request)
            result = service(session).process_webhook(raw_body, str(stripe_signature or ""))
            return {"ok": True, **result}
        except Exception as exc:
            _raise_public_error(exc)
            raise AssertionError("unreachable")

    return router
