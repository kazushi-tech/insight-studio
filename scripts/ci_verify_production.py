"""Verify the production frontend and both FastAPI services at one exact SHA."""

from __future__ import annotations

import argparse
import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen


def _json_request(url: str, *, token: str = "", timeout: float = 15.0) -> tuple[int, dict]:
    headers = {"Accept": "application/json", "User-Agent": "insight-studio-release-gate/1"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, headers=headers)
    try:
        with urlopen(request, timeout=timeout) as response:
            status = response.status
            raw = response.read(512_000)
    except HTTPError as exc:
        return exc.code, {}
    except (URLError, TimeoutError, OSError):
        return 0, {}
    try:
        return status, json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return status, {}


def _status_request(url: str, timeout: float = 15.0) -> int:
    request = Request(url, headers={"User-Agent": "insight-studio-release-gate/1"})
    try:
        with urlopen(request, timeout=timeout) as response:
            response.read(1024)
            return response.status
    except HTTPError as exc:
        return exc.code
    except (URLError, TimeoutError, OSError):
        return 0


def _health_sha(payload: dict) -> str:
    for key in ("deployment_sha", "commit", "git_commit", "version"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value.lower()
    return ""


def _ml_backend_ready(payload: dict, expected_mode: str) -> bool:
    """Prove that ML is using the selected durable backend, not an inline fallback."""

    snapshot = payload.get("analysis_worker")
    if not isinstance(snapshot, dict) or snapshot.get("mode") != expected_mode:
        return False
    if snapshot.get("ready") is not True:
        return False
    if expected_mode == "worker":
        return (
            snapshot.get("required") is True
            and isinstance(snapshot.get("fresh_workers"), int)
            and snapshot["fresh_workers"] >= 1
            and isinstance(snapshot.get("latest_heartbeat_at"), str)
            and bool(snapshot["latest_heartbeat_at"])
        )
    return snapshot.get("required") is False


def _frontend_ready(base_url: str, expected_sha: str) -> bool:
    token = os.getenv("VERCEL_TOKEN", "").strip()
    project_id = os.getenv("VERCEL_FRONTEND_PROJECT_ID", "").strip()
    team_id = os.getenv("VERCEL_TEAM_ID", "").strip()
    if not token or not project_id:
        raise RuntimeError(
            "VERCEL_TOKEN and VERCEL_FRONTEND_PROJECT_ID are required to prove the frontend SHA"
        )
    hostname = urlparse(base_url).hostname or ""
    if not hostname:
        raise RuntimeError("PRODUCTION_BASE_URL must contain a hostname")
    query = {}
    if team_id:
        query["teamId"] = team_id
    suffix = f"?{urlencode(query)}" if query else ""
    status, payload = _json_request(
        f"https://api.vercel.com/v13/deployments/{quote(hostname, safe='')}{suffix}",
        token=token,
    )
    if status != 200:
        return False
    meta = payload.get("meta") or {}
    git_source = payload.get("gitSource") or {}
    sha = str(
        meta.get("githubCommitSha")
        or meta.get("gitCommitSha")
        or git_source.get("sha")
        or ""
    ).lower()
    state = str(payload.get("readyState") or payload.get("state") or "").upper()
    target = str(payload.get("target") or "").lower()
    project = payload.get("project") or {}
    resolved_project = str(payload.get("projectId") or project.get("id") or "")
    return (
        sha == expected_sha
        and state == "READY"
        and target == "production"
        and resolved_project == project_id
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--expected-sha", required=True)
    parser.add_argument("--attempts", type=int, default=40)
    parser.add_argument("--interval", type=float, default=30.0)
    parser.add_argument("--job-backend", choices=("worker", "workflow"), required=True)
    parser.add_argument("--workflow-url", default="")
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")
    expected_sha = args.expected_sha.lower()
    if len(expected_sha) != 40:
        parser.error("--expected-sha must be a full 40-character commit SHA")
    if args.job_backend == "workflow" and not args.workflow_url:
        parser.error("--workflow-url is required when --job-backend=workflow")

    try:
        for attempt in range(1, args.attempts + 1):
            frontend_http = _status_request(f"{base_url}/")
            ads_status, ads = _json_request(f"{base_url}/api/ads/health", timeout=3.0)
            ml_status, ml = _json_request(f"{base_url}/api/ml/health", timeout=3.0)
            frontend_sha_ok = _frontend_ready(base_url, expected_sha)
            ads_sha = _health_sha(ads)
            ml_sha = _health_sha(ml)
            ml_backend_ok = _ml_backend_ready(ml, args.job_backend)
            workflow_ok = args.job_backend == "worker"
            if args.job_backend == "workflow":
                workflow_status, workflow = _json_request(args.workflow_url, timeout=3.0)
                workflow_ok = workflow_status == 200 and workflow.get("ok") is True

            ready = (
                frontend_http == 200
                and frontend_sha_ok
                and ads_status == 200
                and ads.get("ok") is True
                and ads_sha == expected_sha
                and ml_status == 200
                and ml.get("ok") is True
                and ml_sha == expected_sha
                and ml_backend_ok
                and workflow_ok
            )
            print(
                f"attempt={attempt}/{args.attempts} frontend_http={frontend_http} "
                f"frontend_sha={frontend_sha_ok} ads_http={ads_status} ads_sha={ads_sha[:7] or 'none'} "
                f"ml_http={ml_status} ml_sha={ml_sha[:7] or 'none'} "
                f"job_backend={args.job_backend} ml_backend={ml_backend_ok} workflow={workflow_ok}"
            )
            if ready:
                print(f"Production proof passed for exact SHA {expected_sha}.")
                return 0
            if attempt < args.attempts:
                time.sleep(args.interval)
    except RuntimeError as exc:
        print(f"::error::{exc}")
        return 2

    print("::error::production did not converge to the expected frontend/Ads/ML SHA and durable backend")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
