# 全サービス一括起動スクリプト
# Frontend (port 3002) + ML backend (port 8002) + Ads backend (port 8001)

$repo = $PSScriptRoot

# Market Lens Backend
$ml = Start-Process python -ArgumentList "-m", "uvicorn", "web.app.main:app",
  "--host", "127.0.0.1", "--port", "8002", "--reload" `
  -WorkingDirectory "$repo\backends\market-lens-ai" -PassThru

# Ads Insights Backend
$ads = Start-Process python -ArgumentList "-m", "uvicorn", "web.app.backend_api:app",
  "--host", "127.0.0.1", "--port", "8001", "--reload", "--timeout-keep-alive", "300" `
  -WorkingDirectory "$repo\backends\ads-insights" -PassThru

# Frontend
npm run dev

# Cleanup
Stop-Process -Id $ml.Id, $ads.Id -ErrorAction SilentlyContinue
