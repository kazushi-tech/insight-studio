"""Delivery routes — delivery config CRUD + send API (Phase 8)."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..auth import verify_auth_optional, verify_token

from ..schemas.delivery import (
    DeliveryChannel,
    DeliveryConfig,
    DeliveryConfigCreate,
    DeliveryConfigUpdate,
    DeliveryLog,
    DeliverySendRequest,
    DeliveryStatus,
)
from ..services.delivery_email import EmailDeliveryService
from ..services.delivery_slack import SlackDeliveryService

_ID_RE = re.compile(r"^[0-9a-f]{12}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SLACK_PREFIX = "https://hooks.slack.com/"
_MAX_DELIVERY_CONFIGS = 20


def _check_id(val: str, name: str = "id") -> None:
    if not _ID_RE.match(val):
        raise HTTPException(status_code=422, detail=f"Invalid {name}: {val}")


def _validate_target(channel: DeliveryChannel, target: str) -> None:
    """Validate delivery target format by channel type."""
    if channel == DeliveryChannel.email:
        if not _EMAIL_RE.match(target):
            raise HTTPException(status_code=422, detail=f"Invalid email address: {target}")
    elif channel == DeliveryChannel.slack:
        if not target.startswith(_SLACK_PREFIX):
            raise HTTPException(
                status_code=422,
                detail=f"Slack webhook must start with {_SLACK_PREFIX}",
            )


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_delivery_router(
    email_service: EmailDeliveryService | None = None,
    slack_service: SlackDeliveryService | None = None,
) -> APIRouter:
    """Factory that creates delivery routes."""
    router = APIRouter(prefix="/api/delivery", tags=["delivery"])
    _email = email_service or EmailDeliveryService()
    _slack = slack_service or SlackDeliveryService()

    _configs: dict[str, DeliveryConfig] = {}
    _logs: dict[str, list[DeliveryLog]] = {}

    @router.post("/settings", response_model=DeliveryConfig)
    async def create_config(req: DeliveryConfigCreate, _: str = Depends(verify_token)):
        if len(_configs) >= _MAX_DELIVERY_CONFIGS:
            raise HTTPException(
                status_code=422,
                detail=f"Delivery config limit reached ({_MAX_DELIVERY_CONFIGS})",
            )
        _validate_target(req.channel, req.target)
        config = DeliveryConfig(
            id=_new_id(),
            channel=req.channel,
            target=req.target,
            enabled=req.enabled,
            config_json=req.config_json,
            created_at=_now(),
        )
        _configs[config.id] = config
        return config

    @router.get("/settings", response_model=list[DeliveryConfig])
    async def list_configs(_: str | None = Depends(verify_auth_optional)):
        return sorted(_configs.values(), key=lambda c: c.created_at, reverse=True)

    @router.get("/settings/{config_id}", response_model=DeliveryConfig)
    async def get_config(config_id: str, _: str | None = Depends(verify_auth_optional)):
        _check_id(config_id, "config_id")
        config = _configs.get(config_id)
        if config is None:
            raise HTTPException(status_code=404, detail="Config not found")
        return config

    @router.patch("/settings/{config_id}", response_model=DeliveryConfig)
    async def update_config(config_id: str, req: DeliveryConfigUpdate, _: str = Depends(verify_token)):
        _check_id(config_id, "config_id")
        config = _configs.get(config_id)
        if config is None:
            raise HTTPException(status_code=404, detail="Config not found")
        updates: dict = {"updated_at": _now()}
        if req.target is not None:
            _validate_target(config.channel, req.target)
            updates["target"] = req.target
        if req.enabled is not None:
            updates["enabled"] = req.enabled
        if req.config_json is not None:
            updates["config_json"] = req.config_json
        updated = config.model_copy(update=updates)
        _configs[config_id] = updated
        return updated

    @router.delete("/settings/{config_id}")
    async def delete_config(config_id: str, _: str = Depends(verify_token)):
        _check_id(config_id, "config_id")
        if config_id not in _configs:
            raise HTTPException(status_code=404, detail="Config not found")
        del _configs[config_id]
        return {"deleted": True}

    @router.post("/send", response_model=DeliveryLog)
    async def send_delivery(req: DeliverySendRequest, _: str = Depends(verify_token)):
        _check_id(req.config_id, "config_id")
        config = _configs.get(req.config_id)
        if config is None:
            raise HTTPException(status_code=404, detail="Config not found")
        if not config.enabled:
            raise HTTPException(status_code=422, detail="Delivery config is disabled")

        # Approval flow
        if req.require_approval:
            log = DeliveryLog(
                id=_new_id(),
                config_id=config.id,
                status=DeliveryStatus.pending_approval,
                digest_id=req.digest_id,
            )
            _logs.setdefault(config.id, []).append(log)
            return log

        # Direct send
        success = False
        error = ""
        try:
            if config.channel == DeliveryChannel.email:
                success = await _email.send_digest(
                    to=config.target,
                    subject="Market Lens AI - Digest Report",
                    summary=f"Digest {req.digest_id}",
                )
            elif config.channel == DeliveryChannel.slack:
                success = await _slack.send_digest(
                    webhook_url=config.target,
                    title="Market Lens AI - Digest",
                    summary=f"Digest {req.digest_id}",
                )
        except Exception as exc:
            error = str(exc)

        log = DeliveryLog(
            id=_new_id(),
            config_id=config.id,
            status=DeliveryStatus.sent if success else DeliveryStatus.failed,
            digest_id=req.digest_id,
            sent_at=_now() if success else None,
            error_message=error,
        )
        _logs.setdefault(config.id, []).append(log)
        return log

    @router.post("/approve/{log_id}", response_model=DeliveryLog)
    async def approve_delivery(log_id: str, _: str = Depends(verify_token)):
        _check_id(log_id, "log_id")
        for config_logs in _logs.values():
            for i, log in enumerate(config_logs):
                if log.id == log_id and log.status == DeliveryStatus.pending_approval:
                    approved = log.model_copy(update={"status": DeliveryStatus.approved})
                    config_logs[i] = approved
                    return approved
        raise HTTPException(status_code=404, detail="Pending delivery not found")

    @router.get("/logs/{config_id}", response_model=list[DeliveryLog])
    async def get_logs(config_id: str, _: str | None = Depends(verify_auth_optional)):
        _check_id(config_id, "config_id")
        return list(reversed(_logs.get(config_id, [])))

    return router
