"""Offline verification for Clerk/Svix webhook signatures."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import os
import time
from dataclasses import dataclass

from .errors import AuthenticationError, PlatformConfigurationError


@dataclass(frozen=True)
class ClerkWebhookHeaders:
    message_id: str
    timestamp: str
    signature: str


class ClerkWebhookVerifier:
    def __init__(self, signing_secret: str, tolerance_seconds: int = 300) -> None:
        raw_secret = (signing_secret or "").strip()
        if not raw_secret:
            raise PlatformConfigurationError("CLERK_WEBHOOK_SIGNING_SECRET is required")
        encoded_secret = raw_secret[6:] if raw_secret.startswith("whsec_") else raw_secret
        try:
            self._secret = base64.b64decode(encoded_secret, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise PlatformConfigurationError(
                "CLERK_WEBHOOK_SIGNING_SECRET is not valid base64"
            ) from exc
        if not self._secret:
            raise PlatformConfigurationError("Clerk webhook signing secret is empty")
        self._tolerance_seconds = max(1, int(tolerance_seconds))

    @classmethod
    def from_env(cls) -> "ClerkWebhookVerifier":
        try:
            tolerance = int(os.getenv("CLERK_WEBHOOK_TOLERANCE_SECONDS", "300"))
        except ValueError as exc:
            raise PlatformConfigurationError(
                "CLERK_WEBHOOK_TOLERANCE_SECONDS must be an integer"
            ) from exc
        return cls(os.getenv("CLERK_WEBHOOK_SIGNING_SECRET", ""), tolerance)

    def verify(self, payload: bytes, headers: ClerkWebhookHeaders) -> None:
        if not headers.message_id or not headers.timestamp or not headers.signature:
            raise AuthenticationError("Missing Clerk webhook signature headers")
        try:
            timestamp = int(headers.timestamp)
        except ValueError as exc:
            raise AuthenticationError("Invalid Clerk webhook timestamp") from exc
        if abs(int(time.time()) - timestamp) > self._tolerance_seconds:
            raise AuthenticationError("Expired Clerk webhook signature")

        signed_payload = (
            f"{headers.message_id}.{headers.timestamp}.".encode("utf-8") + payload
        )
        expected = base64.b64encode(
            hmac.new(self._secret, signed_payload, hashlib.sha256).digest()
        ).decode("ascii")
        signatures = []
        for item in headers.signature.split():
            version, separator, value = item.partition(",")
            if separator and version == "v1" and value:
                signatures.append(value)
        if not signatures or not any(
            hmac.compare_digest(expected, candidate) for candidate in signatures
        ):
            raise AuthenticationError("Invalid Clerk webhook signature")
