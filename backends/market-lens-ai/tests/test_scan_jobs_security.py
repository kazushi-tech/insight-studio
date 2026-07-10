"""Security regression tests for asynchronous scan-job BYOK handling."""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from web.app.models import ScanResponse
from web.app.repositories.file_scan_job_repository import FileScanJobRepository
from web.app.repositories.scan_repository import ScanRepository
from web.app.routers.scan_routes import create_scan_router
from web.app.schemas.scan_job import ScanJobRecord


class _UnusedScanRepository(ScanRepository):
    """The route requires a result repository; mocked execution never uses it."""

    def save(self, result) -> None:
        pass

    def load(self, run_id):
        return None

    def list_all(self, owner_id):
        return []

    def delete(self, run_id):
        return False


def _make_app(job_repo: FileScanJobRepository) -> FastAPI:
    app = FastAPI()
    app.include_router(create_scan_router(_UnusedScanRepository(), job_repo=job_repo))
    return app


def _poll_until_terminal(client: TestClient, job_id: str) -> dict:
    for _ in range(40):
        response = client.get(
            f"/api/scan/jobs/{job_id}",
            headers={"X-Insight-User": "guest:security-test"},
        )
        assert response.status_code == 200
        body = response.json()
        if body["status"] in {"completed", "failed"}:
            return body
        time.sleep(0.05)
    raise AssertionError("Scan job did not reach a terminal state")


def _assert_secret_absent_from_files(base_dir, secret: str) -> None:
    for path in base_dir.rglob("*"):
        if path.is_file():
            assert secret not in path.read_text(encoding="utf-8")


def test_async_byok_key_is_forwarded_but_never_persisted_or_returned(tmp_path):
    secret = "SENTINEL-BYOK-KEY-DO-NOT-PERSIST"
    job_repo = FileScanJobRepository(tmp_path)
    app = _make_app(job_repo)
    completed = ScanResponse(
        run_id="safe-result-id",
        status="completed",
        report_md="# Safe report",
        total_time_sec=0.1,
    )

    with (
        patch("web.app.routers.scan_routes.validate_urls", return_value=[]),
        patch(
            "web.app.routers.scan_routes.execute_scan",
            new_callable=AsyncMock,
            return_value=completed,
        ) as execute,
        TestClient(app) as client,
    ):
        start = client.post(
            "/api/scan/jobs",
            headers={"X-Insight-User": "guest:security-test"},
            json={"urls": ["https://example.com"], "api_key": secret},
        )
        assert start.status_code == 202
        assert secret not in start.text
        assert "api_key" not in start.text

        terminal = _poll_until_terminal(client, start.json()["job_id"])
        assert terminal["status"] == "completed"
        serialized_response = json.dumps(terminal, ensure_ascii=False)
        assert secret not in serialized_response
        assert "api_key" not in serialized_response

        request = execute.await_args.args[0]
        assert request.api_key == secret

    _assert_secret_absent_from_files(tmp_path, secret)
    job_text = (tmp_path / start.json()["job_id"] / "job.json").read_text(encoding="utf-8")
    assert "api_key" not in job_text


def test_legacy_job_with_api_key_is_readable_and_scrubbed_on_next_write(tmp_path):
    secret = "SENTINEL-LEGACY-BYOK-KEY"
    job_id = "legacyjob001"
    now = datetime.now(timezone.utc).isoformat()
    job_path = tmp_path / job_id / "job.json"
    job_path.parent.mkdir(parents=True)
    job_path.write_text(
        json.dumps(
            {
                "job_id": job_id,
                "owner_id": "guest:legacy",
                "urls": ["https://example.com"],
                "api_key": secret,
                "status": "completed",
                "stage": "complete",
                "created_at": now,
                "updated_at": now,
            }
        ),
        encoding="utf-8",
    )

    repo = FileScanJobRepository(tmp_path)
    record = repo.load_job(job_id)

    assert isinstance(record, ScanJobRecord)
    assert "api_key" not in record.model_dump()
    repo.save_job(record)

    rewritten = job_path.read_text(encoding="utf-8")
    assert secret not in rewritten
    assert "api_key" not in rewritten


def test_async_failure_does_not_log_persist_or_return_echoed_key(tmp_path, caplog):
    secret = "SENTINEL-ECHOED-BYOK-KEY"
    job_repo = FileScanJobRepository(tmp_path)
    app = _make_app(job_repo)

    caplog.set_level(logging.ERROR, logger="market-lens")
    with (
        patch("web.app.routers.scan_routes.validate_urls", return_value=[]),
        patch(
            "web.app.routers.scan_routes.execute_scan",
            new_callable=AsyncMock,
            side_effect=RuntimeError(f"provider echoed {secret}"),
        ),
        TestClient(app) as client,
    ):
        start = client.post(
            "/api/scan/jobs",
            headers={"X-Insight-User": "guest:security-test"},
            json={"urls": ["https://example.com"], "api_key": secret},
        )
        terminal = _poll_until_terminal(client, start.json()["job_id"])

    assert terminal["status"] == "failed"
    assert secret not in start.text
    assert secret not in json.dumps(terminal, ensure_ascii=False)
    assert secret not in caplog.text
    _assert_secret_absent_from_files(tmp_path, secret)
