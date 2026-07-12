"""Strict request contracts for report history routes."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ReportMessageInput(StrictModel):
    role: Literal["user", "assistant", "system", "tool"]
    content: str = Field(min_length=1, max_length=100_000)
    metadata: dict[str, Any] | None = None


class ReportCreateRequest(StrictModel):
    client_entry_id: str = Field(min_length=1, max_length=100)
    title: str | None = Field(default=None, max_length=300)
    summary: str | None = Field(default=None, max_length=20_000)
    report: dict[str, Any]
    messages: list[ReportMessageInput] = Field(default_factory=list, max_length=500)


class ReportImportRequest(ReportCreateRequest):
    source_schema: str = Field(min_length=1, max_length=32)


class ReportShareRequest(StrictModel):
    expires_in_days: int = Field(default=7, ge=1, le=7)


class ReportQuestionRequest(StrictModel):
    question: str = Field(min_length=1, max_length=2_000)
