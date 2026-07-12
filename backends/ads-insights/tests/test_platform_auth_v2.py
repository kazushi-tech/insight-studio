from __future__ import annotations

import base64
import hashlib
import hmac
import sys
import time
from pathlib import Path

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.platform.auth import ClerkJWTVerifier
from web.app.platform.errors import AuthenticationError, PlatformConfigurationError
from web.app.platform.webhook import ClerkWebhookHeaders, ClerkWebhookVerifier


ISSUER = "https://clerk.example.test"
ALLOWED_AZP = "https://insight.example.test"


@pytest.fixture(scope="module")
def rsa_keys():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return private_pem, public_pem.decode("utf-8")


def _claims(**overrides):
    now = int(time.time())
    values = {
        "exp": now + 3600,
        "nbf": now - 5,
        "iss": ISSUER,
        "azp": ALLOWED_AZP,
        "sub": "user_a",
        "org_id": "org_a",
    }
    values.update(overrides)
    return values


def _token(private_pem: bytes, claims: dict) -> str:
    return jwt.encode(claims, private_pem, algorithm="RS256")


def _verifier(public_pem: str) -> ClerkJWTVerifier:
    return ClerkJWTVerifier(
        public_key_pem=public_pem,
        issuer=ISSUER,
        allowed_authorized_parties={ALLOWED_AZP},
        leeway_seconds=0,
    )


def test_valid_clerk_token_is_verified_offline(rsa_keys):
    private_pem, public_pem = rsa_keys
    principal = _verifier(public_pem).verify(_token(private_pem, _claims()))
    assert principal.clerk_user_id == "user_a"
    assert principal.clerk_organization_id == "org_a"
    assert principal.authorized_party == ALLOWED_AZP


@pytest.mark.parametrize(
    "claim,value",
    [
        ("exp", int(time.time()) - 60),
        ("nbf", int(time.time()) + 600),
        ("iss", "https://wrong-issuer.example"),
        ("azp", "https://evil.example"),
    ],
)
def test_expired_not_before_issuer_and_azp_are_rejected(rsa_keys, claim, value):
    private_pem, public_pem = rsa_keys
    with pytest.raises(AuthenticationError):
        _verifier(public_pem).verify(
            _token(private_pem, _claims(**{claim: value}))
        )


@pytest.mark.parametrize("missing_claim", ["exp", "nbf", "iss", "azp", "sub", "org_id"])
def test_all_required_claims_are_enforced(rsa_keys, missing_claim):
    private_pem, public_pem = rsa_keys
    claims = _claims()
    claims.pop(missing_claim)
    with pytest.raises(AuthenticationError):
        _verifier(public_pem).verify(_token(private_pem, claims))


def test_non_rsa_public_key_configuration_fails_closed():
    with pytest.raises(PlatformConfigurationError):
        ClerkJWTVerifier(
            public_key_pem="not-a-public-key",
            issuer=ISSUER,
            allowed_authorized_parties={ALLOWED_AZP},
        )


def test_clerk_webhook_signature_and_expiry_are_verified(monkeypatch):
    secret = b"test-webhook-secret"
    verifier = ClerkWebhookVerifier(
        "whsec_" + base64.b64encode(secret).decode("ascii"),
        tolerance_seconds=300,
    )
    timestamp = int(time.time())
    payload = b'{"type":"user.created","data":{"id":"user_a"}}'
    message_id = "msg_123"
    signed = f"{message_id}.{timestamp}.".encode("utf-8") + payload
    signature = base64.b64encode(
        hmac.new(secret, signed, hashlib.sha256).digest()
    ).decode("ascii")

    verifier.verify(
        payload,
        ClerkWebhookHeaders(
            message_id=message_id,
            timestamp=str(timestamp),
            signature=f"v1,{signature}",
        ),
    )

    monkeypatch.setattr(time, "time", lambda: timestamp + 301)
    with pytest.raises(AuthenticationError):
        verifier.verify(
            payload,
            ClerkWebhookHeaders(
                message_id=message_id,
                timestamp=str(timestamp),
                signature=f"v1,{signature}",
            ),
        )
