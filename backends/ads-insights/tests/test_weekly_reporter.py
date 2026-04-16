"""weekly-reporter のユニットテスト"""

import sys
import tempfile
from pathlib import Path

# パス設定
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PROJECT_ROOT))
_SKILLS_DIR = _PROJECT_ROOT / ".agent" / "skills"
sys.path.insert(0, str(_SKILLS_DIR))
sys.path.insert(0, str(_SKILLS_DIR / "weekly-reporter"))

import pandas as pd

# テスト対象モジュール
import importlib.util
spec = importlib.util.spec_from_file_location(
    "weekly_analyze", _SKILLS_DIR / "weekly-reporter" / "analyze.py"
)
analyze_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analyze_mod)


def _make_daily_df():
    """テスト用の日別データを作成。"""
    dates = pd.date_range("2025-11-10", "2025-11-23", freq="D")
    data = {
        "日付": dates,
        "費用": [10000 + i * 500 for i in range(len(dates))],
        "表示回数": [5000 + i * 200 for i in range(len(dates))],
        "クリック数": [500 + i * 20 for i in range(len(dates))],
        "CV": [50 + i * 2 for i in range(len(dates))],
    }
    return pd.DataFrame(data)


def test_detect_date_column():
    """日付列自動検出テスト。"""
    df = _make_daily_df()
    result = analyze_mod.detect_date_column(df)
    assert result == "日付"
    print("  [PASS] 日付列検出: 日本語")

    df2 = df.rename(columns={"日付": "Date"})
    result2 = analyze_mod.detect_date_column(df2)
    assert result2 == "Date"
    print("  [PASS] 日付列検出: 英語")


def test_detect_metric_columns():
    """指標列自動検出テスト。"""
    df = _make_daily_df()
    result = analyze_mod.detect_metric_columns(df)
    assert "cost" in result
    assert "impr" in result
    assert "click" in result
    assert "cv" in result
    print("  [PASS] 指標列検出: 4指標")


def test_aggregate_weekly():
    """週次集約テスト。"""
    df = _make_daily_df()
    metric_map = analyze_mod.detect_metric_columns(df)
    weekly = analyze_mod.aggregate_weekly(df, "日付", metric_map)

    assert len(weekly) == 2  # 2週分
    assert "week_label" in weekly.columns
    assert "cost" in weekly.columns
    assert "ctr" in weekly.columns
    assert "cvr" in weekly.columns

    # 派生指標が計算されていることを確認
    for _, row in weekly.iterrows():
        if row["impr"] > 0:
            expected_ctr = row["click"] / row["impr"]
            assert abs(row["ctr"] - expected_ctr) < 1e-6, f"CTR mismatch: {row['ctr']} vs {expected_ctr}"
        if row["click"] > 0:
            expected_cvr = row["cv"] / row["click"]
            assert abs(row["cvr"] - expected_cvr) < 1e-6, f"CVR mismatch: {row['cvr']} vs {expected_cvr}"

    print("  [PASS] 週次集約: 正常")


def test_aggregate_weekly_derived_metrics():
    """週次集約の派生指標計算テスト（暗算禁止の検証）。"""
    df = _make_daily_df()
    metric_map = analyze_mod.detect_metric_columns(df)
    weekly = analyze_mod.aggregate_weekly(df, "日付", metric_map)

    for _, row in weekly.iterrows():
        # CPA = cost / cv
        if row.get("cv", 0) > 0:
            expected_cpa = row["cost"] / row["cv"]
            assert abs(row["cpa"] - expected_cpa) < 1e-6
        # CPC = cost / click
        if row.get("click", 0) > 0:
            expected_cpc = row["cost"] / row["click"]
            assert abs(row["cpc"] - expected_cpc) < 1e-6

    print("  [PASS] 派生指標計算: CPA/CPC")


def test_calculate_wow():
    """WoW計算テスト。"""
    df = _make_daily_df()
    metric_map = analyze_mod.detect_metric_columns(df)
    weekly = analyze_mod.aggregate_weekly(df, "日付", metric_map)
    wow = analyze_mod.calculate_wow(weekly)

    assert wow  # 空でない
    assert "cost" in wow
    assert "current" in wow["cost"]
    assert "previous" in wow["cost"]
    assert "diff" in wow["cost"]
    assert "pct_change" in wow["cost"]

    # diff = current - previous
    assert abs(wow["cost"]["diff"] - (wow["cost"]["current"] - wow["cost"]["previous"])) < 1e-6
    print("  [PASS] WoW計算: 基本テスト")


def test_calculate_wow_pct():
    """WoW変化率の正確性テスト。"""
    df = _make_daily_df()
    metric_map = analyze_mod.detect_metric_columns(df)
    weekly = analyze_mod.aggregate_weekly(df, "日付", metric_map)
    wow = analyze_mod.calculate_wow(weekly)

    for key in ["cost", "impr", "click", "cv"]:
        if key in wow:
            prev = wow[key]["previous"]
            diff = wow[key]["diff"]
            pct = wow[key]["pct_change"]
            if prev != 0:
                expected_pct = diff / prev * 100
                assert abs(pct - expected_pct) < 1e-6, f"{key} pct_change: {pct} vs {expected_pct}"

    print("  [PASS] WoW計算: 変化率")


def test_calculate_wow_target_week():
    """WoW: 特定週指定テスト。"""
    df = _make_daily_df()
    metric_map = analyze_mod.detect_metric_columns(df)
    weekly = analyze_mod.aggregate_weekly(df, "日付", metric_map)

    # 最後の週を指定
    last_week = weekly["week_label"].iloc[-1]
    wow = analyze_mod.calculate_wow(weekly, target_week=last_week)

    assert wow
    assert wow.get("_current_week") == last_week
    print("  [PASS] WoW計算: 週指定")


def test_calculate_wow_single_week():
    """WoW: 1週分しかない場合。"""
    dates = pd.date_range("2025-11-10", "2025-11-16", freq="D")
    df = pd.DataFrame({
        "日付": dates,
        "費用": [10000] * len(dates),
        "表示回数": [5000] * len(dates),
        "クリック数": [500] * len(dates),
        "CV": [50] * len(dates),
    })
    metric_map = analyze_mod.detect_metric_columns(df)
    weekly = analyze_mod.aggregate_weekly(df, "日付", metric_map)
    wow = analyze_mod.calculate_wow(weekly)

    assert wow == {}  # 1週分しかなければ空
    print("  [PASS] WoW計算: 1週のみ")


def test_csv_read_cp932():
    """CP932エンコードCSV読み込みテスト。"""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="cp932") as f:
        f.write("日付,費用,表示回数,クリック数,CV\n")
        f.write("2025-11-10,10000,5000,500,50\n")
        f.write("2025-11-11,10500,5200,520,52\n")
        csv_path = Path(f.name)

    # UTF-8で読めないが cp932 で読めるはず
    try:
        df = pd.read_csv(csv_path, encoding="utf-8")
    except UnicodeDecodeError:
        df = pd.read_csv(csv_path, encoding="cp932")

    assert len(df) == 2
    csv_path.unlink()
    print("  [PASS] CSV読み込み: CP932")


if __name__ == "__main__":
    print("=" * 50)
    print("  weekly-reporter テスト")
    print("=" * 50)

    tests = [
        test_detect_date_column,
        test_detect_metric_columns,
        test_aggregate_weekly,
        test_aggregate_weekly_derived_metrics,
        test_calculate_wow,
        test_calculate_wow_pct,
        test_calculate_wow_target_week,
        test_calculate_wow_single_week,
        test_csv_read_cp932,
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
