"""M-107 Clerk/offline authentication and platform RBAC boundary tests."""

from __future__ import annotations

import time

import jwt
import pytest
import sqlalchemy as sa
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient

import web.app.auth as auth_module
from web.app.auth import get_verified_owner_id, verify_admin_or_integration
from web.app.tenant_auth import TenantDatabaseUnavailableError
from web.app.tenant_schema import (
    app_users,
    metadata,
    project_memberships,
    projects,
    workspace_memberships,
    workspaces,
)


ISSUER = "https://clerk.example.test"
ALLOWED_AZP = "https://app.example.test"

USER_A = "user_A"
APP_USER_A = "10000000-0000-0000-0000-000000000001"
ORG_A = "org_A"
WORKSPACE_A = "20000000-0000-0000-0000-000000000001"
PROJECT_A = "30000000-0000-0000-0000-000000000001"

USER_B = "user_B"
APP_USER_B = "10000000-0000-0000-0000-000000000002"
ORG_B = "org_B"
WORKSPACE_B = "20000000-0000-0000-0000-000000000002"
PROJECT_B = "30000000-0000-0000-0000-000000000002"

CUSTOMER_USER = "user_customer"
CUSTOMER_APP_USER = "10000000-0000-0000-0000-000000000003"


@pytest.fixture(scope="module")
def signing_keys():
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
    return private_pem, public_pem


@pytest.fixture()
def platform_db(tmp_path, monkeypatch, signing_keys):
    db_path = tmp_path / "platform.db"
    url = f"sqlite:///{db_path.as_posix()}"
    engine = sa.create_engine(url)
    metadata.create_all(engine)  # test-only; runtime never creates schema
    with engine.begin() as connection:
        connection.execute(
            sa.insert(app_users),
            [
                {
                    "id": APP_USER_A,
                    "clerk_user_id": USER_A,
                    "platform_role": "platform_admin",
                    "status": "active",
                },
                {
                    "id": APP_USER_B,
                    "clerk_user_id": USER_B,
                    "platform_role": "platform_admin",
                    "status": "active",
                },
                {
                    "id": CUSTOMER_APP_USER,
                    "clerk_user_id": CUSTOMER_USER,
                    "platform_role": None,
                    "status": "active",
                },
            ],
        )
        connection.execute(
            sa.insert(workspaces),
            [
                {
                    "id": WORKSPACE_A,
                    "clerk_organization_id": ORG_A,
                    "slug": "tenant-a",
                    "name": "Tenant A",
                    "status": "active",
                },
                {
                    "id": WORKSPACE_B,
                    "clerk_organization_id": ORG_B,
                    "slug": "tenant-b",
                    "name": "Tenant B",
                    "status": "active",
                },
            ],
        )
        connection.execute(
            sa.insert(projects),
            [
                {
                    "id": PROJECT_A,
                    "workspace_id": WORKSPACE_A,
                    "slug": "project-a",
                    "name": "Project A",
                    "status": "active",
                },
                {
                    "id": PROJECT_B,
                    "workspace_id": WORKSPACE_B,
                    "slug": "project-b",
                    "name": "Project B",
                    "status": "active",
                },
            ],
        )
        connection.execute(
            sa.insert(workspace_memberships).values(
                workspace_id=WORKSPACE_A,
                app_user_id=CUSTOMER_APP_USER,
                role="workspace_owner",
            )
        )
        connection.execute(
            sa.insert(project_memberships).values(
                workspace_id=WORKSPACE_A,
                project_id=PROJECT_A,
                app_user_id=CUSTOMER_APP_USER,
                role="project_viewer",
            )
        )

    _, public_pem = signing_keys
    for name in (
        "API_KEYS",
        "INTEGRATION_API_KEYS",
        "JWT_SECRET",
        "RENDER",
        "VERCEL",
        "RENDER_SERVICE_ID",
        "RENDER_EXTERNAL_URL",
        "APP_ENV",
        "ENVIRONMENT",
        "ENV",
    ):
        monkeypatch.delenv(name, raising=False)
    auth_module.API_KEYS.clear()
    monkeypatch.setenv("ALLOW_INSECURE_DEV_AUTH", "false")
    monkeypatch.setenv("ML_AUTH_MODE", "clerk")
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("CLERK_JWT_PUBLIC_KEY", public_pem.decode("utf-8"))
    monkeypatch.setenv("CLERK_ISSUER", ISSUER)
    monkeypatch.setenv("CLERK_ALLOWED_AZP", ALLOWED_AZP)
    return url


def _token(
    private_pem: bytes,
    *,
    user_id: str = USER_A,
    org_id: str = ORG_A,
    azp: str = ALLOWED_AZP,
    issuer: str = ISSUER,
    expires_in: int = 300,
    not_before_offset: int = -1,
) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "sub": user_id,
            "org_id": org_id,
            "azp": azp,
            "iss": issuer,
            "nbf": now + not_before_offset,
            "exp": now + expires_in,
        },
        private_pem,
        algorithm="RS256",
    )


def _client() -> TestClient:
    app = FastAPI()

    @app.get("/protected")
    async def protected(
        request: Request,
        principal=Depends(verify_admin_or_integration),
        owner_id: str = Depends(get_verified_owner_id),
    ):
        return {
            "kind": principal.kind,
            "role": principal.role,
            "owner_id": owner_id,
            "clerk_user": request.state.clerk_user,
            "workspace": request.state.workspace,
            "project": request.state.project,
        }

    return TestClient(app)


def _headers(token: str, project_id: str = PROJECT_A) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "X-Insight-Project": project_id,
    }


def test_platform_admin_gets_verified_request_context(
    platform_db,
    signing_keys,
):
    token = _token(signing_keys[0])
    response = _client().get(
        "/protected",
        headers={**_headers(token), "X-Insight-User": "auth:spoofed1"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == "clerk"
    assert body["role"] == "platform_admin"
    assert body["owner_id"] == f"clerk:{APP_USER_A}"
    assert body["owner_id"] != "auth:spoofed1"
    assert body["clerk_user"]["clerk_user_id"] == USER_A
    assert body["workspace"]["id"] == WORKSPACE_A
    assert body["project"]["id"] == PROJECT_A


@pytest.mark.parametrize(
    "overrides",
    [
        {"azp": "https://evil.example.test"},
        {"expires_in": -60},
        {"issuer": "https://wrong-issuer.example.test"},
    ],
)
def test_invalid_clerk_claims_are_rejected(
    platform_db,
    signing_keys,
    overrides,
):
    token = _token(signing_keys[0], **overrides)
    response = _client().get("/protected", headers=_headers(token))
    assert response.status_code == 401


def test_unknown_clerk_org_is_forbidden(platform_db, signing_keys):
    token = _token(signing_keys[0], org_id="org_unknown")
    response = _client().get("/protected", headers=_headers(token))
    assert response.status_code == 403


def test_cross_org_project_selection_is_hidden(platform_db, signing_keys):
    token = _token(signing_keys[0], org_id=ORG_B, user_id=USER_B)
    response = _client().get(
        "/protected",
        headers=_headers(token, project_id=PROJECT_A),
    )
    assert response.status_code == 404


def test_customer_workspace_role_cannot_use_advanced_ml(platform_db, signing_keys):
    token = _token(signing_keys[0], user_id=CUSTOMER_USER)
    response = _client().get("/protected", headers=_headers(token))
    assert response.status_code == 403
    assert "Platform administrator" in response.json()["detail"]


def test_legacy_hs256_is_disabled_in_clerk_mode(platform_db, monkeypatch):
    secret = "legacy-test-secret-at-least-32-bytes"
    monkeypatch.setenv("JWT_SECRET", secret)
    legacy = jwt.encode(
        {"typ": "auth", "role": "admin", "exp": int(time.time()) + 60},
        secret,
        algorithm="HS256",
    )
    response = _client().get(
        "/protected",
        headers={"Authorization": f"Bearer {legacy}"},
    )
    assert response.status_code == 401


def test_database_failure_is_503_without_identity_fallback(
    platform_db,
    signing_keys,
    monkeypatch,
):
    class DownResolver:
        def resolve(self, *args, **kwargs):
            raise TenantDatabaseUnavailableError("down")

    monkeypatch.setattr(auth_module, "get_identity_resolver", lambda: DownResolver())
    response = _client().get(
        "/protected",
        headers=_headers(_token(signing_keys[0])),
    )
    assert response.status_code == 503
    assert "identity service" in response.json()["detail"]


def test_clerk_verifier_has_no_network_fallback():
    source = (auth_module.__file__ and open(auth_module.__file__, encoding="utf-8").read())
    tenant_source_path = auth_module.__file__.replace("auth.py", "tenant_auth.py")
    tenant_source = open(tenant_source_path, encoding="utf-8").read()
    combined = (source + tenant_source).lower()
    assert "pyjwkclient" not in combined
    assert "urlopen(" not in combined
    assert "httpx." not in combined
