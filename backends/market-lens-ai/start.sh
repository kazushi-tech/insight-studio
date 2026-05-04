#!/bin/bash
# Render start script for market-lens-ai
#
# Problem: repositories call metadata.create_all() which creates tables
# outside of alembic tracking. When alembic upgrade head runs, it tries
# CREATE TABLE on already-existing tables and fails.
#
# Fix: if upgrade fails, stamp head to sync alembic state with the
# existing schema, so future migrations apply cleanly.

set -uo pipefail

echo "=== Running alembic migrations ==="
if alembic upgrade head 2>&1; then
    echo "=== Migrations applied successfully ==="
else
    echo "⚠ alembic upgrade failed — attempting stamp..."
    alembic stamp head 2>&1 || echo "⚠ DB not available — skipping migrations, starting without DB"
fi

echo "=== Testing Python app import ==="
python -c "
try:
    import unified_app
    print('Import OK: unified_app loaded successfully')
except Exception as e:
    import traceback
    print(f'Import FAILED: {e}')
    traceback.print_exc()
" || true

echo "=== Starting unified uvicorn ==="
exec uvicorn unified_app:app --host 0.0.0.0 --port "$PORT"
