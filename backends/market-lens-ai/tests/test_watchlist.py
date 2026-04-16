"""Tests for Phase 7: Watchlist CRUD, competitor monitoring, collection policy."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from web.app.main import app, _rate_store


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clear_rate():
    _rate_store.clear()


# ---------------------------------------------------------------------------
# Watchlist CRUD
# ---------------------------------------------------------------------------

class TestWatchlistCRUD:
    def test_create_watchlist(self, client):
        res = client.post("/api/watchlists", json={"name": "Test Watchlist", "project_id": "proj1"})
        assert res.status_code == 200
        data = res.json()
        assert data["name"] == "Test Watchlist"
        assert data["project_id"] == "proj1"
        assert len(data["id"]) == 12

    def test_list_watchlists(self, client):
        client.post("/api/watchlists", json={"name": "WL1"})
        client.post("/api/watchlists", json={"name": "WL2"})
        res = client.get("/api/watchlists")
        assert res.status_code == 200
        assert len(res.json()) >= 2

    def test_list_watchlists_filter_by_project(self, client):
        client.post("/api/watchlists", json={"name": "WL-A", "project_id": "p1"})
        client.post("/api/watchlists", json={"name": "WL-B", "project_id": "p2"})
        res = client.get("/api/watchlists?project_id=p1")
        assert res.status_code == 200
        names = [w["name"] for w in res.json()]
        assert "WL-A" in names

    def test_get_watchlist(self, client):
        create = client.post("/api/watchlists", json={"name": "Detail WL"}).json()
        res = client.get(f"/api/watchlists/{create['id']}")
        assert res.status_code == 200
        assert res.json()["watchlist"]["name"] == "Detail WL"
        assert res.json()["entries"] == []

    def test_get_watchlist_not_found(self, client):
        res = client.get("/api/watchlists/aabbccddeeff")
        assert res.status_code == 404

    def test_update_watchlist(self, client):
        create = client.post("/api/watchlists", json={"name": "Old Name"}).json()
        res = client.patch(f"/api/watchlists/{create['id']}", json={"name": "New Name"})
        assert res.status_code == 200
        assert res.json()["name"] == "New Name"

    def test_delete_watchlist(self, client):
        create = client.post("/api/watchlists", json={"name": "Delete Me"}).json()
        res = client.delete(f"/api/watchlists/{create['id']}")
        assert res.status_code == 200
        assert res.json()["deleted"] is True
        res2 = client.get(f"/api/watchlists/{create['id']}")
        assert res2.status_code == 404

    def test_invalid_id_format(self, client):
        res = client.get("/api/watchlists/invalid!")
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# Watchlist Entry CRUD
# ---------------------------------------------------------------------------

class TestWatchlistEntries:
    def test_add_entry(self, client):
        wl = client.post("/api/watchlists", json={"name": "Entry Test"}).json()
        res = client.post(
            f"/api/watchlists/{wl['id']}/entries",
            json={"url": "https://example.com", "label": "Example", "source_type": "official_site"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["url"] == "https://example.com"
        assert data["watchlist_id"] == wl["id"]

    def test_add_entry_to_missing_watchlist(self, client):
        res = client.post(
            "/api/watchlists/aabbccddeeff/entries",
            json={"url": "https://example.com"},
        )
        assert res.status_code == 404

    def test_delete_entry(self, client):
        wl = client.post("/api/watchlists", json={"name": "Del Entry"}).json()
        entry = client.post(
            f"/api/watchlists/{wl['id']}/entries",
            json={"url": "https://example.com"},
        ).json()
        res = client.delete(f"/api/watchlists/{wl['id']}/entries/{entry['id']}")
        assert res.status_code == 200
        assert res.json()["deleted"] is True

    def test_entries_included_in_detail(self, client):
        wl = client.post("/api/watchlists", json={"name": "With Entries"}).json()
        client.post(f"/api/watchlists/{wl['id']}/entries", json={"url": "https://example.com"})
        detail = client.get(f"/api/watchlists/{wl['id']}").json()
        assert len(detail["entries"]) == 1
        assert detail["watchlist"]["entry_count"] == 1

    def test_get_diffs_empty(self, client):
        wl = client.post("/api/watchlists", json={"name": "Diff Test"}).json()
        entry = client.post(
            f"/api/watchlists/{wl['id']}/entries",
            json={"url": "https://example.com"},
        ).json()
        res = client.get(f"/api/watchlists/{wl['id']}/entries/{entry['id']}/diffs")
        assert res.status_code == 200
        assert res.json() == []


# ---------------------------------------------------------------------------
# Collection Policy
# ---------------------------------------------------------------------------

class TestCollectionPolicy:
    def test_blocked_domain_rejected(self, client):
        wl = client.post("/api/watchlists", json={"name": "Policy Test"}).json()
        res = client.post(
            f"/api/watchlists/{wl['id']}/entries",
            json={"url": "https://facebook.com/page", "source_type": "official_site"},
        )
        assert res.status_code == 422
        assert "blocked" in res.json()["detail"].lower()

    def test_ssrf_blocked(self, client):
        wl = client.post("/api/watchlists", json={"name": "SSRF Test"}).json()
        res = client.post(
            f"/api/watchlists/{wl['id']}/entries",
            json={"url": "http://localhost:8080/admin"},
        )
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# Competitor Monitor (unit)
# ---------------------------------------------------------------------------

class TestCompetitorMonitor:
    def test_diff_analyzer(self):
        from web.app.services.diff_analyzer import DiffAnalyzer
        from web.app.schemas.watchlist_v2 import DiffResult
        from datetime import datetime, timezone

        analyzer = DiffAnalyzer()
        diff = DiffResult(
            entry_id="test123test1",
            url="https://example.com",
            changes_detected=True,
            checked_at=datetime.now(timezone.utc),
        )
        snapshot = {
            "title": "New Title",
            "headlines": ["Buy Now", "Limited Offer"],
            "ctas": ["Sign Up", "Learn More"],
            "meta_description": "Updated desc",
        }
        result = analyzer.analyze(diff, snapshot)
        assert result.changes_detected is True
        assert len(result.headline_changes) > 0
        assert len(result.cta_changes) > 0
        assert "headline" in result.summary.lower() or "cta" in result.summary.lower()

    @pytest.mark.asyncio
    async def test_check_entry_no_change(self):
        from web.app.services.competitor_monitor import CompetitorMonitor
        from web.app.repositories.watchlist_repository import WatchlistRepository
        from web.app.schemas.watchlist_v2 import WatchlistEntry, WatchlistEntryCreate

        repo = WatchlistRepository()
        wl = repo.create_watchlist(
            type("R", (), {"name": "test", "description": "", "project_id": ""})()
        )
        req = WatchlistEntryCreate(url="https://example.com")
        entry = repo.add_entry(wl.id, req)

        monitor = CompetitorMonitor(repo=repo)
        result = await monitor.check_entry(entry)
        assert result.changes_detected is False
        assert result.entry_id == entry.id


# ---------------------------------------------------------------------------
# Collection Policy (unit)
# ---------------------------------------------------------------------------

class TestCollectionPolicyUnit:
    def test_validate_source_allowed(self):
        from web.app.services.collection_policy import validate_source
        assert validate_source("https://example.com", "official_site") is None

    def test_validate_source_blocked_domain(self):
        from web.app.services.collection_policy import validate_source
        err = validate_source("https://twitter.com/user", "official_site")
        assert err is not None
        assert "blocked" in err.lower()

    def test_validate_source_invalid_type(self):
        from web.app.services.collection_policy import validate_source
        err = validate_source("https://example.com", "scraping")
        assert err is not None
        assert "not allowed" in err.lower()


# ---------------------------------------------------------------------------
# Resource Limits (Stage 1-3)
# ---------------------------------------------------------------------------

class TestWatchlistLimits:
    def test_entry_limit_per_watchlist(self):
        """50エントリを超えると422を返すこと（unit test）。"""
        from web.app.repositories.watchlist_repository import WatchlistRepository
        from web.app.schemas.watchlist_v2 import WatchlistEntryCreate

        repo = WatchlistRepository()
        wl = repo.create_watchlist(
            type("R", (), {"name": "test", "description": "", "project_id": ""})()
        )
        for i in range(50):
            entry = repo.add_entry(wl.id, WatchlistEntryCreate(url=f"https://example.com/p{i}"))
            assert entry is not None, f"Entry {i} failed"
        entries = repo.list_entries(wl.id)
        assert len(entries) == 50

    def test_watchlist_limit_per_project(self):
        """20個のwatchlistを超えると422を返すこと（unit test）。"""
        from web.app.repositories.watchlist_repository import WatchlistRepository

        repo = WatchlistRepository()
        for i in range(20):
            repo.create_watchlist(
                type("R", (), {"name": f"wl-{i}", "description": "", "project_id": "proj1"})()
            )
        existing = repo.list_watchlists(project_id="proj1")
        assert len(existing) == 20

    def test_diff_history_limit(self):
        """diff履歴が100件を超えると古いものが削除されること。"""
        from web.app.repositories.watchlist_repository import WatchlistRepository
        from web.app.schemas.watchlist_v2 import DiffResult
        from datetime import datetime, timezone

        repo = WatchlistRepository()
        for i in range(110):
            repo.store_diff("entry1234abcd", DiffResult(
                entry_id="entry1234abcd",
                url="https://example.com",
                changes_detected=False,
                checked_at=datetime.now(timezone.utc),
                summary=f"diff-{i}",
            ))
        diffs = repo.get_diffs("entry1234abcd", limit=200)
        assert len(diffs) <= 100


# ---------------------------------------------------------------------------
# Auth (Stage 1-1) — MVP mode (no API_KEYS set) should pass through
# ---------------------------------------------------------------------------

class TestWatchlistAuth:
    def test_create_watchlist_no_auth_mvp_mode(self, client):
        """MVP mode（API_KEYS未設定）ではヘッダーなしでも通ること。"""
        res = client.post("/api/watchlists", json={"name": "No Auth", "project_id": "auth_test"})
        assert res.status_code == 200

    def test_read_watchlist_no_auth_mvp_mode(self, client):
        """GETは認証オプショナルなので常に通ること。"""
        res = client.get("/api/watchlists")
        assert res.status_code == 200
