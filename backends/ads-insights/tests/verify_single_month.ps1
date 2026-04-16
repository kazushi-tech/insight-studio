# verify_single_month.ps1
# 単月のKPI抽出と派生指標計算を検証

$ENV:PYTHONPATH = ".\web\app"
.\.venv\Scripts\python.exe -c @"
from pathlib import Path
from kpi_extractor import extract_from_excel
from point_pack_generator import generate_point_pack_md

# テスト案件の1ヶ月分のExcel
data_dir = Path('G:/マイドライブ/ads-insights/data/テスト案件')
xlsx_files = list(data_dir.glob('*.xlsx'))

if not xlsx_files:
    print('ERROR: No XLSX files found in', str(data_dir))
    exit(1)

xlsx = xlsx_files[0]
print(f'Testing with: {xlsx.name}')
print('')

# KPI抽出
current = extract_from_excel(xlsx, fail_fast=False)

print('--- Basic KPIs ---')
for key in ['cost', 'impr', 'click', 'cv']:
    v = current.get_kpi(key)
    print(f'{key}: {v}')

print('')
print('--- Derived KPIs ---')
for key in ['ctr', 'cvr', 'cpa', 'cpc']:
    v = current.get_kpi(key)
    evidence = current.evidence.get(key, '')
    print(f'{key}: {v} ({evidence})')

print('')
print('--- Markdown Generation Test ---')
md = generate_point_pack_md(current, None, 'テスト案件')
print(f'Generated {len(md)} characters')
print('')
print('--- First 800 chars ---')
print(md[:800])

# チェック: CTR/CVR/CPA/CPCが計算されているか
success = True
for key in ['ctr', 'cvr', 'cpa', 'cpc']:
    v = current.get_kpi(key)
    if v is None:
        print(f'[FAIL] {key} is None')
        success = False

if success:
    print('')
    print('✅ SUCCESS: All derived KPIs calculated')
else:
    print('')
    print('❌ FAIL: Some derived KPIs are missing')
    exit(1)
"@
