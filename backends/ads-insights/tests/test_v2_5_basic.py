"""
V2.5基本テスト - CV値・売上の取り込み確認

Usage:
    python tests/test_v2_5_basic.py
"""
import sys
from pathlib import Path

# プロジェクトルートをパスに追加
sys.path.insert(0, str(Path(__file__).parent.parent / "web" / "app"))

from data_providers.mock_provider import MockProvider


def test_conversion_value_extraction():
    """MockProviderでCV値を取得できることを確認"""
    print("[TEST] test_conversion_value_extraction...")
    provider = MockProvider()
    report = provider.extract_single("2025-11")

    assert report is not None, "ReportData should not be None"

    cv_value = report.get_kpi("conversion_value")
    assert cv_value is not None, "conversion_value should not be None"
    assert cv_value == 750000.0, f"Expected conversion_value=750000.0, got {cv_value}"

    print("  [PASS] test_conversion_value_extraction")


def test_revenue_extraction():
    """MockProviderで売上を取得できることを確認"""
    print("[TEST] test_revenue_extraction...")
    provider = MockProvider()
    report = provider.extract_single("2025-11")

    assert report is not None, "ReportData should not be None"

    revenue = report.get_kpi("revenue")
    assert revenue is not None, "revenue should not be None"
    assert revenue == 800000.0, f"Expected revenue=800000.0, got {revenue}"

    print("  [PASS] test_revenue_extraction")


def test_both_cv_value_and_revenue():
    """CV値と売上の両方が取得できることを確認"""
    print("[TEST] test_both_cv_value_and_revenue...")
    provider = MockProvider()
    report = provider.extract_single("2025-12")

    assert report is not None, "ReportData should not be None"

    cv_value = report.get_kpi("conversion_value")
    revenue = report.get_kpi("revenue")

    assert cv_value is not None, "conversion_value should not be None"
    assert revenue is not None, "revenue should not be None"
    assert cv_value == 900000.0, f"Expected conversion_value=900000.0, got {cv_value}"
    assert revenue == 960000.0, f"Expected revenue=960000.0, got {revenue}"

    print("  [PASS] test_both_cv_value_and_revenue")


def test_backward_compatibility():
    """既存KPIが引き続き動作することを確認"""
    print("[TEST] test_backward_compatibility...")
    provider = MockProvider()
    report = provider.extract_single("2025-11")

    assert report.get_kpi("cost") == 500000.0, "cost should work"
    assert report.get_kpi("impr") == 100000.0, "impr should work"
    assert report.get_kpi("click") == 5000.0, "click should work"
    assert report.get_kpi("cv") == 250.0, "cv should work"
    assert report.get_kpi("ctr") == 0.05, "ctr should work"
    assert report.get_kpi("cvr") == 0.05, "cvr should work"
    assert report.get_kpi("cpa") == 2000.0, "cpa should work"
    assert report.get_kpi("cpc") == 100.0, "cpc should work"

    print("  [PASS] test_backward_compatibility")


def test_weekly_period_with_new_kpis():
    """週次レポートで新KPIが取得できることを確認"""
    print("[TEST] test_weekly_period_with_new_kpis...")
    provider = MockProvider()
    report = provider.extract_single("2025-W48")

    assert report is not None, "ReportData should not be None"
    assert report.period_type == "weekly", f"Expected weekly, got {report.period_type}"

    cv_value = report.get_kpi("conversion_value")
    revenue = report.get_kpi("revenue")

    assert cv_value == 195000.0, f"Expected conversion_value=195000.0, got {cv_value}"
    assert revenue == 208000.0, f"Expected revenue=208000.0, got {revenue}"

    print("  [PASS] test_weekly_period_with_new_kpis")


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("Running V2.5 Basic Tests")
    print("=" * 60 + "\n")

    try:
        test_conversion_value_extraction()
        test_revenue_extraction()
        test_both_cv_value_and_revenue()
        test_backward_compatibility()
        test_weekly_period_with_new_kpis()

        print("\n" + "=" * 60)
        print("All V2.5 tests passed!")
        print("=" * 60 + "\n")
        sys.exit(0)

    except AssertionError as e:
        print("\n" + "=" * 60)
        print(f"Test failed: {e}")
        print("=" * 60 + "\n")
        sys.exit(1)

    except Exception as e:
        print("\n" + "=" * 60)
        print(f"Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        print("=" * 60 + "\n")
        sys.exit(1)
