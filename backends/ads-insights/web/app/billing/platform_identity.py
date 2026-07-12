"""Adapter from the Clerk platform context to billing authorization."""

from __future__ import annotations

from collections.abc import Callable
from functools import lru_cache

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..platform.auth import ClerkJWTVerifier, bearer_token
from ..platform.errors import PlatformError
from ..platform.repository import PlatformRepository
from ..platform_db import PlatformDatabaseUnavailable
from .identity import BillingIdentity


@lru_cache(maxsize=1)
def _environment_verifier() -> ClerkJWTVerifier:
    return ClerkJWTVerifier.from_env()


def create_platform_billing_identity_dependency(
    session_dependency: Callable,
    *,
    jwt_verifier: ClerkJWTVerifier | None = None,
) -> Callable:
    """Verify Clerk offline and resolve the workspace from PostgreSQL."""

    def current_billing_identity(
        request: Request,
        authorization: str | None = Header(default=None, alias="Authorization"),
        session: Session = Depends(session_dependency),
    ) -> BillingIdentity:
        try:
            verifier = jwt_verifier or _environment_verifier()
            principal = verifier.verify(bearer_token(authorization))
            context = PlatformRepository(session).get_context(principal)
            request.state.workspace_id = context.workspace_id
            return BillingIdentity.from_access_context(context)
        except PlatformError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.code) from exc
        except (SQLAlchemyError, PlatformDatabaseUnavailable) as exc:
            raise HTTPException(status_code=503, detail="billing_database_unavailable") from exc

    return current_billing_identity
