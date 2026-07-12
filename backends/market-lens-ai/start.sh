#!/bin/bash
# Runtime start only. Alembic is executed by the protected pre-deploy/release
# job; startup must never stamp, mutate, or silently bypass an unavailable DB.

set -euo pipefail

echo "=== Verifying Python app import ==="
python -c "import unified_app; print('Import OK: unified_app loaded successfully')"

echo "=== Starting unified uvicorn ==="
exec uvicorn unified_app:app --host 0.0.0.0 --port "$PORT"
