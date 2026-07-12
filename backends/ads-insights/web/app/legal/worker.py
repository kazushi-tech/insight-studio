"""Continuously consume durable privacy export and deletion jobs."""

from __future__ import annotations

import os
import signal
import threading
import time
from collections.abc import Callable

from sqlalchemy.orm import Session

from ..observability import capture_exception_safe, initialize_sentry, log_event
from ..platform_db import PlatformDatabaseUnavailable, get_platform_engine
from .operations import PrivacyOperationsRunner, PrivacyOpsConfig, PrivacyOpsError


SessionFactory = Callable[[], Session]


def _env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        value = int((os.getenv(name) or str(default)).strip())
    except ValueError:
        value = default
    return min(max(value, minimum), maximum)


class PrivacyWorker:
    def __init__(
        self,
        session_factory: SessionFactory,
        *,
        config: PrivacyOpsConfig,
        batch_size: int = 25,
    ) -> None:
        self.session_factory = session_factory
        self.config = config
        self.batch_size = min(max(batch_size, 1), 250)

    def validate_configuration(self) -> None:
        self.config.require_retention_policy()
        self.config.encryption_key()
        self.config.require_export_limit()

    def run_once(self):
        with self.session_factory() as session:
            try:
                result = PrivacyOperationsRunner(
                    session,
                    config=self.config,
                ).run_once(execute=True, limit=self.batch_size)
                session.commit()
                return result
            except Exception:
                session.rollback()
                raise

    def run_forever(
        self,
        *,
        poll_seconds: int,
        stop_event: threading.Event,
    ) -> int:
        self.validate_configuration()
        while not stop_event.is_set():
            started = time.monotonic()
            try:
                result = self.run_once()
                log_event(
                    "info",
                    "privacy_worker_cycle",
                    stage="complete",
                    duration_ms=round((time.monotonic() - started) * 1000, 1),
                    status_code=200,
                )
            except (PrivacyOpsError, PlatformDatabaseUnavailable) as exc:
                code = exc.code if isinstance(exc, PrivacyOpsError) else "database_unavailable"
                log_event(
                    "error",
                    "privacy_worker_cycle_failed",
                    stage="privacy",
                    error_code=code,
                    duration_ms=round((time.monotonic() - started) * 1000, 1),
                )
            except Exception as exc:
                capture_exception_safe(
                    exc,
                    error_code="privacy_worker_internal_error",
                    stage="privacy",
                )
                log_event(
                    "error",
                    "privacy_worker_cycle_failed",
                    stage="privacy",
                    error_code="internal_error",
                    duration_ms=round((time.monotonic() - started) * 1000, 1),
                )
            stop_event.wait(poll_seconds)
        return 0


def _session() -> Session:
    return Session(get_platform_engine(), expire_on_commit=False)


def main() -> int:
    if (os.getenv("PRIVACY_WORKER_ENABLED") or "").strip().lower() != "true":
        log_event(
            "error",
            "privacy_worker_disabled",
            error_code="worker_not_enabled",
        )
        return 2
    initialize_sentry()
    worker = PrivacyWorker(
        _session,
        config=PrivacyOpsConfig.from_env(),
        batch_size=_env_int("PRIVACY_WORKER_BATCH_SIZE", 25, minimum=1, maximum=250),
    )
    try:
        worker.validate_configuration()
    except PrivacyOpsError as exc:
        log_event(
            "error",
            "privacy_worker_configuration_invalid",
            error_code=exc.code,
        )
        return 2

    stop_event = threading.Event()

    def _stop(_signum, _frame) -> None:
        stop_event.set()

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    return worker.run_forever(
        poll_seconds=_env_int(
            "PRIVACY_WORKER_POLL_SECONDS",
            15,
            minimum=5,
            maximum=3600,
        ),
        stop_event=stop_event,
    )


if __name__ == "__main__":
    raise SystemExit(main())
