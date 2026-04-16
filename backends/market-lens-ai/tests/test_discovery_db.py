"""Tests for discovery DB persistence (M5.2)."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from web.app.db.engine import create_tables
from web.app.db.tables import discovery_candidates, discovery_searches, metadata


@pytest.fixture
def db_session():
    """In-memory SQLite session for testing."""
    from sqlalchemy import event

    engine = create_engine("sqlite:///:memory:")

    # Enable foreign key enforcement for SQLite
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as session:
        yield session


class TestDiscoveryTables:
    """Tests for discovery table schema."""

    def test_tables_created(self, db_session):
        """Discovery tables exist after create_all."""
        # Just verify we can query without error
        rows = db_session.execute(select(discovery_searches)).all()
        assert rows == []
        rows = db_session.execute(select(discovery_candidates)).all()
        assert rows == []

    def test_insert_search(self, db_session):
        """Can insert a discovery search record."""
        from datetime import datetime, timezone

        db_session.execute(
            discovery_searches.insert().values(
                id="aabbccddeeff",
                brand_url="https://example.com",
                brand_domain="example.com",
                query_used="example competitors",
                provider="cse",
                result_count=5,
                created_at=datetime.now(timezone.utc),
            )
        )
        db_session.commit()
        rows = db_session.execute(select(discovery_searches)).all()
        assert len(rows) == 1
        assert rows[0].brand_domain == "example.com"

    def test_insert_candidate(self, db_session):
        """Can insert a discovery candidate linked to a search."""
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        db_session.execute(
            discovery_searches.insert().values(
                id="aabbccddeeff",
                brand_url="https://example.com",
                brand_domain="example.com",
                query_used="example competitors",
                provider="cse",
                result_count=1,
                created_at=now,
            )
        )
        db_session.execute(
            discovery_candidates.insert().values(
                id="112233445566",
                search_id="aabbccddeeff",
                url="https://competitor.com",
                domain="competitor.com",
                title="Comp",
                snippet="A rival",
                score=75,
                status="pending",
                created_at=now,
            )
        )
        db_session.commit()
        rows = db_session.execute(select(discovery_candidates)).all()
        assert len(rows) == 1
        assert rows[0].score == 75
        assert rows[0].status == "pending"

    def test_cascade_delete(self, db_session):
        """Deleting a search cascades to its candidates."""
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        db_session.execute(
            discovery_searches.insert().values(
                id="aabbccddeeff",
                brand_url="https://example.com",
                brand_domain="example.com",
                query_used="query",
                provider="cse",
                result_count=1,
                created_at=now,
            )
        )
        db_session.execute(
            discovery_candidates.insert().values(
                id="112233445566",
                search_id="aabbccddeeff",
                url="https://comp.com",
                domain="comp.com",
                title="T",
                snippet="S",
                score=50,
                status="pending",
                created_at=now,
            )
        )
        db_session.commit()

        db_session.execute(
            discovery_searches.delete().where(discovery_searches.c.id == "aabbccddeeff")
        )
        db_session.commit()

        candidates = db_session.execute(select(discovery_candidates)).all()
        assert len(candidates) == 0

    def test_update_candidate_status(self, db_session):
        """Can update candidate status."""
        from datetime import datetime, timezone
        from sqlalchemy import update

        now = datetime.now(timezone.utc)
        db_session.execute(
            discovery_searches.insert().values(
                id="aabbccddeeff",
                brand_url="https://example.com",
                brand_domain="example.com",
                query_used="query",
                provider="cse",
                result_count=1,
                created_at=now,
            )
        )
        db_session.execute(
            discovery_candidates.insert().values(
                id="112233445566",
                search_id="aabbccddeeff",
                url="https://comp.com",
                domain="comp.com",
                title="T",
                snippet="S",
                score=50,
                status="pending",
                created_at=now,
            )
        )
        db_session.commit()

        db_session.execute(
            update(discovery_candidates)
            .where(discovery_candidates.c.id == "112233445566")
            .values(status="approved", updated_at=now)
        )
        db_session.commit()

        row = db_session.execute(
            select(discovery_candidates).where(discovery_candidates.c.id == "112233445566")
        ).first()
        assert row.status == "approved"
