# Privacy export and deletion operations

The legal API records durable database jobs; it never builds an export or
deletes tenant data inside the HTTP request. The production consumer is
`python -m web.app.legal.worker`. `backends/ads-insights/scripts/privacy_ops.py`
remains a guarded dry-run/operator recovery tool.

## Required production configuration

- `DATABASE_URL`: managed PostgreSQL only in production.
- `PRIVACY_RETENTION_POLICY_VERSION`: the company-approved retention policy
  version. Empty means execution is disabled.
- `PRIVACY_EXPORT_RETENTION_DAYS`: encrypted artifact lifetime, from 1 to 365.
- `PRIVACY_EXPORT_ENCRYPTION_KEY_B64`: URL-safe Base64 encoding of exactly 32
  random bytes. Store it in the deployment secret manager.
- `PRIVACY_EXPORT_ENCRYPTION_KEY_ID`: non-secret key version used for rotation.
- `PRIVACY_EXPORT_MAX_BYTES`: explicit plaintext JSON plus CSV limit, from 1 KiB
  to 250 MiB.
- `PRIVACY_WORKER_ENABLED=true`: explicit destructive-worker activation.
- `PRIVACY_WORKER_POLL_SECONDS`: 5 to 3600 seconds.
- `PRIVACY_WORKER_BATCH_SIZE`: 1 to 250 jobs per transaction.

The key material, dataset identifiers, tokens, provider IDs, API keys, and raw
errors are never written to audit metadata. Export bodies are AES-256-GCM
encrypted and remain in PostgreSQL. There is no `/tmp` or local-file fallback.

## Self-service status and delivery

- `GET /api/legal/data-exports` lists only exports visible to the authenticated
  account or workspace owner.
- `GET /api/legal/data-exports/{job_id}` returns customer-safe status.
- `GET /api/legal/data-exports/{job_id}/download?format=json|csv` decrypts only
  a ready, unexpired, tenant-authorized artifact. Responses are private,
  `no-store`, and every successful download creates an audit event.
- The customer UI polls pending jobs and offers JSON/CSV only while the
  encrypted artifact is ready.

The encrypted artifact expires according to the approved retention setting.
Expiry is enforced at download time even if the worker has not yet scrubbed
the ciphertext row.

## Safe operation and recovery

Dry-run is the default and performs no writes:

```powershell
cd backends/ads-insights
python scripts/privacy_ops.py
```

One-off recovery execution must be explicit:

```powershell
python scripts/privacy_ops.py --mode exports --execute
python scripts/privacy_ops.py --mode deletions --execute
```

An export becomes `ready` and is delivered only through the authenticated
same-origin download API. No email attachment or public object URL is created.

Deletion execution rechecks the 30-day boundary, cancellation state, and
last-owner protection. Workspace deletion is blocked while a billable Stripe
subscription is active. Account and workspace rows are retained only as
minimal tombstones needed to prevent automatic Clerk re-bootstrap; PII and
tenant data are removed or de-linked.

## External completion steps

Before closing a workspace/account deletion ticket, an operator must also:

1. cancel or verify cancellation of the Stripe subscription;
2. delete or disable the matching Clerk user/organization;
3. verify the authenticated download audit or follow the approved recovery
   procedure when a customer cannot access the product;
4. record the external ticket reference in the company audit system.

Those provider actions require production credentials and company policy, so
the worker fails closed instead of fabricating them.

The Render privacy-worker blueprint is intentionally `autoDeployTrigger: off`.
Production activation remains blocked until the company-approved retention
version, encryption-key custody/rotation process, managed-PostgreSQL backup,
and Clerk/Stripe deletion runbooks have been supplied and tested.
