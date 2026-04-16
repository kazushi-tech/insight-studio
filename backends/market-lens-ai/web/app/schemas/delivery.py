"""Delivery schemas (Phase 8)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class DeliveryChannel(str, Enum):
    email = "email"
    slack = "slack"


class DeliveryStatus(str, Enum):
    draft = "draft"
    pending_approval = "pending_approval"
    approved = "approved"
    sent = "sent"
    failed = "failed"


class DeliveryConfigCreate(BaseModel):
    """Request to create a delivery configuration."""

    channel: DeliveryChannel
    target: str = Field(min_length=1, max_length=500)
    enabled: bool = True
    config_json: dict = Field(default_factory=dict)


class DeliveryConfigUpdate(BaseModel):
    """Request to update a delivery configuration."""

    target: Optional[str] = Field(default=None, min_length=1, max_length=500)
    enabled: Optional[bool] = None
    config_json: Optional[dict] = None


class DeliveryConfig(BaseModel):
    """A delivery configuration (email or Slack)."""

    id: str
    channel: DeliveryChannel
    target: str
    enabled: bool = True
    config_json: dict = Field(default_factory=dict)
    created_at: datetime
    updated_at: Optional[datetime] = None


class DeliveryLog(BaseModel):
    """Log of a delivery attempt."""

    id: str
    config_id: str
    status: DeliveryStatus
    digest_id: str = ""
    sent_at: Optional[datetime] = None
    error_message: str = ""


class DeliverySendRequest(BaseModel):
    """Request to send a digest via delivery channel."""

    config_id: str
    digest_id: str
    require_approval: bool = False
