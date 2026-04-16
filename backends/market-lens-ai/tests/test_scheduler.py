"""Tests for Phase 8: Scheduler, Runner, and Delivery."""

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
# Job Scheduler CRUD
# ---------------------------------------------------------------------------

class TestJobCRUD:
    def test_create_job(self, client):
        res = client.post("/api/jobs", json={
            "job_type": "watchlist_check",
            "cron_expression": "0 9 * * *",
            "target_id": "aabbccddeeff",
        })
        assert res.status_code == 200
        data = res.json()
        assert data["job_type"] == "watchlist_check"
        assert data["status"] == "active"

    def test_list_jobs(self, client):
        client.post("/api/jobs", json={"job_type": "watchlist_check"})
        res = client.get("/api/jobs")
        assert res.status_code == 200
        assert len(res.json()) >= 1

    def test_list_jobs_filter(self, client):
        client.post("/api/jobs", json={"job_type": "watchlist_check"})
        client.post("/api/jobs", json={"job_type": "digest_delivery"})
        res = client.get("/api/jobs?job_type=digest_delivery")
        assert res.status_code == 200
        for j in res.json():
            assert j["job_type"] == "digest_delivery"

    def test_get_job(self, client):
        created = client.post("/api/jobs", json={"job_type": "watchlist_check"}).json()
        res = client.get(f"/api/jobs/{created['id']}")
        assert res.status_code == 200
        assert res.json()["id"] == created["id"]

    def test_get_job_not_found(self, client):
        res = client.get("/api/jobs/aabbccddeeff")
        assert res.status_code == 404

    def test_update_job(self, client):
        created = client.post("/api/jobs", json={"job_type": "watchlist_check"}).json()
        res = client.patch(f"/api/jobs/{created['id']}", json={"status": "paused"})
        assert res.status_code == 200
        assert res.json()["status"] == "paused"

    def test_delete_job(self, client):
        created = client.post("/api/jobs", json={"job_type": "watchlist_check"}).json()
        res = client.delete(f"/api/jobs/{created['id']}")
        assert res.status_code == 200
        assert client.get(f"/api/jobs/{created['id']}").status_code == 404

    def test_invalid_id(self, client):
        res = client.get("/api/jobs/badid!!")
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# Job Execution
# ---------------------------------------------------------------------------

class TestJobExecution:
    def test_run_job(self, client):
        created = client.post("/api/jobs", json={"job_type": "watchlist_check"}).json()
        res = client.post(f"/api/jobs/{created['id']}/run")
        assert res.status_code == 200
        assert res.json()["executed"] is True

    def test_run_paused_job_skipped(self, client):
        created = client.post("/api/jobs", json={"job_type": "watchlist_check"}).json()
        client.patch(f"/api/jobs/{created['id']}", json={"status": "paused"})
        res = client.post(f"/api/jobs/{created['id']}/run")
        assert res.status_code == 200
        assert res.json()["executed"] is False

    def test_job_results_recorded(self, client):
        created = client.post("/api/jobs", json={"job_type": "watchlist_check"}).json()
        client.post(f"/api/jobs/{created['id']}/run")
        res = client.get(f"/api/jobs/{created['id']}/results")
        assert res.status_code == 200
        assert len(res.json()) >= 1
        assert res.json()[0]["status"] == "success"

    def test_run_all_jobs(self, client):
        client.post("/api/jobs", json={"job_type": "watchlist_check"})
        client.post("/api/jobs", json={"job_type": "digest_delivery"})
        res = client.post("/api/jobs/run-all")
        assert res.status_code == 200
        assert res.json()["executed_count"] >= 2


# ---------------------------------------------------------------------------
# Idempotency (unit)
# ---------------------------------------------------------------------------

class TestIdempotency:
    @pytest.mark.asyncio
    async def test_try_acquire_prevents_double_run(self):
        from web.app.jobs.scheduler import JobScheduler
        sched = JobScheduler()
        job = sched.create_job(
            type("R", (), {"job_type": "watchlist_check", "cron_expression": "0 9 * * *", "target_id": ""})()
        )
        assert await sched.try_acquire(job.id) is True
        assert await sched.try_acquire(job.id) is False
        await sched.release(job.id)
        assert await sched.try_acquire(job.id) is True

    @pytest.mark.asyncio
    async def test_is_running(self):
        from web.app.jobs.scheduler import JobScheduler
        sched = JobScheduler()
        job = sched.create_job(
            type("R", (), {"job_type": "watchlist_check", "cron_expression": "", "target_id": ""})()
        )
        assert sched.is_running(job.id) is False
        await sched.try_acquire(job.id)
        assert sched.is_running(job.id) is True


# ---------------------------------------------------------------------------
# Delivery Config CRUD
# ---------------------------------------------------------------------------

class TestDeliveryCRUD:
    def test_create_email_config(self, client):
        res = client.post("/api/delivery/settings", json={
            "channel": "email",
            "target": "user@example.com",
        })
        assert res.status_code == 200
        data = res.json()
        assert data["channel"] == "email"
        assert data["enabled"] is True

    def test_create_slack_config(self, client):
        res = client.post("/api/delivery/settings", json={
            "channel": "slack",
            "target": "https://hooks.slack.com/services/T000/B000/xxx",
        })
        assert res.status_code == 200
        assert res.json()["channel"] == "slack"

    def test_list_configs(self, client):
        client.post("/api/delivery/settings", json={"channel": "email", "target": "a@b.com"})
        res = client.get("/api/delivery/settings")
        assert res.status_code == 200
        assert len(res.json()) >= 1

    def test_update_config(self, client):
        created = client.post("/api/delivery/settings", json={"channel": "email", "target": "old@b.com"}).json()
        res = client.patch(f"/api/delivery/settings/{created['id']}", json={"target": "new@b.com"})
        assert res.status_code == 200
        assert res.json()["target"] == "new@b.com"

    def test_delete_config(self, client):
        created = client.post("/api/delivery/settings", json={"channel": "email", "target": "del@b.com"}).json()
        res = client.delete(f"/api/delivery/settings/{created['id']}")
        assert res.status_code == 200
        assert client.get(f"/api/delivery/settings/{created['id']}").status_code == 404


# ---------------------------------------------------------------------------
# Delivery Send + Approval
# ---------------------------------------------------------------------------

class TestDeliverySend:
    def test_send_email(self, client):
        config = client.post("/api/delivery/settings", json={"channel": "email", "target": "user@test.com"}).json()
        res = client.post("/api/delivery/send", json={
            "config_id": config["id"],
            "digest_id": "aabbccddeeff",
        })
        assert res.status_code == 200
        assert res.json()["status"] == "sent"

    def test_send_disabled_config(self, client):
        config = client.post("/api/delivery/settings", json={"channel": "email", "target": "x@y.com"}).json()
        client.patch(f"/api/delivery/settings/{config['id']}", json={"enabled": False})
        res = client.post("/api/delivery/send", json={
            "config_id": config["id"],
            "digest_id": "aabbccddeeff",
        })
        assert res.status_code == 422

    def test_approval_flow(self, client):
        config = client.post("/api/delivery/settings", json={"channel": "email", "target": "approve@test.com"}).json()
        send_res = client.post("/api/delivery/send", json={
            "config_id": config["id"],
            "digest_id": "aabbccddeeff",
            "require_approval": True,
        })
        assert send_res.status_code == 200
        assert send_res.json()["status"] == "pending_approval"

        log_id = send_res.json()["id"]
        approve_res = client.post(f"/api/delivery/approve/{log_id}")
        assert approve_res.status_code == 200
        assert approve_res.json()["status"] == "approved"

    def test_logs(self, client):
        config = client.post("/api/delivery/settings", json={"channel": "slack", "target": "https://hooks.slack.com/x"}).json()
        client.post("/api/delivery/send", json={"config_id": config["id"], "digest_id": "aabbccddeeff"})
        res = client.get(f"/api/delivery/logs/{config['id']}")
        assert res.status_code == 200
        assert len(res.json()) >= 1


# ---------------------------------------------------------------------------
# Delivery Services (unit)
# ---------------------------------------------------------------------------

class TestDeliveryServicesUnit:
    @pytest.mark.asyncio
    async def test_email_log_transport(self):
        from web.app.services.delivery_email import EmailDeliveryService
        svc = EmailDeliveryService()
        result = await svc.send_digest(to="test@example.com", subject="Test", summary="Hello")
        assert result is True

    @pytest.mark.asyncio
    async def test_slack_log_transport(self):
        from web.app.services.delivery_slack import SlackDeliveryService
        svc = SlackDeliveryService()
        result = await svc.send_digest(
            webhook_url="https://hooks.slack.com/test",
            title="Test",
            summary="Hello",
        )
        assert result is True


# ---------------------------------------------------------------------------
# Cron Validation (Stage 2-1)
# ---------------------------------------------------------------------------

class TestCronValidation:
    def test_valid_cron_expression(self, client):
        res = client.post("/api/jobs", json={
            "job_type": "watchlist_check",
            "cron_expression": "0 9 * * *",
        })
        assert res.status_code == 200
        assert res.json()["next_run_at"] is not None

    def test_invalid_cron_expression(self, client):
        res = client.post("/api/jobs", json={
            "job_type": "watchlist_check",
            "cron_expression": "invalid_cron",
        })
        assert res.status_code == 422
        assert "cron" in res.json()["detail"].lower()

    def test_empty_cron_allowed(self, client):
        res = client.post("/api/jobs", json={
            "job_type": "watchlist_check",
            "cron_expression": "",
        })
        assert res.status_code == 200

    def test_invalid_cron_on_update(self, client):
        created = client.post("/api/jobs", json={"job_type": "watchlist_check"}).json()
        res = client.patch(f"/api/jobs/{created['id']}", json={"cron_expression": "bad bad bad"})
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# Job Limits (Stage 1-3)
# ---------------------------------------------------------------------------

class TestJobLimits:
    def test_job_limit_50(self):
        """ジョブ上限50のunit test。"""
        from web.app.jobs.scheduler import JobScheduler
        sched = JobScheduler()
        for i in range(50):
            sched.create_job(
                type("R", (), {"job_type": "watchlist_check", "cron_expression": "", "target_id": ""})()
            )
        assert len(sched.list_jobs()) == 50


# ---------------------------------------------------------------------------
# Async Idempotency (Stage 2-4)
# ---------------------------------------------------------------------------

class TestAsyncIdempotency:
    @pytest.mark.asyncio
    async def test_concurrent_acquire(self):
        import asyncio
        from web.app.jobs.scheduler import JobScheduler
        sched = JobScheduler()
        job = sched.create_job(
            type("R", (), {"job_type": "watchlist_check", "cron_expression": "", "target_id": ""})()
        )
        results = await asyncio.gather(
            sched.try_acquire(job.id),
            sched.try_acquire(job.id),
            sched.try_acquire(job.id),
        )
        assert results.count(True) == 1
        assert results.count(False) == 2


# ---------------------------------------------------------------------------
# Delivery Target Validation (Stage 2-3)
# ---------------------------------------------------------------------------

class TestDeliveryTargetValidation:
    def test_invalid_email_rejected(self, client):
        res = client.post("/api/delivery/settings", json={
            "channel": "email",
            "target": "not-an-email",
        })
        assert res.status_code == 422
        assert "email" in res.json()["detail"].lower()

    def test_valid_email_accepted(self, client):
        res = client.post("/api/delivery/settings", json={
            "channel": "email",
            "target": "user@example.com",
        })
        assert res.status_code == 200

    def test_invalid_slack_webhook_rejected(self, client):
        res = client.post("/api/delivery/settings", json={
            "channel": "slack",
            "target": "https://evil.example.com/webhook",
        })
        assert res.status_code == 422
        assert "slack" in res.json()["detail"].lower()

    def test_valid_slack_webhook_accepted(self, client):
        res = client.post("/api/delivery/settings", json={
            "channel": "slack",
            "target": "https://hooks.slack.com/services/T000/B000/xxx",
        })
        assert res.status_code == 200

    def test_invalid_email_on_update(self, client):
        config = client.post("/api/delivery/settings", json={
            "channel": "email", "target": "ok@test.com",
        }).json()
        res = client.patch(f"/api/delivery/settings/{config['id']}", json={"target": "bad"})
        assert res.status_code == 422

    def test_delivery_config_limit(self, client):
        """デリバリーconfig上限テスト — 上限に達したら422が返ること。"""
        # まず現在の件数を取得
        existing = client.get("/api/delivery/settings").json()
        remaining = 20 - len(existing)
        # 残り分を埋める
        for i in range(remaining):
            _rate_store.clear()  # Rate limit回避
            res = client.post("/api/delivery/settings", json={
                "channel": "email", "target": f"limit{i}@example.com",
            })
            assert res.status_code == 200, f"Config {i} failed: {res.text}"
        _rate_store.clear()
        res = client.post("/api/delivery/settings", json={
            "channel": "email", "target": "overflow@example.com",
        })
        assert res.status_code == 422
        assert "limit" in res.json()["detail"].lower()
