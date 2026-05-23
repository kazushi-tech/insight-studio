param(
    [string]$TargetBranch = "master",
    [string]$ProductionUrl = "https://insight-studio-chi.vercel.app",
    [int]$PollSeconds = 30,
    [int]$TimeoutMinutes = 45,
    [switch]$SkipLocalChecks
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command is not available: $Name"
    }
}

function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [switch]$AllowFailure
    )

    $output = & $FilePath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    if ($output) {
        $output | ForEach-Object { Write-Host $_ }
    }
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw "Command failed ($exitCode): $FilePath $($Arguments -join ' ')"
    }
    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = ($output -join "`n")
    }
}

function Get-GitValue {
    param([string[]]$Arguments)
    $result = Invoke-Checked -FilePath "git" -Arguments $Arguments
    return ($result.Output.Trim())
}

function Assert-CleanTrackedTree {
    Write-Step "Checking tracked working tree"
    Invoke-Checked -FilePath "git" -Arguments @("diff", "--quiet")
    Invoke-Checked -FilePath "git" -Arguments @("diff", "--cached", "--quiet")
}

function Run-LocalChecks {
    if ($SkipLocalChecks) {
        Write-Step "Skipping local checks by request"
        return
    }

    Write-Step "Running local release gates"
    Invoke-Checked -FilePath "npm" -Arguments @("run", "lint")
    Invoke-Checked -FilePath "npm" -Arguments @("test")
    Invoke-Checked -FilePath "npm" -Arguments @("run", "build")
}

function Get-HealthCommit {
    param([string]$Path)

    $uri = "$ProductionUrl$Path"
    try {
        $response = Invoke-RestMethod -Uri $uri -TimeoutSec 45
    }
    catch {
        return [pscustomobject]@{
            Ok = $false
            Commit = ""
            Detail = $_.Exception.Message
        }
    }

    $commit = ""
    if ($null -ne $response.commit) {
        $commit = [string]$response.commit
    }
    elseif ($null -ne $response.version) {
        $commit = [string]$response.version
    }

    return [pscustomobject]@{
        Ok = $true
        Commit = $commit
        Detail = ($response | ConvertTo-Json -Compress -Depth 8)
    }
}

function Wait-ProductionCommit {
    param([string]$ExpectedCommit)

    Write-Step "Waiting for production health to report $ExpectedCommit"
    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)

    while ((Get-Date) -lt $deadline) {
        $frontendOk = $false
        try {
            $front = Invoke-WebRequest -Uri "$ProductionUrl/" -UseBasicParsing -TimeoutSec 20
            $frontendOk = ($front.StatusCode -eq 200)
        }
        catch {
            $frontendOk = $false
        }

        $ml = Get-HealthCommit -Path "/api/ml/health"
        $ads = Get-HealthCommit -Path "/api/ads/health"

        Write-Host ("frontend={0} ml={1} ads={2}" -f $frontendOk, $ml.Commit, $ads.Commit)

        if ($frontendOk -and $ml.Commit -eq $ExpectedCommit -and $ads.Commit -eq $ExpectedCommit) {
            Write-Host "Production is live at commit $ExpectedCommit" -ForegroundColor Green
            return
        }

        Start-Sleep -Seconds $PollSeconds
    }

    throw "Production did not report commit $ExpectedCommit within $TimeoutMinutes minutes."
}

function Get-OrCreatePullRequest {
    param(
        [string]$CurrentBranch,
        [string]$HeadCommit
    )

    $existing = Invoke-Checked -FilePath "gh" -Arguments @(
        "pr", "list",
        "--head", $CurrentBranch,
        "--base", $TargetBranch,
        "--state", "open",
        "--json", "number",
        "--jq", ".[0].number // empty"
    )

    if ($existing.Output.Trim()) {
        return $existing.Output.Trim()
    }

    $title = "Release $($HeadCommit.Substring(0, 7)) to production"
    $body = @"
Automated production release.

- Source branch: $CurrentBranch
- Commit: $HeadCommit
- Completion gate: production health must report the merged commit on both /api/ml/health and /api/ads/health.
"@

    $create = Invoke-Checked -FilePath "gh" -Arguments @(
        "pr", "create",
        "--base", $TargetBranch,
        "--head", $CurrentBranch,
        "--title", $title,
        "--body", $body
    )

    $url = ($create.Output.Trim() -split "`n")[-1]
    $number = Invoke-Checked -FilePath "gh" -Arguments @(
        "pr", "view", $url,
        "--json", "number",
        "--jq", ".number"
    )
    return $number.Output.Trim()
}

function Merge-PullRequest {
    param([string]$PrNumber)

    Write-Step "Waiting for PR checks"
    Invoke-Checked -FilePath "gh" -Arguments @("pr", "checks", $PrNumber, "--watch", "--fail-fast")

    Write-Step "Merging PR #$PrNumber"
    Invoke-Checked -FilePath "gh" -Arguments @("pr", "merge", $PrNumber, "--squash", "--delete-branch")

    $state = Invoke-Checked -FilePath "gh" -Arguments @(
        "pr", "view", $PrNumber,
        "--json", "state,mergeCommit",
        "--jq", ".state + `" `" + .mergeCommit.oid"
    )

    $parts = $state.Output.Trim() -split " "
    if ($parts[0] -ne "MERGED" -or -not $parts[1]) {
        throw "PR #$PrNumber did not report a merge commit."
    }

    return $parts[1]
}

Require-Command "git"
Require-Command "gh"
Require-Command "npm"

Write-Step "Preparing release"
$repoRoot = Get-GitValue -Arguments @("rev-parse", "--show-toplevel")
Set-Location $repoRoot

Assert-CleanTrackedTree
Run-LocalChecks

Write-Step "Refreshing origin"
Invoke-Checked -FilePath "git" -Arguments @("fetch", "origin", $TargetBranch)

$headCommit = Get-GitValue -Arguments @("rev-parse", "HEAD")
$currentBranch = Get-GitValue -Arguments @("branch", "--show-current")
if (-not $currentBranch) {
    throw "Current HEAD is detached. Switch to a release branch first."
}

Write-Step "Trying direct production push"
$directPush = Invoke-Checked -FilePath "git" -Arguments @("push", "origin", "HEAD:$TargetBranch") -AllowFailure
if ($directPush.ExitCode -eq 0) {
    Wait-ProductionCommit -ExpectedCommit $headCommit
    exit 0
}

Write-Host "Direct push was rejected or unavailable; using PR release path." -ForegroundColor Yellow

if ($currentBranch -eq $TargetBranch) {
    $stamp = Get-Date -Format "yyyyMMddHHmmss"
    $releaseBranch = "codex/release-$($headCommit.Substring(0, 7))-$stamp"
    Write-Step "Creating release branch $releaseBranch"
    Invoke-Checked -FilePath "git" -Arguments @("switch", "-c", $releaseBranch)
    $currentBranch = $releaseBranch
}

Write-Step "Pushing release branch"
Invoke-Checked -FilePath "git" -Arguments @("push", "-u", "origin", $currentBranch)

$prNumber = Get-OrCreatePullRequest -CurrentBranch $currentBranch -HeadCommit $headCommit
$mergeCommit = Merge-PullRequest -PrNumber $prNumber
Wait-ProductionCommit -ExpectedCommit $mergeCommit
