<#
.SYNOPSIS
  The owner's whole publish in one command: deploy the sync worker, `npm run publish`, deploy the AI worker.

.DESCRIPTION
  Run from the repo root, after `node scripts/release.js <version> "<title>" --no-publish`:

    $env:GH_TOKEN = '<token>'      # or be signed in with `gh auth login`
    pwsh scripts\publish-all.ps1

  Steps, in order (a failure stops everything after it):
    1. sync     wrangler deploy      in workers\vex-sync-worker   (retried on network / 5xx errors)
    2. publish  npm run publish      in the repo root             (never retried; it is safe to rerun by hand)
    3. ai       wrangler deploy      in workers\vex-ai-worker     (retried on network / 5xx errors)

  Progress is kept in %TEMP%\vex-publish-all-state.json, keyed by the version in package.json.
  Rerunning after a failure SKIPS the steps already done and resumes at the failed one. A new
  version starts fresh. -Reset forgets the progress; -DryRun shows the plan and runs nothing.

  wrangler deploy is retried up to 3 times (waits 5 s, then 20 s) only when its output looks like a
  network or 5xx failure (Cloudflare 502/503/504, ECONNRESET, timeouts, DNS). Anything else (auth,
  a syntax error in the worker) fails at once.

  The token is never printed: output lines are filtered for the value of $env:GH_TOKEN and for
  anything shaped like a GitHub token before they reach the screen.

  Exit code 0 = every step done, 1 = a step failed (the message says which and how to resume).

.PARAMETER DryRun       Print the plan and the resume point; change nothing, run nothing.
.PARAMETER Reset        Delete the saved progress first.
.PARAMETER StateFile    Where progress is kept (default %TEMP%\vex-publish-all-state.json).
.PARAMETER StepsFile    JSON array of {name, command, cwd, retry} replacing the three real steps
                        (tests/main/publishAll.test.js uses it with fake commands). Skips the
                        GH_TOKEN / wrangler preflight.
.PARAMETER Backoff  Comma-separated waits in seconds between wrangler attempts (default '5,20' = three attempts).
.PARAMETER Version      Override the version the progress is keyed by (default package.json's).
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$Reset,
  [string]$StateFile = (Join-Path $env:TEMP 'vex-publish-all-state.json'),
  [string]$StepsFile,
  [string]$Backoff = '5,20',
  [string]$Version
)

$ErrorActionPreference = 'Continue'
$BackoffSeconds = @($Backoff -split ',' | ForEach-Object { [int]$_.Trim() })
$repo = Split-Path -Parent $PSScriptRoot
if (-not $Version) { $Version = (Get-Content -Raw (Join-Path $repo 'package.json') | ConvertFrom-Json).version }

# --- the steps ---------------------------------------------------------------
if ($StepsFile) {
  try { $steps = @(Get-Content -Raw $StepsFile -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop) }
  catch { Write-Host "publish-all: cannot read -StepsFile $StepsFile ($($_.Exception.Message))"; exit 1 }
  if ($steps.Count -eq 0) { Write-Host "publish-all: -StepsFile $StepsFile has no steps"; exit 1 }
} else {
  $steps = @(
    [pscustomobject]@{ name = 'sync';    command = 'wrangler deploy'; cwd = 'workers\vex-sync-worker'; retry = $true },
    [pscustomobject]@{ name = 'publish'; command = 'npm run publish'; cwd = '.';                        retry = $false },
    [pscustomobject]@{ name = 'ai';      command = 'wrangler deploy'; cwd = 'workers\vex-ai-worker';   retry = $true }
  )
}

# --- progress ----------------------------------------------------------------
if ($Reset -and (Test-Path $StateFile)) { Remove-Item $StateFile -Force; Write-Host 'publish-all: progress forgotten.' }
$done = @()
if (Test-Path $StateFile) {
  try { $state = Get-Content -Raw $StateFile | ConvertFrom-Json } catch { throw "publish-all: cannot read $StateFile ($($_.Exception.Message)); delete it or pass -Reset" }
  if ($state.version -eq $Version) { $done = @($state.done) }
}
function Save-State {
  if ($DryRun) { return }
  ([pscustomobject]@{ version = $Version; done = @($script:done); updated = (Get-Date).ToString('s') } | ConvertTo-Json) | Set-Content -Path $StateFile -Encoding UTF8
}

# --- never print a token -----------------------------------------------------
function Hide-Secrets([string]$text) {
  if ($env:GH_TOKEN -and $env:GH_TOKEN.Length -ge 8) { $text = $text.Replace($env:GH_TOKEN, '***') }
  $text = [regex]::Replace($text, 'gh[pousr]_[A-Za-z0-9]{16,}', '***')
  $text = [regex]::Replace($text, 'github_pat_[A-Za-z0-9_]{16,}', '***')
  return $text
}

$transient = 'ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up|fetch failed|network|timed out|timeout|Bad Gateway|Service Unavailable|Gateway Time-?out|Internal Server Error|(HTTP|status|code|error)\D{0,20}\b5\d\d\b'

function Invoke-Step($step) {
  $dir = if ([System.IO.Path]::IsPathRooted([string]$step.cwd)) { [string]$step.cwd } else { Join-Path $repo ([string]$step.cwd) }
  $attempt = 0
  while ($true) {
    $attempt++
    $lines = New-Object System.Collections.Generic.List[string]
    Push-Location $dir
    try {
      $global:LASTEXITCODE = 0
      & ([scriptblock]::Create([string]$step.command)) 2>&1 | ForEach-Object {
        $line = Hide-Secrets (($_ | Out-String).TrimEnd())
        $lines.Add($line)
        Write-Host $line
      }
      $code = $global:LASTEXITCODE
    } catch {
      $line = Hide-Secrets $_.Exception.Message
      $lines.Add($line); Write-Host $line
      $code = 1
    } finally { Pop-Location }
    if ($code -eq 0) { return $true }
    $max = $BackoffSeconds.Count + 1
    if ($step.retry -and $attempt -lt $max -and (($lines -join "`n") -match $transient)) {
      $wait = $BackoffSeconds[$attempt - 1]
      Write-Host "publish-all: $($step.name) looks like a network/5xx failure (exit $code); attempt $attempt of $max, retrying in $wait s"
      if ($wait -gt 0) { Start-Sleep -Seconds $wait }
      continue
    }
    Write-Host "publish-all: $($step.name) exited with $code after $attempt attempt(s)"
    return $false
  }
}

# --- preflight (real run only) -----------------------------------------------
if (-not $StepsFile -and -not $DryRun) {
  if (-not $env:GH_TOKEN) {
    & gh auth status *> $null
    if ($LASTEXITCODE -ne 0) { Write-Host 'publish-all: no GH_TOKEN and gh is not signed in. Set $env:GH_TOKEN or run gh auth login. Nothing was deployed.'; exit 1 }
  }
  if (-not (Get-Command wrangler -ErrorAction SilentlyContinue)) { Write-Host 'publish-all: wrangler is not on PATH (npm i -g wrangler). Nothing was deployed.'; exit 1 }
}

# --- run ---------------------------------------------------------------------
Write-Host "publish-all: v$Version$(if ($DryRun) { ' (dry run)' })"
$i = 0
foreach ($step in $steps) {
  $i++
  $label = "step $i/$($steps.Count) $($step.name)"
  if ($done -contains $step.name) { Write-Host "publish-all: $label already done, skipping"; continue }
  if ($DryRun) { Write-Host "publish-all: $label would run: $($step.command)  (in $($step.cwd))"; continue }
  Write-Host "publish-all: $label ... $($step.command)"
  if (-not (Invoke-Step $step)) {
    Write-Host ''
    Write-Host "publish-all: FAILED at $label. Earlier steps are done and saved; later steps did not run."
    Write-Host "publish-all: fix the cause and rerun the same command: it resumes at '$($step.name)'."
    exit 1
  }
  $done += [string]$step.name
  Save-State
  Write-Host "publish-all: $label done"
}
if (-not $DryRun) { Write-Host "publish-all: v$Version published: every step is done." }
exit 0
