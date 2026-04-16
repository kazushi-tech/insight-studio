"""DB-backed implementation of CreativeReviewRepository using SQLAlchemy Core."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from sqlalchemy import select, delete as sa_delete, update as sa_update
from sqlalchemy.orm import Session, sessionmaker

from ..db.engine import get_engine, get_session, create_tables
from ..db.tables import review_runs, review_outputs, export_records
from .creative_review_repository import (
    CreativeReviewRepository,
    CreativeReviewRun,
    ExportRecord,
    ReviewOutput,
    RunStatus,
    ExportFormat,
)


class DbCreativeReviewRepository(CreativeReviewRepository):
    """Stores creative review data in relational DB."""

    def __init__(self, session_factory: sessionmaker[Session] | None = None) -> None:
        if session_factory is None:
            engine = get_engine()
            create_tables(engine)
            session_factory = get_session(engine)
        self._session_factory = session_factory

    # --- Review Run ---

    def save_run(self, run: CreativeReviewRun) -> None:
        with self._session_factory() as session:
            with session.begin():
                session.execute(
                    review_runs.insert().values(
                        id=run.run_id,
                        asset_id=run.asset_id,
                        review_type=run.review_type,
                        status=run.status.value if hasattr(run.status, "value") else str(run.status),
                        brand_info=run.brand_info or None,
                        operator_memo=run.operator_memo or None,
                        lp_url=run.lp_url,
                        created_at=run.created_at,
                        updated_at=run.created_at,
                    )
                )

    def load_run(self, run_id: str) -> Optional[CreativeReviewRun]:
        with self._session_factory() as session:
            row = session.execute(
                select(review_runs).where(review_runs.c.id == run_id)
            ).first()
            if row is None:
                return None
            return _row_to_run(row)

    def update_run_status(
        self, run_id: str, status: RunStatus, completed_at: Optional[datetime] = None,
    ) -> bool:
        with self._session_factory() as session:
            with session.begin():
                values: dict = {
                    "status": status.value if hasattr(status, "value") else str(status),
                    "updated_at": completed_at or datetime.utcnow(),
                }
                result = session.execute(
                    sa_update(review_runs)
                    .where(review_runs.c.id == run_id)
                    .values(**values)
                )
                return result.rowcount > 0

    def list_runs(self, *, limit: int = 50, offset: int = 0) -> list[CreativeReviewRun]:
        with self._session_factory() as session:
            rows = session.execute(
                select(review_runs)
                .order_by(review_runs.c.created_at.desc())
                .limit(limit)
                .offset(offset)
            ).fetchall()
            return [_row_to_run(r) for r in rows]

    def delete_run(self, run_id: str) -> bool:
        with self._session_factory() as session:
            with session.begin():
                # Delete children first
                session.execute(
                    sa_delete(export_records).where(export_records.c.run_id == run_id)
                )
                session.execute(
                    sa_delete(review_outputs).where(review_outputs.c.run_id == run_id)
                )
                result = session.execute(
                    sa_delete(review_runs).where(review_runs.c.id == run_id)
                )
                return result.rowcount > 0

    # --- Review Output ---

    def save_output(self, output: ReviewOutput) -> None:
        with self._session_factory() as session:
            with session.begin():
                session.execute(
                    review_outputs.insert().values(
                        run_id=output.run_id,
                        output_json=json.dumps(output.output_json),
                        model_used=output.model_used,
                        created_at=output.created_at,
                    )
                )

    def load_output(self, run_id: str) -> Optional[ReviewOutput]:
        with self._session_factory() as session:
            row = session.execute(
                select(review_outputs).where(review_outputs.c.run_id == run_id)
            ).first()
            if row is None:
                return None
            return ReviewOutput(
                run_id=row.run_id,
                output_json=json.loads(row.output_json),
                model_used=row.model_used,
                created_at=row.created_at,
            )

    # --- Export Record ---

    def save_export(self, record: ExportRecord) -> None:
        with self._session_factory() as session:
            with session.begin():
                session.execute(
                    export_records.insert().values(
                        id=record.export_id,
                        run_id=record.run_id,
                        format=record.format.value if hasattr(record.format, "value") else str(record.format),
                        file_name=record.file_path,
                        file_size_bytes=record.file_size_bytes,
                        created_at=record.created_at,
                    )
                )

    def list_exports(self, run_id: str) -> list[ExportRecord]:
        with self._session_factory() as session:
            rows = session.execute(
                select(export_records)
                .where(export_records.c.run_id == run_id)
                .order_by(export_records.c.created_at)
            ).fetchall()
            return [
                ExportRecord(
                    export_id=r.id,
                    run_id=r.run_id,
                    format=ExportFormat(r.format),
                    file_path=r.file_name,
                    file_size_bytes=r.file_size_bytes,
                    created_at=r.created_at,
                )
                for r in rows
            ]


def _row_to_run(row) -> CreativeReviewRun:
    return CreativeReviewRun(
        run_id=row.id,
        asset_id=row.asset_id,
        review_type=row.review_type,
        status=RunStatus(row.status),
        brand_info=row.brand_info or "",
        operator_memo=row.operator_memo or "",
        lp_url=row.lp_url,
        created_at=row.created_at,
        completed_at=None,  # updated_at maps to completed_at conceptually
    )
