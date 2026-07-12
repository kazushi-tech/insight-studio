"""Tests for the durable privacy worker process."""

from __future__ import annotations

import base64
from types import SimpleNamespace

import pytest

from web.app.legal.operations import PrivacyOpsConfig
from web.app.legal.worker import PrivacyWorker


CONFIG = PrivacyOpsConfig(
    retention_policy_version="retention-worker-test",
    export_retention_days=14,
    export_encryption_key_b64=base64.urlsafe_b64encode(b"w" * 32).decode("ascii"),
    export_encryption_key_id="worker-key-v1",
    export_max_bytes=1024 * 1024,
)


class _Session:
    def __init__(self):
        self.committed = False
        self.rolled_back = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


def test_worker_executes_durable_jobs_and_commits(monkeypatch):
    session = _Session()
    calls = []

    class _Runner:
        def __init__(self, received_session, *, config):
            assert received_session is session
            assert config is CONFIG

        def run_once(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(exports_ready=1)

    monkeypatch.setattr("web.app.legal.worker.PrivacyOperationsRunner", _Runner)
    worker = PrivacyWorker(lambda: session, config=CONFIG, batch_size=17)
    result = worker.run_once()

    assert result.exports_ready == 1
    assert calls == [{"execute": True, "limit": 17}]
    assert session.committed is True
    assert session.rolled_back is False


def test_worker_rolls_back_and_propagates_failures(monkeypatch):
    session = _Session()

    class _Runner:
        def __init__(self, *_args, **_kwargs):
            pass

        def run_once(self, **_kwargs):
            raise RuntimeError("sensitive database detail")

    monkeypatch.setattr("web.app.legal.worker.PrivacyOperationsRunner", _Runner)
    worker = PrivacyWorker(lambda: session, config=CONFIG)

    with pytest.raises(RuntimeError):
        worker.run_once()
    assert session.committed is False
    assert session.rolled_back is True


def test_worker_configuration_fails_closed_before_processing():
    worker = PrivacyWorker(lambda: _Session(), config=PrivacyOpsConfig())
    with pytest.raises(Exception) as exc_info:
        worker.validate_configuration()
    assert str(exc_info.value) == "retention_policy_not_configured"
