"""Clerk-to-project bridge for the hybrid GA4 reporting routes.

The legacy BQ endpoints remain available during migration, but a Clerk caller
never supplies its dataset scope. This module verifies the short-lived token
offline, resolves workspace/project RBAC in PostgreSQL, requires current legal
acceptance and a writable entitlement, then returns only the server-owned
dataset reference to request middleware.
"""

from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Mapping

import sqlalchemy as sa
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..billing.config import BillingConfig
from ..billing.entitlements import decide_entitlement
from ..legal.config import LegalConfig
from ..legal.errors import LegalError
from ..legal.identity import LegalIdentity
from ..legal.service import LegalService
from ..platform.schema import project_data_sources, subscriptions
from ..platform_db import PlatformDatabaseUnavailable, get_platform_engine
from ..report_periods import validate_timezone
from .auth import AuthenticationError, ClerkJWTVerifier, PlatformConfigurationError
from .errors import PlatformError
from .repository import PlatformRepository


class RuntimeAccessError(RuntimeError):
    def __init__(self, code: str, status_code: int) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


@lru_cache(maxsize=1)
def _verifier() -> ClerkJWTVerifier:
    return ClerkJWTVerifier.from_env()


def resolve_context_runtime_policy(session: Session, context: Any) -> dict[str, Any]:
    """Return the single legal/billing policy used by all customer runtimes."""
    if context.platform_role == "platform_admin":
        return {
            "legal_accepted": True,
            "entitlement": {
                "access": "full",
                "status": "platform_admin",
                "plan_key": None,
                "transition_at": None,
            },
        }
    try:
        LegalService(session, config=LegalConfig.from_env()).require_current_acceptance(
            LegalIdentity.from_access_context(context)
        )
    except LegalError as exc:
        raise RuntimeAccessError("legal_acceptance_required", 403) from exc
    subscription = session.execute(
        sa.select(subscriptions)
        .where(subscriptions.c.workspace_id == context.workspace_id)
        .order_by(subscriptions.c.updated_at.desc(), subscriptions.c.created_at.desc())
        .limit(1)
    ).mappings().first()
    return {
        "legal_accepted": True,
        "entitlement": decide_entitlement(
            subscription,
            now=datetime.now(timezone.utc),
            config=BillingConfig.from_env(),
        ),
    }


def resolve_clerk_project_runtime_access(token: str, project_id: str) -> dict[str, Any]:
    try:
        principal = _verifier().verify(token)
    except (AuthenticationError, PlatformConfigurationError) as exc:
        raise RuntimeAccessError("authentication_required", 401) from exc
    normalized_project_id = str(project_id or "").strip()
    if not normalized_project_id:
        raise RuntimeAccessError("project_scope_required", 400)

    try:
        with Session(get_platform_engine()) as session:
            repository = PlatformRepository(session)
            context = repository.get_context(principal)
            repository.get_project(context, normalized_project_id)
            project_role = context.role_for_project(normalized_project_id)
            if not context.can_manage_workspace and project_role != "project_editor":
                raise RuntimeAccessError("project_write_forbidden", 403)

            policy = resolve_context_runtime_policy(session, context)
            if policy["entitlement"]["access"] != "full":
                raise RuntimeAccessError("subscription_write_forbidden", 403)

            source = session.execute(
                sa.select(project_data_sources).where(
                    project_data_sources.c.workspace_id == context.workspace_id,
                    project_data_sources.c.project_id == normalized_project_id,
                    project_data_sources.c.source_type == "ga4_bigquery",
                    project_data_sources.c.status == "active",
                )
            ).mappings().first()
            if source is None:
                raise RuntimeAccessError("data_source_not_ready", 409)
            gcp_project_id = str(source.get("gcp_project_id") or "").strip()
            dataset_id = str(source.get("dataset_id") or "").strip()
            if not gcp_project_id or not dataset_id:
                raise RuntimeAccessError("data_source_not_ready", 409)
            safe_config = source.get("safe_config")
            safe_config = dict(safe_config) if isinstance(safe_config, Mapping) else {}
            raw_cv_events = safe_config.get("conversion_events")
            if isinstance(raw_cv_events, str):
                cv_events = [
                    item.strip()
                    for item in raw_cv_events.split(",")
                    if item.strip()
                ]
            elif isinstance(raw_cv_events, (list, tuple)):
                cv_events = [
                    str(item).strip()
                    for item in raw_cv_events
                    if str(item).strip()
                ]
            else:
                cv_events = []
            report_timezone = str(safe_config.get("timezone") or "Asia/Tokyo").strip()
            try:
                validate_timezone(report_timezone)
            except ValueError as exc:
                raise RuntimeAccessError("data_source_not_ready", 409) from exc
            return {
                "role": "project_user",
                "workspace_id": context.workspace_id,
                "project_id": normalized_project_id,
                "user_id": context.app_user_id,
                "dataset_id": f"{gcp_project_id}.{dataset_id}",
                "cv_events": cv_events,
                "timezone": report_timezone,
            }
    except RuntimeAccessError:
        raise
    except PlatformError as exc:
        raise RuntimeAccessError("project_access_forbidden", exc.status_code) from exc
    except (PlatformDatabaseUnavailable, SQLAlchemyError) as exc:
        raise RuntimeAccessError("platform_database_unavailable", 503) from exc
