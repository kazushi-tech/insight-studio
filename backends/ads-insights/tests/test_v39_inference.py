"""
V3.9 軽量テスト: グラフ要約関数とプロンプト拡張の検証
"""

import sys
import json
from pathlib import Path

# プロジェクトルートをパスに追加
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def test_summarize_line_chart():
    """時系列グラフの要約が正しく生成されるかテスト"""
    from web.app.bq_chart_builder import summarize_chart_groups_for_ai

    groups = [
        {
            "title": "PV分析 — 日別推移",
            "chartType": "line",
            "labels": ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"],
            "datasets": [
                {
                    "label": "PV数",
                    "data": [1000, 1500, 800, 2000, 1200]
                }
            ],
            "_periodTag": "2024-01"
        }
    ]

    result = summarize_chart_groups_for_ai(groups)

    # ピーク・ボトムが含まれる
    assert "ピーク" in result
    assert "ボトム" in result
    # 期間タグが含まれる
    assert "2024-01" in result
    # 急変動（1000→1500は50%増加）が検出される
    assert "50%" in result or "増加" in result
    print("[OK] test_summarize_line_chart passed")


def test_summarize_bar_chart():
    """カテゴリ棒グラフの要約が正しく生成されるかテスト"""
    from web.app.bq_chart_builder import summarize_chart_groups_for_ai

    groups = [
        {
            "title": "流入分析 — チャネル別",
            "chartType": "bar_horizontal",
            "labels": ["Google / organic", "Direct", "Instagram / referral", "Bing / organic", "Others"],
            "datasets": [
                {
                    "label": "セッション",
                    "data": [5000, 2000, 1000, 500, 200]
                }
            ],
            "_periodTag": "2024-01"
        }
    ]

    result = summarize_chart_groups_for_ai(groups)

    # 上位が含まれる
    assert "上位" in result
    # ピークが含まれる
    assert "Google" in result or "5000" in result
    # 偏りが検出される（上位3件で77%）
    assert "偏り" in result or "%" in result
    print("[OK] test_summarize_bar_chart passed")


def test_summarize_empty():
    """空入力で安全に空文字が返るかテスト"""
    from web.app.bq_chart_builder import summarize_chart_groups_for_ai

    # 空リスト
    result = summarize_chart_groups_for_ai([])
    assert result == ""

    # データが不足
    result = summarize_chart_groups_for_ai([{"title": "test", "chartType": "line", "labels": [], "datasets": []}])
    assert result == ""

    print("[OK] test_summarize_empty passed")


def test_summarize_chart_evidence_pack_for_ai():
    """structured evidence pack がAI向け要約に展開されるかテスト"""
    from web.app.bq_chart_builder import summarize_chart_evidence_pack_for_ai

    pack = {
        "version": "chart_evidence_pack_v1",
        "scope_label": "2026-05",
        "chart_count": 1,
        "charts": [
            {
                "chart_id": "chart_01_test",
                "title": "LP分析 — 日別推移",
                "chart_type": "line",
                "period_tag": "2026-05",
                "series": [
                    {
                        "label": "/a",
                        "latest": {"label": "5/3", "value": 200},
                        "max": {"label": "5/3", "value": 200},
                        "min": {"label": "5/1", "value": 100},
                        "total": 450,
                        "change_from_first": {"absolute": 100, "percent": 100.0},
                        "notable_swings": [{"from_label": "5/2", "to_label": "5/3", "percent": 33.3}],
                    }
                ],
                "ranking_top": [{"series_label": "/a", "label": "5/3", "value": 200}],
            }
        ],
    }

    result = summarize_chart_evidence_pack_for_ai(pack)
    assert "数値根拠パック" in result
    assert "chart_01_test" in result
    assert "最新=5/3 200" in result
    assert "初回比=100 (+100.0%)" in result


def test_validate_ai_insight_output_rejects_unsupported_numbers_and_forbidden_kpi():
    """根拠パック外の数値とGA4未取得広告KPIを検知する"""
    from web.app.bq_chart_builder import validate_ai_insight_output

    pack = {
        "charts": [
            {
                "chart_id": "chart_01_test",
                "title": "セッション推移",
                "series": [{"label": "セッション", "latest": {"label": "5/3", "value": 200}}],
            }
        ]
    }
    text = """```insight-report
{"version":"insight_report_v2","executive_summary":["悪い例"],"evidence_table":[],"interpretation":[],"hypotheses":[],"actions":[],"limitations":[]}
```
CPAが1,000円で、セッションは999件です。
"""

    result = validate_ai_insight_output(text, pack, data_source="bq")
    assert result["ok"] is False
    assert any("CPA" in issue for issue in result["issues"])
    assert any("999" in issue for issue in result["issues"])


def test_validate_ai_insight_output_accepts_evidence_numbers():
    """根拠パック内の数値だけなら通過する"""
    from web.app.bq_chart_builder import validate_ai_insight_output

    pack = {
        "charts": [
            {
                "chart_id": "chart_01_test",
                "title": "セッション推移",
                "series": [{"label": "セッション", "latest": {"label": "5/3", "value": 200}}],
            }
        ]
    }
    text = """```insight-report
{"version":"insight_report_v2","executive_summary":["5/3が最大"],"evidence_table":[{"claim":"最大","metric":"セッション","value":"200","period":"5/3","source":"chart_01_test","confidence":"high"}],"interpretation":["初心者にも分かるよう、5/3のセッション200を見ます。","Senior AdOps Reviewerは広告費未取得を確認しました。"],"hypotheses":[{"hypothesis":"流入増の仮説","evidence":"chart_01_test","missing_data":"広告費"}],"actions":[{"priority":"P0","action":"確認","rationale":"200が最大","expected_metric":"セッション"}],"limitations":["広告費は未取得","Consistency Agent: 日付と数値を確認"],"review_status":{"verdict":"pass","notes":["初心者説明","Senior AdOps Reviewer","Consistency Agent"]}}
```
chart_01_test のセッション 200 を根拠にします。
"""

    result = validate_ai_insight_output(text, pack, data_source="bq")
    assert result["ok"] is True


def test_validate_ai_insight_output_rejects_mismatched_evidence_table_row():
    """source/metric/value/period の組み合わせが違う根拠行を検知する"""
    from web.app.bq_chart_builder import validate_ai_insight_output

    pack = {
        "charts": [
            {
                "chart_id": "chart_01_test",
                "title": "PV分析 — 日別推移",
                "series": [
                    {"label": "PV数", "points": [{"label": "5/3", "value": 200}]},
                    {"label": "セッション", "points": [{"label": "5/2", "value": 200}]},
                ],
            }
        ]
    }
    text = """```insight-report
{"version":"insight_report_v2","executive_summary":["5/3が最大"],"evidence_table":[{"claim":"最大","metric":"セッション","value":"200","period":"5/3","source":"chart_01_test","confidence":"high"}],"interpretation":["初心者にも分かるように確認します。","Senior AdOps ReviewerとConsistency Agentが確認しました。"],"hypotheses":[{"hypothesis":"流入増の仮説","evidence":"chart_01_test","missing_data":"広告費"}],"actions":[{"priority":"P0","action":"確認","rationale":"200が最大","expected_metric":"セッション"}],"limitations":["広告費は未取得","Consistency Agent: 日付と数値を確認"],"review_status":{"verdict":"pass","notes":["初心者説明","Senior AdOps Reviewer","Consistency Agent"]}}
```
chart_01_test のセッション 200 を根拠にします。
"""

    result = validate_ai_insight_output(text, pack, data_source="bq")
    assert result["ok"] is False
    assert any("source/metric/value/period" in issue for issue in result["issues"])


def test_validate_ai_insight_output_requires_chart_id_when_evidence_pack_exists():
    """数値根拠パックがある場合は chart_id なし回答を落とす"""
    from web.app.bq_chart_builder import validate_ai_insight_output

    pack = {
        "charts": [
            {
                "chart_id": "chart_01_test",
                "title": "セッション推移",
                "series": [{"label": "セッション", "latest": {"label": "5/3", "value": 200}}],
            }
        ]
    }
    text = """```insight-report
{"version":"insight_report_v2","executive_summary":["5/3が最大"],"evidence_table":[{"claim":"最大","metric":"セッション","value":"200","period":"5/3","source":"根拠パック","confidence":"high"}],"interpretation":["200を根拠に確認"],"hypotheses":[],"actions":[{"priority":"P0","action":"確認","rationale":"200が最大","expected_metric":"セッション"}],"limitations":["広告費は未取得"]}
```
セッション 200 を根拠にします。
"""

    result = validate_ai_insight_output(text, pack, data_source="bq")
    assert result["ok"] is False
    assert any("chart_id" in issue for issue in result["issues"])


def test_validate_ai_insight_output_allows_grouped_missing_ad_kpis():
    """未取得と明記した広告KPIリストは危険な断定として扱わない"""
    from web.app.bq_chart_builder import validate_ai_insight_output

    pack = {
        "charts": [
            {
                "chart_id": "chart_01_test",
                "title": "セッション推移",
                "series": [{"label": "セッション", "latest": {"label": "5/3", "value": 200}}],
            }
        ]
    }
    text = """```insight-report
{"version":"insight_report_v2","executive_summary":["5/3が最大"],"evidence_table":[{"claim":"最大","metric":"セッション","value":"200","period":"5/3","source":"chart_01_test","confidence":"high"}],"interpretation":["初心者にも分かるよう、5/3のセッション200を見ます。","Senior AdOps Reviewerは広告費未取得を確認しました。"],"hypotheses":[{"hypothesis":"流入増の仮説","evidence":"chart_01_test","missing_data":"広告費"}],"actions":[{"priority":"P0","action":"確認","rationale":"200が最大","expected_metric":"セッション"}],"limitations":["広告費、CPA、ROAS、CTR、CPC、インプレッションは入力に存在しない限り未取得として扱います。","Consistency Agent: 日付と数値を確認"],"review_status":{"verdict":"pass","notes":["初心者説明","Senior AdOps Reviewer","Consistency Agent"]}}
```
chart_01_test のセッション 200 を根拠にします。初心者向けに説明し、Senior AdOps Reviewer と Consistency Agent が確認しました。広告費、CPA、ROAS、CTR、CPC、インプレッションは入力に存在しない限り未取得として扱います。
"""

    result = validate_ai_insight_output(text, pack, data_source="bq")
    assert result["ok"] is True


def test_review_safe_report_resolves_date_aliases():
    """20260507 と 2026年5月7日 を同じ日付根拠として扱う"""
    from web.app.backend_api import _build_review_safe_insight_report

    pack = {
        "scope_label": "2026-05",
        "charts": [
            {
                "chart_id": "chart_02_date",
                "title": "流入分析 — 日別推移",
                "series": [
                    {
                        "label": "セッション",
                        "points": [
                            {
                                "label": "5/7",
                                "rawLabel": "20260507",
                                "aliases": ["20260507", "2026-05-07", "2026/5/7", "2026年5月7日", "5/7"],
                                "value": 114,
                            }
                        ],
                        "latest": {"label": "5/7", "value": 114},
                        "max": {"label": "5/7", "value": 114},
                    }
                ],
            }
        ],
    }

    compact = _build_review_safe_insight_report(pack, query_text="20260507 のPV数が上がった理由は？")
    japanese = _build_review_safe_insight_report(pack, query_text="2026年5月7日のPV数が上がった理由は？")

    assert "chart_02_date" in compact
    assert "5/7" in compact
    assert "114" in compact
    assert "chart_02_date" in japanese
    assert "5/7" in japanese
    assert "114" in japanese
    for marker in ["Beginner Explainer Agent", "Senior AdOps Reviewer Agent", "Consistency Agent", "初心者", "未取得"]:
        assert marker in compact


def test_review_safe_report_is_professional_and_beginner_readable():
    """fallbackでもシニア運用判断と初心者説明を含む"""
    from web.app.backend_api import _build_review_safe_insight_report
    from web.app.bq_chart_builder import validate_ai_insight_output

    pack = {
        "scope_label": "2026-05",
        "charts": [
            {
                "chart_id": "chart_01",
                "title": "PV分析 — 日別推移",
                "series": [
                    {"label": "ユーザー数", "points": [{"label": "5/7", "aliases": ["20260507", "2026年5月7日"], "value": 273}], "latest": {"label": "5/7", "value": 273}, "max": {"label": "5/7", "value": 273}},
                    {"label": "セッション数", "points": [{"label": "5/7", "aliases": ["20260507", "2026年5月7日"], "value": 308}], "latest": {"label": "5/7", "value": 308}, "max": {"label": "5/7", "value": 308}},
                    {"label": "PV数", "points": [{"label": "5/7", "aliases": ["20260507", "2026年5月7日"], "value": 328}], "latest": {"label": "5/7", "value": 328}, "max": {"label": "5/7", "value": 328}},
                ],
            }
        ],
    }

    text = _build_review_safe_insight_report(pack, query_text="2026年5月7日を初心者にも分かるように説明")

    assert "chart_01" in text
    assert "273" in text and "308" in text and "328" in text
    assert "初心者" in text
    assert "シニア広告運用" in text or "Senior AdOps Reviewer Agent" in text
    assert "原因ではなく、検証前の仮説" in text
    assert "CPA" in text and "未取得" in text
    assert validate_ai_insight_output(text, pack, data_source="bq")["ok"] is True


def test_review_safe_report_with_prior_issues_is_repaired_and_valid():
    """Review Agent の指摘後に安全版へ修復したレポートは 422 に戻さない"""
    from web.app.backend_api import _build_review_safe_insight_report
    from web.app.bq_chart_builder import validate_ai_insight_output

    pack = {
        "scope_label": "2026-05",
        "charts": [
            {
                "chart_id": "chart_01",
                "title": "PV分析 — 日別推移",
                "series": [
                    {"label": "ユーザー数", "points": [{"label": "5/7", "aliases": ["20260507", "2026年5月7日"], "value": 273}]},
                    {"label": "セッション数", "points": [{"label": "5/7", "aliases": ["20260507", "2026年5月7日"], "value": 308}]},
                    {"label": "PV数", "points": [{"label": "5/7", "aliases": ["20260507", "2026年5月7日"], "value": 328}]},
                ],
            }
        ],
    }

    text = _build_review_safe_insight_report(
        pack,
        review_issues=["元のLLM回答に根拠パック外の値があります: 999件"],
        query_text="20260507 と 2026年5月7日の PV数・セッション数・ユーザー数",
    )

    result = validate_ai_insight_output(text, pack, data_source="bq", require_agent_trace=True)
    assert result["ok"] is True
    assert '"verdict": "pass"' in text
    assert "273" in text and "308" in text and "328" in text
    assert "Review Agent の指摘を受け" in text


def test_validate_ai_insight_output_requires_full_agent_trace_when_requested():
    from web.app.bq_chart_builder import REQUIRED_AGENT_TRACE_STAGES, validate_ai_insight_output

    pack = {
        "charts": [
            {
                "chart_id": "chart_01_test",
                "series": [
                    {"label": "セッション", "points": [{"label": "5/3", "value": 200}]},
                ],
            }
        ]
    }
    text = """```insight-report
{"version":"insight_report_v2","executive_summary":["5/3が最大"],"evidence_table":[{"claim":"最大","metric":"セッション","value":"200","period":"5/3","source":"chart_01_test","confidence":"high"}],"interpretation":["初心者にも分かるように確認します。","Senior AdOps ReviewerとConsistency Agentが確認しました。"],"hypotheses":[{"hypothesis":"流入増の仮説","evidence":"chart_01_test","missing_data":"広告費"}],"actions":[{"priority":"P0","action":"確認","rationale":"200が最大","expected_metric":"セッション"}],"limitations":["広告費は未取得","Consistency Agent: 日付と数値を確認"],"review_status":{"verdict":"pass","notes":["初心者説明","Senior AdOps Reviewer","Consistency Agent"]}}
```
chart_01_test のセッション 200 を根拠にします。
"""
    missing = validate_ai_insight_output(text, pack, data_source="bq", agent_trace=[], require_agent_trace=True)
    assert missing["ok"] is False
    assert any("agent_trace" in issue for issue in missing["issues"])

    trace = [
        {
            "stage": stage,
            "label": stage,
            "status": "completed",
            "mode": "deterministic_fallback",
            "summary": "検査完了",
            "checks": ["確認"],
            "issues": [],
            "excerpt": "検査完了",
        }
        for stage in REQUIRED_AGENT_TRACE_STAGES
    ]
    result = validate_ai_insight_output(text, pack, data_source="bq", agent_trace=trace, require_agent_trace=True)
    assert result["ok"] is True


def test_validate_ai_insight_output_ignores_verbose_agent_trace_claims():
    from web.app.bq_chart_builder import REQUIRED_AGENT_TRACE_STAGES, validate_ai_insight_output

    pack = {
        "charts": [
            {
                "chart_id": "chart_01_test",
                "series": [
                    {"label": "PV数", "points": [{"label": "5/7", "value": 328}]},
                ],
            }
        ]
    }
    trace = [
        {
            "stage": stage,
            "label": stage,
            "status": "completed",
            "mode": "llm_stage" if stage != "data_evidence_agent" else "deterministic_fallback",
            "summary": "検査完了",
            "checks": ["確認"],
            "issues": [],
            "excerpt": "内部検査では5回確認し、CPA 3000円のような未採用案も棄却しました。",
        }
        for stage in REQUIRED_AGENT_TRACE_STAGES
    ]
    text = f"""```insight-report
{{"version":"insight_report_v2","executive_summary":["5/7はPV数328です"],"evidence_table":[{{"claim":"PV分析","metric":"PV数","value":"328","period":"5/7","source":"chart_01_test","confidence":"high"}}],"interpretation":["初心者にも分かるように確認します。","Senior AdOps ReviewerとConsistency Agentが確認しました。"],"hypotheses":[{{"hypothesis":"流入増の仮説","evidence":"chart_01_test","missing_data":"広告費"}}],"actions":[{{"priority":"P0","action":"確認","rationale":"PV数328","expected_metric":"PV数"}}],"limitations":["CPA、ROAS、CTRは未取得"],"review_status":{{"verdict":"pass","notes":["初心者説明","Senior AdOps Reviewer","Consistency Agent"],"unsupported_kpis":["CPA","ROAS","CTR"]}},"agent_trace":{json.dumps(trace, ensure_ascii=False)}}}
```
chart_01_test の PV数 328 を根拠にします。CPA、ROAS、CTRは未取得です。
"""
    result = validate_ai_insight_output(text, pack, data_source="bq", agent_trace=trace, require_agent_trace=True)
    assert result["ok"] is True


def test_load_bq_system_prompt_with_inference():
    """inference_hintが正しく連結されるかテスト"""
    import json

    # テスト用のヒントファイルを一時的に作成
    hints_path = ROOT / "web/app/prompts/bq_query_hints.json"

    # 実際のファイルを読み込んで inference_hint があるか確認
    if hints_path.exists():
        hints = json.loads(hints_path.read_text(encoding="utf-8-sig"))
        # pv に inference_hint があることを確認
        assert "pv" in hints
        assert "inference_hint" in hints["pv"]
        print(f"[OK] pv inference_hint: {hints['pv']['inference_hint'][:50]}...")

    print("[OK] test_load_bq_system_prompt_with_inference passed")


def test_inference_hint_in_system_prompt():
    """_load_bq_system_promptにinference_hintが含まれるかテスト"""
    # このテストは backend_api のインポートが必要
    # 簡易的にファイル内容を確認
    system_path = ROOT / "web/app/prompts/system_bq.txt"

    if system_path.exists():
        content = system_path.read_text(encoding="utf-8-sig")
        # 類推ルールが追加されていることを確認
        assert "類推" in content or "仮説" in content
        print("[OK] system_bq.txt contains inference rules")

    print("[OK] test_inference_hint_in_system_prompt passed")


def run_all_tests():
    """全テストを実行"""
    print("=" * 50)
    print("V3.9 Inference Framework Tests")
    print("=" * 50)

    tests = [
        test_summarize_line_chart,
        test_summarize_bar_chart,
        test_summarize_empty,
        test_summarize_chart_evidence_pack_for_ai,
        test_validate_ai_insight_output_rejects_unsupported_numbers_and_forbidden_kpi,
        test_validate_ai_insight_output_accepts_evidence_numbers,
        test_load_bq_system_prompt_with_inference,
        test_inference_hint_in_system_prompt,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            print(f"[FAIL] {test.__name__} failed: {e}")
            failed += 1

    print("=" * 50)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 50)

    return failed == 0


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
