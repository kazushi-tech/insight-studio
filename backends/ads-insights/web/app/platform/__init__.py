"""Clerk-backed platform access layer for Insight Studio.

The package is intentionally isolated from ``backend_api.py`` so it can be
mounted only after its database and Clerk configuration gates are ready.
"""

from .auth import ClerkJWTVerifier, ClerkPrincipal
from .repository import PlatformRepository
from .schema import platform_metadata

__all__ = [
    "ClerkJWTVerifier",
    "ClerkPrincipal",
    "PlatformRepository",
    "platform_metadata",
]
