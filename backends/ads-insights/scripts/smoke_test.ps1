#!/usr/bin/env pwsh
# Smoke test for ads-insights backend API endpoints
# Purpose: Verify all critical endpoints return 200 OK

Write-Host "🔍 Starting smoke test for ads-insights backend..." -ForegroundColor Cyan

$BASE_URL = "http://localhost:8001"
$PASS_COUNT = 0
$FAIL_COUNT = 0

function Test-Endpoint {
    param(
        [string]$Path,
        [string]$Method = "GET",
        [string]$Body = $null
    )
    
    Write-Host "Testing $Method $Path ... " -NoNewline
    
    try {
        if ($Method -eq "GET") {
            $response = Invoke-WebRequest -Uri "$BASE_URL$Path" -Method GET -ErrorAction Stop
        }
        else {
            $headers = @{"Content-Type" = "application/json" }
            $response = Invoke-WebRequest -Uri "$BASE_URL$Path" -Method POST -Body $Body -Headers $headers -ErrorAction Stop
        }
        
        if ($response.StatusCode -eq 200) {
            Write-Host "✅ PASS" -ForegroundColor Green
            $script:PASS_COUNT++
            return $true
        }
        else {
            Write-Host "❌ FAIL (Status: $($response.StatusCode))" -ForegroundColor Red
            $script:FAIL_COUNT++
            return $false
        }
    }
    catch {
        Write-Host "❌ FAIL (Error: $($_.Exception.Message))" -ForegroundColor Red
        $script:FAIL_COUNT++
        return $false
    }
}

# Test critical endpoints
Write-Host "`n📋 Testing READ endpoints..." -ForegroundColor Yellow
Test-Endpoint "/api/health"
Test-Endpoint "/api/folders"
Test-Endpoint "/api/list_point_packs"

Write-Host "`n📋 Testing WRITE endpoints..." -ForegroundColor Yellow
# Note: These tests require valid data, may fail if data folder is empty
# Test-Endpoint "/api/generate_multi_report" "POST" '{"folder_path":"data","months":["2025-10"]}'

Write-Host "`n" + ("=" * 50)
Write-Host "📊 Smoke Test Results:" -ForegroundColor Cyan
Write-Host "  ✅ Passed: $PASS_COUNT" -ForegroundColor Green
Write-Host "  ❌ Failed: $FAIL_COUNT" -ForegroundColor Red

if ($FAIL_COUNT -eq 0) {
    Write-Host "`n🎉 All tests passed!" -ForegroundColor Green
    exit 0
}
else {
    Write-Host "`n⚠️  Some tests failed. Please check the backend server." -ForegroundColor Yellow
    exit 1
}
