"""Tests for ReportEnvelope v0 schema parser + flag-gated endpoints."""

from __future__ import annotations

import os

import pytest

from web.app.schemas.report_envelope import (
    AXIS_KEYS,
    build_envelope_from_md,
    report_envelope_enabled,
)


SAMPLE_REPORT_MD = """# Discovery Hub レポート

## 1. 市場推定データ（参照必須）

**信頼度**: 中

| 指標 | レンジ | 単位 |
| --- | --- | --- |
| 市場規模 | 200〜400 | 億円 |
| 検索ボリューム | 20,000〜60,000 | 件/月 |
| CPC | 120〜260 | 円 |

## 2. 最優先施策

- FV購買訴求切替: 「ONLINE MAGAZINE」をベネフィット訴求に差し替え
- CTAの視認性向上: ファーストビュー内にCTAを移動
- 信頼訴求の強化: 導入事例 / 実績数 / レビュー追加

## 4. ブランド別評価

### brand.example

| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 強 | ブランドKW完全一致 | 確認済み |
| FV訴求 | 同等 | ベネフィット記述あり | 確認済み |
| CTAの明確性 | 弱 | CTAがスクロール先 | 確認済み |
| 信頼構築 | 強 | 実績500社明記 | 確認済み |
| 価格・オファー | 評価保留 | 価格非開示 | 未確認 |
| 購買導線 | 同等 | 3クリックで完結 | 確認済み |

### brand.another

| 評価軸 | 判定 | 根拠 | 証拠強度 |
| --- | --- | --- | --- |
| 検索意図一致 | 同等 | 関連KW一致 | 確認済み |
| FV訴求 | 弱 | 汎用コピーのみ | 確認済み |

## 5. まとめ
以上。
"""


def test_envelope_built_from_full_report():
    env = build_envelope_from_md("abc123", "scan", SAMPLE_REPORT_MD)
    assert env.version == "v0"
    assert env.report_id == "abc123"
    assert env.kind == "scan"

    assert len(env.priority_actions) == 3
    assert env.priority_actions[0].title == "FV購買訴求切替"
    assert "ONLINE MAGAZINE" in env.priority_actions[0].detail

    assert env.market_estimate is not None
    assert env.market_estimate.confidence == "中"
    labels = [r.label for r in env.market_estimate.ranges]
    assert "市場規模" in labels
    size_range = next(r for r in env.market_estimate.ranges if r.label == "市場規模")
    assert size_range.min == 200
    assert size_range.max == 400
    assert size_range.unit == "億円"
    sv_range = next(r for r in env.market_estimate.ranges if r.label == "検索ボリューム")
    assert sv_range.min == 20000
    assert sv_range.max == 60000

    assert len(env.brand_evaluations) == 2
    first = env.brand_evaluations[0]
    assert first.brand == "brand.example"
    axis_map = {a.axis: a for a in first.axes}
    assert axis_map["検索意図一致"].verdict == "強"
    assert axis_map["FV訴求"].verdict == "同等"
    assert axis_map["CTA明確性"].verdict == "弱"
    assert axis_map["信頼構築"].verdict == "強"
    assert axis_map["価格・オファー"].verdict == "評価保留"
    assert axis_map["購買導線"].verdict == "同等"
    # Normalized axis keys must match the canonical 6 axes
    for axis in axis_map:
        assert axis in AXIS_KEYS


def test_envelope_empty_on_unparseable_report():
    env = build_envelope_from_md("xyz", "discovery", "")
    assert env.priority_actions == []
    assert env.market_estimate is None
    assert env.brand_evaluations == []


def test_envelope_partial_report_only_market():
    md = """## 市場推定データ

**信頼度**: 高

| 指標 | レンジ | 単位 |
| --- | --- | --- |
| 市場規模 | 1000〜2000 | 億円 |
"""
    env = build_envelope_from_md("partial", "scan", md)
    assert env.priority_actions == []
    assert env.brand_evaluations == []
    assert env.market_estimate is not None
    assert env.market_estimate.confidence == "高"
    assert env.market_estimate.ranges[0].min == 1000


def test_envelope_flag_defaults_off(monkeypatch):
    monkeypatch.delenv("REPORT_ENVELOPE_V0", raising=False)
    assert report_envelope_enabled() is False


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on"])
def test_envelope_flag_on_variants(monkeypatch, value):
    monkeypatch.setenv("REPORT_ENVELOPE_V0", value)
    assert report_envelope_enabled() is True


def test_envelope_scan_endpoint_404_when_flag_off(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.delenv("REPORT_ENVELOPE_V0", raising=False)
    from web.app.main import app

    client = TestClient(app)
    resp = client.get("/api/scans/unknown/report.json")
    assert resp.status_code == 404


def test_envelope_scan_endpoint_returns_envelope_when_flag_on(monkeypatch, tmp_path):
    from pathlib import Path
    from fastapi.testclient import TestClient

    monkeypatch.setenv("REPORT_ENVELOPE_V0", "1")

    from web.app import main as main_module, storage
    # Redirect file storage into tmp_path for the duration of the test
    monkeypatch.setattr(storage, "DATA_DIR", Path(tmp_path))

    from web.app.models import ScanResult

    # Seed a completed scan with our sample report_md
    run_id = "abcdef012345"
    owner_id = "guest:testuser1234"
    scan = ScanResult(
        run_id=run_id,
        owner_id=owner_id,
        status="completed",
        urls=["https://a.example", "https://b.example"],
        extracted=[],
        report_md=SAMPLE_REPORT_MD,
        total_time_sec=1.0,
    )
    main_module._repo.save(scan)

    client = TestClient(main_module.app)
    resp = client.get(
        f"/api/scans/{run_id}/report.json",
        headers={"X-Insight-User": owner_id},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["version"] == "v0"
    assert body["kind"] == "scan"
    assert body["report_id"] == run_id
    assert len(body["priority_actions"]) == 3
    assert body["market_estimate"]["confidence"] == "中"
    assert len(body["brand_evaluations"]) == 2
