$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
if (Test-Path $venvPython) {
    $py = $venvPython
    Write-Host "[boot] Using venv python: $py" -ForegroundColor Green
} else {
    Write-Warning "[boot] .venv not found - falling back to system python"
    $py = "python"
}

$envFile = Join-Path $repoRoot ".env.local"
if (-not (Test-Path $envFile)) { $envFile = Join-Path $repoRoot ".env" }
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process")
        }
    }
    Write-Host "[boot] Loaded env from $envFile" -ForegroundColor Cyan
}

$backendPort = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "8002" }
$frontendPort = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } else { "3001" }

Write-Host "[boot] Starting backend on port $backendPort ..." -ForegroundColor Yellow
$backendJob = Start-Job -ScriptBlock {
    param($py, $port, $root)
    Set-Location $root
    & $py -m uvicorn web.app.main:app --host 0.0.0.0 --port $port --reload
} -ArgumentList $py, $backendPort, $repoRoot

Start-Sleep -Seconds 3
$healthy = $false
for ($i = 0; $i -lt 10; $i++) {
    try {
        $resp = Invoke-RestMethod "http://localhost:$backendPort/api/health" -TimeoutSec 2
        if ($resp.ok) { $healthy = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
}
if ($healthy) { Write-Host "[boot] Backend healthy!" -ForegroundColor Green }
else { Write-Warning "[boot] Backend health check failed - continuing" }

Write-Host "[boot] Starting frontend on port $frontendPort ..." -ForegroundColor Yellow
$frontendJob = Start-Job -ScriptBlock {
    param($port, $root)
    Set-Location $root
    npx vite --port $port
} -ArgumentList $frontendPort, $repoRoot

Write-Host ""
Write-Host "=== Market Lens AI ===" -ForegroundColor Magenta
Write-Host "  Backend:  http://localhost:$backendPort" -ForegroundColor Cyan
Write-Host "  Frontend: http://localhost:$frontendPort" -ForegroundColor Cyan
Write-Host "  Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

try {
    while ($true) {
        Receive-Job $backendJob -ErrorAction SilentlyContinue
        Receive-Job $frontendJob -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
} finally {
    Write-Host "`n[boot] Shutting down..." -ForegroundColor Yellow
    Stop-Job $backendJob, $frontendJob -ErrorAction SilentlyContinue
    Remove-Job $backendJob, $frontendJob -Force -ErrorAction SilentlyContinue
}
