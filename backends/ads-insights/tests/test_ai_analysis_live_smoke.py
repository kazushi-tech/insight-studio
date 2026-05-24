import os
import sys
from pathlib import Path

import httpx
import pytest


RUN_LIVE = os.getenv("RUN_LIVE_AI_E2E") == "1"
pytestmark = pytest.mark.skipif(
    not RUN_LIVE,
    reason="Set RUN_LIVE_AI_E2E=1 to run live BigQuery/Gemini smoke test.",
)

os.environ.setdefault("APP_PASSWORD", "test-secret-pw-42")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx")

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import web.app.backend_api as backend_api  # noqa: E402


@pytest.mark.anyio
async def test_live_neutral_ai_generate_from_real_services():
    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("VITE_GEMINI_API_KEY")
    if not gemini_key:
        pytest.skip("GEMINI_API_KEY or VITE_GEMINI_API_KEY is required for live AI smoke.")

    payload = {
        "mode": "question",
        "provider": "google",
        "model": "gemini-2.5-flash",
        "temperature": 0.1,
        "message": "5月のPV数で一番高かった日はいつ？原因は何だと思う？",
        "point_pack_md": "## PV分析\n5月のPV推移をBigQueryデータから分析してください。\n",
        "data_source": "bq",
        "bq_query_types": ["pv", "traffic", "landing", "device"],
        "analysis_context_meta": {
            "projectName": "ペタビット",
            "caseName": "ペタビット",
            "datasetId": "analytics_311324674",
            "periods": ["2026-05"],
        },
        "ai_chart_context": [],
    }

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=backend_api.app),
        base_url="http://test",
        timeout=300,
    ) as client:
        token_resp = await client.post("/api/auth/login", json={"password": os.environ["APP_PASSWORD"]})
        assert token_resp.status_code == 200
        token = token_resp.json()["token"]

        resp = await client.post(
            "/api/insights/neon/generate",
            json=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "X-Client-ID": "live-ai-e2e-smoke",
                "X-Analysis-Provider": "google",
                "X-Gemini-API-Key": gemini_key,
            },
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["parse_status"] == "json"
    assert body["fallback_used"] is False
    assert body["analysis_context"]["sessionLandingPageDiagnostic"]["method"] == "ga4_session_first_page_view"
    assert body["analysis_context"]["sessionLandingPageDiagnostic"]["topLandingPages"]
    markdown = body.get("answer_markdown") or body.get("text") or ""
    assert "## 結論" in markdown
    assert "## 数値根拠" in markdown
    assert "2026-05-" in markdown or "2026年5月" in markdown
    assert "PV" in markdown
    assert "401" in markdown
    assert "セッションLP" in markdown or "最初のpage_view" in markdown or "ランディングページ" in markdown
