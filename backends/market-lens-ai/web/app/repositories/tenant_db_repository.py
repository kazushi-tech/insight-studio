"""Tenant-bound production repositories for Market Lens.

Every operation reads the verified request context and includes both
``workspace_id`` and ``project_id`` in its database predicate.  Database
failures surface as HTTP 503; this adapter never falls back to files or tmp.
"""

from __future__ import annotations

import json
import os
import re
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, Optional, Type

import sqlalchemy as sa
from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from ..models import ScanResult
from ..schemas.creative_asset import CreativeAssetMetadata
from ..schemas.discovery_job import (
    DiscoveryJobError,
    DiscoveryJobRecord,
    DiscoveryJobStage,
    DiscoveryJobStatus,
)
from ..schemas.scan_job import (
    ScanJobError,
    ScanJobRecord,
    ScanJobStage,
    ScanJobStatus,
)
from ..tenant_auth import (
    TenantAuthConfigurationError,
    TenantContext,
    get_current_tenant_context,
    get_managed_session_factory,
    is_managed_runtime,
    validate_managed_session_factory,
)
from ..tenant_schema import (
    analysis_jobs,
    app_users,
    asset_data,
    assets,
    delivery_configs,
    export_records,
    jobs,
    projects,
    review_outputs,
    review_runs,
    watchlists,
)
from .asset_repository import AssetRepository
from .creative_review_repository import (
    CreativeReviewRepository,
    CreativeReviewRun,
    ExportFormat,
    ExportRecord,
    ReviewOutput,
    RunStatus,
)
from .discovery_job_repository import DiscoveryJobRepository
from .scan_job_repository import ScanJobRepository
from .scan_repository import ScanRepository


_ID_RE = re.compile(r"^[0-9a-f]{12}$")
_TRUTHY = {"1", "true", "yes", "on"}
_PRODUCTION_ENVIRONMENTS = {"prod", "production", "staging"}

_TO_DB_JOB_STATUS = {
    "queued": "queued",
    "running": "running",
    "completed": "succeeded",
    "failed": "failed",
    "cancelled": "canceled",
    "canceled": "canceled",
}


class TenantRepositoryConfigurationError(RuntimeError):
    """Repository backend is unsafe or unavailable for this environment."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _enum_value(value: Any) -> str:
    return str(value.value) if hasattr(value, "value") else str(value)


def _validate_id(value: str, kind: str) -> None:
    if not _ID_RE.fullmatch(value):
        raise ValueError(f"Invalid {kind}: {value!r}")


def _service_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Market Lens persistence is unavailable.",
    )


class _TenantDbBase:
    def __init__(self, session_factory: sessionmaker[Session] | None = None) -> None:
        try:
            self._session_factory = session_factory or get_managed_session_factory()
            validate_managed_session_factory(self._session_factory)
        except TenantAuthConfigurationError as exc:
            raise TenantRepositoryConfigurationError(
                "Market Lens database repository is unavailable: unsafe database configuration"
            ) from exc

    @staticmethod
    def _context() -> TenantContext:
        return get_current_tenant_context()

    @contextmanager
    def _session(self) -> Iterator[Session]:
        try:
            with self._session_factory() as session:
                yield session
        except HTTPException:
            raise
        except SQLAlchemyError as exc:
            raise _service_unavailable(exc) from exc


class TenantDbScanRepository(_TenantDbBase, ScanRepository):
    """Persist completed scan reports in the scoped ``analysis_jobs`` table."""

    _JOB_TYPE = "scan_result"

    def save(self, result: ScanResult) -> None:
        _validate_id(result.run_id, "run_id")
        context = self._context()
        payload = result.model_dump(mode="json")
        with self._session() as session, session.begin():
            existing = session.execute(
                sa.select(analysis_jobs.c.id).where(
                    analysis_jobs.c.id == result.run_id,
                    analysis_jobs.c.workspace_id == context.workspace_id,
                    analysis_jobs.c.project_id == context.project_id,
                    analysis_jobs.c.job_type == self._JOB_TYPE,
                )
            ).scalar_one_or_none()
            values = {
                "status": _TO_DB_JOB_STATUS.get(result.status, "failed"),
                "stage": "complete" if result.status == "completed" else result.status,
                "progress_pct": 100 if result.status == "completed" else 0,
                "request_json": {"record": payload},
                "result_summary_json": {"result": payload},
                "completed_at": _now() if result.status == "completed" else None,
                "updated_at": _now(),
            }
            if existing is None:
                session.execute(
                    sa.insert(analysis_jobs).values(
                        id=result.run_id,
                        workspace_id=context.workspace_id,
                        project_id=context.project_id,
                        created_by_user_id=context.app_user_id,
                        job_type=self._JOB_TYPE,
                        created_at=result.created_at,
                        attempts=1,
                        **values,
                    )
                )
            else:
                session.execute(
                    sa.update(analysis_jobs)
                    .where(
                        analysis_jobs.c.id == result.run_id,
                        analysis_jobs.c.workspace_id == context.workspace_id,
                        analysis_jobs.c.project_id == context.project_id,
                    )
                    .values(**values)
                )

    def load(self, run_id: str) -> Optional[ScanResult]:
        _validate_id(run_id, "run_id")
        context = self._context()
        with self._session() as session:
            payload = session.execute(
                sa.select(analysis_jobs.c.result_summary_json).where(
                    analysis_jobs.c.id == run_id,
                    analysis_jobs.c.workspace_id == context.workspace_id,
                    analysis_jobs.c.project_id == context.project_id,
                    analysis_jobs.c.job_type == self._JOB_TYPE,
                )
            ).scalar_one_or_none()
        if not isinstance(payload, dict) or not isinstance(payload.get("result"), dict):
            return None
        return ScanResult.model_validate(payload["result"])

    def list_all(self, owner_id: str) -> list[dict]:
        context = self._context()
        with self._session() as session:
            rows = session.execute(
                sa.select(analysis_jobs.c.result_summary_json).where(
                    analysis_jobs.c.workspace_id == context.workspace_id,
                    analysis_jobs.c.project_id == context.project_id,
                    analysis_jobs.c.job_type == self._JOB_TYPE,
                ).order_by(analysis_jobs.c.created_at.desc())
            ).scalars().all()
        summaries: list[dict] = []
        for payload in rows:
            if not isinstance(payload, dict) or not isinstance(payload.get("result"), dict):
                continue
            result = payload["result"]
            if result.get("owner_id") != owner_id:
                continue
            summaries.append(
                {
                    "run_id": result.get("run_id"),
                    "created_at": result.get("created_at", ""),
                    "status": result.get("status", "unknown"),
                    "urls": result.get("urls", []),
                }
            )
        return summaries

    def delete(self, run_id: str) -> bool:
        _validate_id(run_id, "run_id")
        context = self._context()
        with self._session() as session, session.begin():
            result = session.execute(
                sa.delete(analysis_jobs).where(
                    analysis_jobs.c.id == run_id,
                    analysis_jobs.c.workspace_id == context.workspace_id,
                    analysis_jobs.c.project_id == context.project_id,
                    analysis_jobs.c.job_type == self._JOB_TYPE,
                )
            )
            return result.rowcount > 0


class _TenantDbJobRepository(_TenantDbBase):
    _record_model: Type[BaseModel]
    _job_type: str

    def save_job(self, record: BaseModel) -> None:
        job_id = str(getattr(record, "job_id"))
        _validate_id(job_id, "job_id")
        context = self._context()
        payload = record.model_dump(mode="json", exclude={"api_key", "search_api_key"})
        raw_status = _enum_value(getattr(record, "status"))
        stage = _enum_value(getattr(record, "stage", raw_status))
        values = {
            "status": _TO_DB_JOB_STATUS.get(raw_status, "failed"),
            "stage": stage,
            "progress_pct": int(getattr(record, "progress_pct", 0)),
            "request_json": {"record": payload},
            "error_json": payload.get("error"),
            "heartbeat_at": getattr(record, "heartbeat_at", None),
            "started_at": getattr(record, "started_at", None),
            "completed_at": (
                getattr(record, "updated_at", None)
                if raw_status in {"completed", "failed", "cancelled"}
                else None
            ),
            "updated_at": getattr(record, "updated_at", None) or _now(),
        }
        with self._session() as session, session.begin():
            existing = session.execute(
                sa.select(analysis_jobs.c.id).where(
                    analysis_jobs.c.id == job_id,
                    analysis_jobs.c.workspace_id == context.workspace_id,
                    analysis_jobs.c.project_id == context.project_id,
                    analysis_jobs.c.job_type == self._job_type,
                )
            ).scalar_one_or_none()
            if existing is None:
                session.execute(
                    sa.insert(analysis_jobs).values(
                        id=job_id,
                        workspace_id=context.workspace_id,
                        project_id=context.project_id,
                        created_by_user_id=context.app_user_id,
                        job_type=self._job_type,
                        attempts=1,
                        created_at=getattr(record, "created_at", None) or _now(),
                        **values,
                    )
                )
            else:
                session.execute(
                    sa.update(analysis_jobs)
                    .where(
                        analysis_jobs.c.id == job_id,
                        analysis_jobs.c.workspace_id == context.workspace_id,
                        analysis_jobs.c.project_id == context.project_id,
                        analysis_jobs.c.job_type == self._job_type,
                    )
                    .values(**values)
                )

    def load_job(self, job_id: str):
        _validate_id(job_id, "job_id")
        context = self._context()
        with self._session() as session:
            payload = session.execute(
                sa.select(analysis_jobs.c.request_json).where(
                    analysis_jobs.c.id == job_id,
                    analysis_jobs.c.workspace_id == context.workspace_id,
                    analysis_jobs.c.project_id == context.project_id,
                    analysis_jobs.c.job_type == self._job_type,
                )
            ).scalar_one_or_none()
        if not isinstance(payload, dict) or not isinstance(payload.get("record"), dict):
            return None
        return self._record_model.model_validate(payload["record"])

    def save_result(self, job_id: str, result: dict) -> None:
        _validate_id(job_id, "job_id")
        context = self._context()
        with self._session() as session, session.begin():
            updated = session.execute(
                sa.update(analysis_jobs)
                .where(
                    analysis_jobs.c.id == job_id,
                    analysis_jobs.c.workspace_id == context.workspace_id,
                    analysis_jobs.c.project_id == context.project_id,
                    analysis_jobs.c.job_type == self._job_type,
                )
                .values(result_summary_json={"result": result}, updated_at=_now())
            )
            if updated.rowcount != 1:
                raise ValueError(f"Unknown scoped job_id: {job_id}")

    def load_result(self, job_id: str) -> Optional[dict]:
        _validate_id(job_id, "job_id")
        context = self._context()
        with self._session() as session:
            payload = session.execute(
                sa.select(analysis_jobs.c.result_summary_json).where(
                    analysis_jobs.c.id == job_id,
                    analysis_jobs.c.workspace_id == context.workspace_id,
                    analysis_jobs.c.project_id == context.project_id,
                    analysis_jobs.c.job_type == self._job_type,
                )
            ).scalar_one_or_none()
        if not isinstance(payload, dict) or not isinstance(payload.get("result"), dict):
            return None
        return payload["result"]

    def mark_stale_running_as_failed(self) -> int:
        with self._session() as session:
            rows = session.execute(
                sa.select(
                    analysis_jobs.c.id,
                    analysis_jobs.c.workspace_id,
                    analysis_jobs.c.project_id,
                    analysis_jobs.c.request_json,
                ).where(
                    analysis_jobs.c.job_type == self._job_type,
                    analysis_jobs.c.status.in_(["queued", "running"]),
                )
            ).mappings().all()
        count = 0
        for row in rows:
            payload = row["request_json"]
            if not isinstance(payload, dict) or not isinstance(payload.get("record"), dict):
                continue
            record = self._record_model.model_validate(payload["record"])
            record.status = self._failed_status()
            record.stage = self._failed_stage()
            record.updated_at = _now()
            record.error = self._restart_error()
            record_payload = record.model_dump(
                mode="json",
                exclude={"api_key", "search_api_key"},
            )
            with self._session() as session, session.begin():
                session.execute(
                    sa.update(analysis_jobs)
                    .where(
                        analysis_jobs.c.id == row["id"],
                        analysis_jobs.c.workspace_id == row["workspace_id"],
                        analysis_jobs.c.project_id == row["project_id"],
                        analysis_jobs.c.job_type == self._job_type,
                    )
                    .values(
                        status="failed",
                        stage="failed",
                        progress_pct=int(getattr(record, "progress_pct", 0)),
                        request_json={"record": record_payload},
                        error_json=record_payload.get("error"),
                        completed_at=record.updated_at,
                        updated_at=record.updated_at,
                    )
                )
            count += 1
        return count

    def _failed_status(self):
        raise NotImplementedError

    def _failed_stage(self):
        raise NotImplementedError

    def _restart_error(self):
        raise NotImplementedError


class TenantDbScanJobRepository(_TenantDbJobRepository, ScanJobRepository):
    _record_model = ScanJobRecord
    _job_type = "scan"

    def _failed_status(self):
        return ScanJobStatus.failed

    def _failed_stage(self):
        return ScanJobStage.failed

    def _restart_error(self):
        return ScanJobError(
            status_code=503,
            detail="サーバー再起動によりジョブが中断されました。再実行してください。",
            retryable=True,
        )


class TenantDbDiscoveryJobRepository(_TenantDbJobRepository, DiscoveryJobRepository):
    _record_model = DiscoveryJobRecord
    _job_type = "discovery"

    def _failed_status(self):
        return DiscoveryJobStatus.failed

    def _failed_stage(self):
        return DiscoveryJobStage.failed

    def _restart_error(self):
        return DiscoveryJobError(
            status_code=503,
            detail="サーバー再起動によりジョブが中断されました。再実行してください。",
            retryable=True,
        )


class TenantDbAssetRepository(_TenantDbBase, AssetRepository):
    def save(self, metadata: CreativeAssetMetadata, data: bytes) -> None:
        _validate_id(metadata.asset_id, "asset_id")
        context = self._context()
        with self._session() as session, session.begin():
            session.execute(
                sa.insert(assets).values(
                    id=metadata.asset_id,
                    file_name=metadata.file_name,
                    mime_type=metadata.mime_type,
                    size_bytes=metadata.size_bytes,
                    width=metadata.width,
                    height=metadata.height,
                    asset_type=_enum_value(metadata.asset_type),
                    created_at=metadata.created_at,
                    workspace_id=context.workspace_id,
                    project_id=context.project_id,
                    created_by_user_id=context.app_user_id,
                )
            )
            session.execute(
                sa.insert(asset_data).values(asset_id=metadata.asset_id, data=data)
            )

    def load_metadata(self, asset_id: str) -> Optional[CreativeAssetMetadata]:
        _validate_id(asset_id, "asset_id")
        context = self._context()
        with self._session() as session:
            row = session.execute(
                sa.select(assets).where(
                    assets.c.id == asset_id,
                    assets.c.workspace_id == context.workspace_id,
                    assets.c.project_id == context.project_id,
                )
            ).mappings().first()
        return _asset_metadata(row) if row else None

    def load_data(self, asset_id: str) -> Optional[bytes]:
        _validate_id(asset_id, "asset_id")
        context = self._context()
        with self._session() as session:
            return session.execute(
                sa.select(asset_data.c.data)
                .join(assets, assets.c.id == asset_data.c.asset_id)
                .where(
                    asset_data.c.asset_id == asset_id,
                    assets.c.workspace_id == context.workspace_id,
                    assets.c.project_id == context.project_id,
                )
            ).scalar_one_or_none()

    def delete(self, asset_id: str) -> bool:
        _validate_id(asset_id, "asset_id")
        context = self._context()
        with self._session() as session, session.begin():
            owned = session.execute(
                sa.select(assets.c.id).where(
                    assets.c.id == asset_id,
                    assets.c.workspace_id == context.workspace_id,
                    assets.c.project_id == context.project_id,
                )
            ).scalar_one_or_none()
            if owned is None:
                return False
            session.execute(sa.delete(asset_data).where(asset_data.c.asset_id == asset_id))
            session.execute(
                sa.delete(assets).where(
                    assets.c.id == asset_id,
                    assets.c.workspace_id == context.workspace_id,
                    assets.c.project_id == context.project_id,
                )
            )
            return True

    def list_all(self) -> list[CreativeAssetMetadata]:
        context = self._context()
        with self._session() as session:
            rows = session.execute(
                sa.select(assets).where(
                    assets.c.workspace_id == context.workspace_id,
                    assets.c.project_id == context.project_id,
                ).order_by(assets.c.created_at.desc())
            ).mappings().all()
        return [_asset_metadata(row) for row in rows]


def _asset_metadata(row: Any) -> CreativeAssetMetadata:
    return CreativeAssetMetadata(
        asset_id=row["id"],
        file_name=row["file_name"],
        mime_type=row["mime_type"],
        size_bytes=row["size_bytes"],
        width=row["width"],
        height=row["height"],
        asset_type=row["asset_type"],
        created_at=row["created_at"],
    )


class TenantDbCreativeReviewRepository(_TenantDbBase, CreativeReviewRepository):
    def save_run(self, run: CreativeReviewRun) -> None:
        _validate_id(run.run_id, "review_id")
        context = self._context()
        with self._session() as session, session.begin():
            asset_exists = session.execute(
                sa.select(assets.c.id).where(
                    assets.c.id == run.asset_id,
                    assets.c.workspace_id == context.workspace_id,
                    assets.c.project_id == context.project_id,
                )
            ).scalar_one_or_none()
            if asset_exists is None:
                raise ValueError("Asset is not available in the active tenant")
            session.execute(
                sa.insert(review_runs).values(
                    id=run.run_id,
                    asset_id=run.asset_id,
                    review_type=run.review_type,
                    status=_enum_value(run.status),
                    brand_info=run.brand_info or None,
                    operator_memo=run.operator_memo or None,
                    lp_url=run.lp_url,
                    created_at=run.created_at,
                    updated_at=run.completed_at or run.created_at,
                    workspace_id=context.workspace_id,
                    project_id=context.project_id,
                    created_by_user_id=context.app_user_id,
                )
            )

    def load_run(self, run_id: str) -> Optional[CreativeReviewRun]:
        row = self._load_run_row(run_id)
        return _review_run(row) if row else None

    def _load_run_row(self, run_id: str):
        _validate_id(run_id, "review_id")
        context = self._context()
        with self._session() as session:
            return session.execute(
                sa.select(review_runs).where(
                    review_runs.c.id == run_id,
                    review_runs.c.workspace_id == context.workspace_id,
                    review_runs.c.project_id == context.project_id,
                )
            ).mappings().first()

    def update_run_status(
        self,
        run_id: str,
        status_value: RunStatus,
        completed_at: Optional[datetime] = None,
    ) -> bool:
        _validate_id(run_id, "review_id")
        context = self._context()
        with self._session() as session, session.begin():
            result = session.execute(
                sa.update(review_runs)
                .where(
                    review_runs.c.id == run_id,
                    review_runs.c.workspace_id == context.workspace_id,
                    review_runs.c.project_id == context.project_id,
                )
                .values(
                    status=_enum_value(status_value),
                    updated_at=completed_at or _now(),
                )
            )
            return result.rowcount > 0

    def list_runs(self, *, limit: int = 50, offset: int = 0) -> list[CreativeReviewRun]:
        context = self._context()
        with self._session() as session:
            rows = session.execute(
                sa.select(review_runs)
                .where(
                    review_runs.c.workspace_id == context.workspace_id,
                    review_runs.c.project_id == context.project_id,
                )
                .order_by(review_runs.c.created_at.desc())
                .limit(limit)
                .offset(offset)
            ).mappings().all()
        return [_review_run(row) for row in rows]

    def delete_run(self, run_id: str) -> bool:
        _validate_id(run_id, "review_id")
        context = self._context()
        with self._session() as session, session.begin():
            owned = session.execute(
                sa.select(review_runs.c.id).where(
                    review_runs.c.id == run_id,
                    review_runs.c.workspace_id == context.workspace_id,
                    review_runs.c.project_id == context.project_id,
                )
            ).scalar_one_or_none()
            if owned is None:
                return False
            session.execute(sa.delete(export_records).where(export_records.c.run_id == run_id))
            session.execute(sa.delete(review_outputs).where(review_outputs.c.run_id == run_id))
            session.execute(
                sa.delete(review_runs).where(
                    review_runs.c.id == run_id,
                    review_runs.c.workspace_id == context.workspace_id,
                    review_runs.c.project_id == context.project_id,
                )
            )
            return True

    def save_output(self, output: ReviewOutput) -> None:
        if self._load_run_row(output.run_id) is None:
            raise ValueError("Review is not available in the active tenant")
        with self._session() as session, session.begin():
            session.execute(
                sa.insert(review_outputs).values(
                    run_id=output.run_id,
                    output_json=json.dumps(output.output_json, ensure_ascii=False),
                    model_used=output.model_used,
                    created_at=output.created_at,
                )
            )

    def load_output(self, run_id: str) -> Optional[ReviewOutput]:
        _validate_id(run_id, "review_id")
        context = self._context()
        with self._session() as session:
            row = session.execute(
                sa.select(review_outputs)
                .join(review_runs, review_runs.c.id == review_outputs.c.run_id)
                .where(
                    review_outputs.c.run_id == run_id,
                    review_runs.c.workspace_id == context.workspace_id,
                    review_runs.c.project_id == context.project_id,
                )
            ).mappings().first()
        if row is None:
            return None
        return ReviewOutput(
            run_id=row["run_id"],
            output_json=json.loads(row["output_json"]),
            model_used=row["model_used"],
            created_at=row["created_at"],
        )

    def save_export(self, record: ExportRecord) -> None:
        if self._load_run_row(record.run_id) is None:
            raise ValueError("Review is not available in the active tenant")
        with self._session() as session, session.begin():
            session.execute(
                sa.insert(export_records).values(
                    id=record.export_id,
                    run_id=record.run_id,
                    format=_enum_value(record.format),
                    file_name=record.file_path,
                    file_size_bytes=record.file_size_bytes,
                    created_at=record.created_at,
                )
            )

    def list_exports(self, run_id: str) -> list[ExportRecord]:
        if self._load_run_row(run_id) is None:
            return []
        with self._session() as session:
            rows = session.execute(
                sa.select(export_records)
                .where(export_records.c.run_id == run_id)
                .order_by(export_records.c.created_at)
            ).mappings().all()
        return [
            ExportRecord(
                export_id=row["id"],
                run_id=row["run_id"],
                format=ExportFormat(row["format"]),
                file_path=row["file_name"],
                file_size_bytes=row["file_size_bytes"],
                created_at=row["created_at"],
            )
            for row in rows
        ]


def _review_run(row: Any) -> CreativeReviewRun:
    return CreativeReviewRun(
        run_id=row["id"],
        asset_id=row["asset_id"],
        review_type=row["review_type"],
        status=RunStatus(row["status"]),
        brand_info=row["brand_info"] or "",
        operator_memo=row["operator_memo"] or "",
        lp_url=row["lp_url"],
        created_at=row["created_at"],
        completed_at=row["updated_at"],
    )


@dataclass(frozen=True)
class TenantRepositoryBundle:
    scan_repo: ScanRepository
    scan_job_repo: ScanJobRepository
    discovery_job_repo: DiscoveryJobRepository
    asset_repo: AssetRepository
    review_repo: CreativeReviewRepository
    watchlist_repo: Any
    scheduler: Any
    delivery_repo: Any
    backend: str
    readiness_probe: Callable[[], bool]

    def is_ready(self) -> bool:
        try:
            return bool(self.readiness_probe())
        except Exception:
            return False


def _is_production() -> bool:
    return is_managed_runtime()


def _verify_database(session_factory: sessionmaker[Session]) -> None:
    try:
        with session_factory() as session:
            session.execute(sa.text("SELECT 1"))
            for table in (
                app_users,
                projects,
                analysis_jobs,
                assets,
                watchlists,
                jobs,
                delivery_configs,
            ):
                session.execute(sa.select(sa.literal(1)).select_from(table).limit(1))
    except SQLAlchemyError as exc:
        raise TenantRepositoryConfigurationError(
            "Market Lens database repository is unavailable"
        ) from exc


def create_tenant_repository_bundle(
    backend: str | None = None,
    *,
    session_factory: sessionmaker[Session] | None = None,
    file_base_dir: Path | None = None,
    verify_connection: bool = True,
) -> TenantRepositoryBundle:
    """Create a strict repository bundle with no production file fallback."""

    selected = (backend or os.getenv("REPOSITORY_BACKEND") or "").strip().lower()
    if not selected:
        selected = "db" if _is_production() else "file"
    if selected in {"file", "local"}:
        if _is_production():
            raise TenantRepositoryConfigurationError(
                "File repositories are forbidden in production"
            )
        from .file_asset_repository import FileAssetRepository
        from .file_creative_review_repository import FileCreativeReviewRepository
        from .file_discovery_job_repository import FileDiscoveryJobRepository
        from .file_scan_job_repository import FileScanJobRepository
        from .file_scan_repository import FileScanRepository
        from .tenant_ops_repository import InMemoryDeliveryRepository
        from .watchlist_repository import WatchlistRepository
        from ..jobs.scheduler import JobScheduler

        base = file_base_dir
        asset_repo = (
            FileAssetRepository(base_dir=base / "assets")
            if base
            else FileAssetRepository()
        )
        review_repo = (
            FileCreativeReviewRepository(base_dir=base / "reviews")
            if base
            else FileCreativeReviewRepository()
        )
        return TenantRepositoryBundle(
            scan_repo=FileScanRepository(),
            scan_job_repo=FileScanJobRepository(base / "scan_jobs" if base else None),
            discovery_job_repo=FileDiscoveryJobRepository(
                base / "discovery_jobs" if base else None
            ),
            asset_repo=asset_repo,
            review_repo=review_repo,
            watchlist_repo=WatchlistRepository(),
            scheduler=JobScheduler(),
            delivery_repo=InMemoryDeliveryRepository(),
            backend="file",
            readiness_probe=lambda: True,
        )
    if selected not in {"db", "database"}:
        raise TenantRepositoryConfigurationError(
            f"Unsupported Market Lens repository backend: {selected}"
        )
    try:
        factory = session_factory or get_managed_session_factory()
        validate_managed_session_factory(factory)
    except TenantAuthConfigurationError as exc:
        raise TenantRepositoryConfigurationError(
            "Market Lens database repository is unavailable: DATABASE_URL must use PostgreSQL with TLS"
        ) from exc
    if verify_connection:
        _verify_database(factory)

    def database_ready() -> bool:
        try:
            _verify_database(factory)
        except TenantRepositoryConfigurationError:
            return False
        return True

    from .tenant_ops_repository import (
        TenantDbDeliveryRepository,
        TenantDbJobScheduler,
        TenantDbWatchlistRepository,
    )

    return TenantRepositoryBundle(
        scan_repo=TenantDbScanRepository(factory),
        scan_job_repo=TenantDbScanJobRepository(factory),
        discovery_job_repo=TenantDbDiscoveryJobRepository(factory),
        asset_repo=TenantDbAssetRepository(factory),
        review_repo=TenantDbCreativeReviewRepository(factory),
        watchlist_repo=TenantDbWatchlistRepository(factory),
        scheduler=TenantDbJobScheduler(factory),
        delivery_repo=TenantDbDeliveryRepository(factory),
        backend="db",
        readiness_probe=database_ready,
    )


class _UnavailableRepository:
    """Fail every persistence call without silently switching to local files."""

    def __getattr__(self, _name: str):
        def unavailable(*_args, **_kwargs):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Market Lens persistence is unavailable.",
            )

        return unavailable


def unavailable_tenant_repository_bundle() -> TenantRepositoryBundle:
    repository = _UnavailableRepository()
    return TenantRepositoryBundle(
        scan_repo=repository,
        scan_job_repo=repository,
        discovery_job_repo=repository,
        asset_repo=repository,
        review_repo=repository,
        watchlist_repo=repository,
        scheduler=repository,
        delivery_repo=repository,
        backend="unavailable",
        readiness_probe=lambda: False,
    )
