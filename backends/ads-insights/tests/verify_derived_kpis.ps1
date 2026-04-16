# verify_derived_kpis.ps1
# 派生指標計算のunit testを実行

$ENV:PYTHONPATH = ".\web\app"
.\.venv\Scripts\python.exe -c @'
from report_data import ReportData, ExtractMeta

# ダミーデータを使って派生指標計算をテスト
meta = ExtractMeta(
    file="test.xlsx",
    sheet="Sheet1",
    method="manual",
    refs={},
    rows=1,
    cols=4,
)

# 基本KPIを設定
kpis = {
    "cost": 100000.0,
    "impr": 50000.0,
    "click": 2500.0,
    "cv": 100.0,
}

report = ReportData(kpis=kpis, meta=meta, month_tag="2025-11")

print("--- Before compute_derived_kpis ---")
print(f"ctr: {report.get_kpi('ctr')}")
print(f"cvr: {report.get_kpi('cvr')}")
print(f"cpa: {report.get_kpi('cpa')}")
print(f"cpc: {report.get_kpi('cpc')}")

# 派生指標を計算
report.compute_derived_kpis()

print("")
print("--- After compute_derived_kpis ---")
print(f"ctr: {report.get_kpi('ctr')} (should be 0.05 = 2500/50000)")
print(f"cvr: {report.get_kpi('cvr')} (should be 0.04 = 100/2500)")
print(f"cpa: {report.get_kpi('cpa')} (should be 1000 = 100000/100)")
print(f"cpc: {report.get_kpi('cpc')} (should be 40 = 100000/2500)")

print("")
print("--- Evidence ---")
for key in ["ctr", "cvr", "cpa", "cpc"]:
    print(f"{key}: {report.evidence.get(key, '')}")

# 検証
success = True
expected = {
    "ctr": 0.05,
    "cvr": 0.04,
    "cpa": 1000.0,
    "cpc": 40.0,
}

for key, exp_val in expected.items():
    actual = report.get_kpi(key)
    if actual is None:
        print(f"[FAIL] {key} is None")
        success = False
    elif abs(actual - exp_val) > 0.001:
        print(f"[FAIL] {key}: expected {exp_val}, got {actual}")
        success = False

if success:
    print("")
    print("✅ SUCCESS: Derived KPI calculations are correct")
else:
    print("")
    print("❌ FAIL: Derived KPI calculations have errors")
    exit(1)
'@
