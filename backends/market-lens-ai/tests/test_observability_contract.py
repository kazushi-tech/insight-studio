from __future__ import annotations

import json
import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from web.app import observability
from web.app.observability import sentry_before_send, structured_event, workspace_hash


def test_ml_observability_allowlist_and_hash(monkeypatch):
    monkeypatch.setenv("OBSERVABILITY_HASH_SALT", "unit-test-salt")
    event = structured_event(
        "error",
        "job_failed",
        {
            "job_id": "job-1",
            "stage": "analyze",
            "error_code": "provider_unavailable",
            "url": "https://private.example/",
            "email": "person@example.com",
            "api_key": "secret",
            "dataset": "private_dataset",
        },
    )
    assert event["job_id"] == "job-1"
    assert event["stage"] == "analyze"
    assert event["error_code"] == "provider_unavailable"
    assert not {"url", "email", "api_key", "dataset"} & set(event)
    assert workspace_hash("workspace-a") == workspace_hash("workspace-a")
    assert workspace_hash("workspace-a") != workspace_hash("workspace-b")


def test_ml_sentry_event_contains_only_safe_operational_metadata(monkeypatch):
    monkeypatch.setenv("COMMIT_SHA", "release123")
    event = sentry_before_send(
        {
            "level": "error",
            "request": {"url": "https://private.example/path"},
            "user": {"email": "person@example.com", "ip_address": "fd00::1"},
            "extra": {"dataset": "customer_dataset", "jwt": "header.payload.signature"},
            "tags": {
                "error_code": "provider_unavailable",
                "stage": "analysis_job",
                "job_id": "private-job",
            },
            "exception": {
                "values": [{
                    "type": "ProviderError",
                    "value": "API key sk-secret",
                    "stacktrace": {"frames": [{"filename": "/app/private.py", "context_line": "secret"}]},
                }],
            },
        }
    )
    encoded = json.dumps(event)
    for forbidden in (
        "private.example",
        "person@example.com",
        "fd00::1",
        "customer_dataset",
        "header.payload.signature",
        "private-job",
        "sk-secret",
        "/app/private.py",
        "context_line",
    ):
        assert forbidden not in encoded
    assert event["exception"] == {
        "values": [{"type": "ProviderError", "value": "Unhandled application error"}]
    }
    assert event["tags"] == {
        "service": "ml_backend",
        "error_code": "provider_unavailable",
        "stage": "analysis_job",
        "deployment_sha": "release123",
    }


def test_ml_sentry_initialization_is_opt_in_and_trace_free(monkeypatch):
    captured: dict[str, object] = {}
    fake_sdk = types.ModuleType("sentry_sdk")
    fake_sdk.init = lambda **options: captured.update(options)
    monkeypatch.setitem(sys.modules, "sentry_sdk", fake_sdk)
    monkeypatch.setenv("SENTRY_DSN", "https://public@example.invalid/1")
    monkeypatch.setattr(observability, "_SENTRY_INITIALIZED", False)
    monkeypatch.setattr(observability, "_SENTRY_SDK", None)

    assert observability.initialize_sentry() is True
    assert captured["send_default_pii"] is False
    assert captured["traces_sample_rate"] == 0.0
    assert captured["profiles_sample_rate"] == 0.0
    assert captured["include_local_variables"] is False
    assert captured["max_request_body_size"] == "never"
    assert captured["default_integrations"] is False
    assert captured["before_send"] is sentry_before_send
