"""Fail-closed legal/privacy configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from .errors import LegalConfigurationError


@dataclass(frozen=True)
class LegalConfig:
    required_document_keys: tuple[str, ...] = ("terms", "privacy")
    hash_secret: str = field(default="", repr=False)

    @classmethod
    def from_env(cls) -> "LegalConfig":
        keys = tuple(
            value.strip()
            for value in (
                os.getenv("LEGAL_REQUIRED_DOCUMENT_KEYS") or "terms,privacy"
            ).split(",")
            if value.strip()
        )
        return cls(
            required_document_keys=keys,
            hash_secret=(os.getenv("LEGAL_AUDIT_HASH_SECRET") or "").strip(),
        )

    def require_hash_secret(self) -> str:
        if len(self.hash_secret.encode("utf-8")) < 32:
            raise LegalConfigurationError("legal audit hashing is not configured")
        return self.hash_secret
