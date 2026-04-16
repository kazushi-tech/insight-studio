#!/bin/bash
# Render start script for market-lens-ai
#
# Problem: repositories call metadata.create_all() which creates tables
# outside of alembic tracking. When alembic upgrade head runs, it tries
# CREATE TABLE on already-existing tables and fails.
#
# Fix: if upgrade fails, stamp head to sync alembic state with the
# existing schema, so future migrations apply cleanly.

set -euo pipefail

echo "=== Running alembic migrations ==="
if alembic upgrade head 2>&1; then
    echo "=== Migrations applied successfully ==="
else
    echo "⚠ alembic upgrade failed — stamping head for existing schema"
    alembic stamp head
    echo "=== Stamped head successfully ==="
fi

echo "=== Starting uvicorn ==="
exec uvicorn web.app.main:app --host 0.0.0.0 --port "$PORT"
