"""Static repository-side validation for the GitHub Actions release gates."""

from __future__ import annotations

from pathlib import Path
import py_compile
import os
import re
import shutil
import subprocess

import yaml


REQUIRED_JOBS = {
    "release_source",
    "frontend",
    "ads_backend",
    "ml_backend",
    "security",
    "schema",
    "browser",
    "post_deploy",
}
EXPRESSION_RE = re.compile(r"\$\{\{.*?\}\}")


def _job_run_text(workflow: dict, job_name: str) -> str:
    job = workflow.get("jobs", {}).get(job_name)
    if not isinstance(job, dict):
        raise AssertionError(f"ci.yml: missing job {job_name}")
    fragments: list[str] = []
    for step in job.get("steps", []):
        if not isinstance(step, dict):
            continue
        fragments.append(str(step.get("run") or ""))
        with_values = step.get("with")
        if isinstance(with_values, dict):
            fragments.extend(str(value) for value in with_values.values())
    return "\n".join(fragments)


def _require_fragments(label: str, text: str, fragments: tuple[str, ...]) -> None:
    missing = [fragment for fragment in fragments if fragment not in text]
    if missing:
        raise AssertionError(f"{label}: missing release-gate fragments: {missing}")


def _check_release_contract(ci: dict, monitor: dict, guard: dict, root: Path) -> None:
    frontend = _job_run_text(ci, "frontend")
    _require_fragments(
        "ci.yml:frontend",
        frontend,
        (
            "npm ci",
            "npm run lint",
            "--maxWorkers=1",
            "npm run test:coverage",
            "npm run build",
            "npm run bundle:check",
            "npm run workflow:verify",
        ),
    )
    ads = _job_run_text(ci, "ads_backend")
    _require_fragments(
        "ci.yml:ads_backend",
        ads,
        (
            "--require-hashes -r .github/requirements/ads-ci.lock",
            "ci_pytest_gate.py",
            "--minimum 305",
            "ci_postgres_gate.py ads",
        ),
    )
    ml = _job_run_text(ci, "ml_backend")
    _require_fragments(
        "ci.yml:ml_backend",
        ml,
        (
            "--require-hashes -r .github/requirements/ml-ci.lock",
            "ci_pytest_gate.py",
            "--minimum 1235",
            "ci_postgres_gate.py ml",
        ),
    )
    for job_name in ("ads_backend", "ml_backend", "schema"):
        services = ci["jobs"][job_name].get("services", {})
        if "postgres" not in services:
            raise AssertionError(f"ci.yml:{job_name}: disposable PostgreSQL service is required")
    postgres_gate = (root / "scripts" / "ci_postgres_gate.py").read_text(encoding="utf-8")
    _require_fragments(
        "ci_postgres_gate.py:ads-stack",
        postgres_gate,
        (
            "_ads_http_stack_gate",
            "rsa.generate_private_key",
            "httpx.ASGITransport(app=backend_api.app)",
            '"/api/auth/bootstrap"',
            '"/api/projects"',
            "cross-workspace project access",
            "Invalid Clerk signature was not rejected",
            "Expired Clerk session was not rejected",
        ),
    )
    security = _job_run_text(ci, "security")
    _require_fragments(
        "ci.yml:security",
        security,
        (
            "--require-hashes -r .github/requirements/security-schema-ci.lock",
            "npm audit --omit=dev",
            "pip-audit --strict",
            "check_secret_leaks.py",
            "check_python_locks.py",
            "check_frozen_integrations.py",
            "actionlint",
            "test_tenant_isolation.py",
            "test_fetcher_security.py",
            "test_observability_contract.py",
            "test_worker_readiness_m116.py",
        ),
    )
    schema = _job_run_text(ci, "schema")
    _require_fragments(
        "ci.yml:schema",
        schema,
        (
            "alembic heads",
            "test_alembic_migration.py",
            "ci_postgres_gate.py migrations",
            "test_report_contract_v2.py",
            "ci_openapi_snapshot.py",
            "--require-hashes -r .github/requirements/security-schema-ci.lock",
        ),
    )
    openapi_gate = (root / "scripts" / "ci_openapi_snapshot.py").read_text(encoding="utf-8")
    openapi_baseline = root / "docs" / "contracts" / "openapi.snapshot.sha256.json"
    if not openapi_baseline.is_file() or "full OpenAPI snapshot changed" not in openapi_gate:
        raise AssertionError("schema gate must compare the complete OpenAPI specs with a committed baseline")
    browser = _job_run_text(ci, "browser")
    _require_fragments(
        "ci.yml:browser",
        browser,
        ("npm ci", "playwright install --with-deps chromium", "ci_browser_smoke.py"),
    )
    package = (root / "package.json").read_text(encoding="utf-8")
    browser_gate = (root / "scripts" / "ci_browser_smoke.py").read_text(encoding="utf-8")
    if (
        '"axe-core": "4.12.1"' not in package
        or "_assert_axe" not in browser_gate
        or "page.add_script_tag" not in browser_gate
        or 'result["incomplete"]' not in browser_gate
    ):
        raise AssertionError("browser gate must fail on axe critical/serious violations")
    post_deploy = _job_run_text(ci, "post_deploy")
    _require_fragments(
        "ci.yml:post_deploy",
        post_deploy,
        ("ci_verify_production.py", "--expected-sha", "--job-backend"),
    )
    monitor_text = _job_run_text(monitor, "health_check")
    _require_fragments(
        "monitor.yml:health_check",
        monitor_text,
        (
            "MARKET_LENS_JOB_BACKEND must be explicitly set to worker or workflow",
            "/api/ads/health",
            "/api/ml/health",
            "WORKFLOW_READINESS_URL",
        ),
    )
    guard_text = _job_run_text(guard, "enforce_master_source")
    _require_fragments(
        "production-guard.yml",
        guard_text,
        ("expectedSha", "deployment.ref === 'master'", "deployment.sha === expectedSha"),
    )
    release_script = (root / "scripts" / "release-production.ps1").read_text(encoding="utf-8")
    if "HEAD:$TargetBranch" in release_script or "Trying direct production push" in release_script:
        raise AssertionError("release-production.ps1 must never push a feature branch directly to master")

    start_script = (root / "backends" / "market-lens-ai" / "start.sh").read_text(encoding="utf-8")
    if "set -euo pipefail" not in start_script:
        raise AssertionError("market-lens start.sh must fail closed")
    if "alembic " in start_script or " stamp " in start_script or "|| true" in start_script:
        raise AssertionError("runtime start.sh must not migrate, stamp, or ignore startup failures")

    render = _load(root / "render.yaml")
    services = {
        service.get("name"): service
        for service in render.get("services", [])
        if isinstance(service, dict)
    }
    web = services.get("market-lens-ai", {})
    worker = services.get("market-lens-analysis-worker", {})
    if "alembic upgrade head" not in str(web.get("preDeployCommand") or ""):
        raise AssertionError("Render web service must migrate only in preDeployCommand")
    web_env = {item.get("key"): item.get("value") for item in web.get("envVars", [])}
    worker_env = {item.get("key"): item.get("value") for item in worker.get("envVars", [])}
    if web_env.get("REPOSITORY_BACKEND") != "postgres":
        raise AssertionError("Render web service must use PostgreSQL without file fallback")
    if worker.get("type") != "worker" or worker_env.get("MARKET_LENS_JOB_BACKEND") != "worker":
        raise AssertionError("Render durable fallback worker contract is missing")

    vercel_text = (root / "vercel.json").read_text(encoding="utf-8")
    _require_fragments(
        "vercel.json",
        vercel_text,
        (
            "private, no-store, max-age=0",
            "public, max-age=31536000, immutable",
            "https://*.clerk.accounts.dev",
            "worker-src 'self' blob:",
        ),
    )


def _load(path: Path) -> dict:
    data = yaml.load(path.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
    if not isinstance(data, dict):
        raise AssertionError(f"{path}: workflow root must be a mapping")
    return data


def _bash_command() -> str:
    if os.name == "nt":
        git_bash = Path(r"C:\Program Files\Git\bin\bash.exe")
        if git_bash.is_file():
            return str(git_bash)
    command = shutil.which("bash")
    if not command:
        raise AssertionError("bash is required to statically parse workflow run blocks")
    return command


def _check_shell_blocks(path: Path, workflow: dict) -> None:
    bash = _bash_command()
    for job_name, job in workflow.get("jobs", {}).items():
        for index, step in enumerate(job.get("steps", []), start=1):
            script = step.get("run")
            if not script:
                continue
            # GitHub expressions are evaluated before the selected shell runs.
            normalized = EXPRESSION_RE.sub("ci_expression", script)
            completed = subprocess.run(
                [bash, "-n"],
                input=normalized,
                check=False,
                text=True,
                capture_output=True,
            )
            if completed.returncode != 0:
                detail = completed.stderr.strip().splitlines()[-1]
                raise AssertionError(f"{path.name}:{job_name}:step {index}: {detail}")


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    workflows = root / ".github" / "workflows"
    try:
        ci_path = workflows / "ci.yml"
        monitor_path = workflows / "monitor.yml"
        guard_path = workflows / "production-guard.yml"
        ci = _load(ci_path)
        monitor = _load(monitor_path)
        guard = _load(guard_path)
        missing = REQUIRED_JOBS - set(ci.get("jobs", {}))
        if missing:
            raise AssertionError(f"ci.yml: missing required jobs: {sorted(missing)}")

        workflow_text = "\n".join(
            path.read_text(encoding="utf-8") for path in workflows.glob("*.yml")
        ).lower()
        if "onrender.com" in workflow_text:
            raise AssertionError("legacy Render URL remains in a workflow")
        if "*/5 * * * *" not in monitor_path.read_text(encoding="utf-8"):
            raise AssertionError("monitor.yml must run every five minutes")
        if "schedule" not in monitor.get("on", {}):
            raise AssertionError("monitor.yml has no schedule trigger")

        _check_release_contract(ci, monitor, guard, root)

        _check_shell_blocks(ci_path, ci)
        _check_shell_blocks(monitor_path, monitor)
        _check_shell_blocks(guard_path, guard)

        for script in sorted((root / "scripts").glob("ci_*.py")) + sorted(
            (root / "scripts").glob("check_*.py")
        ):
            py_compile.compile(str(script), doraise=True)
    except (AssertionError, OSError, py_compile.PyCompileError, yaml.YAMLError) as exc:
        print(f"::error::{exc}")
        return 1
    print("Workflow YAML structure and CI helper syntax passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
