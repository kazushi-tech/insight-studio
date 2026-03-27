# run_tests.ps1 - ads-insights Test Runner
# Runs all test files and reports results

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ads-insights Test Runner" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Change to project root
$ProjectRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
Set-Location $ProjectRoot

# Test files to run
$TestFiles = @(
    "tests/test_v2_5_basic.py",
    "tests/test_v2_5_display.py",
    "tests/test_data_providers.py",
    "tests/test_kpi_aggregation.py"
)

$Results = @()
$TotalPassed = 0
$TotalFailed = 0

foreach ($TestFile in $TestFiles) {
    Write-Host "Running: $TestFile" -ForegroundColor Yellow
    Write-Host "-" * 40

    $StartTime = Get-Date

    try {
        $Output = python $TestFile 2>&1
        $ExitCode = $LASTEXITCODE

        $EndTime = Get-Date
        $Duration = ($EndTime - $StartTime).TotalSeconds

        if ($ExitCode -eq 0) {
            Write-Host "[PASS] $TestFile ($([math]::Round($Duration, 2))s)" -ForegroundColor Green
            $TotalPassed++
            $Results += @{
                File = $TestFile
                Status = "PASS"
                Duration = $Duration
            }
        } else {
            Write-Host "[FAIL] $TestFile" -ForegroundColor Red
            Write-Host $Output -ForegroundColor Red
            $TotalFailed++
            $Results += @{
                File = $TestFile
                Status = "FAIL"
                Duration = $Duration
                Output = $Output
            }
        }
    } catch {
        Write-Host "[ERROR] $TestFile - $_" -ForegroundColor Red
        $TotalFailed++
        $Results += @{
            File = $TestFile
            Status = "ERROR"
            Error = $_
        }
    }

    Write-Host ""
}

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Test Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Passed: $TotalPassed" -ForegroundColor Green
Write-Host "Failed: $TotalFailed" -ForegroundColor $(if ($TotalFailed -gt 0) { "Red" } else { "Green" })
Write-Host "Total:  $($TotalPassed + $TotalFailed)"
Write-Host ""

if ($TotalFailed -gt 0) {
    Write-Host "Failed tests:" -ForegroundColor Red
    foreach ($Result in $Results) {
        if ($Result.Status -eq "FAIL" -or $Result.Status -eq "ERROR") {
            Write-Host "  - $($Result.File)" -ForegroundColor Red
        }
    }
    exit 1
} else {
    Write-Host "All tests passed!" -ForegroundColor Green
    exit 0
}
