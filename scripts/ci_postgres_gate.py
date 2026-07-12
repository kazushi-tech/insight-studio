"""Destructive PostgreSQL-only CI gates for migrations and durable repositories.

The command refuses non-local/non-CI database URLs.  GitHub Actions gives every
job a disposable ``insight_studio_ci`` database, so resetting ``public`` cannot
touch staging or production by accident.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys

import sqlalchemy as sa
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import Session, sessionmaker


ROOT = Path(__file__).resolve().parents[1]
ML_ROOT = ROOT / "backends" / "market-lens-ai"
ADS_ROOT = ROOT / "backends" / "ads-insights"
INTERNAL_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001"
INTERNAL_PROJECT_ID = "00000000-0000-0000-0000-000000000002"


def _safe_ci_url(raw: str) -> URL:
    url = make_url(raw)
    if url.get_backend_name() not in {"postgres", "postgresql"}:
        raise AssertionError("PostgreSQL integration gate requires a PostgreSQL URL")
    if not os.getenv("CI"):
        raise AssertionError("PostgreSQL integration gate is destructive and CI-only")
    if (url.host or "").lower() not in {"127.0.0.1", "localhost", "postgres"}:
        raise AssertionError("PostgreSQL integration gate only accepts a local CI host")
    if "ci" not in (url.database or "").lower():
        raise AssertionError("PostgreSQL integration database name must contain 'ci'")
    return url


def _engine(raw: str) -> sa.Engine:
    _safe_ci_url(raw)
    return sa.create_engine(raw, pool_pre_ping=True)


def _reset_public(engine: sa.Engine) -> None:
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        connection.execute(sa.text("DROP SCHEMA IF EXISTS public CASCADE"))
        connection.execute(sa.text("CREATE SCHEMA public"))


def _alembic(raw: str, *arguments: str) -> None:
    env = {
        **os.environ,
        "DATABASE_URL": raw,
        "DATABASE_SSLMODE": "disable",
        "ENVIRONMENT": "test",
        "APP_ENV": "test",
    }
    completed = subprocess.run(
        [sys.executable, "-m", "alembic", *arguments],
        cwd=ML_ROOT,
        env=env,
        check=False,
        text=True,
    )
    if completed.returncode:
        raise RuntimeError(f"alembic {' '.join(arguments)} failed")


def _assert_head(engine: sa.Engine) -> None:
    with engine.connect() as connection:
        revision = connection.execute(sa.text("SELECT version_num FROM alembic_version")).scalar_one()
        if revision != "012":
            raise AssertionError(f"database revision is {revision!r}, expected '012'")


def migration_gate(raw: str) -> None:
    engine = _engine(raw)
    _reset_public(engine)
    _alembic(raw, "upgrade", "head")
    _assert_head(engine)
    with engine.connect() as connection:
        required = {
            "workspaces",
            "projects",
            "report_runs",
            "analysis_jobs",
            "analysis_worker_heartbeats",
            "subscriptions",
            "legal_acceptances",
        }
        tables = set(sa.inspect(connection).get_table_names())
        if missing := required - tables:
            raise AssertionError(f"blank database migration missed tables: {sorted(missing)}")

    _reset_public(engine)
    _alembic(raw, "upgrade", "007")
    with engine.begin() as connection:
        connection.execute(sa.text(
            "INSERT INTO assets "
            "(id, file_name, mime_type, size_bytes, asset_type, created_at) "
            "VALUES ('ci-legacy-asset', 'legacy.png', 'image/png', 10, 'banner', CURRENT_TIMESTAMP)"
        ))
        connection.execute(sa.text(
            "INSERT INTO watchlists (id, name, project_id, created_at) "
            "VALUES ('ci-legacy-watch', 'Legacy', 'legacy-project', CURRENT_TIMESTAMP)"
        ))
        connection.execute(sa.text(
            "INSERT INTO usage_events (id, event_type, workspace_id, created_at) "
            "VALUES ('ci-legacy-usage', 'scan', 'legacy-workspace', CURRENT_TIMESTAMP)"
        ))
    _alembic(raw, "upgrade", "head")
    _assert_head(engine)
    with engine.connect() as connection:
        asset_scope = connection.execute(sa.text(
            "SELECT workspace_id, project_id FROM assets WHERE id = 'ci-legacy-asset'"
        )).one()
        watch_scope = connection.execute(sa.text(
            "SELECT workspace_id, project_id, legacy_project_ref "
            "FROM watchlists WHERE id = 'ci-legacy-watch'"
        )).one()
        usage_scope = connection.execute(sa.text(
            "SELECT workspace_id, project_id, legacy_workspace_ref "
            "FROM usage_events WHERE id = 'ci-legacy-usage'"
        )).one()
    expected = (INTERNAL_WORKSPACE_ID, INTERNAL_PROJECT_ID)
    if tuple(asset_scope) != expected:
        raise AssertionError(f"007 asset backfill failed: {tuple(asset_scope)!r}")
    if tuple(watch_scope) != (*expected, "legacy-project"):
        raise AssertionError(f"007 watchlist backfill failed: {tuple(watch_scope)!r}")
    if tuple(usage_scope) != (*expected, "legacy-workspace"):
        raise AssertionError(f"007 usage backfill failed: {tuple(usage_scope)!r}")
    print("PostgreSQL blank->head and 007->head migration gates passed.")


def ads_repository_gate(raw: str) -> None:
    engine = _engine(raw)
    _reset_public(engine)
    _alembic(raw, "upgrade", "head")
    sys.path.insert(0, str(ADS_ROOT))
    os.environ.update(
        DATABASE_URL=raw,
        DATABASE_SSLMODE="disable",
        ENVIRONMENT="test",
        APP_ENV="test",
    )
    from web.app.platform.auth import ClerkPrincipal
    from web.app.platform.contracts import BootstrapRequest, ProjectCreate
    from web.app.platform.errors import PlatformError
    from web.app.platform.repository import PlatformRepository
    from web.app.platform_db import assert_database_ready, reset_platform_engine_for_tests

    reset_platform_engine_for_tests()
    assert_database_ready()

    def principal(suffix: str) -> ClerkPrincipal:
        return ClerkPrincipal(
            clerk_user_id=f"user_ci_{suffix}",
            clerk_organization_id=f"org_ci_{suffix}",
            issuer="https://ci.clerk.test",
            authorized_party="https://ci.example.test",
            claims={"org_role": "org:admin"},
        )

    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    first = principal("a")
    with session_factory.begin() as session:
        repository = PlatformRepository(session)
        repository.bootstrap(first, BootstrapRequest(
            workspace_name="CI Workspace A",
            workspace_slug="ci-workspace-a",
            primary_email="owner-a@example.invalid",
            display_name="Owner A",
        ))
        context_a = repository.get_context(first)
        project_a = repository.create_project(
            context_a,
            ProjectCreate(name="CI Project A", slug="ci-project-a"),
            "ci-create-project-a",
        )
        replay = repository.create_project(
            context_a,
            ProjectCreate(name="CI Project A", slug="ci-project-a"),
            "ci-create-project-a",
        )
        if replay["id"] != project_a["id"]:
            raise AssertionError("Ads PostgreSQL idempotency replay created a second project")

    second = principal("b")
    with session_factory.begin() as session:
        repository = PlatformRepository(session)
        repository.bootstrap(second, BootstrapRequest(
            workspace_name="CI Workspace B",
            workspace_slug="ci-workspace-b",
            primary_email="owner-b@example.invalid",
            display_name="Owner B",
        ))
        context_b = repository.get_context(second)
        try:
            repository.get_project(context_b, str(project_a["id"]))
        except PlatformError:
            pass
        else:
            raise AssertionError("Ads PostgreSQL repository allowed a cross-workspace project read")
        if repository.list_projects(context_b):
            raise AssertionError("workspace B unexpectedly listed workspace A projects")
    _ads_http_stack_gate(raw, engine)
    print(
        "Ads PostgreSQL repository plus Clerk-signed FastAPI HTTP auth, "
        "idempotency, and tenant-isolation gates passed."
    )


def _ads_http_stack_gate(raw: str, engine: sa.Engine) -> None:
    """Exercise offline Clerk verification through the real Ads ASGI stack.

    Browser smoke intentionally mocks API payloads for deterministic UI checks.
    This complementary required gate uses a disposable PostgreSQL service and
    sends HTTP requests through every FastAPI middleware/dependency layer.  No
    Clerk network, BigQuery credential, or external provider is involved.
    """

    import asyncio
    import time

    import httpx
    import jwt
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    issuer = "https://clerk.ci.invalid"
    authorized_party = "https://insight-studio.ci.invalid"
    signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = signing_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_pem = signing_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")

    os.environ.update(
        DATABASE_URL=raw,
        DATABASE_SSLMODE="disable",
        ENVIRONMENT="test",
        APP_ENV="test",
        DATA_PROVIDER="mock",
        APP_PASSWORD="ci-admin-password-not-used-by-clerk-stack",
        JWT_SECRET="ci-jwt-secret-at-least-thirty-two-bytes-long",
        RATE_LIMIT_HASH_SECRET="ci-rate-limit-secret-at-least-thirty-two-bytes",
        PROJECT_INVITE_HASH_SECRET="ci-project-invite-secret-at-least-thirty-two-bytes",
        CLERK_JWT_PUBLIC_KEY=public_pem,
        CLERK_ISSUER=issuer,
        CLERK_ALLOWED_AZP=authorized_party,
        PLATFORM_ADMIN_CLERK_USER_IDS="user_ci_http_a",
    )

    from web.app import backend_api
    from web.app.platform.rate_limits import _clerk_verifier
    from web.app.routers.platform_v2_routes import _environment_jwt_verifier

    _environment_jwt_verifier.cache_clear()
    _clerk_verifier.cache_clear()

    def token(
        user_id: str,
        organization_id: str,
        *,
        key_pem: bytes = private_pem,
        azp: str = authorized_party,
        expires_in: int = 300,
    ) -> str:
        now = int(time.time())
        return jwt.encode(
            {
                "sub": user_id,
                "org_id": organization_id,
                "azp": azp,
                "iss": issuer,
                "nbf": now - 1,
                "exp": now + expires_in,
            },
            key_pem,
            algorithm="RS256",
        )

    async def exercise() -> None:
        transport = httpx.ASGITransport(app=backend_api.app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://ads-ci.test",
        ) as client:
            token_a = token("user_ci_http_a", "org_ci_http_a")
            token_b = token("user_ci_http_b", "org_ci_http_b")
            headers_a = {"Authorization": f"Bearer {token_a}"}
            headers_b = {"Authorization": f"Bearer {token_b}"}

            bootstrap_a = await client.post(
                "/api/auth/bootstrap",
                headers=headers_a,
                json={
                    "workspace_name": "CI HTTP Workspace A",
                    "workspace_slug": "ci-http-workspace-a",
                    "primary_email": "owner-a@example.invalid",
                    "display_name": "CI Owner A",
                },
            )
            if bootstrap_a.status_code != 200:
                raise AssertionError(
                    f"Clerk/FastAPI/PostgreSQL bootstrap A failed: "
                    f"{bootstrap_a.status_code} {bootstrap_a.text[:300]}"
                )
            bootstrap_b = await client.post(
                "/api/auth/bootstrap",
                headers=headers_b,
                json={
                    "workspace_name": "CI HTTP Workspace B",
                    "workspace_slug": "ci-http-workspace-b",
                    "primary_email": "owner-b@example.invalid",
                    "display_name": "CI Owner B",
                },
            )
            if bootstrap_b.status_code != 200:
                raise AssertionError(
                    f"Clerk/FastAPI/PostgreSQL bootstrap B failed: "
                    f"{bootstrap_b.status_code} {bootstrap_b.text[:300]}"
                )

            created = await client.post(
                "/api/projects",
                headers={**headers_a, "Idempotency-Key": "ci-http-create-project-a"},
                json={"name": "CI HTTP Project A", "slug": "ci-http-project-a"},
            )
            if created.status_code != 201:
                raise AssertionError(
                    f"Clerk/FastAPI/PostgreSQL project create failed: "
                    f"{created.status_code} {created.text[:300]}"
                )
            project_id = str(created.json()["project"]["id"])
            replay = await client.post(
                "/api/projects",
                headers={**headers_a, "Idempotency-Key": "ci-http-create-project-a"},
                json={"name": "CI HTTP Project A", "slug": "ci-http-project-a"},
            )
            if replay.status_code != 201 or str(replay.json()["project"]["id"]) != project_id:
                raise AssertionError("HTTP idempotency replay created another project")

            listed = await client.get("/api/projects", headers=headers_a)
            if listed.status_code != 200 or not any(
                str(item.get("id")) == project_id
                for item in listed.json().get("projects", [])
            ):
                raise AssertionError("HTTP project list did not read PostgreSQL state")

            cross_tenant = await client.get(
                f"/api/projects/{project_id}",
                headers=headers_b,
            )
            if cross_tenant.status_code not in {403, 404}:
                raise AssertionError(
                    "Clerk/FastAPI stack allowed cross-workspace project access"
                )

            me = await client.get("/api/auth/me", headers=headers_a)
            if me.status_code != 200 or me.json().get("workspace", {}).get("id") is None:
                raise AssertionError("HTTP /api/auth/me did not resolve persisted RBAC")

            wrong_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            wrong_private_pem = wrong_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
            invalid_signature = await client.get(
                "/api/auth/me",
                headers={
                    "Authorization": (
                        "Bearer "
                        + token(
                            "user_ci_http_a",
                            "org_ci_http_a",
                            key_pem=wrong_private_pem,
                        )
                    )
                },
            )
            if invalid_signature.status_code != 401:
                raise AssertionError("Invalid Clerk signature was not rejected")

            expired = await client.get(
                "/api/auth/me",
                headers={
                    "Authorization": (
                        "Bearer "
                        + token(
                            "user_ci_http_a",
                            "org_ci_http_a",
                            expires_in=-60,
                        )
                    )
                },
            )
            if expired.status_code != 401:
                raise AssertionError("Expired Clerk session was not rejected")

    asyncio.run(exercise())

    with engine.connect() as connection:
        http_projects = connection.execute(
            sa.text(
                "SELECT COUNT(*) FROM projects "
                "WHERE slug = 'ci-http-project-a'"
            )
        ).scalar_one()
        http_workspaces = connection.execute(
            sa.text(
                "SELECT COUNT(*) FROM workspaces "
                "WHERE clerk_organization_id IN ('org_ci_http_a', 'org_ci_http_b')"
            )
        ).scalar_one()
    if http_projects != 1 or http_workspaces != 2:
        raise AssertionError(
            "FastAPI HTTP writes were not durably persisted in PostgreSQL"
        )


def ml_repository_gate(raw: str) -> None:
    engine = _engine(raw)
    _reset_public(engine)
    _alembic(raw, "upgrade", "head")
    sys.path.insert(0, str(ML_ROOT))
    from web.app.jobs.analysis_backend import (
        AnalysisJobType,
        JobBackendMode,
        JobBackendSettings,
        PostgresAnalysisJobBackend,
    )
    from web.app.tenant_auth import TenantContext

    factory = sessionmaker(bind=engine, expire_on_commit=False)
    backend = PostgresAnalysisJobBackend(
        factory,
        settings=JobBackendSettings(mode=JobBackendMode.worker),
    )
    backend.register_worker("ci-worker-a", deployment_sha="c" * 40)
    if not backend.heartbeat_worker("ci-worker-a", state="ready", active_jobs=0):
        raise AssertionError("ML PostgreSQL worker liveness heartbeat failed")
    readiness = backend.worker_readiness_snapshot()
    if not readiness["ready"] or readiness["fresh_workers"] != 1:
        raise AssertionError(f"ML PostgreSQL worker readiness failed: {readiness!r}")
    context_a = TenantContext(
        auth_kind="ci",
        owner_id="ci-owner-a",
        workspace_id=INTERNAL_WORKSPACE_ID,
        project_id=INTERNAL_PROJECT_ID,
    )
    job = backend.enqueue(
        AnalysisJobType.scan,
        {"target_ref": "ci-fixture"},
        idempotency_key="ci-worker-idempotency",
        context=context_a,
    )
    replay = backend.enqueue(
        AnalysisJobType.scan,
        {"target_ref": "ci-fixture"},
        idempotency_key="ci-worker-idempotency",
        context=context_a,
    )
    if replay.id != job.id:
        raise AssertionError("ML PostgreSQL enqueue idempotency failed")
    claimed = backend.claim_next("ci-worker-a")
    if claimed is None or claimed.id != job.id:
        raise AssertionError("ML PostgreSQL worker did not claim the queued job")
    if backend.claim_next("ci-worker-b") is not None:
        raise AssertionError("ML PostgreSQL worker double-claimed a leased job")
    if not backend.heartbeat(job.id, "ci-worker-a", stage="ci", progress_pct=50):
        raise AssertionError("ML PostgreSQL worker heartbeat failed")
    if not backend.complete(job.id, "ci-worker-a", {"ok": True}):
        raise AssertionError("ML PostgreSQL worker completion failed")
    if not backend.record_worker_job_result("ci-worker-a", job.id, "succeeded"):
        raise AssertionError("ML PostgreSQL worker canary evidence failed")
    finished = backend.get(job.id, context=context_a)
    if finished is None or finished.status.value != "succeeded":
        raise AssertionError("ML PostgreSQL completed result was not persisted")
    first_artifact = backend.record_artifact(
        finished,
        artifact_type="ci-result",
        storage_kind="database",
        storage_ref="ci-artifact-ref",
    )
    second_artifact = backend.record_artifact(
        finished,
        artifact_type="ci-result",
        storage_kind="database",
        storage_ref="ci-artifact-ref",
    )
    if first_artifact != second_artifact:
        raise AssertionError("ML PostgreSQL artifact idempotency failed")
    if not backend.record_ai_usage(
        finished,
        provider="ci",
        model="fixture",
        operation="analysis",
        idempotency_key="ci-usage-idempotency",
    ):
        raise AssertionError("ML PostgreSQL first usage ledger insert failed")
    if backend.record_ai_usage(
        finished,
        provider="ci",
        model="fixture",
        operation="analysis",
        idempotency_key="ci-usage-idempotency",
    ):
        raise AssertionError("ML PostgreSQL duplicated an AI usage ledger entry")
    with engine.connect() as connection:
        artifact_count = connection.execute(sa.text(
            "SELECT COUNT(*) FROM analysis_job_artifacts WHERE analysis_job_id = :job_id"
        ), {"job_id": job.id}).scalar_one()
        usage_count = connection.execute(sa.text(
            "SELECT COUNT(*) FROM ai_usage_ledger WHERE analysis_job_id = :job_id"
        ), {"job_id": job.id}).scalar_one()
    if artifact_count != 1 or usage_count != 1:
        raise AssertionError(
            f"ML PostgreSQL durable dedupe failed: artifacts={artifact_count}, usage={usage_count}"
        )
    readiness = backend.worker_readiness_snapshot(include_workers=True)
    if readiness.get("latest_successful_job_at") is None:
        raise AssertionError("ML PostgreSQL worker success evidence was not persisted")
    print("ML PostgreSQL worker readiness, lease, artifact, and AI-usage gates passed.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("migrations", "ads", "ml"))
    parser.add_argument("--database-url", required=True)
    args = parser.parse_args()
    try:
        if args.mode == "migrations":
            migration_gate(args.database_url)
        elif args.mode == "ads":
            ads_repository_gate(args.database_url)
        else:
            ml_repository_gate(args.database_url)
    except Exception as exc:
        print(f"::error::{type(exc).__name__}: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
