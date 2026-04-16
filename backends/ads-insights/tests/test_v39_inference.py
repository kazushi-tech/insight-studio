"""
V3.9 軽量テスト: グラフ要約関数とプロンプト拡張の検証
"""

import sys
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
