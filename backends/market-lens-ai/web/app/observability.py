"""Privacy-safe JSON logging for ML runtime and durable workers."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
from typing import Any, Mapping


_LOGGER = logging.getLogger("insight_studio.ml")
_SAFE_TOKEN = re.compile(r"[^A-Za-z0-9_.:-]+")
_SENTRY_INITIALIZED = False
_SENTRY_SDK: Any | None = None
_ALLOWED_FIELDS = frozenset(
    {
        "request_id",
        "deployment_sha",
        "workspace_hash",
        "job_id",
        "stage",
        "duration_ms",
        "error_code",
        "status_code",
    }
)


def deployment_sha() -> str | None:
    for name in ("VERCEL_GIT_COMMIT_SHA", "COMMIT_SHA", "RENDER_GIT_COMMIT"):
        value = str(os.getenv(name) or "").strip()
        if value:
            return value[:64]
    return None


def workspace_hash(workspace_id: Any) -> str | None:
    value = str(workspace_id or "").strip()
    salt = str(os.getenv("OBSERVABILITY_HASH_SALT") or "").strip()
    if not value or not salt:
        return None
    return hmac.new(salt.encode(), value.encode(), hashlib.sha256).hexdigest()


def structured_event(level: str, event: str, fields: Mapping[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "level": level if level in {"debug", "info", "warning", "error"} else "info",
        "event": str(event or "event")[:80],
        "service": "ml_backend",
    }
    for key, value in (fields or {}).items():
        if key not in _ALLOWED_FIELDS or value is None:
            continue
        payload[key] = value if isinstance(value, (int, float, bool)) else str(value)[:160]
    sha = deployment_sha()
    if sha and "deployment_sha" not in payload:
        payload["deployment_sha"] = sha
    return payload


def log_event(level: str, event: str, **fields: Any) -> None:
    payload = structured_event(level, event, fields)
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    method = {
        "debug": _LOGGER.debug,
        "warning": _LOGGER.warning,
        "error": _LOGGER.error,
    }.get(payload["level"], _LOGGER.info)
    method(encoded)


def _safe_token(value: Any, fallback: str, *, limit: int = 80) -> str:
    token = _SAFE_TOKEN.sub("_", str(value or "").strip())[:limit].strip("_.:-")
    return token or fallback


def _sentry_environment() -> str:
    return _safe_token(
        os.getenv("SENTRY_ENVIRONMENT")
        or os.getenv("APP_ENV")
        or os.getenv("ENVIRONMENT")
        or "unknown",
        "unknown",
        limit=40,
    )


def sentry_before_send(
    event: Mapping[str, Any],
    hint: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Rebuild an exception event from an operational allowlist only."""

    raw_tags = event.get("tags") if isinstance(event.get("tags"), Mapping) else {}
    raw_exception = event.get("exception")
    values = raw_exception.get("values") if isinstance(raw_exception, Mapping) else None
    first_value = values[0] if isinstance(values, list) and values else {}
    exception_type = _safe_token(
        first_value.get("type") if isinstance(first_value, Mapping) else None,
        "ApplicationError",
    )
    error_code = _safe_token(raw_tags.get("error_code"), exception_type)
    tags = {
        "service": "ml_backend",
        "error_code": error_code,
    }
    stage = raw_tags.get("stage")
    if stage:
        tags["stage"] = _safe_token(stage, "unknown_stage")
    sha = deployment_sha()
    if sha:
        tags["deployment_sha"] = _safe_token(sha, "unknown_release", limit=64)

    safe_event: dict[str, Any] = {
        "platform": "python",
        "level": event.get("level") if event.get("level") in {"fatal", "error", "warning"} else "error",
        "environment": _sentry_environment(),
        "tags": tags,
        "fingerprint": ["ml_backend", error_code, exception_type],
        "exception": {
            "values": [
                {
                    "type": exception_type,
                    "value": "Unhandled application error",
                }
            ]
        },
    }
    if sha:
        safe_event["release"] = _safe_token(sha, "unknown_release", limit=64)
    event_id = str(event.get("event_id") or "")
    if re.fullmatch(r"[0-9a-fA-F]{32}", event_id):
        safe_event["event_id"] = event_id.lower()
    timestamp = event.get("timestamp")
    if isinstance(timestamp, (int, float)):
        safe_event["timestamp"] = timestamp
    return safe_event


def initialize_sentry() -> bool:
    """Initialize optional Sentry without request/trace integrations."""

    global _SENTRY_INITIALIZED, _SENTRY_SDK
    if _SENTRY_INITIALIZED:
        return _SENTRY_SDK is not None
    _SENTRY_INITIALIZED = True
    dsn = str(os.getenv("SENTRY_DSN") or "").strip()
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        log_event("warning", "sentry_unavailable", error_code="dependency_missing")
        return False

    try:
        sentry_sdk.init(
            dsn=dsn,
            environment=_sentry_environment(),
            release=deployment_sha(),
            send_default_pii=False,
            traces_sample_rate=0.0,
            profiles_sample_rate=0.0,
            include_local_variables=False,
            max_request_body_size="never",
            default_integrations=False,
            before_send=sentry_before_send,
        )
    except Exception:
        log_event(
            "error",
            "sentry_initialization_failed",
            error_code="invalid_monitoring_configuration",
        )
        return False
    _SENTRY_SDK = sentry_sdk
    return True


def capture_exception_safe(
    exc: BaseException,
    *,
    error_code: str = "unhandled_exception",
    stage: str | None = None,
) -> None:
    """Capture an exception while before_send removes message, stack and locals."""

    if not initialize_sentry() or _SENTRY_SDK is None:
        return
    try:
        with _SENTRY_SDK.new_scope() as scope:
            scope.set_tag("service", "ml_backend")
            scope.set_tag("error_code", _safe_token(error_code, "unhandled_exception"))
            if stage:
                scope.set_tag("stage", _safe_token(stage, "unknown_stage"))
            _SENTRY_SDK.capture_exception(exc)
    except Exception:
        return
