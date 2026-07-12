"""Adapter from the existing Clerk platform context to ``ReportIdentity``."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from functools import lru_cache

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..platform.auth import ClerkJWTVerifier, bearer_token
from ..platform.errors import PlatformError
from ..platform.repository import PlatformRepository
from ..platform.runtime_access import (
    RuntimeAccessError,
    resolve_context_runtime_policy,
)
from ..platform_db import PlatformDatabaseUnavailable
from .identity import ReportIdentity


@lru_cache(maxsize=1)
def _environment_verifier() -> ClerkJWTVerifier:
    return ClerkJWTVerifier.from_env()


def create_platform_report_identity_dependency(
    session_dependency: Callable,
    *,
    jwt_verifier: ClerkJWTVerifier | None = None,
) -> Callable:
    """Create a FastAPI dependency sharing the router's DB session."""

    def current_report_identity(
        request: Request,
        authorization: str | None = Header(default=None, alias="Authorization"),
        session: Session = Depends(session_dependency),
    ) -> ReportIdentity:
        try:
            verifier = jwt_verifier or _environment_verifier()
            principal = verifier.verify(bearer_token(authorization))
            context = PlatformRepository(session).get_context(principal)
            request.state.workspace_id = context.workspace_id
            policy = resolve_context_runtime_policy(session, context)
            identity = ReportIdentity.from_access_context(context)
            return replace(
                identity,
                legal_accepted=bool(policy["legal_accepted"]),
                entitlement_access=str(policy["entitlement"]["access"]),
            )
        except RuntimeAccessError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.code) from exc
        except PlatformError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.code) from exc
        except (SQLAlchemyError, PlatformDatabaseUnavailable) as exc:
            raise HTTPException(status_code=503, detail="report_database_unavailable") from exc

    return current_report_identity
