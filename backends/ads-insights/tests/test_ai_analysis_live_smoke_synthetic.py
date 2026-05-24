import os
import sys
from pathlib import Path

import pytest


RUN_SYNTHETIC_GEMINI = os.getenv("RUN_LIVE_AI_SYNTHETIC") == "1"
pytestmark = pytest.mark.skipif(
    not RUN_SYNTHETIC_GEMINI,
    reason="Set RUN_LIVE_AI_SYNTHETIC=1 to run Gemini smoke with synthetic context only.",
)

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import web.app.backend_api as backend_api  # noqa: E402
from web.app.ai_analysis import (  # noqa: E402
    ai_json_output_contract,
    build_pv_spike_diagnostic_context,
    normalize_ai_model_response,
)


def _synthetic_context():
    diagnostic = build_pv_spike_diagnostic_context(
        [
            {"date": "2026-05-11", "page_views": 120},
            {"date": "2026-05-12", "page_views": 150},
            {"date": "2026-05-13", "page_views": 260},
        ],
        {
            "sourceMedium": [
                {"sourceMedium": "search.example / organic", "peakDayPageViews": 150, "previousDayPageViews": 80},
                {"sourceMedium": "newsletter.example / email", "peakDayPageViews": 70, "previousDayPageViews": 40},
            ],
            "landingPage": [
                {
                    "landingPage": "https://article.example.test/how-to-choose",
                    "peakDayPageViews": 180,
                    "previousDayPageViews": 75,
                },
                {
                    "landingPage": "https://home.example.test/",
                    "peakDayPageViews": 90,
                    "previousDayPageViews": 85,
                },
            ],
            "campaign": [
                {"campaign": "synthetic-spring-guide", "peakDayPageViews": 70, "previousDayPageViews": 40},
            ],
            "device": [
                {"device": "mobile", "peakDayPageViews": 190, "previousDayPageViews": 95},
            ],
        },
        date_range={"start": "2026-05-01", "end": "2026-05-31", "timezone": "Asia/Tokyo"},
        session_landing_page_rows=[
            {
                "date": "2026-05-12",
                "landing_page_url": "https://entry-a.example.test/",
                "landing_page_title": "Synthetic Entry A",
                "page_views": 60,
                "sessions": 24,
            },
            {
                "date": "2026-05-13",
                "landing_page_url": "https://entry-a.example.test/",
                "landing_page_title": "Synthetic Entry A",
                "page_views": 170,
                "sessions": 52,
            },
            {
                "date": "2026-05-13",
                "landing_page_url": "https://entry-b.example.test/",
                "landing_page_title": "Synthetic Entry B",
                "page_views": 45,
                "sessions": 17,
            },
        ],
    )
    return {
        "question": "Which synthetic landing page group contributed to the PV spike?",
        "projectName": "Synthetic Demo Project",
        "propertyName": "Synthetic GA4 Property",
        "datasetId": "analytics_synthetic_demo",
        "dateRange": {"start": "2026-05-01", "end": "2026-05-31", "timezone": "Asia/Tokyo"},
        "metricFocus": "page_views",
        "pvSpikeDiagnostic": diagnostic,
        "caveats": diagnostic.get("caveats", []),
    }


def test_gemini_response_contract_with_synthetic_session_lp_context_only():
    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("VITE_GEMINI_API_KEY")
    if not gemini_key:
        pytest.skip("GEMINI_API_KEY or VITE_GEMINI_API_KEY is required for synthetic Gemini smoke.")

    context = _synthetic_context()
    prompt = f"""
You are validating an AI analytics response contract with synthetic data only.
Do not claim access to real analytics data, real client names, or real URLs.
Return JSON only.

{ai_json_output_contract()}

# Synthetic AI_ANALYSIS_CONTEXT
```json
{backend_api._safe_json_dumps(context, ensure_ascii=False, indent=2)}
```

Required answer_markdown content:
- Mention that session LP means GA4 session's first page_view.page_location.
- Explain that page_location PV and session LP are different.
- Explain that the synthetic entry page group contributed to PV increase.
- Do not say that a page is the cause only because that page's page_location PV increased.
"""

    lowered_prompt = prompt.lower()
    assert "analytics_synthetic_demo" in lowered_prompt
    assert "example.test" in lowered_prompt
    assert ("analytics_" + "311" + "324674") not in lowered_prompt
    assert ("pet" + "abit") not in lowered_prompt
    assert ("ペタ" + "ビット") not in prompt

    raw = backend_api._gemini_generate(
        model=os.getenv("AI_EXPLORER_SYNTHETIC_GEMINI_MODEL", "gemini-2.5-flash"),
        prompt=prompt,
        temperature=0.0,
        max_tokens=1536,
        api_key=gemini_key,
        feature="ads.neon_generate.synthetic_smoke",
    )
    result = normalize_ai_model_response(raw, context=context)
    markdown = result.get("answer_markdown") or ""

    assert result["ok"] is True
    assert result["parse_status"] == "json"
    assert result["fallback_used"] is False
    assert "GA4" in markdown
    assert "page_view" in markdown
    assert "page_location" in markdown
    assert "セッションLP" in markdown or "session LP" in markdown
    assert "入口" in markdown or "entry" in markdown or "始まったセッション" in markdown
    assert "トップページのPVが増えたからトップページが原因" not in markdown
