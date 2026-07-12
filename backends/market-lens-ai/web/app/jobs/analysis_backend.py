"""Durable common analysis-job backend for Wave 4.

PostgreSQL workers claim rows with ``FOR UPDATE SKIP LOCKED``.  A lease is
represented by ``status=running`` plus ``heartbeat_at``; no process-local task
is considered authoritative in worker mode.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Iterator, Mapping

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from ..tenant_auth import TenantContext, get_current_tenant_context
from ..tenant_schema import (
    ai_usage_ledger,
    analysis_job_artifacts,
    analysis_jobs,
    analysis_worker_heartbeats,
)


LEASE_SECONDS = 60
HEARTBEAT_SECONDS = 20
MAX_ATTEMPTS = 3
WORKER_CONCURRENCY = 2
WORKER_HEARTBEAT_RETENTION_DAYS = 7

_TRUTHY = {"1", "true", "yes", "on"}
_PRODUCTION_ENVIRONMENTS = {"prod", "production", "staging"}
_ARTIFACT_NAMESPACE = uuid.UUID("3b6ee81e-7069-4f59-aad0-94d915689e3f")
_SECRET_KEYS = {
    "api_key",
    "search_api_key",
    "authorization",
    "token",
    "secret",
    "credential",
    "password",
}


class AnalysisJobType(str, Enum):
    scan = "scan"
    compare = "compare"
    discovery = "discovery"
    creative_review = "creative_review"


class AnalysisJobStatus(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    canceled = "canceled"


class JobBackendMode(str, Enum):
    inline = "inline"
    worker = "worker"
    workflow = "workflow"


class JobBackendConfigurationError(RuntimeError):
    pass


@dataclass(frozen=True)
class JobBackendSettings:
    mode: JobBackendMode
    lease_seconds: int = LEASE_SECONDS
    heartbeat_seconds: int = HEARTBEAT_SECONDS
    max_attempts: int = MAX_ATTEMPTS
    concurrency: int = WORKER_CONCURRENCY
    workflow_endpoint: str | None = None
    workflow_token: str | None = None

    @classmethod
    def from_env(cls) -> "JobBackendSettings":
        raw_mode = (os.getenv("MARKET_LENS_JOB_BACKEND") or "").strip().lower()
        production = _is_production()
        if not raw_mode:
            if "pytest" in sys.modules:
                raw_mode = JobBackendMode.inline.value
            else:
                raise JobBackendConfigurationError(
                    "MARKET_LENS_JOB_BACKEND must be explicitly configured"
                )
        try:
            mode = JobBackendMode(raw_mode)
        except ValueError as exc:
            raise JobBackendConfigurationError(
                f"Unsupported MARKET_LENS_JOB_BACKEND: {raw_mode}"
            ) from exc
        if production and mode == JobBackendMode.inline:
            raise JobBackendConfigurationError(
                "Inline analysis jobs are forbidden in production"
            )

        worker_enabled = _env_truthy("MARKET_LENS_WORKER_ENABLED")
        workflow_enabled = _env_truthy("MARKET_LENS_WORKFLOW_ENABLED")
        if worker_enabled and workflow_enabled:
            raise JobBackendConfigurationError(
                "Worker and Workflow cannot be enabled simultaneously"
            )
        if worker_enabled and mode != JobBackendMode.worker:
            raise JobBackendConfigurationError(
                "Worker flag conflicts with the selected job backend"
            )
        if workflow_enabled and mode != JobBackendMode.workflow:
            raise JobBackendConfigurationError(
                "Workflow flag conflicts with the selected job backend"
            )

        endpoint = (os.getenv("MARKET_LENS_WORKFLOW_ENDPOINT") or "").strip() or None
        token = (os.getenv("MARKET_LENS_WORKFLOW_TOKEN") or "").strip() or None
        if mode == JobBackendMode.workflow and (not endpoint or not token):
            raise JobBackendConfigurationError(
                "Workflow backend requires endpoint and token"
            )
        settings = cls(
            mode=mode,
            workflow_endpoint=endpoint,
            workflow_token=token,
        )
        if settings.heartbeat_seconds >= settings.lease_seconds:
            raise JobBackendConfigurationError(
                "Worker heartbeat must be shorter than the lease"
            )
        return settings


@dataclass(frozen=True)
class AnalysisJob:
    id: str
    workspace_id: str
    project_id: str
    created_by_user_id: str | None
    owner_id: str
    job_type: AnalysisJobType
    status: AnalysisJobStatus
    stage: str
    progress_pct: int
    payload: Mapping[str, Any]
    attempts: int
    heartbeat_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    result: Mapping[str, Any] | None
    error: Mapping[str, Any] | None
    lease_owner: str | None = None


def _is_production() -> bool:
    if _env_truthy("VERCEL") or _env_truthy("RENDER"):
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


def _env_truthy(name: str) -> bool:
    return str(os.getenv(name, "")).strip().lower() in _TRUTHY


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _canonical_hash(value: Mapping[str, Any]) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _contains_secret(value: Any) -> bool:
    if isinstance(value, Mapping):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in _SECRET_KEYS or _contains_secret(child):
                return True
    elif isinstance(value, list):
        return any(_contains_secret(item) for item in value)
    return False


def _validated_worker_id(value: str) -> str:
    worker_id = str(value or "").strip()
    allowed_punctuation = {"-", "_", ".", ":"}
    if (
        not worker_id
        or len(worker_id) > 100
        or any(
            not (character.isascii() and character.isalnum())
            and character not in allowed_punctuation
            for character in worker_id
        )
    ):
        raise ValueError("Worker id must be a safe opaque identifier")
    return worker_id


def _validated_job_evidence_id(value: str) -> str:
    job_id = str(value or "").strip()
    allowed_punctuation = {"-", "_", ".", ":"}
    if (
        not job_id
        or len(job_id) > 36
        or any(
            not (character.isascii() and character.isalnum())
            and character not in allowed_punctuation
            for character in job_id
        )
    ):
        raise ValueError("Job evidence id must be a safe opaque identifier")
    return job_id


def _safe_deployment_sha(value: str | None = None) -> str | None:
    raw = str(
        value
        or os.getenv("VERCEL_GIT_COMMIT_SHA")
        or os.getenv("RENDER_GIT_COMMIT")
        or ""
    ).strip().lower()
    if 7 <= len(raw) <= 64 and all(character in "0123456789abcdef" for character in raw):
        return raw
    return None


def _aware_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _iso_utc(value: datetime | None) -> str | None:
    aware = _aware_utc(value)
    return aware.isoformat().replace("+00:00", "Z") if aware else None


class InlineAnalysisJobBackend:
    mode = JobBackendMode.inline


class PostgresAnalysisJobBackend:
    """Tenant-aware enqueue/poll API plus unscoped worker claim API."""

    mode = JobBackendMode.worker

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        *,
        settings: JobBackendSettings | None = None,
    ) -> None:
        self._session_factory = session_factory
        self.settings = settings or JobBackendSettings(mode=JobBackendMode.worker)

    @contextmanager
    def _session(self) -> Iterator[Session]:
        try:
            with self._session_factory() as session:
                yield session
        except HTTPException:
            raise
        except IntegrityError:
            # Callers use uniqueness constraints for idempotent replay.  Keep
            # that signal intact instead of turning it into a generic outage.
            raise
        except SQLAlchemyError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Analysis job database is unavailable.",
            ) from exc

    def enqueue(
        self,
        job_type: AnalysisJobType | str,
        payload: Mapping[str, Any],
        *,
        idempotency_key: str | None = None,
        context: TenantContext | None = None,
    ) -> AnalysisJob:
        context = context or get_current_tenant_context()
        job_type = AnalysisJobType(job_type)
        clean_payload = dict(payload)
        if _contains_secret(clean_payload):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Worker job payload cannot contain credentials.",
            )
        key = (idempotency_key or "").strip() or None
        if key and len(key) > 255:
            raise HTTPException(status_code=422, detail="Idempotency-Key is too long")
        request_hash = _canonical_hash(
            {"job_type": job_type.value, "payload": clean_payload}
        )
        if key:
            replay = self._find_idempotent(context.workspace_id, key)
            if replay is not None:
                if (
                    replay.job_type != job_type
                    or replay.project_id != context.project_id
                    or _request_hash(replay) != request_hash
                ):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Idempotency-Key was already used with another request.",
                    )
                return replay

        job_id = _new_id()
        now = _now()
        request_json = {
            "payload": clean_payload,
            "owner_id": context.owner_id,
            "request_hash": request_hash,
            "lease_owner": None,
        }
        try:
            with self._session() as session, session.begin():
                session.execute(
                    sa.insert(analysis_jobs).values(
                        id=job_id,
                        workspace_id=context.workspace_id,
                        project_id=context.project_id,
                        created_by_user_id=context.app_user_id,
                        job_type=job_type.value,
                        status=AnalysisJobStatus.queued.value,
                        stage="queued",
                        progress_pct=0,
                        idempotency_key=key,
                        request_json=request_json,
                        attempts=0,
                        created_at=now,
                        updated_at=now,
                    )
                )
        except IntegrityError as exc:
            if key:
                replay = self._find_idempotent(context.workspace_id, key)
                if replay is not None and _request_hash(replay) == request_hash:
                    return replay
            raise HTTPException(status_code=409, detail="Analysis job already exists") from exc
        job = self.get(job_id, context=context)
        assert job is not None
        return job

    def _find_idempotent(self, workspace_id: str, key: str) -> AnalysisJob | None:
        with self._session() as session:
            row = session.execute(
                sa.select(analysis_jobs).where(
                    analysis_jobs.c.workspace_id == workspace_id,
                    analysis_jobs.c.idempotency_key == key,
                )
            ).mappings().first()
        return _job_from_row(row) if row else None

    def get(
        self,
        job_id: str,
        *,
        context: TenantContext | None = None,
    ) -> AnalysisJob | None:
        context = context or get_current_tenant_context()
        with self._session() as session:
            row = session.execute(
                sa.select(analysis_jobs).where(
                    analysis_jobs.c.id == job_id,
                    analysis_jobs.c.workspace_id == context.workspace_id,
                    analysis_jobs.c.project_id == context.project_id,
                    analysis_jobs.c.job_type.in_([item.value for item in AnalysisJobType]),
                )
            ).mappings().first()
        return _job_from_row(row) if row else None

    def cancel(
        self,
        job_id: str,
        *,
        context: TenantContext | None = None,
    ) -> AnalysisJob | None:
        context = context or get_current_tenant_context()
        now = _now()
        with self._session() as session, session.begin():
            row = session.execute(
                sa.select(analysis_jobs)
                .where(
                    analysis_jobs.c.id == job_id,
                    analysis_jobs.c.workspace_id == context.workspace_id,
                    analysis_jobs.c.project_id == context.project_id,
                    analysis_jobs.c.job_type.in_([item.value for item in AnalysisJobType]),
                )
                .with_for_update()
            ).mappings().first()
            if row is None:
                return None
            if row["status"] in {
                AnalysisJobStatus.queued.value,
                AnalysisJobStatus.running.value,
            }:
                session.execute(
                    sa.update(analysis_jobs)
                    .where(analysis_jobs.c.id == job_id)
                    .values(
                        status=AnalysisJobStatus.canceled.value,
                        stage="canceled",
                        completed_at=now,
                        updated_at=now,
                    )
                )
        return self.get(job_id, context=context)

    def claim_statement(self, now: datetime | None = None):
        now = now or _now()
        lease_cutoff = now - timedelta(seconds=self.settings.lease_seconds)
        claimable = sa.or_(
            sa.and_(
                analysis_jobs.c.status == AnalysisJobStatus.queued.value,
                analysis_jobs.c.attempts < self.settings.max_attempts,
            ),
            sa.and_(
                analysis_jobs.c.status == AnalysisJobStatus.running.value,
                analysis_jobs.c.heartbeat_at < lease_cutoff,
                analysis_jobs.c.attempts < self.settings.max_attempts,
            ),
        )
        return (
            sa.select(analysis_jobs)
            .where(
                analysis_jobs.c.job_type.in_([item.value for item in AnalysisJobType]),
                claimable,
            )
            .order_by(analysis_jobs.c.created_at, analysis_jobs.c.id)
            .limit(1)
            .with_for_update(skip_locked=True)
        )

    def claim_next(self, worker_id: str) -> AnalysisJob | None:
        if not worker_id.strip():
            raise ValueError("worker_id is required")
        now = _now()
        lease_cutoff = now - timedelta(seconds=self.settings.lease_seconds)
        with self._session() as session, session.begin():
            session.execute(
                sa.update(analysis_jobs)
                .where(
                    analysis_jobs.c.job_type.in_([item.value for item in AnalysisJobType]),
                    analysis_jobs.c.status == AnalysisJobStatus.running.value,
                    analysis_jobs.c.heartbeat_at < lease_cutoff,
                    analysis_jobs.c.attempts >= self.settings.max_attempts,
                )
                .values(
                    status=AnalysisJobStatus.failed.value,
                    stage="failed",
                    error_json={"code": "lease_exhausted", "retryable": False},
                    completed_at=now,
                    updated_at=now,
                )
            )
            row = session.execute(self.claim_statement(now)).mappings().first()
            if row is None:
                return None
            request_json = dict(row["request_json"] or {})
            request_json["lease_owner"] = worker_id
            attempts = int(row["attempts"] or 0) + 1
            session.execute(
                sa.update(analysis_jobs)
                .where(analysis_jobs.c.id == row["id"])
                .values(
                    status=AnalysisJobStatus.running.value,
                    stage="claimed",
                    attempts=attempts,
                    heartbeat_at=now,
                    started_at=row["started_at"] or now,
                    request_json=request_json,
                    updated_at=now,
                )
            )
            claimed = dict(row)
            claimed.update(
                status=AnalysisJobStatus.running.value,
                stage="claimed",
                attempts=attempts,
                heartbeat_at=now,
                started_at=row["started_at"] or now,
                request_json=request_json,
                updated_at=now,
            )
        return _job_from_row(claimed)

    def heartbeat(
        self,
        job_id: str,
        worker_id: str,
        *,
        stage: str | None = None,
        progress_pct: int | None = None,
    ) -> bool:
        values: dict[str, Any] = {"heartbeat_at": _now(), "updated_at": _now()}
        if stage is not None:
            values["stage"] = stage[:64]
        if progress_pct is not None:
            values["progress_pct"] = max(0, min(100, int(progress_pct)))
        with self._session() as session, session.begin():
            row = session.execute(
                sa.select(analysis_jobs)
                .where(
                    analysis_jobs.c.id == job_id,
                    analysis_jobs.c.status == AnalysisJobStatus.running.value,
                )
                .with_for_update()
            ).mappings().first()
            if row is None or _lease_owner(row) != worker_id:
                return False
            session.execute(
                sa.update(analysis_jobs)
                .where(analysis_jobs.c.id == job_id)
                .values(**values)
            )
            return True

    def register_worker(
        self,
        worker_id: str,
        *,
        deployment_sha: str | None = None,
    ) -> None:
        """Register one opaque worker process without storing hostnames or secrets."""

        safe_worker_id = _validated_worker_id(worker_id)
        now = _now()
        expires_at = now + timedelta(seconds=self.settings.lease_seconds)
        retention_cutoff = now - timedelta(days=WORKER_HEARTBEAT_RETENTION_DAYS)
        with self._session() as session, session.begin():
            session.execute(
                sa.delete(analysis_worker_heartbeats).where(
                    analysis_worker_heartbeats.c.updated_at < retention_cutoff,
                    sa.or_(
                        analysis_worker_heartbeats.c.state == "stopped",
                        analysis_worker_heartbeats.c.expires_at < retention_cutoff,
                    ),
                )
            )
            existing = session.execute(
                sa.select(analysis_worker_heartbeats.c.worker_id)
                .where(analysis_worker_heartbeats.c.worker_id == safe_worker_id)
                .with_for_update()
            ).scalar_one_or_none()
            values = {
                "state": "starting",
                "active_jobs": 0,
                "processed_jobs": 0,
                "last_job_id": None,
                "last_job_status": None,
                "last_job_completed_at": None,
                "deployment_sha": _safe_deployment_sha(deployment_sha),
                "started_at": now,
                "heartbeat_at": now,
                "expires_at": expires_at,
                "stopped_at": None,
                "updated_at": now,
            }
            if existing is None:
                session.execute(
                    sa.insert(analysis_worker_heartbeats).values(
                        worker_id=safe_worker_id,
                        **values,
                    )
                )
            else:
                session.execute(
                    sa.update(analysis_worker_heartbeats)
                    .where(analysis_worker_heartbeats.c.worker_id == safe_worker_id)
                    .values(**values)
                )

    def heartbeat_worker(
        self,
        worker_id: str,
        *,
        state: str,
        active_jobs: int,
    ) -> bool:
        safe_worker_id = _validated_worker_id(worker_id)
        if state not in {"ready", "busy", "draining"}:
            raise ValueError("Unsupported worker heartbeat state")
        safe_active_jobs = max(0, min(WORKER_CONCURRENCY, int(active_jobs)))
        if state == "ready" and safe_active_jobs:
            raise ValueError("A ready worker cannot report active jobs")
        if state == "busy" and safe_active_jobs == 0:
            raise ValueError("A busy worker must report an active job")
        now = _now()
        with self._session() as session, session.begin():
            result = session.execute(
                sa.update(analysis_worker_heartbeats)
                .where(analysis_worker_heartbeats.c.worker_id == safe_worker_id)
                .values(
                    state=state,
                    active_jobs=safe_active_jobs,
                    heartbeat_at=now,
                    expires_at=now + timedelta(seconds=self.settings.lease_seconds),
                    stopped_at=None,
                    updated_at=now,
                )
            )
            return result.rowcount == 1

    def record_worker_job_result(
        self,
        worker_id: str,
        job_id: str,
        job_status: AnalysisJobStatus | str,
    ) -> bool:
        safe_worker_id = _validated_worker_id(worker_id)
        safe_job_id = _validated_job_evidence_id(job_id)
        normalized_status = AnalysisJobStatus(job_status)
        if normalized_status not in {
            AnalysisJobStatus.succeeded,
            AnalysisJobStatus.failed,
            AnalysisJobStatus.canceled,
        }:
            raise ValueError("Only terminal worker job results may be recorded")
        now = _now()
        with self._session() as session, session.begin():
            result = session.execute(
                sa.update(analysis_worker_heartbeats)
                .where(analysis_worker_heartbeats.c.worker_id == safe_worker_id)
                .values(
                    processed_jobs=analysis_worker_heartbeats.c.processed_jobs + 1,
                    last_job_id=safe_job_id,
                    last_job_status=normalized_status.value,
                    last_job_completed_at=now,
                    updated_at=now,
                )
            )
            return result.rowcount == 1

    def mark_worker_stopped(self, worker_id: str) -> bool:
        safe_worker_id = _validated_worker_id(worker_id)
        now = _now()
        with self._session() as session, session.begin():
            result = session.execute(
                sa.update(analysis_worker_heartbeats)
                .where(analysis_worker_heartbeats.c.worker_id == safe_worker_id)
                .values(
                    state="stopped",
                    active_jobs=0,
                    heartbeat_at=now,
                    expires_at=now,
                    stopped_at=now,
                    updated_at=now,
                )
            )
            return result.rowcount == 1

    def worker_readiness_snapshot(self, *, include_workers: bool = False) -> dict[str, Any]:
        """Return an aggregate public snapshot or detailed operator evidence."""

        required = self.mode == JobBackendMode.worker
        unavailable: dict[str, Any] = {
            "mode": self.mode.value,
            "required": required,
            "ready": False,
            "freshness_seconds": self.settings.lease_seconds,
            "fresh_workers": 0,
            "stale_workers": 0,
            "stopped_workers": 0,
            "starting_workers": 0,
            "latest_heartbeat_at": None,
            "latest_successful_job_at": None,
        }
        try:
            with self._session() as session:
                rows = session.execute(
                    sa.select(analysis_worker_heartbeats).order_by(
                        analysis_worker_heartbeats.c.updated_at.desc(),
                        analysis_worker_heartbeats.c.worker_id,
                    )
                ).mappings().all()
        except HTTPException:
            if include_workers:
                unavailable["workers"] = []
            return unavailable

        now = _now()
        fresh_workers = []
        stale_workers = []
        stopped_workers = []
        starting_workers = []
        evidence_rows: list[dict[str, Any]] = []
        latest_heartbeat: datetime | None = None
        latest_success_at: datetime | None = None
        for row in rows:
            heartbeat_at = _aware_utc(row.get("heartbeat_at"))
            expires_at = _aware_utc(row.get("expires_at"))
            completed_at = _aware_utc(row.get("last_job_completed_at"))
            state = str(row.get("state") or "starting")
            is_expired = expires_at is None or expires_at <= now
            effective_state = "stale" if state != "stopped" and is_expired else state
            if effective_state in {"ready", "busy"}:
                fresh_workers.append(row)
            elif effective_state == "stale":
                stale_workers.append(row)
            elif effective_state == "stopped":
                stopped_workers.append(row)
            else:
                starting_workers.append(row)
            if heartbeat_at and (latest_heartbeat is None or heartbeat_at > latest_heartbeat):
                latest_heartbeat = heartbeat_at
            if (
                row.get("last_job_status") == AnalysisJobStatus.succeeded.value
                and completed_at
                and (latest_success_at is None or completed_at > latest_success_at)
            ):
                latest_success_at = completed_at
            if include_workers:
                evidence_rows.append(
                    {
                        "worker_id": str(row["worker_id"]),
                        "state": effective_state,
                        "reported_state": state,
                        "active_jobs": int(row.get("active_jobs") or 0),
                        "processed_jobs": int(row.get("processed_jobs") or 0),
                        "started_at": _iso_utc(row.get("started_at")),
                        "heartbeat_at": _iso_utc(heartbeat_at),
                        "expires_at": _iso_utc(expires_at),
                        "stopped_at": _iso_utc(row.get("stopped_at")),
                        "deployment_sha": row.get("deployment_sha"),
                        "last_job_id": row.get("last_job_id"),
                        "last_job_status": row.get("last_job_status"),
                        "last_job_completed_at": _iso_utc(completed_at),
                    }
                )

        snapshot = {
            "mode": self.mode.value,
            "required": required,
            "ready": bool(fresh_workers) if required else True,
            "freshness_seconds": self.settings.lease_seconds,
            "fresh_workers": len(fresh_workers),
            "stale_workers": len(stale_workers),
            "stopped_workers": len(stopped_workers),
            "starting_workers": len(starting_workers),
            "latest_heartbeat_at": _iso_utc(latest_heartbeat),
            "latest_successful_job_at": _iso_utc(latest_success_at),
        }
        if include_workers:
            snapshot["workers"] = evidence_rows
        return snapshot

    def complete(
        self,
        job_id: str,
        worker_id: str,
        result: Mapping[str, Any],
    ) -> bool:
        return self._finish_owned(
            job_id,
            worker_id,
            status_value=AnalysisJobStatus.succeeded,
            stage="complete",
            result=dict(result),
            error=None,
        )

    def fail(
        self,
        job_id: str,
        worker_id: str,
        error: Mapping[str, Any],
        *,
        retryable: bool,
    ) -> bool:
        with self._session() as session, session.begin():
            row = session.execute(
                sa.select(analysis_jobs)
                .where(
                    analysis_jobs.c.id == job_id,
                    analysis_jobs.c.status == AnalysisJobStatus.running.value,
                )
                .with_for_update()
            ).mappings().first()
            if row is None or _lease_owner(row) != worker_id:
                return False
            should_retry = retryable and int(row["attempts"] or 0) < self.settings.max_attempts
            now = _now()
            session.execute(
                sa.update(analysis_jobs)
                .where(analysis_jobs.c.id == job_id)
                .values(
                    status=(
                        AnalysisJobStatus.queued.value
                        if should_retry
                        else AnalysisJobStatus.failed.value
                    ),
                    stage="retrying" if should_retry else "failed",
                    heartbeat_at=None if should_retry else row["heartbeat_at"],
                    error_json=dict(error),
                    completed_at=None if should_retry else now,
                    updated_at=now,
                )
            )
            return True

    def _finish_owned(
        self,
        job_id: str,
        worker_id: str,
        *,
        status_value: AnalysisJobStatus,
        stage: str,
        result: Mapping[str, Any] | None,
        error: Mapping[str, Any] | None,
    ) -> bool:
        with self._session() as session, session.begin():
            row = session.execute(
                sa.select(analysis_jobs)
                .where(
                    analysis_jobs.c.id == job_id,
                    analysis_jobs.c.status == AnalysisJobStatus.running.value,
                )
                .with_for_update()
            ).mappings().first()
            if row is None or _lease_owner(row) != worker_id:
                return False
            now = _now()
            session.execute(
                sa.update(analysis_jobs)
                .where(analysis_jobs.c.id == job_id)
                .values(
                    status=status_value.value,
                    stage=stage,
                    progress_pct=100 if status_value == AnalysisJobStatus.succeeded else row["progress_pct"],
                    result_summary_json={"result": dict(result or {})},
                    error_json=dict(error) if error else None,
                    completed_at=now,
                    heartbeat_at=now,
                    updated_at=now,
                )
            )
            return True

    def record_artifact(
        self,
        job: AnalysisJob,
        *,
        artifact_type: str,
        storage_kind: str,
        storage_ref: str,
        content_sha256: str | None = None,
        size_bytes: int = 0,
        mime_type: str | None = None,
        metadata_json: Mapping[str, Any] | None = None,
    ) -> str | None:
        stable_key = "\x1f".join([job.id, artifact_type, storage_ref])
        artifact_id = str(uuid.uuid5(_ARTIFACT_NAMESPACE, stable_key))
        values = dict(
            id=artifact_id,
            workspace_id=job.workspace_id,
            project_id=job.project_id,
            analysis_job_id=job.id,
            artifact_type=artifact_type,
            storage_kind=storage_kind,
            storage_ref=storage_ref,
            content_sha256=content_sha256,
            size_bytes=max(0, int(size_bytes)),
            mime_type=mime_type,
            metadata_json=dict(metadata_json or {}),
        )
        try:
            with self._session() as session, session.begin():
                owned = session.execute(
                    sa.select(analysis_jobs.c.status, analysis_jobs.c.request_json)
                    .where(
                        analysis_jobs.c.id == job.id,
                        analysis_jobs.c.workspace_id == job.workspace_id,
                        analysis_jobs.c.project_id == job.project_id,
                    )
                    .with_for_update()
                ).mappings().first()
                if (
                    owned is None
                    or owned["status"] != AnalysisJobStatus.running.value
                    or _lease_owner(owned) != job.lease_owner
                ):
                    return None
                session.execute(sa.insert(analysis_job_artifacts).values(**values))
        except IntegrityError:
            pass
        return artifact_id

    def record_ai_usage(
        self,
        job: AnalysisJob,
        *,
        provider: str,
        model: str | None,
        operation: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        estimated_cost_microunits: int = 0,
        currency: str = "USD",
        idempotency_key: str | None = None,
    ) -> bool:
        key = idempotency_key or (
            f"analysis:{job.id}:{operation}:{provider}:{model or 'default'}"
        )
        try:
            with self._session() as session, session.begin():
                owned = session.execute(
                    sa.select(analysis_jobs.c.status, analysis_jobs.c.request_json)
                    .where(
                        analysis_jobs.c.id == job.id,
                        analysis_jobs.c.workspace_id == job.workspace_id,
                        analysis_jobs.c.project_id == job.project_id,
                    )
                    .with_for_update()
                ).mappings().first()
                if (
                    owned is None
                    or owned["status"] != AnalysisJobStatus.running.value
                    or _lease_owner(owned) != job.lease_owner
                ):
                    return False
                existing = session.execute(
                    sa.select(ai_usage_ledger.c.id).where(
                        ai_usage_ledger.c.idempotency_key == key
                    )
                ).scalar_one_or_none()
                if existing is not None:
                    return False
                session.execute(
                    sa.insert(ai_usage_ledger).values(
                        id=str(uuid.uuid4()),
                        workspace_id=job.workspace_id,
                        project_id=job.project_id,
                        app_user_id=job.created_by_user_id,
                        analysis_job_id=job.id,
                        provider=provider,
                        model=model,
                        operation=operation,
                        input_tokens=max(0, int(input_tokens)),
                        output_tokens=max(0, int(output_tokens)),
                        estimated_cost_microunits=max(0, int(estimated_cost_microunits)),
                        currency=currency[:3].upper(),
                        idempotency_key=key,
                        occurred_at=_now(),
                    )
                )
        except IntegrityError:
            return False
        return True

    def readiness(self) -> bool:
        try:
            with self._session() as session:
                for table in (
                    analysis_jobs,
                    analysis_job_artifacts,
                    analysis_worker_heartbeats,
                    ai_usage_ledger,
                ):
                    session.execute(sa.select(sa.literal(1)).select_from(table).limit(1))
            if self.mode == JobBackendMode.worker:
                return bool(self.worker_readiness_snapshot()["ready"])
            return True
        except HTTPException:
            return False


class WorkflowAnalysisJobBackend(PostgresAnalysisJobBackend):
    """DB-backed handoff surface for an externally configured Workflow runner."""

    mode = JobBackendMode.workflow


class UnavailableAnalysisJobBackend:
    mode = None

    def __getattr__(self, _name: str):
        def unavailable(*_args, **_kwargs):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Analysis job backend is unavailable.",
            )

        return unavailable


def create_analysis_job_backend(
    session_factory: sessionmaker[Session],
    *,
    settings: JobBackendSettings | None = None,
):
    settings = settings or JobBackendSettings.from_env()
    if settings.mode == JobBackendMode.inline:
        return InlineAnalysisJobBackend()
    if settings.mode == JobBackendMode.workflow:
        return WorkflowAnalysisJobBackend(session_factory, settings=settings)
    return PostgresAnalysisJobBackend(session_factory, settings=settings)


def _job_from_row(row: Mapping[str, Any]) -> AnalysisJob:
    request_json = dict(row.get("request_json") or {})
    result_json = row.get("result_summary_json") or {}
    result = result_json.get("result") if isinstance(result_json, Mapping) else None
    return AnalysisJob(
        id=str(row["id"]),
        workspace_id=str(row["workspace_id"]),
        project_id=str(row["project_id"]),
        created_by_user_id=(
            str(row["created_by_user_id"]) if row.get("created_by_user_id") else None
        ),
        owner_id=str(request_json.get("owner_id") or ""),
        job_type=AnalysisJobType(str(row["job_type"])),
        status=AnalysisJobStatus(str(row["status"])),
        stage=str(row.get("stage") or "queued"),
        progress_pct=int(row.get("progress_pct") or 0),
        payload=dict(request_json.get("payload") or {}),
        attempts=int(row.get("attempts") or 0),
        heartbeat_at=row.get("heartbeat_at"),
        started_at=row.get("started_at"),
        completed_at=row.get("completed_at"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        result=dict(result) if isinstance(result, Mapping) else None,
        error=(
            dict(row["error_json"])
            if isinstance(row.get("error_json"), Mapping)
            else None
        ),
        lease_owner=(
            str(request_json["lease_owner"])
            if request_json.get("lease_owner")
            else None
        ),
    )


def _request_hash(job: AnalysisJob) -> str:
    return _canonical_hash({"job_type": job.job_type.value, "payload": dict(job.payload)})


def _lease_owner(row: Mapping[str, Any]) -> str | None:
    request_json = row.get("request_json") or {}
    if isinstance(request_json, Mapping) and request_json.get("lease_owner"):
        return str(request_json["lease_owner"])
    return None
