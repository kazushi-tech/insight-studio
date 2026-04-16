"""DB-backed implementation of AssetRepository using SQLAlchemy Core."""

from __future__ import annotations

from typing import Optional

from sqlalchemy import select, delete as sa_delete
from sqlalchemy.orm import Session, sessionmaker

from ..db.engine import get_engine, get_session, create_tables
from ..db.tables import assets, asset_data
from ..schemas.creative_asset import CreativeAssetMetadata
from .asset_repository import AssetRepository


class DbAssetRepository(AssetRepository):
    """Stores asset metadata + binary data in relational DB."""

    def __init__(self, session_factory: sessionmaker[Session] | None = None) -> None:
        if session_factory is None:
            engine = get_engine()
            create_tables(engine)
            session_factory = get_session(engine)
        self._session_factory = session_factory

    def save(self, metadata: CreativeAssetMetadata, data: bytes) -> None:
        with self._session_factory() as session:
            with session.begin():
                session.execute(
                    assets.insert().values(
                        id=metadata.asset_id,
                        file_name=metadata.file_name,
                        mime_type=metadata.mime_type,
                        size_bytes=metadata.size_bytes,
                        width=metadata.width,
                        height=metadata.height,
                        asset_type=metadata.asset_type.value if hasattr(metadata.asset_type, "value") else str(metadata.asset_type),
                        created_at=metadata.created_at,
                    )
                )
                session.execute(
                    asset_data.insert().values(
                        asset_id=metadata.asset_id,
                        data=data,
                    )
                )

    def load_metadata(self, asset_id: str) -> Optional[CreativeAssetMetadata]:
        with self._session_factory() as session:
            row = session.execute(
                select(assets).where(assets.c.id == asset_id)
            ).first()
            if row is None:
                return None
            return _row_to_metadata(row)

    def load_data(self, asset_id: str) -> Optional[bytes]:
        with self._session_factory() as session:
            row = session.execute(
                select(asset_data.c.data).where(asset_data.c.asset_id == asset_id)
            ).first()
            if row is None:
                return None
            return row.data

    def delete(self, asset_id: str) -> bool:
        with self._session_factory() as session:
            with session.begin():
                # Delete asset_data first (child), then assets (parent)
                session.execute(
                    sa_delete(asset_data).where(asset_data.c.asset_id == asset_id)
                )
                result = session.execute(
                    sa_delete(assets).where(assets.c.id == asset_id)
                )
                return result.rowcount > 0

    def list_all(self) -> list[CreativeAssetMetadata]:
        with self._session_factory() as session:
            rows = session.execute(
                select(assets).order_by(assets.c.created_at.desc())
            ).fetchall()
            return [_row_to_metadata(r) for r in rows]


def _row_to_metadata(row) -> CreativeAssetMetadata:
    return CreativeAssetMetadata(
        asset_id=row.id,
        file_name=row.file_name,
        mime_type=row.mime_type,
        size_bytes=row.size_bytes,
        width=row.width,
        height=row.height,
        asset_type=row.asset_type,
        created_at=row.created_at,
    )
