# fix-render-monorepo.ps1
# market-lens-ai の Render設定を修正（rootDir + build/start command）
# 前回のバグ: rootDir が PATCH body に含まれておらず、設定がクリアされていた

$ErrorActionPreference = "Stop"

Write-Host "`n=== Fix market-lens-ai (rootDir included) ===" -ForegroundColor Cyan

$apiKey = Read-Host "Render API Key" -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($apiKey)
$token = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)

if (-not $token.StartsWith("rnd_")) {
    Write-Host "API key は rnd_ で始まる必要があります" -ForegroundColor Red
    exit 1
}

$headers = @{
    "Accept"       = "application/json"
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json"
}

$SERVICE_ID = "srv-d6v2odua2pns73aat9bg"

# PATCH body — rootDir を必ず含める（省略するとクリアされる）
$body = @{
    rootDir      = "backends/market-lens-ai"
    buildCommand = "pip install -r requirements.txt"
    startCommand = "alembic upgrade head && uvicorn web.app.main:app --host 0.0.0.0 --port `$PORT"
} | ConvertTo-Json

Write-Host "`n[1] サービス設定を更新中..." -ForegroundColor Yellow
Write-Host "  rootDir:      backends/market-lens-ai" -ForegroundColor Gray
Write-Host "  buildCommand: pip install -r requirements.txt" -ForegroundColor Gray
Write-Host "  startCommand: alembic upgrade head && uvicorn ..." -ForegroundColor Gray

try {
    $result = Invoke-WebRequest -Uri "https://api.render.com/v1/services/$SERVICE_ID" -Method PATCH -Headers $headers -Body $body -UseBasicParsing
    Write-Host "  OK ($($result.StatusCode))" -ForegroundColor Green

    # レスポンスから rootDir が正しく設定されたか確認
    $json = $result.Content | ConvertFrom-Json
    $serviceDetails = $json.service
    if ($serviceDetails) {
        Write-Host "  rootDir確認: $($serviceDetails.rootDir)" -ForegroundColor Cyan
    }
} catch {
    Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host "  Detail: $($reader.ReadToEnd())" -ForegroundColor Red
    } catch {}
    exit 1
}

# デプロイ実行
Write-Host "`n[2] デプロイ開始..." -ForegroundColor Yellow
$deployBody = '{}'
try {
    $deploy = Invoke-WebRequest -Uri "https://api.render.com/v1/services/$SERVICE_ID/deploys" -Method POST -Headers $headers -Body $deployBody -UseBasicParsing
    Write-Host "  デプロイ開始 ($($deploy.StatusCode))" -ForegroundColor Green
    $deployJson = $deploy.Content | ConvertFrom-Json
    $deployId = $deployJson.id
    if ($deployId) {
        Write-Host "  Deploy ID: $deployId" -ForegroundColor Cyan
    }
} catch {
    Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host "  Detail: $($reader.ReadToEnd())" -ForegroundColor Red
    } catch {}
    exit 1
}

Remove-Variable token, BSTR, apiKey -ErrorAction SilentlyContinue
[GC]::Collect()

Write-Host "`n=== 完了 ===" -ForegroundColor Cyan
Write-Host "3-5分後に Render Dashboard でビルドログを確認" -ForegroundColor Yellow
Write-Host "https://dashboard.render.com/`n"
