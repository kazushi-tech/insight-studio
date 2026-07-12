"""Structured logs never accept customer payloads or secrets."""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path


_PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PROJECT_ROOT))

from web.app import observability
from web.app.observability import sentry_before_send, structured_event, workspace_hash


def test_structured_event_allowlists_only_safe_operational_fields(monkeypatch):
    monkeypatch.setenv("VERCEL_GIT_COMMIT_SHA", "abc123")
    event = structured_event(
        "error",
        "request_failed",
        {
            "request_id": "req-1",
            "workspace_hash": "hashed",
            "duration_ms": 12,
            "error_code": "database_unavailable",
            "url": "https://secret.example/path",
            "dataset": "customer_dataset",
            "email": "person@example.com",
            "jwt": "header.payload.signature",
            "api_key": "sk-secret",
            "body": {"private": True},
        },
    )
    assert event == {
        "level": "error",
        "event": "request_failed",
        "service": "ads_backend",
        "request_id": "req-1",
        "workspace_hash": "hashed",
        "duration_ms": 12,
        "error_code": "database_unavailable",
        "deployment_sha": "abc123",
    }


def test_workspace_hash_requires_a_secret_salt(monkeypatch):
    monkeypatch.delenv("OBSERVABILITY_HASH_SALT", raising=False)
    assert workspace_hash("workspace-a") is None
    monkeypatch.setenv("OBSERVABILITY_HASH_SALT", "test-only-salt")
    first = workspace_hash("workspace-a")
    assert first and first == workspace_hash("workspace-a")
    assert first != workspace_hash("workspace-b")
    assert "workspace-a" not in first


def test_sentry_event_rebuild_drops_exception_contents_and_request_metadata(monkeypatch):
    monkeypatch.setenv("VERCEL_GIT_COMMIT_SHA", "abc123")
    event = sentry_before_send(
        {
            "event_id": "a" * 32,
            "level": "error",
            "request": {"url": "https://secret.example/private?token=abc"},
            "user": {"email": "person@example.com", "ip_address": "10.0.0.1"},
            "breadcrumbs": [{"message": "sk-secret"}],
            "contexts": {"runtime": {"path": "C:/private/source.py"}},
            "modules": {"private": "1"},
            "tags": {
                "error_code": "database_unavailable",
                "stage": "http_request",
                "dataset": "customer_dataset",
            },
            "exception": {
                "values": [{
                    "type": "RuntimeError",
                    "value": "jwt header.payload.signature",
                    "stacktrace": {"frames": [{"filename": "C:/private/source.py", "vars": {"api_key": "secret"}}]},
                }],
            },
        }
    )
    encoded = json.dumps(event)
    for forbidden in (
        "secret.example",
        "person@example.com",
        "10.0.0.1",
        "sk-secret",
        "customer_dataset",
        "header.payload.signature",
        "C:/private/source.py",
        "api_key",
        "stacktrace",
        "breadcrumbs",
    ):
        assert forbidden not in encoded
    assert event["exception"] == {
        "values": [{"type": "RuntimeError", "value": "Unhandled application error"}]
    }
    assert event["tags"] == {
        "service": "ads_backend",
        "error_code": "database_unavailable",
        "stage": "http_request",
        "deployment_sha": "abc123",
    }


def test_sentry_initialization_disables_pii_traces_sources_and_default_integrations(monkeypatch):
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


def test_invalid_sentry_configuration_never_breaks_application_startup(monkeypatch):
    fake_sdk = types.ModuleType("sentry_sdk")

    def fail_init(**_options):
        raise ValueError("https://secret.example customer_dataset sk-secret")

    fake_sdk.init = fail_init
    monkeypatch.setitem(sys.modules, "sentry_sdk", fake_sdk)
    monkeypatch.setenv("SENTRY_DSN", "https://public@example.invalid/1")
    monkeypatch.setattr(observability, "_SENTRY_INITIALIZED", False)
    monkeypatch.setattr(observability, "_SENTRY_SDK", None)

    assert observability.initialize_sentry() is False
    assert observability._SENTRY_SDK is None
