"""Pydantic request contracts for platform v2 routes."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .errors import ValidationError as PlatformValidationError
from .invitations import normalize_invitation_email


ProjectRole = Literal["project_editor", "project_viewer"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class BootstrapRequest(StrictModel):
    workspace_name: str = Field(min_length=1, max_length=200)
    workspace_slug: str | None = Field(default=None, min_length=1, max_length=100)
    primary_email: str | None = Field(default=None, max_length=320)
    display_name: str | None = Field(default=None, max_length=200)


class ProjectCreate(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=5000)
    is_demo: bool = False

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, value: str) -> str:
        normalized = value.lower()
        if not normalized.replace("-", "").replace("_", "").isalnum():
            raise ValueError("slug must contain only letters, numbers, hyphens, or underscores")
        return normalized


class ProjectPatch(StrictModel):
    version: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    status: Literal["active", "inactive", "archived"] | None = None


class ProjectArchiveRequest(StrictModel):
    version: int = Field(ge=1)


class ProjectMemberCreate(StrictModel):
    email: str | None = Field(default=None, min_length=3, max_length=320)
    role: ProjectRole
    # Hybrid-period compatibility. New clients must use ``email``.
    clerk_user_id: str | None = Field(default=None, min_length=1, max_length=255)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            return normalize_invitation_email(value)
        except PlatformValidationError as exc:
            raise ValueError("email is invalid") from exc

    @model_validator(mode="after")
    def select_contract(self) -> "ProjectMemberCreate":
        if bool(self.email) == bool(self.clerk_user_id):
            raise ValueError("provide exactly one project member identity")
        return self


class ProjectMemberPatch(StrictModel):
    role: ProjectRole


class DataSourceUpsert(StrictModel):
    source_type: str = Field(min_length=1, max_length=32)
    gcp_project_id: str = Field(min_length=1, max_length=128)
    dataset_id: str = Field(min_length=1, max_length=128)
    scope_kind: Literal["customer", "internal_alias", "demo"] = "customer"
    safe_config: dict[str, Any] | None = None


class DataSourceTestResult(StrictModel):
    ok: bool
    connected: bool
    status: str
    checked_at: str
    detail: str | None = None
