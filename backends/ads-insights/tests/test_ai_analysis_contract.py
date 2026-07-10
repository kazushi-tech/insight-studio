import json
import os
import sys
from pathlib import Path

os.environ.setdefault("APP_PASSWORD", "test-secret-pw-42")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx")
os.environ.setdefault("DATA_PROVIDER", "mock")

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import web.app.backend_api as backend_api  # noqa: E402
from web.app.ai_analysis import (  # noqa: E402
    ai_json_output_contract,
    build_session_landing_page_diagnostic,
    build_pv_spike_diagnostic_context,
    fetch_pv_spike_diagnostic_context,
    question_needs_pv_spike_diagnostic,
)


BASE_PAYLOAD = {
    "mode": "question",
    "provider": "google",
    "model": "gemini-2.5-flash",
    "temperature": 0.1,
    "message": "5月のPV数で一番高かった日はいつ？原因は何だと思う？",
    "point_pack_md": "## PV分析\n- **ピーク日**: 2026-05-03（PV: 300）\n",
    "data_source": "bq",
    "bq_query_types": ["pv", "traffic", "landing", "device"],
    "analysis_context_meta": {
        "projectName": "テスト案件",
        "propertyName": "テストGA4",
        "datasetId": "analytics_test",
        "periods": ["2026-05"],
    },
    "ai_chart_context": [
        {
            "title": "PV分析 — 日別推移",
            "chartType": "line",
            "labels": ["2026-05-01", "2026-05-02", "2026-05-03"],
            "datasets": [
                {"label": "ユーザー数", "data": [10, 20, 30]},
                {"label": "セッション数", "data": [12, 25, 35]},
                {"label": "PV数", "data": [100, 150, 300]},
            ],
        },
        {
            "title": "流入分析 — Top5 日別推移",
            "chartType": "line",
            "labels": ["2026-05-01", "2026-05-02", "2026-05-03"],
            "datasets": [
                {"label": "google / organic", "data": [10, 20, 80]},
                {"label": "direct / none", "data": [30, 30, 40]},
            ],
        },
    ],
}


EVIDENCE_PACK = {
    "version": "chart_evidence_pack_v1",
    "scope_label": "2026-05",
    "chart_count": 1,
    "charts": [
        {
            "chart_id": "chart_01_pv",
            "title": "PV分析 — 日別推移",
            "chart_type": "line",
            "period_tag": "2026-05",
            "series": [
                {
                    "label": "PV数",
                    "points": [
                        {"label": "5/1", "rawLabel": "20260501", "value": 100},
                        {"label": "5/3", "rawLabel": "20260503", "value": 300},
                    ],
                    "latest": {"label": "5/3", "value": 300},
                    "max": {"label": "5/3", "value": 300},
                    "min": {"label": "5/1", "value": 100},
                    "total": 400,
                }
            ],
        }
    ],
}


@pytest.fixture(autouse=True)
def _patch_auth_and_rate(monkeypatch):
    backend_api._login_failures.clear()
    backend_api._rate_buckets.clear()
    monkeypatch.setattr(backend_api, "_is_client_key_required", lambda: False)
    yield
    backend_api._login_failures.clear()
    backend_api._rate_buckets.clear()


async def _token(client):
    resp = await client.post("/api/auth/login", json={"password": os.environ["APP_PASSWORD"]})
    assert resp.status_code == 200
    return resp.json()["token"]


async def _post_neon(monkeypatch, raw_response, path="/api/neon/generate"):
    monkeypatch.setattr(backend_api, "_gemini_generate", lambda **_: raw_response)
    monkeypatch.setattr(
        backend_api,
        "fetch_pv_spike_diagnostic_context",
        lambda *_, **__: build_pv_spike_diagnostic_context(
            [
                {"date": "2026-05-01", "page_views": 100},
                {"date": "2026-05-02", "page_views": 150},
                {"date": "2026-05-03", "page_views": 300},
            ],
            {
                "sourceMedium": [
                    {"sourceMedium": "google / organic", "peakDayPageViews": 180, "previousDayPageViews": 80},
                ],
                "landingPage": [
                    {"landingPage": "/column", "peakDayPageViews": 90, "previousDayPageViews": 20},
                ],
                "device": [
                    {"device": "mobile", "peakDayPageViews": 220, "previousDayPageViews": 100},
                ],
            },
            date_range={"start": "2026-05-01", "end": "2026-05-31", "timezone": "Asia/Tokyo"},
            session_landing_page_rows=[
                {"date": "2026-05-02", "landing_page_url": "https://example.com/", "page_views": 40, "sessions": 18},
                {"date": "2026-05-03", "landing_page_url": "https://example.com/", "page_views": 120, "sessions": 45},
            ],
        ),
    )
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=backend_api.app), base_url="http://test") as client:
        token = await _token(client)
        return await client.post(
            path,
            json=BASE_PAYLOAD,
            headers={"Authorization": f"Bearer {token}", "X-Client-ID": "ai-analysis-contract-test"},
        )


async def _post_neon_payload(payload, path="/api/neon/generate"):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=backend_api.app), base_url="http://test") as client:
        token = await _token(client)
        return await client.post(
            path,
            json=payload,
            headers={"Authorization": f"Bearer {token}", "X-Client-ID": "ai-analysis-mode-test"},
        )


def _structured_payload(analysis_mode: str) -> dict:
    return {
        **BASE_PAYLOAD,
        "analysis_mode": analysis_mode,
        "message": "今回のPV状況を初心者向けに説明して",
        "user_prompt": "今回のPV状況を初心者向けに説明して",
        "workflow": "multi_agent_v1",
        "report_contract_version": "insight_report_v2",
        "chart_evidence_pack": EVIDENCE_PACK,
    }


@pytest.mark.anyio
async def test_json_response_returns_answer_markdown(monkeypatch):
    resp = await _post_neon(monkeypatch, json.dumps({"answer_markdown": "## 結論\n最大日は5月3日です。", "direct_answer": "5月3日"}))
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["answer_markdown"].startswith("## 結論")
    assert body["parse_status"] == "json"


@pytest.mark.anyio
async def test_neutral_insights_generate_alias_returns_same_contract(monkeypatch):
    resp = await _post_neon(
        monkeypatch,
        json.dumps({"answer_markdown": "## 結論\n中立APIでも表示できます。"}),
        path="/api/insights/neon/generate",
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["parse_status"] == "json"
    assert "中立API" in body["answer_markdown"]


@pytest.mark.anyio
async def test_legacy_ads_generate_alias_still_returns_same_contract(monkeypatch):
    resp = await _post_neon(
        monkeypatch,
        json.dumps({"answer_markdown": "## 結論\n既存APIでも表示できます。"}),
        path="/api/ads/neon/generate",
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["parse_status"] == "json"
    assert "既存API" in body["answer_markdown"]


@pytest.mark.anyio
async def test_neon_health_aliases_are_lightweight():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=backend_api.app), base_url="http://test") as client:
        insights = await client.get("/api/insights/neon/health")
        legacy = await client.get("/api/ads/neon/health")

    assert insights.status_code == 200
    assert legacy.status_code == 200
    assert insights.json() == {
        "ok": True,
        "service": "ads-insights",
        "feature": "ai-explorer",
        "route": "insights",
    }
    assert legacy.json() == {
        "ok": True,
        "service": "ads-insights",
        "feature": "ai-explorer",
        "route": "ads",
    }


@pytest.mark.anyio
async def test_markdown_only_response_falls_back_to_text(monkeypatch):
    resp = await _post_neon(monkeypatch, "## 結論\n最大日は5月3日です。")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["text"].startswith("## 結論")
    assert body["parse_status"] == "raw_fallback"
    assert "生回答を表示" in body["fallback_notice"]


@pytest.mark.anyio
async def test_json_code_fence_is_parsed(monkeypatch):
    raw = "```json\n" + json.dumps({"answer_markdown": "## 結論\nコードフェンスでも表示できます。"}) + "\n```"
    resp = await _post_neon(monkeypatch, raw)
    assert resp.status_code == 200
    body = resp.json()
    assert body["parse_status"] == "json"
    assert "コードフェンス" in body["text"]


@pytest.mark.anyio
async def test_broken_json_uses_raw_text_fallback(monkeypatch):
    resp = await _post_neon(monkeypatch, '{"answer_markdown": "途中で壊れた"')
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["fallback_used"] is True
    assert body["text"].startswith('{"answer_markdown"')


@pytest.mark.anyio
async def test_empty_response_returns_user_facing_error(monkeypatch):
    resp = await _post_neon(monkeypatch, "")
    assert resp.status_code == 502
    body = resp.json()
    assert body["ok"] is False
    assert body["error_code"] == "empty_ai_response"
    assert "AIから回答が返りませんでした" in body["detail"]


@pytest.mark.anyio
async def test_deterministic_mode_allows_no_api_key_and_makes_zero_llm_calls(monkeypatch):
    monkeypatch.setattr(backend_api, "_is_client_key_required", lambda: True)
    calls = 0

    def should_not_call_llm(**_kwargs):
        nonlocal calls
        calls += 1
        raise AssertionError("deterministic mode must not call Gemini")

    monkeypatch.setattr(backend_api, "_gemini_generate", should_not_call_llm)
    response = await _post_neon_payload(_structured_payload("deterministic"))

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["analysis_mode"] == "deterministic"
    assert body["execution_mode"] == "deterministic"
    assert body["provider"] == "deterministic"
    assert body["model"] is None
    assert body["tokens_used"] == 0
    assert body["llm_calls"] == 0
    assert body["review_status"]["verdict"] == "pass"
    assert "chart_01_pv" in body["text"]
    assert calls == 0


@pytest.mark.anyio
async def test_economy_mode_uses_one_llm_call_when_first_draft_passes(monkeypatch):
    calls = 0
    valid_text = backend_api._build_review_safe_insight_report(
        EVIDENCE_PACK,
        query_text="今回のPV状況を初心者向けに説明して",
    )

    def fake_gemini(**_kwargs):
        nonlocal calls
        calls += 1
        return valid_text

    monkeypatch.setattr(backend_api, "_gemini_generate", fake_gemini)
    response = await _post_neon_payload(_structured_payload("economy"))

    assert response.status_code == 200
    body = response.json()
    assert body["analysis_mode"] == "economy"
    assert body["execution_mode"] == "economy_single_pass"
    assert body["llm_calls"] == 1
    assert body["tokens_used"] is None
    assert body["token_usage_status"] == "not_reported"
    assert body["review_status"]["verdict"] == "pass"
    assert calls == 1


@pytest.mark.anyio
async def test_unspecified_structured_mode_defaults_to_economy(monkeypatch):
    calls = 0
    valid_text = backend_api._build_review_safe_insight_report(EVIDENCE_PACK)

    def fake_gemini(**_kwargs):
        nonlocal calls
        calls += 1
        return valid_text

    payload = _structured_payload("economy")
    payload.pop("analysis_mode")
    monkeypatch.setattr(backend_api, "_gemini_generate", fake_gemini)
    response = await _post_neon_payload(payload)

    assert response.status_code == 200
    body = response.json()
    assert body["analysis_mode"] == "economy"
    assert body["execution_mode"] == "economy_single_pass"
    assert body["llm_calls"] == 1
    assert calls == 1


@pytest.mark.anyio
async def test_economy_mode_repairs_once_then_stops(monkeypatch):
    calls = 0
    valid_text = backend_api._build_review_safe_insight_report(
        EVIDENCE_PACK,
        query_text="今回のPV状況を初心者向けに説明して",
    )

    def fake_gemini(**_kwargs):
        nonlocal calls
        calls += 1
        return "CPAは999円です。" if calls == 1 else valid_text

    monkeypatch.setattr(backend_api, "_gemini_generate", fake_gemini)
    response = await _post_neon_payload(_structured_payload("economy"))

    assert response.status_code == 200
    body = response.json()
    assert body["execution_mode"] == "economy_repair"
    assert body["llm_calls"] == 2
    assert body["review_status"]["verdict"] == "repaired"
    assert body["review_status"]["repaired_from_issues"]
    assert calls == 2


@pytest.mark.anyio
async def test_economy_mode_falls_back_safely_after_one_failed_repair(monkeypatch):
    calls = 0

    def always_invalid(**_kwargs):
        nonlocal calls
        calls += 1
        return "CPAは999円、ROASは500%です。"

    monkeypatch.setattr(backend_api, "_gemini_generate", always_invalid)
    response = await _post_neon_payload(_structured_payload("economy"))

    assert response.status_code == 200
    body = response.json()
    assert body["execution_mode"] == "deterministic_safe_fallback"
    assert body["llm_calls"] == 2
    assert body["fallback_used"] is True
    assert body["review_status"]["verdict"] == "repaired"
    assert body["review_status"]["verdict"] != "pass"
    assert body["validation_warnings"]
    assert "chart_01_pv" in body["text"]
    assert calls == 2


@pytest.mark.anyio
async def test_pv_max_day_is_in_python_built_context(monkeypatch):
    resp = await _post_neon(monkeypatch, json.dumps({"answer_markdown": "## 結論\n最大日は5月3日です。"}))
    body = resp.json()
    summary = body["analysis_context"]["dataSummary"]
    assert summary["max"]["date"] == "2026-05-03"
    assert summary["max"]["value"] == 300
    assert summary["previousPeriodComparison"]["rate"] == 100.0
    assert body["analysis_context"]["pvSpikePeak"]["date"] == "2026-05-03"
    assert body["analysis_context"]["pvSpikeBreakdownRows"]["sourceMedium"] == 1
    assert body["analysis_context"]["sessionLandingPageDiagnostic"]["method"] == "ga4_session_first_page_view"


def test_pv_spike_diagnostic_calculates_peak_and_comparisons():
    diagnostic = build_pv_spike_diagnostic_context(
        [
            {"date": "2026-05-01", "page_views": 100},
            {"date": "2026-05-02", "page_views": 120},
            {"date": "2026-05-03", "page_views": 300},
            {"date": "2026-05-04", "page_views": 130},
        ],
        {},
        date_range={"start": "2026-05-01", "end": "2026-05-04", "timezone": "Asia/Tokyo"},
    )

    peak = diagnostic["peak"]
    assert peak["date"] == "2026-05-03"
    assert peak["pageViews"] == 300
    assert peak["previousDayPageViews"] == 120
    assert peak["previousDayDelta"] == 180
    assert peak["previousDayDeltaRate"] == 150.0
    assert peak["periodAveragePageViews"] == 162.5
    assert peak["periodAverageDelta"] == 137.5
    assert peak["periodAverageDeltaRate"] == 84.6
    assert "campaign別PVデータがこのコンテキストにはありません" in "\n".join(diagnostic["caveats"])


def test_pv_spike_breakdowns_calculate_delta_share_and_contribution():
    diagnostic = build_pv_spike_diagnostic_context(
        [
            {"date": "2026-05-01", "page_views": 100},
            {"date": "2026-05-02", "page_views": 120},
            {"date": "2026-05-03", "page_views": 300},
            {"date": "2026-05-04", "page_views": 130},
        ],
        {
            "sourceMedium": [
                {"sourceMedium": "google / organic", "peakDayPageViews": 180, "previousDayPageViews": 80},
                {"sourceMedium": "google / cpc", "peakDayPageViews": 70, "previousDayPageViews": 30},
            ]
        },
        date_range={"start": "2026-05-01", "end": "2026-05-04", "timezone": "Asia/Tokyo"},
    )

    rows = diagnostic["breakdowns"]["sourceMedium"]
    assert rows[0]["sourceMedium"] == "google / organic"
    assert rows[0]["delta"] == 100
    assert rows[0]["deltaRate"] == 125.0
    assert rows[0]["shareOfPeakDay"] == 60.0
    assert rows[0]["contributionToIncrease"] == 71.4
    assert rows[1]["sourceMedium"] == "google / cpc"
    assert rows[1]["contributionToIncrease"] == 28.6


def test_session_landing_page_diagnostic_attributes_pageviews_to_first_page_view():
    diagnostic = build_session_landing_page_diagnostic(
        [
            {
                "event_date": "2026-05-13",
                "event_timestamp": 1000,
                "user_pseudo_id": "u1",
                "ga_session_id": 111,
                "event_name": "page_view",
                "page_location": "https://example.com/",
                "page_title": "Home",
            },
            {
                "event_date": "2026-05-13",
                "event_timestamp": 2000,
                "user_pseudo_id": "u1",
                "ga_session_id": 111,
                "event_name": "page_view",
                "page_location": "https://example.com/service",
                "page_title": "Service",
            },
            {
                "event_date": "2026-05-13",
                "event_timestamp": 3000,
                "user_pseudo_id": "u2",
                "ga_session_id": 222,
                "event_name": "page_view",
                "page_location": "https://example.com/blog/a",
                "page_title": "Blog A",
            },
        ],
        peak_date="2026-05-13",
        previous_date="2026-05-12",
        date_range={"start": "2026-05-01", "end": "2026-05-31", "timezone": "Asia/Tokyo"},
    )

    rows = diagnostic["topLandingPages"]
    home = next(row for row in rows if row["landingPageUrl"] == "https://example.com/")
    blog = next(row for row in rows if row["landingPageUrl"] == "https://example.com/blog/a")
    assert diagnostic["method"] == "ga4_session_first_page_view"
    assert diagnostic["sessionKeyMethod"] == "user_pseudo_id + ga_session_id"
    assert home["landingPageTitle"] == "Home"
    assert home["peakDayPageViews"] == 2
    assert home["peakDayLandingSessions"] == 1
    assert blog["peakDayPageViews"] == 1
    assert blog["peakDayLandingSessions"] == 1


def test_session_landing_page_diagnostic_calculates_previous_day_delta_share_and_contribution():
    diagnostic = build_session_landing_page_diagnostic(
        [
            {"date": "2026-05-12", "landing_page_url": "https://example.com/", "page_views": 50, "sessions": 20},
            {"date": "2026-05-13", "landing_page_url": "https://example.com/", "page_views": 120, "sessions": 45},
        ],
        peak_date="2026-05-13",
        previous_date="2026-05-12",
        date_range={"start": "2026-05-01", "end": "2026-05-31", "timezone": "Asia/Tokyo"},
    )

    row = diagnostic["topLandingPages"][0]
    assert row["delta"] == 70
    assert row["deltaRate"] == 140.0
    assert row["shareOfPeakDayPageViews"] == 100.0
    assert row["contributionToIncrease"] == 100.0
    assert row["landingSessionsDelta"] == 25


def test_session_landing_page_diagnostic_tracks_missing_session_id_caveat():
    diagnostic = build_session_landing_page_diagnostic(
        [
            {
                "event_date": "2026-05-13",
                "event_timestamp": 1000,
                "user_pseudo_id": "u1",
                "ga_session_id": 111,
                "event_name": "page_view",
                "page_location": "https://example.com/",
            },
            {
                "event_date": "2026-05-13",
                "event_timestamp": 2000,
                "user_pseudo_id": "u2",
                "ga_session_id": None,
                "event_name": "page_view",
                "page_location": "https://example.com/service",
            },
        ],
        peak_date="2026-05-13",
        previous_date="2026-05-12",
        date_range={"start": "2026-05-01", "end": "2026-05-31", "timezone": "Asia/Tokyo"},
    )

    assert diagnostic["totals"]["missingSessionIdPageViews"] == 1
    assert diagnostic["topLandingPages"][0]["peakDayPageViews"] == 1
    assert "ga_session_id" in "\n".join(diagnostic["caveats"])


def test_fetch_pv_spike_diagnostic_falls_back_when_session_landing_sql_fails():
    def fake_run_query(sql, params, project=None):
        if "COUNTIF(event_name = 'page_view')" in sql:
            return [
                {"date": "2026-05-12", "page_views": 50},
                {"date": "2026-05-13", "page_views": 120},
            ]
        if "session_landing" in sql:
            raise RuntimeError("schema missing")
        return [{"landingPage": "https://example.com/", "peakDayPageViews": 120, "previousDayPageViews": 50}]

    diagnostic = fetch_pv_spike_diagnostic_context(
        "analytics_test",
        {"start": "2026-05-01", "end": "2026-05-31", "timezone": "Asia/Tokyo"},
        run_query_fn=fake_run_query,
    )

    assert diagnostic["sessionLandingPageDiagnostic"] is None
    assert diagnostic["breakdowns"]["landingPage"][0]["landingPage"] == "https://example.com/"
    assert "page_location別PVをfallback" in "\n".join(diagnostic["caveats"])


def test_ai_context_contract_mentions_session_landing_page_definition():
    diagnostic = build_pv_spike_diagnostic_context(
        [
            {"date": "2026-05-12", "page_views": 50},
            {"date": "2026-05-13", "page_views": 120},
        ],
        {},
        date_range={"start": "2026-05-01", "end": "2026-05-31", "timezone": "Asia/Tokyo"},
        session_landing_page_rows=[
            {"date": "2026-05-12", "landing_page_url": "https://example.com/", "page_views": 50, "sessions": 20},
            {"date": "2026-05-13", "landing_page_url": "https://example.com/", "page_views": 120, "sessions": 45},
        ],
    )
    prompt = ai_json_output_contract()

    session_diag = diagnostic["sessionLandingPageDiagnostic"]
    assert session_diag["method"] == "ga4_session_first_page_view"
    assert session_diag["landingPageDefinition"] == "first page_view.page_location in each GA4 session"
    assert "page_location別PVとセッションLPは別物" in prompt
    assert "その日に発生したPVを、各セッションの入口ページへ帰属させた診断" in prompt
    assert "sessionLandingPageDiagnostic" in prompt


def test_pv_spike_intent_detection_is_targeted():
    assert question_needs_pv_spike_diagnostic("5月のPV数で一番高かった日はいつ？原因は何だと思う？")
    assert question_needs_pv_spike_diagnostic("アクセスが伸びた理由は？")
    assert not question_needs_pv_spike_diagnostic("CPA改善の優先施策を教えて")
