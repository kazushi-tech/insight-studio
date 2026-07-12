"""Strict client request models: clients can select only ``plan_key``."""

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CheckoutRequest(StrictModel):
    plan_key: str = Field(min_length=1, max_length=100)


class PortalRequest(StrictModel):
    pass
