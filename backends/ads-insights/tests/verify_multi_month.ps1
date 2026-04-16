# verify_multi_month.ps1
# 複数月のKPI集計と合計計算を検証

$ENV:PYTHONPATH = ".\web\app"
.\.venv\Scripts\python.exe -c @"
from pathlib import Path
from kpi_extractor import extract_from_excel
from point_pack_generator import generate_multi_month_point_pack_md, aggregate_multi_month_kpis

# テスト案件の全XLSXファイルを取得
data_dir = Path('G:/マイドライブ/ads-insights/data/テスト案件')
xlsx_files = sorted(list(data_dir.glob('*.xlsx')))

if len(xlsx_files) == 0:
    print('ERROR: No XLSX files found')
    exit(1)

print(f'Found {len(xlsx_files)} XLSX file(s)')
print('')

reports = []
for xlsx in xlsx_files:
    try:
        report = extract_from_excel(xlsx, fail_fast=False)
        reports.append((report.month_tag, report))
        print(f'Loaded: {report.month_tag} from {xlsx.name}')
    except Exception as e:
        print(f'WARN: Failed to load {xlsx.name}: {e}')

if len(reports) == 0:
    print('ERROR: No reports could be loaded')
    exit(1)

# 新しい順にソート
reports.sort(key=lambda x: x[0], reverse=True)

print(f'')
print(f'--- {len(reports)} months loaded ---')
for tag, r in reports:
    impr = r.get_kpi('impr')
    click = r.get_kpi('click')
    cost = r.get_kpi('cost')
    cv = r.get_kpi('cv')
    ctr = r.get_kpi('ctr')
    cvr = r.get_kpi('cvr')
    cpa = r.get_kpi('cpa')
    print(f'{tag}: impr={impr}, click={click}, cost={cost}, cv={cv}')
    print(f'       ctr={ctr}, cvr={cvr}, cpa={cpa}')

# 総計計算
print('')
print('--- Totals Calculation ---')
totals = aggregate_multi_month_kpis(reports)
print(f'Period: {totals.month_tag}')
print('')
print('Basic KPIs (sum):')
for key in ['impr', 'click', 'cost', 'cv']:
    v = totals.get_kpi(key)
    print(f'  {key}: {v}')

print('')
print('Derived KPIs (recalculated):')
for key in ['ctr', 'cvr', 'cpa', 'cpc']:
    v = totals.get_kpi(key)
    evidence = totals.evidence.get(key, '')
    print(f'  {key}: {v} ({evidence})')

# Markdown生成
print('')
print('--- Markdown Generation ---')
md = generate_multi_month_point_pack_md(reports, 'テスト案件')
print(f'Generated {len(md)} characters')
print('')
print('--- First 1200 chars ---')
print(md[:1200])

# チェック: 総計の派生指標が計算されているか
print('')
success = True
for key in ['ctr', 'cvr', 'cpa', 'cpc']:
    v = totals.get_kpi(key)
    if v is None:
        print(f'[FAIL] Totals {key} is None')
        success = False

# Markdownに「未取得」が含まれていないかチェック（合計列のみ）
if '**-**' in md or '**未取得**' in md:
    print('[WARN] Markdown contains 未取得 in totals column')
    # これは警告のみ（月別は未取得があっても許容）

if success:
    print('✅ SUCCESS: All derived KPIs in totals are calculated')
else:
    print('❌ FAIL: Some derived KPIs in totals are missing')
    exit(1)
"@
