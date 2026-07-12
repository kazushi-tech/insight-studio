"""Operator CLI for privacy exports and delayed deletions.

Examples:
    python scripts/privacy_ops.py
    python scripts/privacy_ops.py --mode exports --execute
    python scripts/privacy_ops.py --mode deletions --execute --limit 10

Without ``--execute`` the command is read-only.  Artifact bodies stay encrypted
in the managed database; this command never creates a local fallback file.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from sqlalchemy.orm import Session


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from web.app.legal.operations import (  # noqa: E402
    PrivacyOperationsRunner,
    PrivacyOpsConfig,
    PrivacyOpsError,
)
from web.app.platform_db import (  # noqa: E402
    PlatformDatabaseUnavailable,
    get_platform_engine,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Process managed-DB privacy work (dry-run by default)."
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Persist encrypted exports and execute due deletions.",
    )
    parser.add_argument(
        "--mode",
        choices=("all", "exports", "deletions"),
        default="all",
    )
    parser.add_argument("--limit", type=int, default=25)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        with Session(get_platform_engine(), expire_on_commit=False) as session:
            runner = PrivacyOperationsRunner(
                session,
                config=PrivacyOpsConfig.from_env(),
            )
            result = runner.run_once(
                execute=bool(args.execute),
                limit=args.limit,
                include_exports=args.mode in {"all", "exports"},
                include_deletions=args.mode in {"all", "deletions"},
            )
            if args.execute:
                session.commit()
            else:
                session.rollback()
        print(json.dumps(result.as_safe_dict(), sort_keys=True))
        return 0
    except (PrivacyOpsError, PlatformDatabaseUnavailable) as exc:
        code = exc.code if isinstance(exc, PrivacyOpsError) else "database_unavailable"
        print(json.dumps({"ok": False, "error_code": code}, sort_keys=True))
        return 2
    except Exception:
        # Operator stdout must never expose SQL, provider bodies, identifiers,
        # or key material. Detailed exception capture belongs in the configured
        # private error tracker, not this command's output.
        print(json.dumps({"ok": False, "error_code": "internal_error"}, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
