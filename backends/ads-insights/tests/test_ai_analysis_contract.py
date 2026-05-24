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
    build_pv_spike_diagnostic_context,
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
        ),
    )
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=backend_api.app), base_url="http://test") as client:
        token = await _token(client)
        return await client.post(
            path,
            json=BASE_PAYLOAD,
            headers={"Authorization": f"Bearer {token}", "X-Client-ID": "ai-analysis-contract-test"},
        )


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
async def test_pv_max_day_is_in_python_built_context(monkeypatch):
    resp = await _post_neon(monkeypatch, json.dumps({"answer_markdown": "## 結論\n最大日は5月3日です。"}))
    body = resp.json()
    summary = body["analysis_context"]["dataSummary"]
    assert summary["max"]["date"] == "2026-05-03"
    assert summary["max"]["value"] == 300
    assert summary["previousPeriodComparison"]["rate"] == 100.0
    assert body["analysis_context"]["pvSpikePeak"]["date"] == "2026-05-03"
    assert body["analysis_context"]["pvSpikeBreakdownRows"]["sourceMedium"] == 1


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


def test_pv_spike_intent_detection_is_targeted():
    assert question_needs_pv_spike_diagnostic("5月のPV数で一番高かった日はいつ？原因は何だと思う？")
    assert question_needs_pv_spike_diagnostic("アクセスが伸びた理由は？")
    assert not question_needs_pv_spike_diagnostic("CPA改善の優先施策を教えて")
