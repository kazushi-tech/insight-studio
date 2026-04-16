import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from temp_report_logic import sum_extract_results, ExtractResult, ExtractMeta, KPI_SPECS

def make_dummy_result(cost=None, cv=None):
    kpis = {k: None for k, _, _ in KPI_SPECS}
    kpis["cost"] = cost
    kpis["cv"] = cv
    
    meta = ExtractMeta(file="dummy.xlsx", sheet="Sheet1", method="table", refs={}, rows=10, cols=10)
    key_totals = {"cost": cost, "cv": cv}
    return ExtractResult(kpis=kpis, meta=meta, key_totals=key_totals)

def test_sum_basic():
    r1 = make_dummy_result(cost=100.0, cv=10.0)
    r2 = make_dummy_result(cost=200.0, cv=5.0)
    
    res = sum_extract_results([r1, r2])
    
    # 期待値: cost=300, cv=15
    assert res.kpis["cost"] == 300.0, f"Expected cost 300, got {res.kpis['cost']}"
    assert res.kpis["cv"] == 15.0, f"Expected cv 15, got {res.kpis['cv']}"
    print("[PASS] test_sum_basic")

def test_sum_with_none():
    r1 = make_dummy_result(cost=100.0, cv=None)  # CVなし
    r2 = make_dummy_result(cost=50.0, cv=5.0)
    r3 = make_dummy_result(cost=None, cv=None)   # 全部なし
    
    res = sum_extract_results([r1, r2, r3])
    
    # 期待値: cost=150 (100+50+None), cv=5 (None+5+None)
    assert res.kpis["cost"] == 150.0, f"Expected cost 150, got {res.kpis['cost']}"
    assert res.kpis["cv"] == 5.0, f"Expected cv 5, got {res.kpis['cv']}"
    
    # 全部Noneの項目(clickとか)はNoneのままか
    assert res.kpis["click"] is None, "Expected click to be None"
    
    print("[PASS] test_sum_with_none")

def test_empty_input():
    res = sum_extract_results([])
    # 全部Noneで返るはず
    assert res.kpis["cost"] is None
    print("[PASS] test_empty_input")

if __name__ == "__main__":
    try:
        test_sum_basic()
        test_sum_with_none()
        test_empty_input()
        print("All tests passed!")
    except AssertionError as e:
        print(f"[FAIL] {e}")
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] {e}")
        sys.exit(1)
