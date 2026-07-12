from __future__ import annotations

import os
import sys
from pathlib import Path


os.environ.setdefault("APP_PASSWORD", "test-secret-pw-42")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx")
os.environ.setdefault("DATA_PROVIDER", "mock")

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.backend_api import app


def _iter_registered_routes(routes):
    """Flatten FastAPI 0.139 lazy ``include_router`` wrappers."""
    for route in routes:
        if hasattr(route, "path"):
            yield route
            continue
        original_router = getattr(route, "original_router", None)
        nested = getattr(original_router, "routes", None)
        if nested is not None:
            yield from _iter_registered_routes(nested)


def test_platform_v2_routes_are_registered_once():
    route_methods = [
        (route.path, method)
        for route in _iter_registered_routes(app.routes)
        for method in getattr(route, "methods", set())
    ]
    expected = {
        ("/api/auth/bootstrap", "POST"),
        ("/api/auth/me", "GET"),
        ("/api/webhooks/clerk", "POST"),
        ("/api/projects", "GET"),
        ("/api/projects", "POST"),
        ("/api/projects/{project_id}/data-source/test", "POST"),
        ("/api/projects/{project_ref}/reports", "GET"),
        ("/api/projects/{project_ref}/reports", "POST"),
        ("/api/projects/{project_ref}/reports/import", "POST"),
        ("/api/projects/{project_ref}/reports/{report_id}/export.csv", "GET"),
        ("/api/report-shares/{token}", "GET"),
        ("/api/billing/checkout-sessions", "POST"),
        ("/api/billing/portal-sessions", "POST"),
        ("/api/billing/subscription", "GET"),
        ("/api/billing/webhooks/stripe", "POST"),
        ("/api/legal/documents", "GET"),
        ("/api/legal/acceptance-status", "GET"),
        ("/api/legal/acceptances", "POST"),
        ("/api/legal/data-exports", "POST"),
        ("/api/legal/deletion-requests", "POST"),
    }
    assert expected <= set(route_methods)
    assert all(route_methods.count(route) == 1 for route in expected)
