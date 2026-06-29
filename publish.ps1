# publish.ps1 - Full pipeline: fetch new bills, enrich with Ollama, push to production
#
# FIRST-TIME SETUP (run once, manually):
#   railway login          - authenticate Railway CLI (token persists)
#   railway link           - link this directory to the Railway service
#
# SCHEDULED USE:
#   .\scripts\schedule_publish.ps1  - register weekly Task Scheduler job (Friday 6am)
#   Start-ScheduledTask -TaskName CommonGroundPublish  - run immediately
#
# MANUAL USE:
#   .\publish.ps1                              - full pipeline
#   .\publish.ps1 -SkipFetch                  - skip Legistar scrape
#   .\publish.ps1 -SkipEnrich -SkipNarrative  - sitemap + upload only
#
# Steps:
#  1. scripts/fetch_bills.py          - incremental Legistar scrape (since last ingest date)
#  2. scripts/worker.py               - Ollama enrichment (full_text, analyze, headline, metadata, perspectives)
#  3. scripts/generate_legislative_narrative.py - regenerate 26-year narrative JSON (Ollama)
#  4. scripts/generate_sitemap.py     - regenerate static sitemap.xml
#  5. litestream replicate            - upload CONTENT DB snapshot to Backblaze B2 (path "db")
#  6. git push                        - Vercel picks up new sitemap.xml + narrative JSON (~2 min)
#  7. railway redeploy                - Railway restores CONTENT db from B2 and restarts (~3 min)
#
# NOTE: Step 5 only touches content.db.  Users.db (accounts, votes, tracking,
# bluesky_posts, donations) lives on production and is continuously backed up
# by the Railway-side Litestream process to B2 path "users".  publish.ps1
# never overwrites prod user data.  See app/models/__init__.py for the split.

param(
    [switch]$SkipFetch,
    [switch]$SkipEnrich,
    [switch]$SkipNarrative,
    [int]$MinDaysSinceLastRun = 0   # 0 = always run; set by scheduler wrapper to avoid duplicate runs
)

$ErrorActionPreference = "Stop"
$ROOT = "C:\Projects\Common_Ground"

function Log($msg) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" -ForegroundColor Cyan
}

function Warn($msg) {
    Write-Host "[WARN] $msg" -ForegroundColor Yellow
}

function Fail($msg) {
    Write-Host "[ERROR] $msg" -ForegroundColor Red
    exit 1
}

function Wait-Ollama {
    Log "Checking Ollama..."
    for ($i = 0; $i -lt 12; $i++) {
        try {
            $null = Invoke-RestMethod "http://localhost:11434/api/tags" -TimeoutSec 3
            Log "Ollama is ready."
            return $true
        } catch {
            if ($i -eq 0) {
                Log "Ollama not running - starting it..."
                Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden -ErrorAction SilentlyContinue
            }
            Start-Sleep 5
        }
    }
    return $false
}

# Load .env
Get-Content "$ROOT\.env" | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
}

Set-Location $ROOT

# ── Minimum-interval gate (used by scheduler; skipped on manual runs) ─────────
$LAST_RUN_FILE = "$ROOT\.last_publish"
if ($MinDaysSinceLastRun -gt 0 -and (Test-Path $LAST_RUN_FILE)) {
    $lastRun = [datetime](Get-Content $LAST_RUN_FILE)
    $daysSince = ((Get-Date) - $lastRun).TotalDays
    if ($daysSince -lt $MinDaysSinceLastRun) {
        Write-Host "Last publish was $([math]::Round($daysSince,1)) days ago (< $MinDaysSinceLastRun days). Skipping."
        exit 0
    }
}

Log "Publish pipeline starting..."

# ── Pre-flight checks ─────────────────────────────────────────────────────────

# Ollama required for steps 2 and 3
$needsOllama = (-not $SkipEnrich) -or (-not $SkipNarrative)
if ($needsOllama) {
    if (-not (Wait-Ollama)) {
        Fail "Ollama did not start. Ensure Ollama is installed: https://ollama.com"
    }
}

# Railway auth check (non-fatal - we warn and skip if not logged in)
$railwayOk = $false
try {
    railway status 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $railwayOk = $true }
} catch { }
if (-not $railwayOk) {
    Warn "Railway CLI not logged in or project not linked."
    Warn "Run: railway login && railway link"
    Warn "Step 7 (redeploy) will be skipped this run."
}

# ── Step 1: Fetch new bills from Legistar ────────────────────────────────────
if (-not $SkipFetch) {
    Log "Step 1/7 - Fetching new bills from Legistar (incremental)..."
    python scripts/fetch_bills.py
    if ($LASTEXITCODE -ne 0) { Fail "Bill fetch failed. Fix errors above before continuing." }
    Log "Fetch complete."
} else {
    Log "Step 1/7 - Skipping fetch."
}

# ── Step 2: Enrich with Ollama ───────────────────────────────────────────────
if (-not $SkipEnrich) {
    Log "Step 2/7 - Running Ollama enrichment pipeline..."
    python scripts/worker.py
    if ($LASTEXITCODE -ne 0) { Fail "Enrichment failed. Fix errors above before continuing." }
    Log "Enrichment complete."
} else {
    Log "Step 2/7 - Skipping enrichment."
}

# ── Step 3: Regenerate 26-year legislative narrative ─────────────────────────
if (-not $SkipNarrative) {
    Log "Step 3/7 - Regenerating legislative narrative..."
    python scripts/generate_legislative_narrative.py
    if ($LASTEXITCODE -ne 0) { Fail "Narrative generation failed." }
    Log "Narrative updated."
} else {
    Log "Step 3/7 - Skipping narrative."
}

# ── Step 4: Regenerate sitemap ───────────────────────────────────────────────
Log "Step 4/7 - Regenerating sitemap.xml..."
python scripts/generate_sitemap.py
if ($LASTEXITCODE -ne 0) { Fail "Sitemap generation failed." }
Log "Sitemap updated."

# ── Step 5: Upload DB to Backblaze B2 ────────────────────────────────────────
Log "Step 5/7 - Uploading DB to Backblaze B2..."
& "C:\tools\litestream.exe" replicate -config "$ROOT\litestream.yml" -once -force-snapshot
if ($LASTEXITCODE -ne 0) { Fail "Litestream upload failed. Check B2 credentials and bucket." }
Log "Upload complete."

# ── Step 6: Git push (Vercel auto-deploys on push) ───────────────────────────
Log "Step 6/7 - Committing and pushing sitemap + narrative to GitHub..."
git add frontend/public/sitemap.xml frontend/public/data/legislative_history.json
$staged = git diff --cached --name-only
if ($staged) {
    $stamp = Get-Date -Format "yyyy-MM-dd"
    git commit -m "Data update ${stamp}: refresh sitemap and legislative narrative"
    if ($LASTEXITCODE -ne 0) { Fail "Git commit failed." }
    git push
    if ($LASTEXITCODE -ne 0) { Fail "Git push failed." }
    Log "Pushed - Vercel will redeploy in ~2 min."
} else {
    Log "No sitemap/narrative changes to push."
}

# ── Step 7: Railway redeploy (picks up new DB from B2) ───────────────────────
if ($railwayOk) {
    Log "Step 7/7 - Triggering Railway redeploy..."
    # Bump DB_RESTORE_VERSION so Railway knows to pull the new DB from B2.
    # Without this, Railway skips the restore on restarts (preserving user accounts).
    $version = Get-Date -Format "yyyyMMdd-HHmmss"
    # NOTE: do NOT pipe railway through `2>&1` here. Merging a native command's
    # stderr into the pipeline under $ErrorActionPreference="Stop" turns any
    # stderr line into a terminating NativeCommandError, which aborts the whole
    # script before the deploy and before .last_publish is written. Let stderr
    # flow to the console and gate on $LASTEXITCODE instead.
    # `set` is the current subcommand (the bare `--set` flag is now legacy);
    # --skip-deploys avoids a redundant deploy since we trigger one explicitly below.
    railway variables set "DB_RESTORE_VERSION=$version" --skip-deploys
    if ($LASTEXITCODE -ne 0) {
        Warn "Failed to set DB_RESTORE_VERSION. Backend will NOT restore the new DB this run."
        Warn "Manual fallback:"
        Warn "  railway variables set DB_RESTORE_VERSION=$version --skip-deploys"
        Warn "  railway redeploy --yes"
    } else {
        Log "DB_RESTORE_VERSION set to $version"
        railway redeploy --yes
        if ($LASTEXITCODE -eq 0) {
            Log "Railway redeploy triggered - backend updates in ~3 min."
        } else {
            Warn "Railway redeploy failed. Manual fallback:"
            Warn "  railway redeploy --yes   (or railway.com -> opencommonground-api -> Redeploy)"
        }
    }
} else {
    Warn "Step 7/7 - Skipping Railway redeploy (not logged in)."
    Warn "Manual: railway.com -> opencommonground-api -> Redeploy"
}

# Record successful run timestamp (used by scheduler gate)
(Get-Date).ToString("o") | Set-Content "$ROOT\.last_publish"

Log ""
Log "============================================================"
Log " Publish complete!"
Log " Vercel (frontend):  picks up new sitemap + narrative in ~2 min"
Log " Railway (backend):  restores DB from B2 and restarts in ~3 min"
Log "============================================================"
