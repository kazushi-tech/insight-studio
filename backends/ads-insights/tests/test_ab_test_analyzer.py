"""ab-test-analyzer のユニットテスト"""

import math
import sys
import tempfile
from pathlib import Path

# パス設定
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PROJECT_ROOT))
_SKILLS_DIR = _PROJECT_ROOT / ".agent" / "skills"
sys.path.insert(0, str(_SKILLS_DIR))
sys.path.insert(0, str(_SKILLS_DIR / "ab-test-analyzer"))

import pandas as pd

# テスト対象モジュール
from importlib import import_module
analyze_mod = import_module("analyze", package=None)
# フォールバック: 直接パスでインポート
if not hasattr(analyze_mod, "z_test_proportions"):
    sys.path.insert(0, str(_SKILLS_DIR / "ab-test-analyzer"))
    import importlib
    spec = importlib.util.spec_from_file_location(
        "ab_analyze", _SKILLS_DIR / "ab-test-analyzer" / "analyze.py"
    )
    analyze_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(analyze_mod)


def test_z_test_proportions_basic():
    """Z検定: 基本的な比率差検定。"""
    # バリアントA: 100/1000 = 10%, バリアントB: 150/1000 = 15%
    result = analyze_mod.z_test_proportions(100, 1000, 150, 1000)

    assert abs(result["rate_a"] - 0.10) < 1e-6
    assert abs(result["rate_b"] - 0.15) < 1e-6
    assert abs(result["diff"] - 0.05) < 1e-6
    assert abs(result["relative_diff"] - 50.0) < 1e-6
    # p値は小さいはず（有意差あり）
    assert result["p_value"] < 0.05
    print("  [PASS] Z検定: 基本テスト")


def test_z_test_proportions_no_difference():
    """Z検定: 差がない場合。"""
    result = analyze_mod.z_test_proportions(100, 1000, 100, 1000)

    assert abs(result["diff"]) < 1e-6
    assert result["p_value"] > 0.05  # 有意差なし
    print("  [PASS] Z検定: 差なしテスト")


def test_z_test_proportions_zero_trials():
    """Z検定: 試行数0の場合。"""
    result = analyze_mod.z_test_proportions(0, 0, 0, 0)

    assert result["rate_a"] == 0
    assert result["rate_b"] == 0
    assert result["z_stat"] == 0
    print("  [PASS] Z検定: ゼロ試行テスト")


def test_chi_square_test():
    """カイ二乗検定: 基本テスト。"""
    # 有意差がある場合
    result = analyze_mod.chi_square_test(100, 1000, 150, 1000)

    assert result["chi2"] > 0
    assert result["p_value"] < 0.05
    assert result["dof"] == 1
    print("  [PASS] カイ二乗検定: 基本テスト")


def test_chi_square_test_no_difference():
    """カイ二乗検定: 差がない場合。"""
    result = analyze_mod.chi_square_test(100, 1000, 100, 1000)

    assert result["p_value"] > 0.05
    print("  [PASS] カイ二乗検定: 差なしテスト")


def test_wilson_confidence_interval():
    """Wilson信頼区間: 基本テスト。"""
    lower, upper = analyze_mod.wilson_confidence_interval(100, 1000, 0.95)

    # 10%の周囲にあるはず
    assert lower < 0.10
    assert upper > 0.10
    assert lower > 0
    assert upper < 1
    # 区間の幅は妥当な範囲
    assert (upper - lower) < 0.05
    print("  [PASS] Wilson信頼区間: 基本テスト")


def test_wilson_confidence_interval_zero():
    """Wilson信頼区間: n=0の場合。"""
    lower, upper = analyze_mod.wilson_confidence_interval(0, 0, 0.95)

    assert lower == 0.0
    assert upper == 0.0
    print("  [PASS] Wilson信頼区間: ゼロテスト")


def test_required_sample_size():
    """必要サンプルサイズ: 基本テスト。"""
    n = analyze_mod.required_sample_size(0.10, mde=0.10)

    # 妥当な範囲のサンプルサイズ
    assert n > 0
    assert n < 1000000
    print(f"  [PASS] 必要サンプルサイズ: {n:,} (baseline=10%, MDE=10%)")


def test_required_sample_size_edge():
    """必要サンプルサイズ: エッジケース。"""
    assert analyze_mod.required_sample_size(0, mde=0.1) == 0
    assert analyze_mod.required_sample_size(0.5, mde=0) == 0
    assert analyze_mod.required_sample_size(1.0, mde=0.1) == 0
    print("  [PASS] 必要サンプルサイズ: エッジケース")


def test_detect_variant_column():
    """バリアント列自動検出テスト。"""
    df = pd.DataFrame({
        "バリアント": ["A", "B"],
        "クリック数": [100, 150],
    })
    result = analyze_mod.detect_variant_column(df)
    assert result == "バリアント"
    print("  [PASS] バリアント列検出: 日本語")

    df2 = pd.DataFrame({
        "Variant": ["A", "B"],
        "Clicks": [100, 150],
    })
    result2 = analyze_mod.detect_variant_column(df2)
    assert result2 == "Variant"
    print("  [PASS] バリアント列検出: 英語")


def test_detect_metric_columns():
    """指標列自動検出テスト。"""
    df = pd.DataFrame({
        "バリアント": ["A"],
        "表示回数": [1000],
        "クリック数": [100],
        "CV": [10],
        "費用": [50000],
    })
    result = analyze_mod.detect_metric_columns(df)
    assert "impr" in result
    assert "click" in result
    assert "cv" in result
    assert "cost" in result
    print("  [PASS] 指標列検出: 4指標")


def test_csv_read():
    """CSVファイル読み込みテスト。"""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8") as f:
        f.write("バリアント,表示回数,クリック数,CV,費用\n")
        f.write("A,10000,500,50,100000\n")
        f.write("B,10000,600,70,100000\n")
        csv_path = Path(f.name)

    df = pd.read_csv(csv_path, encoding="utf-8")
    assert len(df) == 2
    assert analyze_mod.detect_variant_column(df) == "バリアント"

    metrics = analyze_mod.detect_metric_columns(df)
    assert len(metrics) == 4

    csv_path.unlink()
    print("  [PASS] CSV読み込み: 正常")


if __name__ == "__main__":
    print("=" * 50)
    print("  ab-test-analyzer テスト")
    print("=" * 50)

    tests = [
        test_z_test_proportions_basic,
        test_z_test_proportions_no_difference,
        test_z_test_proportions_zero_trials,
        test_chi_square_test,
        test_chi_square_test_no_difference,
        test_wilson_confidence_interval,
        test_wilson_confidence_interval_zero,
        test_required_sample_size,
        test_required_sample_size_edge,
        test_detect_variant_column,
        test_detect_metric_columns,
        test_csv_read,
    ]

    passed = 0
    failed = 0
    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            print(f"  [FAIL] {test.__name__}: {e}")
            failed += 1

    print(f"\n結果: {passed} passed, {failed} failed / {len(tests)} total")
    sys.exit(1 if failed > 0 else 0)
