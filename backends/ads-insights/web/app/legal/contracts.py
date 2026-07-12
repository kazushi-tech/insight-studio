"""Strict legal/privacy API request contracts."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class LegalAcceptanceRequest(StrictModel):
    document_key: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_.-]+$")
    version: str = Field(min_length=1, max_length=32)


class DataExportRequest(StrictModel):
    scope: Literal["account", "workspace"]


class DeletionRequestCreate(StrictModel):
    scope: Literal["account", "workspace"]
