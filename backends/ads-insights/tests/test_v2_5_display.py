"""
V2.5表示テスト - CV値・売上がMarkdownに表示されることを確認

Usage:
    python tests/test_v2_5_display.py
"""
import sys
from pathlib import Path

# プロジェクトルートをパスに追加
app_path = Path(__file__).parent.parent / "web" / "app"
sys.path.insert(0, str(app_path))

# バックエンドディレクトリから直接インポート
import os
os.chdir(str(app_path))

from data_providers.mock_provider import MockProvider
import point_pack_generator


def test_new_kpis_in_markdown():
    """新しいKPIが要点パックMarkdownに表示されることを確認"""
    print("[TEST] test_new_kpis_in_markdown...")

    provider = MockProvider()
    current = provider.extract_single("2025-12")
    base = provider.extract_single("2025-11")

    md = point_pack_generator.generate_point_pack_md(current, base, client_name="TestClient")

    # CV値と売上が含まれていることを確認
    assert "CV値" in md, "CV値 should appear in markdown"
    assert "売上" in md, "売上 should appear in markdown"

    # 数値が含まれていることを確認（円記号付き）
    assert "¥900,000" in md, "conversion_value (¥900,000) should appear"
    assert "¥960,000" in md, "revenue (¥960,000) should appear"

    print("  [PASS] test_new_kpis_in_markdown")


def test_kpi_display_order():
    """KPI_DISPLAYの順序が正しいことを確認"""
    print("[TEST] test_kpi_display_order...")

    expected_order = [
        ("cost", "費用"),
        ("impr", "表示回数"),
        ("click", "クリック"),
        ("cv", "CV"),
        ("conversion_value", "CV値"),
        ("revenue", "売上"),
        ("ctr", "CTR"),
        ("cvr", "CVR"),
        ("cpa", "CPA"),
        ("cpc", "CPC"),
    ]

    from point_pack_generator import KPI_DISPLAY

    assert KPI_DISPLAY == expected_order, f"KPI_DISPLAY order mismatch:\nExpected: {expected_order}\nActual: {KPI_DISPLAY}"

    print("  [PASS] test_kpi_display_order")


def test_fmt_value_for_new_kpis():
    """fmt_value()が新しいKPIを正しくフォーマットすることを確認"""
    print("[TEST] test_fmt_value_for_new_kpis...")

    from point_pack_generator import fmt_value

    # conversion_value（通貨フォーマット）
    result = fmt_value(750000.0, kpi_key="conversion_value")
    assert result == "¥750,000", f"Expected ¥750,000, got {result}"

    # revenue（通貨フォーマット）
    result = fmt_value(960000.0, kpi_key="revenue")
    assert result == "¥960,000", f"Expected ¥960,000, got {result}"

    print("  [PASS] test_fmt_value_for_new_kpis")


def test_aggregate_includes_new_kpis():
    """aggregate_multi_month_kpis()が新KPIを集計することを確認"""
    print("[TEST] test_aggregate_includes_new_kpis...")

    from point_pack_generator import aggregate_multi_month_kpis
    provider = MockProvider()

    reports = [
        ("2025-12", provider.extract_single("2025-12")),
        ("2025-11", provider.extract_single("2025-11")),
        ("2025-10", provider.extract_single("2025-10")),
    ]

    totals = aggregate_multi_month_kpis(reports)

    # CV値の合計（900,000 + 750,000 + 675,000 = 2,325,000）
    expected_cv_value = 900000.0 + 750000.0 + 675000.0
    actual_cv_value = totals.get_kpi("conversion_value")
    assert actual_cv_value == expected_cv_value, f"Expected conversion_value={expected_cv_value}, got {actual_cv_value}"

    # 売上の合計（960,000 + 800,000 + 720,000 = 2,480,000）
    expected_revenue = 960000.0 + 800000.0 + 720000.0
    actual_revenue = totals.get_kpi("revenue")
    assert actual_revenue == expected_revenue, f"Expected revenue={expected_revenue}, got {actual_revenue}"

    print("  [PASS] test_aggregate_includes_new_kpis")


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("Running V2.5 Display Tests")
    print("=" * 60 + "\n")

    try:
        test_kpi_display_order()
        test_fmt_value_for_new_kpis()
        test_aggregate_includes_new_kpis()
        test_new_kpis_in_markdown()

        print("\n" + "=" * 60)
        print("All V2.5 display tests passed!")
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
