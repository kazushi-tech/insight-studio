# check-render-logs.ps1
# market-lens-ai の最新デプロイログを取得（デバッグ版）

$ErrorActionPreference = "Stop"

Write-Host "`n=== Render Deploy Logs Checker ===" -ForegroundColor Cyan

$apiKey = Read-Host "Render API Key" -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($apiKey)
$token = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)

$headers = @{
    "Accept" = "application/json"
    "Authorization" = "Bearer $token"
}

$SERVICE_ID = "srv-d6v2odua2pns73aat9bg"

# Step 1: Get deploys (raw JSON)
Write-Host "`n[1] デプロイ一覧..." -ForegroundColor Yellow
try {
    $resp = Invoke-WebRequest -Uri "https://api.render.com/v1/services/$SERVICE_ID/deploys?limit=3" -Headers $headers -UseBasicParsing
    Write-Host $resp.Content
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host $reader.ReadToEnd()
    } catch {}
    exit 1
}

# Step 2: Get deploy details (raw JSON)
$deployId = "dep-d7g41me7r5hc73d1p9lg"
Write-Host "`n[2] デプロイ詳細 ($deployId)..." -ForegroundColor Yellow
try {
    $resp2 = Invoke-WebRequest -Uri "https://api.render.com/v1/services/$SERVICE_ID/deploys/$deployId" -Headers $headers -UseBasicParsing
    Write-Host $resp2.Content
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

# Step 3: Try the global deploy endpoint
Write-Host "`n[3] Global deploy endpoint..." -ForegroundColor Yellow
try {
    $resp3 = Invoke-WebRequest -Uri "https://api.render.com/v1/deploys/$deployId" -Headers $headers -UseBasicParsing
    Write-Host $resp3.Content
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

Remove-Variable token, BSTR, apiKey -ErrorAction SilentlyContinue
[GC]::Collect()
Write-Host "`n=== Done ===" -ForegroundColor Cyan
