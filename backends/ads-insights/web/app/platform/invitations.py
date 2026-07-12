"""Clerk Organization invitation provider and privacy-safe email helpers."""

from __future__ import annotations

import hmac
import os
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, Protocol
from urllib.parse import quote, urlsplit

import httpx

from .errors import (
    InvitationProviderConflict,
    InvitationProviderError,
    PlatformConfigurationError,
    ValidationError,
)


_DOMAIN_LABEL_RE = re.compile(r"^[a-z0-9-]+$")


def normalize_invitation_email(value: str) -> str:
    """Return a conservative canonical mailbox without logging the input."""
    normalized = unicodedata.normalize("NFKC", str(value or "")).strip().casefold()
    if not normalized or len(normalized) > 320 or normalized.count("@") != 1:
        raise ValidationError("invitation email is invalid")
    local, domain = normalized.rsplit("@", 1)
    if not local or len(local.encode("utf-8")) > 64:
        raise ValidationError("invitation email is invalid")
    if any(character.isspace() or ord(character) < 32 for character in local):
        raise ValidationError("invitation email is invalid")
    try:
        ascii_domain = domain.encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise ValidationError("invitation email is invalid") from exc
    labels = ascii_domain.split(".")
    if (
        not ascii_domain
        or len(ascii_domain) > 253
        or any(
            not label
            or len(label) > 63
            or label.startswith("-")
            or label.endswith("-")
            or not _DOMAIN_LABEL_RE.fullmatch(label)
            for label in labels
        )
    ):
        raise ValidationError("invitation email is invalid")
    return f"{local}@{ascii_domain}"


@dataclass(frozen=True)
class ClerkInvitationResult:
    invitation_id: str
    organization_id: str
    email_address: str
    role: str
    status: str
    created_at: datetime
    expires_at: datetime


class ClerkInvitationProvider(Protocol):
    def invite_to_organization(
        self,
        *,
        organization_id: str,
        inviter_user_id: str,
        email: str,
        idempotency_key: str,
    ) -> ClerkInvitationResult: ...


def _provider_timestamp(value: Any) -> datetime:
    try:
        numeric = float(value)
        if numeric > 100_000_000_000:
            numeric /= 1000
        return datetime.fromtimestamp(numeric, tz=timezone.utc)
    except (TypeError, ValueError, OverflowError):
        raise InvitationProviderError("invitation provider response is invalid") from None


class ClerkRESTInvitationProvider:
    """Minimal official Clerk Backend API adapter with sanitized failures."""

    def __init__(
        self,
        *,
        secret_key: str,
        base_url: str = "https://api.clerk.com",
        timeout_seconds: float = 10.0,
    ) -> None:
        self._secret_key = str(secret_key or "").strip()
        parsed_base_url = urlsplit(str(base_url or ""))
        try:
            parsed_port = parsed_base_url.port
        except ValueError as exc:
            raise PlatformConfigurationError(
                "Clerk invitation endpoint is invalid"
            ) from exc
        if (
            parsed_base_url.scheme != "https"
            or parsed_base_url.hostname != "api.clerk.com"
            or parsed_base_url.username is not None
            or parsed_base_url.password is not None
            or parsed_port not in {None, 443}
            or parsed_base_url.path.rstrip("/")
            or parsed_base_url.query
            or parsed_base_url.fragment
        ):
            raise PlatformConfigurationError("Clerk invitation endpoint is invalid")
        self._base_url = "https://api.clerk.com"
        self._timeout_seconds = max(1.0, min(float(timeout_seconds), 30.0))

    @classmethod
    def from_env(cls) -> "ClerkRESTInvitationProvider":
        try:
            timeout = float(os.getenv("CLERK_INVITATION_TIMEOUT_SECONDS", "10"))
        except ValueError as exc:
            raise PlatformConfigurationError(
                "CLERK_INVITATION_TIMEOUT_SECONDS is invalid"
            ) from exc
        return cls(
            secret_key=os.getenv("CLERK_SECRET_KEY", ""),
            timeout_seconds=timeout,
        )

    def invite_to_organization(
        self,
        *,
        organization_id: str,
        inviter_user_id: str,
        email: str,
        idempotency_key: str,
    ) -> ClerkInvitationResult:
        if not self._secret_key:
            raise PlatformConfigurationError("CLERK_SECRET_KEY is required")
        if not organization_id or not inviter_user_id:
            raise PlatformConfigurationError("Clerk Organization context is unavailable")
        normalized_email = normalize_invitation_email(email)
        url = (
            f"{self._base_url}/v1/organizations/"
            f"{quote(organization_id, safe='')}/invitations"
        )
        try:
            with httpx.Client(
                timeout=self._timeout_seconds,
                follow_redirects=False,
            ) as client:
                response = client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {self._secret_key}",
                        "Content-Type": "application/json",
                        "Idempotency-Key": idempotency_key,
                    },
                    json={
                        "email_address": normalized_email,
                        "role": "org:member",
                        "inviter_user_id": inviter_user_id,
                        "expires_in_days": 30,
                    },
                )
        except httpx.HTTPError:
            raise InvitationProviderError("invitation provider request failed") from None
        if response.status_code in {409, 422}:
            raise InvitationProviderConflict("invitation provider rejected the request")
        if response.status_code < 200 or response.status_code >= 300:
            raise InvitationProviderError("invitation provider request failed")
        try:
            payload = response.json()
        except (ValueError, TypeError):
            raise InvitationProviderError("invitation provider response is invalid") from None
        return self._validate_response(payload, organization_id, normalized_email)

    @staticmethod
    def _validate_response(
        payload: Any,
        expected_organization_id: str,
        expected_email: str,
    ) -> ClerkInvitationResult:
        if not isinstance(payload, Mapping):
            raise InvitationProviderError("invitation provider response is invalid")
        invitation_id = str(payload.get("id") or "").strip()
        organization_id = str(
            payload.get("organization_id") or payload.get("organizationId") or ""
        ).strip()
        email_address = str(
            payload.get("email_address") or payload.get("emailAddress") or ""
        ).strip()
        role = str(payload.get("role") or "").strip()
        status = str(payload.get("status") or "").strip()
        try:
            normalized_email = normalize_invitation_email(email_address)
        except ValidationError:
            raise InvitationProviderError(
                "invitation provider response is invalid"
            ) from None
        if (
            not invitation_id
            or len(invitation_id) > 255
            or organization_id != expected_organization_id
            or not hmac.compare_digest(normalized_email, expected_email)
            or role != "org:member"
            or status != "pending"
        ):
            raise InvitationProviderError("invitation provider response is invalid")
        created_at = _provider_timestamp(
            payload.get("created_at") or payload.get("createdAt")
        )
        expires_at = _provider_timestamp(
            payload.get("expires_at") or payload.get("expiresAt")
        )
        if expires_at <= created_at:
            raise InvitationProviderError("invitation provider response is invalid")
        return ClerkInvitationResult(
            invitation_id=invitation_id,
            organization_id=organization_id,
            email_address=normalized_email,
            role=role,
            status=status,
            created_at=created_at,
            expires_at=expires_at,
        )
