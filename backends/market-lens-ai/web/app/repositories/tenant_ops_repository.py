"""Tenant-bound watchlist, scheduler, and delivery persistence.

Parent records are always filtered by the verified workspace/project context.
Child history tables are only reachable through joins to those scoped parents,
so a direct identifier from another tenant is indistinguishable from missing.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlalchemy.orm import Session, sessionmaker

from ..jobs.scheduler import JobScheduler
from ..schemas.delivery import (
    DeliveryConfig,
    DeliveryConfigCreate,
    DeliveryConfigUpdate,
    DeliveryLog,
    DeliveryStatus,
)
from ..schemas.job import (
    Job,
    JobCreate,
    JobResult,
    JobResultStatus,
    JobStatus,
    JobType,
    JobUpdate,
)
from ..schemas.watchlist_v2 import (
    DiffResult,
    Watchlist,
    WatchlistCreate,
    WatchlistEntry,
    WatchlistEntryCreate,
    WatchlistUpdate,
)
from ..tenant_schema import (
    delivery_configs,
    delivery_logs,
    digest_reports,
    job_results,
    jobs,
    watchlist_entries,
    watchlists,
)
from .tenant_db_repository import _TenantDbBase


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _value(value) -> str:
    return str(value.value) if hasattr(value, "value") else str(value)


class TenantDbWatchlistRepository(_TenantDbBase):
    _MAX_DIFFS_PER_ENTRY = 100

    def create_watchlist(self, req: WatchlistCreate) -> Watchlist:
        context = self._context()
        watchlist = Watchlist(
            id=_new_id(),
            name=req.name,
            description=req.description,
            project_id=context.project_id,
            created_at=_now(),
        )
        with self._session() as session, session.begin():
            session.execute(
                sa.insert(watchlists).values(
                    id=watchlist.id,
                    name=watchlist.name,
                    description=watchlist.description or None,
                    workspace_id=context.workspace_id,
                    project_id=context.project_id,
                    created_by_user_id=context.app_user_id,
                    created_at=watchlist.created_at,
                )
            )
        return watchlist

    def get_watchlist(self, watchlist_id: str) -> Watchlist | None:
        context = self._context()
        with self._session() as session:
            row = session.execute(
                sa.select(
                    watchlists,
                    sa.func.count(watchlist_entries.c.id).label("entry_count"),
                )
                .outerjoin(
                    watchlist_entries,
                    sa.and_(
                        watchlist_entries.c.watchlist_id == watchlists.c.id,
                        watchlist_entries.c.workspace_id == context.workspace_id,
                        watchlist_entries.c.project_id == context.project_id,
                    ),
                )
                .where(
                    watchlists.c.id == watchlist_id,
                    watchlists.c.workspace_id == context.workspace_id,
                    watchlists.c.project_id == context.project_id,
                )
                .group_by(*watchlists.c)
            ).mappings().first()
        return _watchlist(row) if row else None

    def list_watchlists(self, project_id: str | None = None) -> list[Watchlist]:
        context = self._context()
        if project_id and project_id != context.project_id:
            return []
        with self._session() as session:
            rows = session.execute(
                sa.select(
                    watchlists,
                    sa.func.count(watchlist_entries.c.id).label("entry_count"),
                )
                .outerjoin(
                    watchlist_entries,
                    sa.and_(
                        watchlist_entries.c.watchlist_id == watchlists.c.id,
                        watchlist_entries.c.workspace_id == context.workspace_id,
                        watchlist_entries.c.project_id == context.project_id,
                    ),
                )
                .where(
                    watchlists.c.workspace_id == context.workspace_id,
                    watchlists.c.project_id == context.project_id,
                )
                .group_by(*watchlists.c)
                .order_by(watchlists.c.created_at.desc())
            ).mappings().all()
        return [_watchlist(row) for row in rows]

    def update_watchlist(
        self,
        watchlist_id: str,
        req: WatchlistUpdate,
    ) -> Watchlist | None:
        context = self._context()
        values = {"updated_at": _now()}
        if req.name is not None:
            values["name"] = req.name
        if req.description is not None:
            values["description"] = req.description
        with self._session() as session, session.begin():
            result = session.execute(
                sa.update(watchlists)
                .where(
                    watchlists.c.id == watchlist_id,
                    watchlists.c.workspace_id == context.workspace_id,
                    watchlists.c.project_id == context.project_id,
                )
                .values(**values)
            )
            if result.rowcount != 1:
                return None
        return self.get_watchlist(watchlist_id)

    def delete_watchlist(self, watchlist_id: str) -> bool:
        context = self._context()
        with self._session() as session, session.begin():
            entry_ids = session.execute(
                sa.select(watchlist_entries.c.id).where(
                    watchlist_entries.c.watchlist_id == watchlist_id,
                    watchlist_entries.c.workspace_id == context.workspace_id,
                    watchlist_entries.c.project_id == context.project_id,
                )
            ).scalars().all()
            owned = session.execute(
                sa.select(watchlists.c.id).where(
                    watchlists.c.id == watchlist_id,
                    watchlists.c.workspace_id == context.workspace_id,
                    watchlists.c.project_id == context.project_id,
                )
            ).scalar_one_or_none()
            if owned is None:
                return False
            if entry_ids:
                session.execute(
                    sa.delete(digest_reports).where(
                        digest_reports.c.entry_id.in_(entry_ids)
                    )
                )
            session.execute(
                sa.delete(watchlist_entries).where(
                    watchlist_entries.c.watchlist_id == watchlist_id,
                    watchlist_entries.c.workspace_id == context.workspace_id,
                    watchlist_entries.c.project_id == context.project_id,
                )
            )
            session.execute(
                sa.delete(watchlists).where(
                    watchlists.c.id == watchlist_id,
                    watchlists.c.workspace_id == context.workspace_id,
                    watchlists.c.project_id == context.project_id,
                )
            )
            return True

    def add_entry(
        self,
        watchlist_id: str,
        req: WatchlistEntryCreate,
    ) -> WatchlistEntry | None:
        context = self._context()
        with self._session() as session, session.begin():
            owned = session.execute(
                sa.select(watchlists.c.id).where(
                    watchlists.c.id == watchlist_id,
                    watchlists.c.workspace_id == context.workspace_id,
                    watchlists.c.project_id == context.project_id,
                )
            ).scalar_one_or_none()
            if owned is None:
                return None
            entry = WatchlistEntry(
                id=_new_id(),
                watchlist_id=watchlist_id,
                url=req.url,
                label=req.label,
                source_type=req.source_type,
                check_interval_hours=req.check_interval_hours,
                created_at=_now(),
            )
            session.execute(
                sa.insert(watchlist_entries).values(
                    id=entry.id,
                    watchlist_id=watchlist_id,
                    url=entry.url,
                    label=entry.label or None,
                    source_type=_value(entry.source_type),
                    check_interval_hours=entry.check_interval_hours,
                    last_snapshot_hash="",
                    created_at=entry.created_at,
                    workspace_id=context.workspace_id,
                    project_id=context.project_id,
                    created_by_user_id=context.app_user_id,
                )
            )
        return entry

    def get_entry(self, entry_id: str) -> WatchlistEntry | None:
        context = self._context()
        with self._session() as session:
            row = session.execute(
                sa.select(watchlist_entries).where(
                    watchlist_entries.c.id == entry_id,
                    watchlist_entries.c.workspace_id == context.workspace_id,
                    watchlist_entries.c.project_id == context.project_id,
                )
            ).mappings().first()
        return _entry(row) if row else None

    def list_entries(self, watchlist_id: str) -> list[WatchlistEntry]:
        context = self._context()
        with self._session() as session:
            rows = session.execute(
                sa.select(watchlist_entries).where(
                    watchlist_entries.c.watchlist_id == watchlist_id,
                    watchlist_entries.c.workspace_id == context.workspace_id,
                    watchlist_entries.c.project_id == context.project_id,
                ).order_by(watchlist_entries.c.created_at.desc())
            ).mappings().all()
        return [_entry(row) for row in rows]

    def delete_entry(self, entry_id: str) -> bool:
        context = self._context()
        with self._session() as session, session.begin():
            owned = session.execute(
                sa.select(watchlist_entries.c.id).where(
                    watchlist_entries.c.id == entry_id,
                    watchlist_entries.c.workspace_id == context.workspace_id,
                    watchlist_entries.c.project_id == context.project_id,
                )
            ).scalar_one_or_none()
            if owned is None:
                return False
            session.execute(
                sa.delete(digest_reports).where(digest_reports.c.entry_id == entry_id)
            )
            session.execute(
                sa.delete(watchlist_entries).where(
                    watchlist_entries.c.id == entry_id,
                    watchlist_entries.c.workspace_id == context.workspace_id,
                    watchlist_entries.c.project_id == context.project_id,
                )
            )
            return True

    def update_snapshot_hash(self, entry_id: str, hash_val: str) -> None:
        context = self._context()
        with self._session() as session, session.begin():
            session.execute(
                sa.update(watchlist_entries)
                .where(
                    watchlist_entries.c.id == entry_id,
                    watchlist_entries.c.workspace_id == context.workspace_id,
                    watchlist_entries.c.project_id == context.project_id,
                )
                .values(last_snapshot_hash=hash_val, last_checked_at=_now())
            )

    def store_diff(self, entry_id: str, diff: DiffResult) -> None:
        if self.get_entry(entry_id) is None:
            return
        with self._session() as session, session.begin():
            session.execute(
                sa.insert(digest_reports).values(
                    id=_new_id(),
                    entry_id=entry_id,
                    status="completed",
                    changes_detected=1 if diff.changes_detected else 0,
                    diff_json=json.dumps(diff.model_dump(mode="json"), ensure_ascii=False),
                    summary=diff.summary or None,
                    created_at=diff.checked_at,
                )
            )
            stale_ids = session.execute(
                sa.select(digest_reports.c.id)
                .where(digest_reports.c.entry_id == entry_id)
                .order_by(digest_reports.c.created_at.desc())
                .offset(self._MAX_DIFFS_PER_ENTRY)
            ).scalars().all()
            if stale_ids:
                session.execute(
                    sa.delete(digest_reports).where(digest_reports.c.id.in_(stale_ids))
                )

    def get_diffs(self, entry_id: str, limit: int = 10) -> list[DiffResult]:
        context = self._context()
        with self._session() as session:
            rows = session.execute(
                sa.select(digest_reports.c.diff_json)
                .join(
                    watchlist_entries,
                    watchlist_entries.c.id == digest_reports.c.entry_id,
                )
                .where(
                    digest_reports.c.entry_id == entry_id,
                    watchlist_entries.c.workspace_id == context.workspace_id,
                    watchlist_entries.c.project_id == context.project_id,
                )
                .order_by(digest_reports.c.created_at.desc())
                .limit(limit)
            ).scalars().all()
        results: list[DiffResult] = []
        for raw in rows:
            if not raw:
                continue
            try:
                results.append(DiffResult.model_validate_json(raw))
            except (ValueError, TypeError):
                continue
        return results


def _watchlist(row) -> Watchlist:
    return Watchlist(
        id=row["id"],
        name=row["name"],
        description=row["description"] or "",
        project_id=row["project_id"],
        entry_count=int(row.get("entry_count") or 0),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _entry(row) -> WatchlistEntry:
    return WatchlistEntry(
        id=row["id"],
        watchlist_id=row["watchlist_id"],
        url=row["url"],
        label=row["label"] or "",
        source_type=row["source_type"],
        check_interval_hours=row["check_interval_hours"],
        last_checked_at=row["last_checked_at"],
        last_snapshot_hash=row["last_snapshot_hash"] or "",
        created_at=row["created_at"],
    )


class TenantDbJobScheduler(_TenantDbBase, JobScheduler):
    def __init__(self, session_factory: sessionmaker[Session] | None = None) -> None:
        _TenantDbBase.__init__(self, session_factory)
        JobScheduler.__init__(self)

    def create_job(self, req: JobCreate) -> Job:
        context = self._context()
        job = Job(
            id=_new_id(),
            job_type=req.job_type,
            cron_expression=req.cron_expression,
            target_id=req.target_id,
            status=JobStatus.active,
            created_at=_now(),
        )
        with self._session() as session, session.begin():
            self._require_target(session, context, req)
            session.execute(
                sa.insert(jobs).values(
                    id=job.id,
                    job_type=_value(job.job_type),
                    cron_expression=job.cron_expression or None,
                    target_id=job.target_id or None,
                    status=_value(job.status),
                    created_at=job.created_at,
                    workspace_id=context.workspace_id,
                    project_id=context.project_id,
                    created_by_user_id=context.app_user_id,
                )
            )
        return job

    @staticmethod
    def _require_target(session: Session, context, req: JobCreate) -> None:
        if not req.target_id:
            return
        table = (
            watchlists
            if req.job_type == JobType.watchlist_check
            else delivery_configs
        )
        target = session.execute(
            sa.select(table.c.id).where(
                table.c.id == req.target_id,
                table.c.workspace_id == context.workspace_id,
                table.c.project_id == context.project_id,
            )
        ).scalar_one_or_none()
        if target is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target not found")

    def get_job(self, job_id: str) -> Job | None:
        context = self._context()
        with self._session() as session:
            row = session.execute(
                sa.select(jobs).where(
                    jobs.c.id == job_id,
                    jobs.c.workspace_id == context.workspace_id,
                    jobs.c.project_id == context.project_id,
                )
            ).mappings().first()
        return _job(row) if row else None

    def list_jobs(self, job_type: JobType | None = None) -> list[Job]:
        context = self._context()
        query = sa.select(jobs).where(
            jobs.c.workspace_id == context.workspace_id,
            jobs.c.project_id == context.project_id,
        )
        if job_type:
            query = query.where(jobs.c.job_type == _value(job_type))
        with self._session() as session:
            rows = session.execute(
                query.order_by(jobs.c.created_at.desc())
            ).mappings().all()
        return [_job(row) for row in rows]

    def update_job(self, job_id: str, req: JobUpdate) -> Job | None:
        context = self._context()
        values = {"updated_at": _now()}
        if req.cron_expression is not None:
            values["cron_expression"] = req.cron_expression
        if req.status is not None:
            values["status"] = _value(req.status)
        with self._session() as session, session.begin():
            result = session.execute(
                sa.update(jobs)
                .where(
                    jobs.c.id == job_id,
                    jobs.c.workspace_id == context.workspace_id,
                    jobs.c.project_id == context.project_id,
                )
                .values(**values)
            )
            if result.rowcount != 1:
                return None
        return self.get_job(job_id)

    def update_next_run(self, job_id: str, next_run_at: datetime) -> Job | None:
        context = self._context()
        with self._session() as session, session.begin():
            result = session.execute(
                sa.update(jobs)
                .where(
                    jobs.c.id == job_id,
                    jobs.c.workspace_id == context.workspace_id,
                    jobs.c.project_id == context.project_id,
                )
                .values(next_run_at=next_run_at, updated_at=_now())
            )
            if result.rowcount != 1:
                return None
        return self.get_job(job_id)

    def delete_job(self, job_id: str) -> bool:
        context = self._context()
        with self._session() as session, session.begin():
            owned = session.execute(
                sa.select(jobs.c.id).where(
                    jobs.c.id == job_id,
                    jobs.c.workspace_id == context.workspace_id,
                    jobs.c.project_id == context.project_id,
                )
            ).scalar_one_or_none()
            if owned is None:
                return False
            session.execute(sa.delete(job_results).where(job_results.c.job_id == job_id))
            session.execute(
                sa.delete(jobs).where(
                    jobs.c.id == job_id,
                    jobs.c.workspace_id == context.workspace_id,
                    jobs.c.project_id == context.project_id,
                )
            )
            return True

    def record_result(
        self,
        job_id: str,
        result_status: JobResultStatus,
        summary: str = "",
        error: str = "",
    ) -> JobResult:
        context = self._context()
        now = _now()
        result = JobResult(
            id=_new_id(),
            job_id=job_id,
            status=result_status,
            started_at=now,
            completed_at=now,
            result_summary=summary,
            error_message=error,
        )
        with self._session() as session, session.begin():
            owned = session.execute(
                sa.select(jobs.c.id).where(
                    jobs.c.id == job_id,
                    jobs.c.workspace_id == context.workspace_id,
                    jobs.c.project_id == context.project_id,
                )
            ).scalar_one_or_none()
            if owned is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
            session.execute(
                sa.insert(job_results).values(
                    id=result.id,
                    job_id=job_id,
                    status=_value(result.status),
                    started_at=result.started_at,
                    completed_at=result.completed_at,
                    result_json=json.dumps({"summary": summary}, ensure_ascii=False),
                    error_message=error or None,
                )
            )
            session.execute(
                sa.update(jobs)
                .where(
                    jobs.c.id == job_id,
                    jobs.c.workspace_id == context.workspace_id,
                    jobs.c.project_id == context.project_id,
                )
                .values(last_run_at=now, updated_at=now)
            )
        return result

    def get_results(self, job_id: str, limit: int = 10) -> list[JobResult]:
        context = self._context()
        with self._session() as session:
            rows = session.execute(
                sa.select(job_results)
                .join(jobs, jobs.c.id == job_results.c.job_id)
                .where(
                    job_results.c.job_id == job_id,
                    jobs.c.workspace_id == context.workspace_id,
                    jobs.c.project_id == context.project_id,
                )
                .order_by(job_results.c.started_at.desc())
                .limit(limit)
            ).mappings().all()
        return [_job_result(row) for row in rows]


def _job(row) -> Job:
    return Job(
        id=row["id"],
        job_type=row["job_type"],
        cron_expression=row["cron_expression"] or "",
        target_id=row["target_id"] or "",
        status=row["status"],
        last_run_at=row["last_run_at"],
        next_run_at=row["next_run_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _job_result(row) -> JobResult:
    summary = ""
    if row["result_json"]:
        try:
            summary = json.loads(row["result_json"]).get("summary", "")
        except (TypeError, ValueError):
            summary = ""
    return JobResult(
        id=row["id"],
        job_id=row["job_id"],
        status=row["status"],
        started_at=row["started_at"],
        completed_at=row["completed_at"],
        result_summary=summary,
        error_message=row["error_message"] or "",
    )


class InMemoryDeliveryRepository:
    """Local/test-only store preserving the existing route behavior."""

    def __init__(self) -> None:
        self._configs: dict[str, DeliveryConfig] = {}
        self._logs: dict[str, list[DeliveryLog]] = {}

    def count_configs(self) -> int:
        return len(self._configs)

    def create_config(self, req: DeliveryConfigCreate) -> DeliveryConfig:
        config = DeliveryConfig(
            id=_new_id(),
            channel=req.channel,
            target=req.target,
            enabled=req.enabled,
            config_json=req.config_json,
            created_at=_now(),
        )
        self._configs[config.id] = config
        return config

    def list_configs(self) -> list[DeliveryConfig]:
        return sorted(self._configs.values(), key=lambda item: item.created_at, reverse=True)

    def get_config(self, config_id: str) -> DeliveryConfig | None:
        return self._configs.get(config_id)

    def update_config(
        self,
        config_id: str,
        req: DeliveryConfigUpdate,
    ) -> DeliveryConfig | None:
        config = self._configs.get(config_id)
        if config is None:
            return None
        values = {"updated_at": _now()}
        if req.target is not None:
            values["target"] = req.target
        if req.enabled is not None:
            values["enabled"] = req.enabled
        if req.config_json is not None:
            values["config_json"] = req.config_json
        updated = config.model_copy(update=values)
        self._configs[config_id] = updated
        return updated

    def delete_config(self, config_id: str) -> bool:
        if config_id not in self._configs:
            return False
        del self._configs[config_id]
        self._logs.pop(config_id, None)
        return True

    def save_log(self, log: DeliveryLog) -> DeliveryLog:
        self._logs.setdefault(log.config_id, []).append(log)
        return log

    def approve_log(self, log_id: str) -> DeliveryLog | None:
        for logs in self._logs.values():
            for index, log in enumerate(logs):
                if log.id == log_id and log.status == DeliveryStatus.pending_approval:
                    approved = log.model_copy(update={"status": DeliveryStatus.approved})
                    logs[index] = approved
                    return approved
        return None

    def list_logs(self, config_id: str) -> list[DeliveryLog]:
        return list(reversed(self._logs.get(config_id, [])))


class TenantDbDeliveryRepository(_TenantDbBase):
    def count_configs(self) -> int:
        context = self._context()
        with self._session() as session:
            return int(
                session.execute(
                    sa.select(sa.func.count()).select_from(delivery_configs).where(
                        delivery_configs.c.workspace_id == context.workspace_id,
                        delivery_configs.c.project_id == context.project_id,
                    )
                ).scalar_one()
            )

    def create_config(self, req: DeliveryConfigCreate) -> DeliveryConfig:
        context = self._context()
        config = DeliveryConfig(
            id=_new_id(),
            channel=req.channel,
            target=req.target,
            enabled=req.enabled,
            config_json=req.config_json,
            created_at=_now(),
        )
        with self._session() as session, session.begin():
            session.execute(
                sa.insert(delivery_configs).values(
                    id=config.id,
                    channel=_value(config.channel),
                    target=config.target,
                    enabled=1 if config.enabled else 0,
                    config_json=json.dumps(config.config_json, ensure_ascii=False),
                    created_at=config.created_at,
                    workspace_id=context.workspace_id,
                    project_id=context.project_id,
                    created_by_user_id=context.app_user_id,
                )
            )
        return config

    def list_configs(self) -> list[DeliveryConfig]:
        context = self._context()
        with self._session() as session:
            rows = session.execute(
                sa.select(delivery_configs).where(
                    delivery_configs.c.workspace_id == context.workspace_id,
                    delivery_configs.c.project_id == context.project_id,
                ).order_by(delivery_configs.c.created_at.desc())
            ).mappings().all()
        return [_delivery_config(row) for row in rows]

    def get_config(self, config_id: str) -> DeliveryConfig | None:
        context = self._context()
        with self._session() as session:
            row = session.execute(
                sa.select(delivery_configs).where(
                    delivery_configs.c.id == config_id,
                    delivery_configs.c.workspace_id == context.workspace_id,
                    delivery_configs.c.project_id == context.project_id,
                )
            ).mappings().first()
        return _delivery_config(row) if row else None

    def update_config(
        self,
        config_id: str,
        req: DeliveryConfigUpdate,
    ) -> DeliveryConfig | None:
        context = self._context()
        values = {"updated_at": _now()}
        if req.target is not None:
            values["target"] = req.target
        if req.enabled is not None:
            values["enabled"] = 1 if req.enabled else 0
        if req.config_json is not None:
            values["config_json"] = json.dumps(req.config_json, ensure_ascii=False)
        with self._session() as session, session.begin():
            result = session.execute(
                sa.update(delivery_configs)
                .where(
                    delivery_configs.c.id == config_id,
                    delivery_configs.c.workspace_id == context.workspace_id,
                    delivery_configs.c.project_id == context.project_id,
                )
                .values(**values)
            )
            if result.rowcount != 1:
                return None
        return self.get_config(config_id)

    def delete_config(self, config_id: str) -> bool:
        context = self._context()
        with self._session() as session, session.begin():
            owned = session.execute(
                sa.select(delivery_configs.c.id).where(
                    delivery_configs.c.id == config_id,
                    delivery_configs.c.workspace_id == context.workspace_id,
                    delivery_configs.c.project_id == context.project_id,
                )
            ).scalar_one_or_none()
            if owned is None:
                return False
            session.execute(
                sa.delete(delivery_logs).where(delivery_logs.c.config_id == config_id)
            )
            session.execute(
                sa.delete(delivery_configs).where(
                    delivery_configs.c.id == config_id,
                    delivery_configs.c.workspace_id == context.workspace_id,
                    delivery_configs.c.project_id == context.project_id,
                )
            )
            return True

    def save_log(self, log: DeliveryLog) -> DeliveryLog:
        context = self._context()
        with self._session() as session, session.begin():
            owned = session.execute(
                sa.select(delivery_configs.c.id).where(
                    delivery_configs.c.id == log.config_id,
                    delivery_configs.c.workspace_id == context.workspace_id,
                    delivery_configs.c.project_id == context.project_id,
                )
            ).scalar_one_or_none()
            if owned is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Config not found")
            session.execute(
                sa.insert(delivery_logs).values(
                    id=log.id,
                    config_id=log.config_id,
                    status=_value(log.status),
                    digest_id=log.digest_id or None,
                    sent_at=log.sent_at,
                    error_message=log.error_message or None,
                )
            )
        return log

    def approve_log(self, log_id: str) -> DeliveryLog | None:
        context = self._context()
        with self._session() as session, session.begin():
            row = session.execute(
                sa.select(delivery_logs)
                .join(delivery_configs, delivery_configs.c.id == delivery_logs.c.config_id)
                .where(
                    delivery_logs.c.id == log_id,
                    delivery_logs.c.status == DeliveryStatus.pending_approval.value,
                    delivery_configs.c.workspace_id == context.workspace_id,
                    delivery_configs.c.project_id == context.project_id,
                )
            ).mappings().first()
            if row is None:
                return None
            session.execute(
                sa.update(delivery_logs)
                .where(delivery_logs.c.id == log_id)
                .values(status=DeliveryStatus.approved.value)
            )
        return _delivery_log({**row, "status": DeliveryStatus.approved.value})

    def list_logs(self, config_id: str) -> list[DeliveryLog]:
        context = self._context()
        with self._session() as session:
            rows = session.execute(
                sa.select(delivery_logs)
                .join(delivery_configs, delivery_configs.c.id == delivery_logs.c.config_id)
                .where(
                    delivery_logs.c.config_id == config_id,
                    delivery_configs.c.workspace_id == context.workspace_id,
                    delivery_configs.c.project_id == context.project_id,
                )
                .order_by(delivery_logs.c.sent_at.desc(), delivery_logs.c.id.desc())
            ).mappings().all()
        return [_delivery_log(row) for row in rows]


def _delivery_config(row) -> DeliveryConfig:
    config = {}
    if row["config_json"]:
        try:
            config = json.loads(row["config_json"])
        except (TypeError, ValueError):
            config = {}
    return DeliveryConfig(
        id=row["id"],
        channel=row["channel"],
        target=row["target"],
        enabled=bool(row["enabled"]),
        config_json=config,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _delivery_log(row) -> DeliveryLog:
    return DeliveryLog(
        id=row["id"],
        config_id=row["config_id"],
        status=row["status"],
        digest_id=row["digest_id"] or "",
        sent_at=row["sent_at"],
        error_message=row["error_message"] or "",
    )
