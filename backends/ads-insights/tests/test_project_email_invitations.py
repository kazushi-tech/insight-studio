"""Clerk email invitation projection, privacy, and ordering tests."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import jwt
import pytest
import sqlalchemy as sa
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.platform.auth import ClerkJWTVerifier
from web.app.platform.errors import InvitationProviderError
from web.app.platform.errors import PlatformConfigurationError
from web.app.platform.invitations import (
    ClerkInvitationResult,
    ClerkRESTInvitationProvider,
)
from web.app.platform.schema import (
    app_users,
    audit_events,
    platform_metadata,
    project_memberships,
    workspaces,
)
from web.app.platform.webhook import ClerkWebhookVerifier
from web.app.routers.platform_v2_routes import create_platform_v2_router


ISSUER = "https://clerk.invite.test"
AZP = "https://insight.invite.test"
HASH_SECRET = "project-invite-test-secret-that-is-over-32-bytes"


class FakeInvitationProvider:
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.mode = "valid"
        self.expires_delta = timedelta(days=30)

    def invite_to_organization(self, **kwargs) -> ClerkInvitationResult:
        self.calls.append(dict(kwargs))
        if self.mode == "error":
            raise InvitationProviderError("raw provider email and body must stay private")
        now = datetime.now(timezone.utc)
        return ClerkInvitationResult(
            invitation_id=f"orginv_private_{len(self.calls)}",
            organization_id=(
                "org_wrong" if self.mode == "wrong_org" else kwargs["organization_id"]
            ),
            email_address=(
                "wrong@example.test"
                if self.mode == "wrong_email"
                else kwargs["email"]
            ),
            role="org:member",
            status="accepted" if self.mode == "accepted" else "pending",
            created_at=now,
            expires_at=now + self.expires_delta,
        )


@pytest.fixture()
def invitation_api(monkeypatch):
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
    webhook_secret = b"project-invitation-webhook-secret"
    webhook_verifier = ClerkWebhookVerifier(
        "whsec_" + base64.b64encode(webhook_secret).decode("ascii")
    )
    engine = sa.create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    platform_metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    def session_dependency():
        session = factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    provider = FakeInvitationProvider()
    app = FastAPI()
    app.include_router(
        create_platform_v2_router(
            session_dependency=session_dependency,
            jwt_verifier=verifier,
            webhook_verifier=webhook_verifier,
            invitation_provider=provider,
            project_invite_hash_secret=HASH_SECRET,
            write_access_checker=lambda _session, _context: None,
        )
    )

    def token(user_id: str, org_id: str) -> str:
        now = int(time.time())
        return jwt.encode(
            {
                "exp": now + 3600,
                "nbf": now - 5,
                "iss": ISSUER,
                "azp": AZP,
                "sub": user_id,
                "org_id": org_id,
                "org_role": "org:admin",
            },
            private_pem,
            algorithm="RS256",
        )

    yield app, token, provider, webhook_secret, factory
    engine.dispose()


def _headers(token: str, key: str | None = None) -> dict[str, str]:
    result = {"Authorization": f"Bearer {token}"}
    if key:
        result["Idempotency-Key"] = key
    return result


async def _bootstrap(client, token, name):
    return await client.post(
        "/api/auth/bootstrap",
        headers=_headers(token),
        json={"workspace_name": name},
    )


async def _webhook(client, secret: bytes, message_id: str, event: dict):
    timestamp = int(time.time())
    body = json.dumps(event, separators=(",", ":")).encode()
    signed = f"{message_id}.{timestamp}.".encode() + body
    signature = base64.b64encode(
        hmac.new(secret, signed, hashlib.sha256).digest()
    ).decode()
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
async def test_email_is_canonical_private_idempotent_and_tenant_scoped(invitation_api):
    app, token, provider, _, factory = invitation_api
    owner_a = token("owner_a", "org_a")
    owner_b = token("owner_b", "org_b")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await _bootstrap(client, owner_a, "A")).status_code == 200
        assert (await _bootstrap(client, owner_b, "B")).status_code == 200
        project_a = (
            await client.post(
                "/api/projects",
                headers=_headers(owner_a, "project-a-key"),
                json={"name": "A", "slug": "a"},
            )
        ).json()["project"]
        project_b = (
            await client.post(
                "/api/projects",
                headers=_headers(owner_b, "project-b-key"),
                json={"name": "B", "slug": "b"},
            )
        ).json()["project"]

        payload = {"email": " New.User@Example.TEST ", "role": "project_viewer"}
        created = await client.post(
            f"/api/projects/{project_a['id']}/members",
            headers=_headers(owner_a, "invite-email-key-001"),
            json=payload,
        )
        assert created.status_code == 201, created.text
        assert created.json()["invitation"]["status"] == "pending"
        assert "example.test" not in created.text.lower()
        assert "orginv_" not in created.text
        assert provider.calls[0]["organization_id"] == "org_a"
        assert provider.calls[0]["inviter_user_id"] == "owner_a"
        assert provider.calls[0]["email"] == "new.user@example.test"

        replay = await client.post(
            f"/api/projects/{project_a['id']}/members",
            headers=_headers(owner_a, "invite-email-key-001"),
            json=payload,
        )
        duplicate = await client.post(
            f"/api/projects/{project_a['id']}/members",
            headers=_headers(owner_a, "invite-email-key-002"),
            json=payload,
        )
        assert replay.json()["invitation"]["created"] is False
        assert duplicate.json()["invitation"]["created"] is False
        assert len(provider.calls) == 1

        role_conflict = await client.post(
            f"/api/projects/{project_a['id']}/members",
            headers=_headers(owner_a, "invite-email-key-003"),
            json={**payload, "role": "project_editor"},
        )
        assert role_conflict.status_code == 409
        assert "example.test" not in role_conflict.text.lower()

        cross_tenant = await client.post(
            f"/api/projects/{project_b['id']}/members",
            headers=_headers(owner_a, "invite-cross-tenant"),
            json={"email": "cross@example.test", "role": "project_viewer"},
        )
        assert cross_tenant.status_code == 404
        assert len(provider.calls) == 1

        invalid = await client.post(
            f"/api/projects/{project_a['id']}/members",
            headers=_headers(owner_a, "invite-invalid-email"),
            json={"email": "not an email", "role": "project_viewer"},
        )
        ambiguous = await client.post(
            f"/api/projects/{project_a['id']}/members",
            headers=_headers(owner_a, "invite-ambiguous"),
            json={
                "email": "valid@example.test",
                "clerk_user_id": "user_x",
                "role": "project_viewer",
            },
        )
        legacy_profile = await client.post(
            f"/api/projects/{project_a['id']}/members",
            headers=_headers(owner_a, "invite-legacy-profile"),
            json={
                "clerk_user_id": "user_x",
                "primary_email": "must-not-persist@example.test",
                "role": "project_viewer",
            },
        )
        malformed = await client.post(
            f"/api/projects/{project_a['id']}/members",
            headers={
                **_headers(owner_a, "invite-malformed-private"),
                "content-type": "application/json",
            },
            content=b'{"email":"malformed-private@example.test",',
        )
        assert invalid.status_code == 422
        assert ambiguous.status_code == 422
        assert legacy_profile.status_code == 422
        assert malformed.status_code == 400
        assert "not an email" not in invalid.text
        assert "valid@example.test" not in ambiguous.text
        assert "must-not-persist@example.test" not in legacy_profile.text
        assert "malformed-private@example.test" not in malformed.text

        legacy_viewer = await client.post(
            f"/api/projects/{project_a['id']}/members",
            headers=_headers(owner_a, "legacy-viewer-key"),
            json={
                "clerk_user_id": "viewer_user",
                "role": "project_viewer",
            },
        )
        assert legacy_viewer.status_code == 201
        assert "viewer_user" not in legacy_viewer.text
        assert "clerk_user_id" not in legacy_viewer.text
        denied = await client.post(
            f"/api/projects/{project_a['id']}/members",
            headers=_headers(token("viewer_user", "org_a"), "viewer-invite-denied"),
            json={"email": "denied@example.test", "role": "project_viewer"},
        )
        assert denied.status_code == 403
        assert len(provider.calls) == 1

    with factory() as session:
        pending = session.execute(
            sa.select(audit_events).where(
                audit_events.c.event_type == "project_invite.pending"
            )
        ).one()._mapping
        metadata = pending["metadata_json"]
        serialized = json.dumps(metadata)
        assert "new.user@example.test" not in serialized
        assert "orginv_private" not in serialized
        assert len(metadata["email_hmac"]) == 64
        assert len(metadata["provider_invitation_id_hash"]) == 64


@pytest.mark.asyncio
async def test_membership_before_user_projects_pending_invite_and_stale_create_cannot_regrant(
    invitation_api,
):
    app, token, provider, secret, factory = invitation_api
    owner = token("owner", "org_a")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await _bootstrap(client, owner, "A")).status_code == 200
        project = (
            await client.post(
                "/api/projects",
                headers=_headers(owner, "webhook-project-key"),
                json={"name": "Webhook", "slug": "webhook"},
            )
        ).json()["project"]
        invite = await client.post(
            f"/api/projects/{project['id']}/members",
            headers=_headers(owner, "webhook-invite-key"),
            json={"email": "joined@example.test", "role": "project_editor"},
        )
        assert invite.status_code == 201
        created_at = provider.calls and datetime.now(timezone.utc)
        membership_time = created_at + timedelta(seconds=2)
        membership = {
            "type": "organizationMembership.created",
            "timestamp": int(membership_time.timestamp() * 1000),
            "data": {
                "id": "membership_joined",
                "role": "org:member",
                "organization": {"id": "org_a"},
                "public_user_data": {"user_id": "joined_user"},
            },
        }
        deferred = await _webhook(client, secret, "msg-membership-first", membership)
        assert deferred.status_code == 200, deferred.text
        user = {
            "type": "user.created",
            "timestamp": int((membership_time + timedelta(seconds=1)).timestamp() * 1000),
            "data": {
                "id": "joined_user",
                "primary_email_address_id": "email_joined",
                "email_addresses": [
                    {"id": "email_joined", "email_address": "joined@example.test"}
                ],
            },
        }
        projected = await _webhook(client, secret, "msg-user-after", user)
        assert projected.status_code == 200, projected.text

        me = await client.get(
            "/api/auth/me", headers=_headers(token("joined_user", "org_a"))
        )
        assert me.status_code == 200
        assert me.json()["project_roles"][project["id"]] == "project_editor"

        direct_update = await client.post(
            f"/api/projects/{project['id']}/members",
            headers=_headers(owner, "webhook-direct-existing-member"),
            json={"email": "joined@example.test", "role": "project_viewer"},
        )
        assert direct_update.status_code == 201, direct_update.text
        assert direct_update.json()["member"]["status"] == "active"
        assert direct_update.json()["member"]["role"] == "project_viewer"
        assert len(provider.calls) == 1

        deleted_time = membership_time + timedelta(seconds=10)
        deleted = {
            **membership,
            "type": "organizationMembership.deleted",
            "timestamp": int(deleted_time.timestamp() * 1000),
        }
        assert (
            await _webhook(client, secret, "msg-membership-delete", deleted)
        ).status_code == 200
        stale = {**membership, "timestamp": int((deleted_time - timedelta(seconds=1)).timestamp() * 1000)}
        assert (
            await _webhook(client, secret, "msg-membership-stale-create", stale)
        ).status_code == 200

        removed = await client.get(
            "/api/auth/me", headers=_headers(token("joined_user", "org_a"))
        )
        assert removed.status_code == 403
        reinvite = await client.post(
            f"/api/projects/{project['id']}/members",
            headers=_headers(owner, "webhook-reinvite-after-removal"),
            json={"email": "joined@example.test", "role": "project_editor"},
        )
        assert reinvite.status_code == 201, reinvite.text
        assert reinvite.json()["invitation"]["status"] == "pending"
        assert len(provider.calls) == 2

    with factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(project_memberships)) == 0
        pending = session.execute(
            sa.select(audit_events.c.metadata_json).where(
                audit_events.c.event_type == "project_invite.pending"
            )
        ).scalar_one()
        assert pending["status"] == "pending"
        stored_user = session.execute(
            sa.select(app_users).where(app_users.c.clerk_user_id == "joined_user")
        ).one()._mapping
        assert stored_user["primary_email"] is None


@pytest.mark.asyncio
async def test_expired_membership_event_never_applies_project_invite(invitation_api):
    app, token, provider, secret, factory = invitation_api
    provider.expires_delta = timedelta(seconds=1)
    owner = token("owner", "org_a")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await _bootstrap(client, owner, "A")).status_code == 200
        project = (
            await client.post(
                "/api/projects",
                headers=_headers(owner, "expired-project-key"),
                json={"name": "Expired", "slug": "expired"},
            )
        ).json()["project"]
        assert (
            await client.post(
                f"/api/projects/{project['id']}/members",
                headers=_headers(owner, "expired-invite-key"),
                json={"email": "expired@example.test", "role": "project_viewer"},
            )
        ).status_code == 201
        event_time = datetime.now(timezone.utc) + timedelta(seconds=3)
        user_event = {
            "type": "user.created",
            "timestamp": int(event_time.timestamp() * 1000),
            "data": {
                "id": "expired_user",
                "primary_email_address_id": "email_expired",
                "email_addresses": [
                    {"id": "email_expired", "email_address": "expired@example.test"}
                ],
            },
        }
        membership_event = {
            "type": "organizationMembership.created",
            "timestamp": int(event_time.timestamp() * 1000),
            "data": {
                "id": "membership_expired",
                "role": "org:member",
                "organization": {"id": "org_a"},
                "public_user_data": {"user_id": "expired_user"},
            },
        }
        assert (await _webhook(client, secret, "msg-expired-user", user_event)).status_code == 200
        assert (
            await _webhook(client, secret, "msg-expired-membership", membership_event)
        ).status_code == 200
    with factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(project_memberships)) == 0
        metadata = session.scalar(
            sa.select(audit_events.c.metadata_json).where(
                audit_events.c.event_type == "project_invite.pending"
            )
        )
        assert metadata["status"] == "expired"


@pytest.mark.asyncio
async def test_stale_user_and_organization_events_cannot_reactivate_access(invitation_api):
    app, token, _, secret, factory = invitation_api
    owner = token("owner", "org_a")
    start = datetime.now(timezone.utc)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await _bootstrap(client, owner, "A")).status_code == 200
        user_created = {
            "type": "user.created",
            "timestamp": int(start.timestamp() * 1000),
            "data": {
                "id": "ordered_user",
                "primary_email_address_id": "ordered_email",
                "email_addresses": [
                    {
                        "id": "ordered_email",
                        "email_address": "ordered@example.test",
                    }
                ],
            },
        }
        membership_created = {
            "type": "organizationMembership.created",
            "timestamp": int((start + timedelta(seconds=1)).timestamp() * 1000),
            "data": {
                "id": "ordered_membership",
                "role": "org:member",
                "organization": {"id": "org_a"},
                "public_user_data": {"user_id": "ordered_user"},
            },
        }
        assert (await _webhook(client, secret, "ordered-user-create", user_created)).status_code == 200
        assert (
            await _webhook(client, secret, "ordered-membership-create", membership_created)
        ).status_code == 200

        stale_delete_before_create = {
            "type": "user.deleted",
            "timestamp": int((start - timedelta(seconds=1)).timestamp() * 1000),
            "data": {"id": "ordered_user"},
        }
        fresh_user_update = {
            **user_created,
            "type": "user.updated",
            "timestamp": int((start + timedelta(seconds=2)).timestamp() * 1000),
        }
        assert (
            await _webhook(
                client,
                secret,
                "ordered-user-stale-delete",
                stale_delete_before_create,
            )
        ).status_code == 200
        assert (
            await _webhook(client, secret, "ordered-user-fresh-update", fresh_user_update)
        ).status_code == 200
        with factory() as session:
            assert session.scalar(
                sa.select(app_users.c.status).where(
                    app_users.c.clerk_user_id == "ordered_user"
                )
            ) == "active"

        user_deleted = {
            "type": "user.deleted",
            "timestamp": int((start + timedelta(seconds=5)).timestamp() * 1000),
            "data": {"id": "ordered_user"},
        }
        stale_user_update = {
            **user_created,
            "type": "user.updated",
            "timestamp": int((start + timedelta(seconds=4)).timestamp() * 1000),
        }
        assert (await _webhook(client, secret, "ordered-user-delete", user_deleted)).status_code == 200
        stale_user = await _webhook(
            client,
            secret,
            "ordered-user-stale-update",
            stale_user_update,
        )
        assert stale_user.status_code == 200
        assert (
            await client.get(
                "/api/auth/me",
                headers=_headers(token("ordered_user", "org_a")),
            )
        ).status_code == 403

        organization_deleted = {
            "type": "organization.deleted",
            "timestamp": int((start + timedelta(seconds=7)).timestamp() * 1000),
            "data": {"id": "org_a"},
        }
        stale_organization_update = {
            "type": "organization.updated",
            "timestamp": int((start + timedelta(seconds=6)).timestamp() * 1000),
            "data": {"id": "org_a", "name": "Must not reactivate", "slug": "stale"},
        }
        assert (
            await _webhook(client, secret, "ordered-org-delete", organization_deleted)
        ).status_code == 200
        assert (
            await _webhook(
                client,
                secret,
                "ordered-org-stale-update",
                stale_organization_update,
            )
        ).status_code == 200

    with factory() as session:
        assert session.scalar(
            sa.select(app_users.c.status).where(
                app_users.c.clerk_user_id == "ordered_user"
            )
        ) == "deleted"
        assert session.scalar(
            sa.select(workspaces.c.status).where(
                workspaces.c.clerk_organization_id == "org_a"
            )
        ) == "deleted"


@pytest.mark.asyncio
async def test_profile_updates_cannot_revive_database_tombstones(invitation_api):
    app, token, _, secret, factory = invitation_api
    owner = token("tombstoned_owner", "tombstoned_org")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await _bootstrap(client, owner, "Tombstoned")).status_code == 200

        with factory() as session:
            session.execute(
                sa.update(app_users)
                .where(app_users.c.clerk_user_id == "tombstoned_owner")
                .values(status="deleted", deleted_at=datetime.now(timezone.utc))
            )
            session.execute(
                sa.update(workspaces)
                .where(workspaces.c.clerk_organization_id == "tombstoned_org")
                .values(status="deleted", deleted_at=datetime.now(timezone.utc))
            )
            session.commit()

        timestamp = int(datetime.now(timezone.utc).timestamp() * 1000)
        user_update = {
            "type": "user.updated",
            "timestamp": timestamp,
            "data": {
                "id": "tombstoned_owner",
                "first_name": "Must not",
                "last_name": "revive",
                "primary_email_address_id": "tombstoned_email",
                "email_addresses": [
                    {
                        "id": "tombstoned_email",
                        "email_address": "tombstoned@example.test",
                    }
                ],
            },
        }
        organization_update = {
            "type": "organization.updated",
            "timestamp": timestamp + 1,
            "data": {
                "id": "tombstoned_org",
                "name": "Must not revive",
                "slug": "must-not-revive",
            },
        }
        assert (
            await _webhook(client, secret, "tombstone-user-update", user_update)
        ).status_code == 200
        assert (
            await _webhook(
                client,
                secret,
                "tombstone-organization-update",
                organization_update,
            )
        ).status_code == 200

    with factory() as session:
        user = session.execute(
            sa.select(app_users).where(
                app_users.c.clerk_user_id == "tombstoned_owner"
            )
        ).one()._mapping
        workspace = session.execute(
            sa.select(workspaces).where(
                workspaces.c.clerk_organization_id == "tombstoned_org"
            )
        ).one()._mapping
        assert user["status"] == "deleted"
        assert user["primary_email"] is None
        assert workspace["status"] == "deleted"
        assert workspace["name"] == "Tombstoned"


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["wrong_org", "wrong_email", "accepted", "error"])
async def test_invalid_provider_is_safe_and_does_not_persist_pending(invitation_api, mode):
    app, token, provider, _, factory = invitation_api
    provider.mode = mode
    owner = token("owner", "org_a")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await _bootstrap(client, owner, "A")).status_code == 200
        project = (
            await client.post(
                "/api/projects",
                headers=_headers(owner, f"provider-project-{mode}"),
                json={"name": "Provider", "slug": f"provider-{mode}"},
            )
        ).json()["project"]
        response = await client.post(
            f"/api/projects/{project['id']}/members",
            headers=_headers(owner, f"provider-invite-{mode}"),
            json={"email": "private@example.test", "role": "project_viewer"},
        )
        assert response.status_code == 502
        assert response.json() == {"detail": "invitation_provider_unavailable"}
        assert "private@example.test" not in response.text
        assert "raw provider" not in response.text
    with factory() as session:
        assert session.scalar(
            sa.select(sa.func.count())
            .select_from(audit_events)
            .where(audit_events.c.event_type == "project_invite.pending")
        ) == 0


def test_official_clerk_provider_validates_response_email_and_sanitizes_failure(monkeypatch):
    captured: dict = {}
    now = datetime.now(timezone.utc)

    class Response:
        status_code = 201

        @staticmethod
        def json():
            return {
                "id": "orginv_test",
                "organization_id": "org_a",
                "email_address": "invitee@example.test",
                "role": "org:member",
                "status": "pending",
                "created_at": int(now.timestamp() * 1000),
                "expires_at": int((now + timedelta(days=30)).timestamp() * 1000),
            }

    class Client:
        def __init__(self, **kwargs):
            captured["client"] = kwargs

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, url, **kwargs):
            captured["url"] = url
            captured["request"] = kwargs
            return Response()

    monkeypatch.setattr(httpx, "Client", Client)
    provider = ClerkRESTInvitationProvider(secret_key="sk_test_private_value")
    result = provider.invite_to_organization(
        organization_id="org_a",
        inviter_user_id="user_owner",
        email="Invitee@Example.TEST",
        idempotency_key="project-invite:test",
    )
    assert result.email_address == "invitee@example.test"
    assert captured["url"] == (
        "https://api.clerk.com/v1/organizations/org_a/invitations"
    )
    assert captured["request"]["json"] == {
        "email_address": "invitee@example.test",
        "role": "org:member",
        "inviter_user_id": "user_owner",
        "expires_in_days": 30,
    }
    assert captured["request"]["headers"]["Idempotency-Key"] == "project-invite:test"

    Response.json = staticmethod(
        lambda: {
            "id": "orginv_wrong",
            "organization_id": "org_a",
            "email_address": "other@example.test",
            "role": "org:member",
            "status": "pending",
            "created_at": int(now.timestamp() * 1000),
            "expires_at": int((now + timedelta(days=30)).timestamp() * 1000),
        }
    )
    with pytest.raises(InvitationProviderError) as error:
        provider.invite_to_organization(
            organization_id="org_a",
            inviter_user_id="user_owner",
            email="invitee@example.test",
            idempotency_key="project-invite:test-2",
        )
    assert "other@example.test" not in str(error.value)
    with pytest.raises(PlatformConfigurationError):
        ClerkRESTInvitationProvider(
            secret_key="sk_test_private_value",
            base_url="https://example.test",
        )
