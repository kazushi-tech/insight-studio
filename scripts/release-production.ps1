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

function Get-ReleaseRequirements {
    param([string]$BaseRef)

    $diff = Invoke-Checked -FilePath "git" -Arguments @("diff", "--name-only", "$BaseRef...HEAD")
    $files = @($diff.Output -split "`n" | Where-Object { $_.Trim() })

    $requiresMl = $false
    $requiresAds = $false
    foreach ($file in $files) {
        if ($file -match "^(backends/market-lens-ai/|render\.yaml$)") {
            $requiresMl = $true
        }
        if ($file -match "^(backends/ads-insights/|render\.yaml$)") {
            $requiresAds = $true
        }
    }

    return [pscustomobject]@{
        Files = $files
        RequiresMlCommit = $requiresMl
        RequiresAdsCommit = $requiresAds
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

function Request-Url {
    param([string]$Uri)

    $script = "const url = process.argv[1]; fetch(url).then(async (res) => { const body = await res.text(); console.log(JSON.stringify({ status: res.status, body })); }).catch((error) => { console.error(error && error.stack ? error.stack : String(error)); process.exit(1); });"
    $result = Invoke-Checked -FilePath "node" -Arguments @("-e", $script, $Uri) -AllowFailure
    if ($result.ExitCode -ne 0) {
        return [pscustomobject]@{
            Ok = $false
            Status = 0
            Body = ""
            Error = $result.Output
        }
    }

    try {
        $payload = ($result.Output.Trim() | ConvertFrom-Json)
    }
    catch {
        return [pscustomobject]@{
            Ok = $false
            Status = 0
            Body = ""
            Error = $_.Exception.Message
        }
    }

    return [pscustomobject]@{
        Ok = ($payload.status -ge 200 -and $payload.status -lt 400)
        Status = [int]$payload.status
        Body = [string]$payload.body
        Error = ""
    }
}

function Get-GitValue {
    param([string[]]$Arguments)
    $result = Invoke-Checked -FilePath "git" -Arguments $Arguments
    return ($result.Output.Trim())
}

function Assert-CleanTrackedTree {
    Write-Step "Checking tracked working tree"
    $null = Invoke-Checked -FilePath "git" -Arguments @("diff", "--quiet")
    $null = Invoke-Checked -FilePath "git" -Arguments @("diff", "--cached", "--quiet")
}

function Run-LocalChecks {
    if ($SkipLocalChecks) {
        Write-Step "Skipping local checks by request"
        return
    }

    Write-Step "Running local release gates"
    $null = Invoke-Checked -FilePath "npm" -Arguments @("run", "lint")
    $null = Invoke-Checked -FilePath "npm" -Arguments @("test")
    $null = Invoke-Checked -FilePath "npm" -Arguments @("run", "build")
}

function Get-HealthCommit {
    param([string]$Path)

    $uri = "$ProductionUrl$Path"
    try {
        $raw = Request-Url -Uri $uri
        if (-not $raw.Ok) {
            return [pscustomobject]@{
                Ok = $false
                Commit = ""
                Detail = $raw.Error
            }
        }
        $response = ($raw.Body | ConvertFrom-Json)
    }
    catch {
        return [pscustomobject]@{
            Ok = $false
            Commit = ""
            Detail = $_.Exception.Message
        }
    }

    $commit = ""
    $propertyNames = @($response.PSObject.Properties.Name)
    if ($propertyNames -contains "commit" -and $null -ne $response.commit) {
        $commit = [string]$response.commit
    }
    elseif ($propertyNames -contains "version" -and $null -ne $response.version) {
        $commit = [string]$response.version
    }

    return [pscustomobject]@{
        Ok = $true
        Commit = $commit
        Detail = ($response | ConvertTo-Json -Compress -Depth 8)
    }
}

function Wait-ProductionCommit {
    param(
        [string]$ExpectedCommit,
        [bool]$RequireMlCommit,
        [bool]$RequireAdsCommit
    )

    Write-Step "Waiting for production health to report $ExpectedCommit"
    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)

    while ((Get-Date) -lt $deadline) {
        $front = Request-Url -Uri "$ProductionUrl/"
        $frontendOk = $front.Ok
        $ml = Get-HealthCommit -Path "/api/ml/health"
        $ads = Get-HealthCommit -Path "/api/ads/health"
        $mlOk = $ml.Ok -and ((-not $RequireMlCommit) -or $ml.Commit -eq $ExpectedCommit)
        $adsOk = $ads.Ok -and ((-not $RequireAdsCommit) -or $ads.Commit -eq $ExpectedCommit)

        Write-Host ("frontend={0} ml={1} ads={2}" -f $frontendOk, $ml.Commit, $ads.Commit)

        if ($frontendOk -and $mlOk -and $adsOk) {
            Write-Host "Production is live at commit $ExpectedCommit" -ForegroundColor Green
            return
        }

        Start-Sleep -Seconds $PollSeconds
    }

    throw "Production did not report commit $ExpectedCommit within $TimeoutMinutes minutes."
}

function Wait-GitHubCi {
    param([string]$ExpectedCommit)

    Write-Step "Waiting for master CI and post-deploy health"
    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)

    while ((Get-Date) -lt $deadline) {
        $run = Invoke-Checked -FilePath "gh" -Arguments @(
            "run", "list",
            "--workflow", "CI",
            "--branch", $TargetBranch,
            "--commit", $ExpectedCommit,
            "--event", "push",
            "--limit", "1",
            "--json", "databaseId,status,conclusion,url",
            "--jq", ".[0] // empty"
        ) -AllowFailure

        if ($run.ExitCode -eq 0 -and $run.Output.Trim()) {
            $payload = ($run.Output.Trim() | ConvertFrom-Json)
            Write-Host ("run={0} status={1} conclusion={2}" -f $payload.databaseId, $payload.status, $payload.conclusion)
            if ($payload.status -eq "completed") {
                if ($payload.conclusion -eq "success") {
                    return
                }
                throw "Master CI failed for ${ExpectedCommit}: $($payload.url)"
            }
        }
        else {
            Write-Host "Waiting for master CI run to appear for $ExpectedCommit"
        }

        Start-Sleep -Seconds $PollSeconds
    }

    throw "Master CI did not complete for $ExpectedCommit within $TimeoutMinutes minutes."
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
    $null = Invoke-Checked -FilePath "gh" -Arguments @("pr", "checks", $PrNumber, "--watch", "--fail-fast")

    Write-Step "Merging PR #$PrNumber"
    $null = Invoke-Checked -FilePath "gh" -Arguments @("pr", "merge", $PrNumber, "--squash", "--delete-branch")

    $state = Invoke-Checked -FilePath "gh" -Arguments @(
        "pr", "view", $PrNumber,
        "--json", "state,mergeCommit",
        "--jq", ".state + `" `" + .mergeCommit.oid"
    )

    if ($state.Output -notmatch "MERGED\s+([0-9a-f]{7,40})") {
        throw "PR #$PrNumber did not report a merge commit."
    }

    return $Matches[1]
}

Require-Command "git"
Require-Command "gh"
Require-Command "npm"
Require-Command "node"

Write-Step "Preparing release"
$repoRoot = Get-GitValue -Arguments @("rev-parse", "--show-toplevel")
Set-Location $repoRoot

Assert-CleanTrackedTree
Run-LocalChecks

Write-Step "Refreshing origin"
$null = Invoke-Checked -FilePath "git" -Arguments @("fetch", "origin", $TargetBranch)
$releaseRequirements = Get-ReleaseRequirements -BaseRef "origin/$TargetBranch"
Write-Host ("backend commit gates: ml={0} ads={1}" -f $releaseRequirements.RequiresMlCommit, $releaseRequirements.RequiresAdsCommit)

$headCommit = Get-GitValue -Arguments @("rev-parse", "HEAD")
$currentBranch = Get-GitValue -Arguments @("branch", "--show-current")
if (-not $currentBranch) {
    throw "Current HEAD is detached. Switch to a release branch first."
}

Write-Step "Trying direct production push"
$directPush = Invoke-Checked -FilePath "git" -Arguments @("push", "origin", "HEAD:$TargetBranch") -AllowFailure
if ($directPush.ExitCode -eq 0) {
    Wait-GitHubCi -ExpectedCommit $headCommit
    Wait-ProductionCommit -ExpectedCommit $headCommit -RequireMlCommit $releaseRequirements.RequiresMlCommit -RequireAdsCommit $releaseRequirements.RequiresAdsCommit
    exit 0
}

Write-Host "Direct push was rejected or unavailable; using PR release path." -ForegroundColor Yellow

if ($currentBranch -eq $TargetBranch) {
    $stamp = Get-Date -Format "yyyyMMddHHmmss"
    $releaseBranch = "codex/release-$($headCommit.Substring(0, 7))-$stamp"
    Write-Step "Creating release branch $releaseBranch"
    $null = Invoke-Checked -FilePath "git" -Arguments @("switch", "-c", $releaseBranch)
    $currentBranch = $releaseBranch
}

Write-Step "Pushing release branch"
$null = Invoke-Checked -FilePath "git" -Arguments @("push", "-u", "origin", $currentBranch)

$prNumber = Get-OrCreatePullRequest -CurrentBranch $currentBranch -HeadCommit $headCommit
$mergeCommit = Merge-PullRequest -PrNumber $prNumber
Wait-GitHubCi -ExpectedCommit $mergeCommit
Wait-ProductionCommit -ExpectedCommit $mergeCommit -RequireMlCommit $releaseRequirements.RequiresMlCommit -RequireAdsCommit $releaseRequirements.RequiresAdsCommit
