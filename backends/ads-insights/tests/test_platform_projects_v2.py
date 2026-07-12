from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sys
import time
from pathlib import Path

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.platform.auth import ClerkJWTVerifier
from web.app.platform.schema import platform_metadata
from web.app.platform.webhook import ClerkWebhookVerifier
from web.app.platform_db import reset_platform_engine_for_tests
from web.app.routers.platform_v2_routes import create_platform_v2_router


ISSUER = "https://clerk.example.test"
AZP = "https://insight.example.test"


@pytest.fixture()
def platform_api(monkeypatch):
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")
    verifier = ClerkJWTVerifier(
        public_key_pem=public_pem,
        issuer=ISSUER,
        allowed_authorized_parties={AZP},
        leeway_seconds=0,
    )
    webhook_secret = b"platform-project-test-webhook-secret"
    webhook_verifier = ClerkWebhookVerifier(
        "whsec_" + base64.b64encode(webhook_secret).decode("ascii")
    )

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # Runtime code never creates tables; this is the isolated test-only setup.
    platform_metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)

    def session_dependency():
        session = session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    monkeypatch.setenv("PLATFORM_ADMIN_CLERK_USER_IDS", "admin_user")
    app = FastAPI()
    app.include_router(
        create_platform_v2_router(
            session_dependency=session_dependency,
            jwt_verifier=verifier,
            webhook_verifier=webhook_verifier,
            data_source_tester=lambda source: {
                "connected": bool(source.get("dataset_id")),
            },
            write_access_checker=lambda _session, _context: None,
        )
    )

    def token(user_id: str, org_id: str, **overrides) -> str:
        now = int(time.time())
        claims = {
            "exp": now + 3600,
            "nbf": now - 5,
            "iss": ISSUER,
            "azp": AZP,
            "sub": user_id,
            "org_id": org_id,
            "org_role": "org:admin",
        }
        claims.update(overrides)
        return jwt.encode(claims, private_pem, algorithm="RS256")

    return app, token, verifier, webhook_secret


def _headers(token: str, *, idempotency_key: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if idempotency_key is not None:
        headers["Idempotency-Key"] = idempotency_key
    return headers


async def _bootstrap(client: httpx.AsyncClient, token: str, name: str) -> httpx.Response:
    return await client.post(
        "/api/auth/bootstrap",
        headers=_headers(token),
        json={"workspace_name": name},
    )


async def _send_clerk_webhook(
    client: httpx.AsyncClient,
    secret: bytes,
    *,
    message_id: str,
    event: dict,
) -> httpx.Response:
    timestamp = int(time.time())
    body = json.dumps(event, separators=(",", ":")).encode("utf-8")
    signed = f"{message_id}.{timestamp}.".encode("utf-8") + body
    signature = base64.b64encode(
        hmac.new(secret, signed, hashlib.sha256).digest()
    ).decode("ascii")
    return await client.post(
        "/api/webhooks/clerk",
        content=body,
        headers={
            "content-type": "application/json",
            "svix-id": message_id,
            "svix-timestamp": str(timestamp),
            "svix-signature": f"v1,{signature}",
        },
    )


@pytest.mark.asyncio
async def test_clerk_webhook_rejects_oversized_body_before_verification(platform_api):
    app, _token, _verifier, _secret = platform_api
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/webhooks/clerk",
            content=b"x" * 1_048_577,
            headers={
                "svix-id": "oversized",
                "svix-timestamp": str(int(time.time())),
                "svix-signature": "v1,invalid",
            },
        )

    assert response.status_code == 413
    assert response.json() == {"detail": "request_body_too_large"}


@pytest.mark.asyncio
async def test_project_idempotency_version_and_cross_tenant_access(platform_api):
    app, token, _, _ = platform_api
    token_a = token("user_a", "org_a")
    token_b = token("user_b", "org_b")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await _bootstrap(client, token_a, "Workspace A")).status_code == 200
        assert (await _bootstrap(client, token_b, "Workspace B")).status_code == 200

        create_payload = {
            "name": "Project A",
            "slug": "project-a",
            "description": "tenant A",
        }
        missing_key = await client.post(
            "/api/projects",
            headers=_headers(token_a),
            json={"name": "No key", "slug": "no-key"},
        )
        assert missing_key.status_code == 400

        first = await client.post(
            "/api/projects",
            headers=_headers(token_a, idempotency_key="create-project-a-001"),
            json=create_payload,
        )
        assert first.status_code == 201, first.text
        project = first.json()["project"]

        replay = await client.post(
            "/api/projects",
            headers=_headers(token_a, idempotency_key="create-project-a-001"),
            json=create_payload,
        )
        assert replay.status_code == 201
        assert replay.json()["project"]["id"] == project["id"]

        conflict = await client.post(
            "/api/projects",
            headers=_headers(token_a, idempotency_key="create-project-a-001"),
            json={**create_payload, "name": "Different payload"},
        )
        assert conflict.status_code == 409

        patched = await client.patch(
            f"/api/projects/{project['id']}",
            headers=_headers(token_a),
            json={"version": 1, "name": "Project A updated"},
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["project"]["version"] == 2

        stale = await client.patch(
            f"/api/projects/{project['id']}",
            headers=_headers(token_a),
            json={"version": 1, "name": "Stale update"},
        )
        assert stale.status_code == 409
        assert stale.json()["detail"] == "version_conflict"

        archived = await client.request(
            "DELETE",
            f"/api/projects/{project['id']}",
            headers=_headers(token_a),
            json={"version": 2},
        )
        assert archived.status_code == 200
        assert archived.json()["project"]["status"] == "archived"
        assert archived.json()["project"]["version"] == 3

        cross_tenant = await client.get(
            f"/api/projects/{project['id']}", headers=_headers(token_b)
        )
        assert cross_tenant.status_code == 404

        forged_wrong_org = token("user_a", "org_b")
        wrong_org = await client.get(
            "/api/auth/me", headers=_headers(forged_wrong_org)
        )
        assert wrong_org.status_code == 403


@pytest.mark.asyncio
async def test_member_rbac_and_data_source_redaction(platform_api):
    app, token, _, _ = platform_api
    owner_token = token("owner_user", "org_a")
    viewer_token = token("viewer_user", "org_a")
    admin_token = token("admin_user", "org_a")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await _bootstrap(client, owner_token, "Workspace A")).status_code == 200
        project_response = await client.post(
            "/api/projects",
            headers=_headers(owner_token, idempotency_key="create-member-project"),
            json={"name": "Members", "slug": "members"},
        )
        project = project_response.json()["project"]

        member_payload = {
            "clerk_user_id": "viewer_user",
            "role": "project_viewer",
        }
        member = await client.post(
            f"/api/projects/{project['id']}/members",
            headers=_headers(owner_token, idempotency_key="invite-viewer-001"),
            json=member_payload,
        )
        assert member.status_code == 201, member.text
        viewer_app_user_id = member.json()["member"]["app_user_id"]

        replay = await client.post(
            f"/api/projects/{project['id']}/members",
            headers=_headers(owner_token, idempotency_key="invite-viewer-001"),
            json=member_payload,
        )
        assert replay.status_code == 201
        assert replay.json()["member"]["app_user_id"] == viewer_app_user_id

        wrong_payload = await client.post(
            f"/api/projects/{project['id']}/members",
            headers=_headers(owner_token, idempotency_key="invite-viewer-001"),
            json={**member_payload, "role": "project_editor"},
        )
        assert wrong_payload.status_code == 409

        me = await client.get("/api/auth/me", headers=_headers(viewer_token))
        assert me.status_code == 200
        assert me.json()["project_roles"][project["id"]] == "project_viewer"
        assert (
            await client.get(
                f"/api/projects/{project['id']}", headers=_headers(viewer_token)
            )
        ).status_code == 200
        denied_patch = await client.patch(
            f"/api/projects/{project['id']}",
            headers=_headers(viewer_token),
            json={"version": 1, "name": "not allowed"},
        )
        assert denied_patch.status_code == 403

        promote = await client.patch(
            f"/api/projects/{project['id']}/members/{viewer_app_user_id}",
            headers=_headers(owner_token),
            json={"role": "project_editor"},
        )
        assert promote.status_code == 200
        editor_patch = await client.patch(
            f"/api/projects/{project['id']}",
            headers=_headers(viewer_token),
            json={"version": 1, "description": "editor update"},
        )
        assert editor_patch.status_code == 200

        data_source_payload = {
            "source_type": "ga4_bigquery",
            "gcp_project_id": "private-gcp-project",
            "dataset_id": "analytics_123456",
            "scope_kind": "customer",
            "safe_config": {"timezone": "Asia/Tokyo"},
        }
        owner_put = await client.put(
            f"/api/projects/{project['id']}/data-source",
            headers=_headers(owner_token),
            json=data_source_payload,
        )
        assert owner_put.status_code == 200, owner_put.text
        assert "dataset_id" not in owner_put.json()["data_source"]
        assert "source_type" not in owner_put.json()["data_source"]

        editor_get = await client.get(
            f"/api/projects/{project['id']}/data-source",
            headers=_headers(viewer_token),
        )
        assert editor_get.status_code == 200
        assert "dataset_id" not in editor_get.json()["data_source"]

        admin_bootstrap = await _bootstrap(client, admin_token, "Workspace A")
        assert admin_bootstrap.status_code == 200, admin_bootstrap.text
        admin_get = await client.get(
            f"/api/projects/{project['id']}/data-source",
            headers=_headers(admin_token),
        )
        assert admin_get.status_code == 200
        assert admin_get.json()["data_source"]["dataset_id"] == "analytics_123456"
        assert admin_get.json()["data_source"]["source_type"] == "ga4_bigquery"

        test_result = await client.post(
            f"/api/projects/{project['id']}/data-source/test",
            headers=_headers(owner_token),
        )
        assert test_result.status_code == 200
        assert test_result.json()["connected"] is True
        assert "dataset" not in test_result.text


@pytest.mark.asyncio
async def test_clerk_webhook_projects_identity_and_is_idempotent(platform_api):
    app, token, _, webhook_secret = platform_api
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        event_clock = int(time.time() * 1000)
        user_event = {
            "type": "user.created",
            "timestamp": event_clock,
            "data": {
                "id": "webhook_user",
                "first_name": "Webhook",
                "last_name": "User",
                "primary_email_address_id": "email_1",
                "email_addresses": [
                    {"id": "email_1", "email_address": "webhook@example.test"}
                ],
            },
        }
        org_event = {
            "type": "organization.created",
            "timestamp": event_clock + 1,
            "data": {"id": "webhook_org", "name": "Webhook Org", "slug": "webhook-org"},
        }
        membership_event = {
            "type": "organizationMembership.created",
            "timestamp": event_clock + 2,
            "data": {
                "id": "membership_1",
                "role": "org:admin",
                "organization": {"id": "webhook_org"},
                "public_user_data": {"user_id": "webhook_user"},
            },
        }
        for message_id, event in [
            ("msg_user", user_event),
            ("msg_org", org_event),
            ("msg_membership", membership_event),
        ]:
            response = await _send_clerk_webhook(
                client,
                webhook_secret,
                message_id=message_id,
                event=event,
            )
            assert response.status_code == 200, response.text
            assert response.json()["duplicate"] is False

        duplicate = await _send_clerk_webhook(
            client,
            webhook_secret,
            message_id="msg_membership",
            event=membership_event,
        )
        assert duplicate.status_code == 200
        assert duplicate.json()["duplicate"] is True

        me = await client.get(
            "/api/auth/me", headers=_headers(token("webhook_user", "webhook_org"))
        )
        assert me.status_code == 200
        assert me.json()["workspace_role"] == "workspace_admin"


@pytest.mark.asyncio
async def test_missing_database_returns_503_without_fallback(platform_api, monkeypatch):
    _, token, verifier, _ = platform_api
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("VERCEL", raising=False)
    reset_platform_engine_for_tests()
    app = FastAPI()
    app.include_router(create_platform_v2_router(jwt_verifier=verifier))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await _bootstrap(client, token("db_user", "db_org"), "DB")
    assert response.status_code == 503
    reset_platform_engine_for_tests()
