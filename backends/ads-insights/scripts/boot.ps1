#!/usr/bin/env pwsh
# scripts/boot.ps1 - The OFFICIAL boot script for Ads Insights Studio
# Unifies startup of Backend (8001) and Frontend (3000)

$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repo

# --- Configuration ---
$BACKEND_PORT = 8001
$FRONTEND_PORT = 3000
$UI_URL = "http://localhost:$FRONTEND_PORT"
$HEALTH_URL = "http://localhost:$BACKEND_PORT/api/health"
$LOG_DIR = Join-Path $repo ".logs"

# --- Utils ---
function Write-Status ($msg, $color = "Cyan") { Write-Host "`n➤ $msg" -ForegroundColor $color }
function Write-ErrorMsg ($msg) { Write-Host "❌ $msg" -ForegroundColor Red }
function Write-Success ($msg) { Write-Host "✅ $msg" -ForegroundColor Green }

# --- 1. Force-stop any existing processes on dev ports ---
Write-Status "Stopping any existing processes on dev ports..."
$stopScript = Join-Path $repo "ops\stop_all.ps1"
if (Test-Path $stopScript) {
    & $stopScript
    Start-Sleep -Seconds 1
}
else {
    Write-Host "⚠️  ops\stop_all.ps1 not found, skipping port cleanup" -ForegroundColor Yellow
}

# --- 2. Setup Environment ---
if (!(Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Force -Path $LOG_DIR | Out-Null }

$py = Join-Path $repo ".venv\Scripts\python.exe"
if (!(Test-Path $py)) { 
    Write-Host "⚠️  Virtual environment not found at .venv" -ForegroundColor Yellow
    $py = "python" 
}

# --- 3. Start Backend ---
Write-Status "Starting Backend API (Port $BACKEND_PORT)..."
$backendLog = Join-Path $LOG_DIR "backend_boot.log"
$backendErr = Join-Path $LOG_DIR "backend_boot.err"

try {
    $backendProc = Start-Process -FilePath $py -ArgumentList "-m", "uvicorn", "web.app.backend_api:app", "--host", "127.0.0.1", "--port", "$BACKEND_PORT", "--log-level", "info", "--timeout-keep-alive", "300" -RedirectStandardOutput $backendLog -RedirectStandardError $backendErr -PassThru -WindowStyle Hidden
    Write-Success "Backend started (PID: $($backendProc.Id))"
}
catch {
    Write-ErrorMsg "Failed to start backend: $_"
    exit 1
}

# Wait for backend to be responsive
Write-Host "   Waiting for backend health check..." -NoNewline
$retries = 20
$backendReady = $false
for ($i = 0; $i -lt $retries; $i++) {
    try {
        $health = Invoke-RestMethod -Uri $HEALTH_URL -TimeoutSec 3 -ErrorAction Stop
        if ($health.ok) {
            $backendReady = $true
            Write-Host " OK!" -ForegroundColor Green
            break
        }
    }
    catch {
        Write-Host "." -NoNewline
        Start-Sleep -Seconds 1
    }
}

if (!$backendReady) {
    Write-Host ""
    Write-ErrorMsg "Backend health check failed after $retries attempts"
    Write-Host "   Check logs: .logs\backend_boot.err" -ForegroundColor Yellow
    Write-Host "   Proceeding anyway, but backend may not be ready..." -ForegroundColor Yellow
}

# --- 4. Start Frontend (Vite) ---
Write-Status "Starting Frontend (Vite) (Port $FRONTEND_PORT)..."

# Use npm run dev
try {
    # Check if node_modules exists
    if (!(Test-Path "node_modules")) {
        Write-Host "📦 Installing dependencies (npm install)..."
        npm install
    }

    # Start Vite
    # Note: npm run dev usually spawns a child process and keeps running.
    # We use Start-Process to keep it properly separate or run it in current shell if we want output.
    # To keep this script running as a controller, we spawn it.
    
    # Run Vite in foreground so the script doesn't exit
    Write-Status "Starting Frontend in foreground..."
    npm run dev
    
}
catch {
    Write-ErrorMsg "Failed to start frontend: $_"
    exit 1
}

# This part will only be reached if npm run dev stops
Write-Host "`nFrontend stopped."
