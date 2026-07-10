import importlib.util
import json
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "scrub_scan_job_secrets.py"
SPEC = importlib.util.spec_from_file_location("scrub_scan_job_secrets", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def test_scrub_scan_jobs_removes_only_secret_fields(tmp_path):
    job_dir = tmp_path / "scan_jobs" / "job-1"
    job_dir.mkdir(parents=True)
    job_path = job_dir / "job.json"
    job_path.write_text(
        json.dumps(
            {
                "job_id": "job-1",
                "api_key": "sentinel-secret",
                "nested": {"search_api_key": "other-secret", "status": "done"},
                "result": [1, 2, 3],
            }
        ),
        encoding="utf-8",
    )

    dry_summary = MODULE.scrub_scan_jobs(tmp_path / "scan_jobs", apply=False)
    assert dry_summary == {"scanned_files": 1, "modified_files": 1, "removed_fields": 2}
    assert "sentinel-secret" in job_path.read_text(encoding="utf-8")

    apply_summary = MODULE.scrub_scan_jobs(tmp_path / "scan_jobs", apply=True)
    assert apply_summary == dry_summary
    payload = json.loads(job_path.read_text(encoding="utf-8"))
    assert payload == {
        "job_id": "job-1",
        "nested": {"status": "done"},
        "result": [1, 2, 3],
    }
