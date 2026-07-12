"""Strict offline verification for Clerk session JWTs.

Only a configured PEM RSA public key is used.  This module deliberately has
no JWKS client, HTTP dependency, discovery URL, or network fallback.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Mapping

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey

from .errors import AuthenticationError, PlatformConfigurationError


_REQUIRED_CLAIMS = ("exp", "nbf", "iss", "azp", "sub", "org_id")


@dataclass(frozen=True)
class ClerkPrincipal:
    clerk_user_id: str
    clerk_organization_id: str
    issuer: str
    authorized_party: str
    claims: Mapping[str, Any]


class ClerkJWTVerifier:
    """Verify Clerk session tokens with a pinned local RS256 public key."""

    def __init__(
        self,
        *,
        public_key_pem: str,
        issuer: str,
        allowed_authorized_parties: set[str],
        leeway_seconds: int = 5,
    ) -> None:
        normalized_key = (public_key_pem or "").strip().replace("\\n", "\n")
        normalized_issuer = (issuer or "").strip().rstrip("/")
        normalized_parties = {
            party.strip().rstrip("/")
            for party in allowed_authorized_parties
            if party and party.strip()
        }
        if not normalized_key or not normalized_issuer or not normalized_parties:
            raise PlatformConfigurationError(
                "Clerk public key, issuer, and allowed azp values are required"
            )
        try:
            loaded_key = serialization.load_pem_public_key(normalized_key.encode("utf-8"))
        except (TypeError, ValueError) as exc:
            raise PlatformConfigurationError("CLERK_JWT_PUBLIC_KEY is not valid PEM") from exc
        if not isinstance(loaded_key, RSAPublicKey):
            raise PlatformConfigurationError("CLERK_JWT_PUBLIC_KEY must be an RSA public key")

        self._public_key_pem = normalized_key
        self._issuer = normalized_issuer
        self._allowed_authorized_parties = frozenset(normalized_parties)
        self._leeway_seconds = max(0, int(leeway_seconds))

    @classmethod
    def from_env(cls) -> "ClerkJWTVerifier":
        parties = {
            value.strip()
            for value in (os.getenv("CLERK_ALLOWED_AZP") or "").split(",")
            if value.strip()
        }
        try:
            leeway = int(os.getenv("CLERK_JWT_LEEWAY_SECONDS", "5"))
        except ValueError as exc:
            raise PlatformConfigurationError(
                "CLERK_JWT_LEEWAY_SECONDS must be an integer"
            ) from exc
        return cls(
            public_key_pem=os.getenv("CLERK_JWT_PUBLIC_KEY", ""),
            issuer=os.getenv("CLERK_ISSUER", ""),
            allowed_authorized_parties=parties,
            leeway_seconds=leeway,
        )

    def verify(self, token: str) -> ClerkPrincipal:
        if not token or not token.strip():
            raise AuthenticationError("Missing Clerk session token")
        try:
            claims = jwt.decode(
                token.strip(),
                self._public_key_pem,
                algorithms=["RS256"],
                issuer=self._issuer,
                leeway=self._leeway_seconds,
                options={
                    "require": list(_REQUIRED_CLAIMS),
                    "verify_signature": True,
                    "verify_exp": True,
                    "verify_nbf": True,
                    "verify_iss": True,
                    "verify_aud": False,
                },
            )
        except jwt.PyJWTError as exc:
            raise AuthenticationError("Invalid Clerk session token") from exc

        authorized_party = claims.get("azp")
        subject = claims.get("sub")
        organization_id = claims.get("org_id")
        issuer = str(claims.get("iss") or "").rstrip("/")
        if not isinstance(authorized_party, str) or (
            authorized_party.rstrip("/") not in self._allowed_authorized_parties
        ):
            raise AuthenticationError("Clerk token azp is not allowed")
        if not isinstance(subject, str) or not subject.strip():
            raise AuthenticationError("Clerk token sub is invalid")
        if not isinstance(organization_id, str) or not organization_id.strip():
            raise AuthenticationError("Clerk token org_id is invalid")
        if issuer != self._issuer:
            raise AuthenticationError("Clerk token issuer is invalid")

        return ClerkPrincipal(
            clerk_user_id=subject.strip(),
            clerk_organization_id=organization_id.strip(),
            issuer=issuer,
            authorized_party=authorized_party.rstrip("/"),
            claims=claims,
        )


def bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise AuthenticationError("Authorization header is required")
    scheme, separator, value = authorization.partition(" ")
    if not separator or scheme.lower() != "bearer" or not value.strip():
        raise AuthenticationError("Bearer token is required")
    return value.strip()
