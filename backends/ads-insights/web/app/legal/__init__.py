"""Versioned legal consent and privacy-request services."""

from .config import LegalConfig
from .identity import LegalIdentity
from .service import LegalService

__all__ = ["LegalConfig", "LegalIdentity", "LegalService"]
