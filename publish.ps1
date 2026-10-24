# publish.ps1 - Full pipeline: fetch new bills, enrich with Ollama, push to production
#
# FIRST-TIME SETUP (run once, manually):
#   railway login          - authenticate Railway CLI (token persists)
#   railway link           - link this directory to the Railway service
#
# SCHEDULED USE:
#   .\scripts\schedule_publish.ps1  - register the Task Scheduler job (logon +
#                                     startup + daily, gated to one publish per
#                                     5 days). Needs an elevated prompt.
#   .\scripts\schedule_publish.ps1 -Status  - why it did or did not run
#   Start-ScheduledTask -TaskName CommonGroundPublish  - run now (gate applies)
#
# Every run, scheduled or manual, transcribes to logs\publish-<stamp>.log.
#
# MANUAL USE:
#   .\publish.ps1                              - full pipeline
#   .\publish.ps1 -SkipFetch                  - skip Legistar scrape
#   .\publish.ps1 -SkipEnrich -SkipNarrative  - sitemap + upload only
#   .\publish.ps1 -SkipTwoLane               - skip the case for / against
#
# Steps:
#  1. scripts/fetch_bills.py          - incremental Legistar scrape (since last ingest date)
#  1b. scripts/refresh_hearings.py    - upcoming committee hearings (Legistar calendar)
#  2. scripts/worker.py               - Ollama enrichment (full_text, analyze, headline, metadata, perspectives)
#  3. scripts/generate_two_lane.py    - the case for / against for newly active bills (Ollama)
#  4. scripts/generate_legislative_narrative.py - regenerate 26-year narrative JSON (Ollama)
#  5. scripts/generate_sitemap.py     - regenerate static sitemap.xml
#  6. ANALYZE + litestream replicate  - refresh SQLite planner stats, then upload CONTENT DB snapshot to Backblaze B2 (path "db")
#  7. git push                        - Vercel picks up new sitemap.xml + narrative JSON (~2 min)
#  8. railway redeploy                - Railway restores CONTENT db from B2 and restarts (~3 min)
#  9. cloudflare purge                - drop cached API reads so the new data is served immediately
#
# Step 9 needs CLOUDFLARE_API_TOKEN (Zone -> Cache Purge -> Purge) and
# CLOUDFLARE_ZONE_ID in .env.  Without them the step is skipped with a warning
# and the edge simply expires on its own (s-maxage=3600), so a publish still
# succeeds -- the new data just takes up to an hour to appear.
#
# NOTE: Step 6 only touches content.db.  Users.db (accounts, votes, tracking,
# bluesky_posts, donations) lives on production and is continuously backed up
# by the Railway-side Litestream process to B2 path "users".  publish.ps1
# never overwrites prod user data.  See app/models/__init__.py for the split.

param(
    [switch]$SkipFetch,
    [switch]$SkipEnrich,
    [switch]$SkipNarrative,
    [switch]$SkipTwoLane,
    [int]$MinDaysSinceLastRun = 0,  # 0 = always run; set by scheduler wrapper to avoid duplicate runs
    [int]$KeepLogs = 30             # how many publish logs to retain
)

$ErrorActionPreference = "Stop"
$ROOT = "C:\Projects\Common_Ground"

# ── Logging ───────────────────────────────────────────────────────────────────
# Task Scheduler discards stdout, so an unattended run used to leave no trace
# whatsoever: a successful publish, a gated no-op and a crash were all
# indistinguishable afterwards. Everything below is transcribed to a file, and
# the scheduled task reports its own exit code into the same directory.
$LogDir = "$ROOT\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogFile = Join-Path $LogDir ("publish-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
try { Start-Transcript -Path $LogFile -Append | Out-Null } catch { }

# Keep the log directory from growing without bound.
try {
    Get-ChildItem -Path $LogDir -Filter "publish-*.log" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip $KeepLogs |
        Remove-Item -Force -ErrorAction SilentlyContinue
} catch { }

function Log($msg) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" -ForegroundColor Cyan
}

function Warn($msg) {
    Write-Host "[WARN] $msg" -ForegroundColor Yellow
}

function Fail($msg) {
    Write-Host "[ERROR] $msg" -ForegroundColor Red
    try { Stop-Transcript | Out-Null } catch { }
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
$EnvFile = "$ROOT\.env"
if (-not (Test-Path $EnvFile)) {
    Fail ".env not found at $EnvFile. Step 8 needs RAILWAY_TOKEN and step 9 needs the Cloudflare pair."
}
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
}

Set-Location $ROOT

# ── Minimum-interval gate (used by scheduler; skipped on manual runs) ─────────
# Note the gate counts ANY publish, manual ones included, because .last_publish
# is written by every successful run. That is deliberate -- a scheduled publish
# hours after a manual one has nothing to do -- but it does mean a habit of
# publishing by hand keeps the scheduled run permanently gated. The log line
# below is what makes that visible instead of looking like a broken task.
$LAST_RUN_FILE = "$ROOT\.last_publish"
if ($MinDaysSinceLastRun -gt 0 -and (Test-Path $LAST_RUN_FILE)) {
    $lastRun = $null
    try { $lastRun = [datetime](Get-Content $LAST_RUN_FILE -Raw).Trim() } catch {
        Warn "Could not parse $LAST_RUN_FILE; treating this as never published."
    }
    if ($lastRun) {
        # Calendar days, not elapsed time. A publish takes ~9 minutes, so with
        # elapsed time the recorded finish always lands just after the daily
        # trigger, and on day N that trigger missed by minutes -- an N-day gate
        # really ran every N+1 days. With -MinDaysSinceLastRun 1 this is "the
        # first trigger of each day publishes, the rest skip".
        $daysSince = ((Get-Date).Date - $lastRun.Date).Days
        if ($daysSince -lt $MinDaysSinceLastRun) {
            $when = if ($daysSince -eq 0) { "earlier today" } else { "$daysSince day(s) ago" }
            Log ("GATED - last publish was {0} ({1}), minimum is {2} day(s). Nothing to do." -f $when, $lastRun.ToString("yyyy-MM-dd HH:mm"), $MinDaysSinceLastRun)
            Log "Run .\publish.ps1 with no -MinDaysSinceLastRun to publish regardless."
            try { Stop-Transcript | Out-Null } catch { }
            exit 0
        }
        Log ("Gate open - last publish was {0} day(s) ago ({1}; minimum {2})." -f $daysSince, $lastRun.ToString("yyyy-MM-dd HH:mm"), $MinDaysSinceLastRun)
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

# Railway auth check (non-fatal - we warn and skip if not logged in).
#
# RAILWAY_TOKEN from .env is what makes this work unattended; the browser login
# expires about monthly, and without the token a scheduled run would skip the
# redeploy every time. Check for it explicitly so the cause is in the log.
$railwayOk = $false
if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("RAILWAY_TOKEN", "Process"))) {
    Warn "RAILWAY_TOKEN is not set in .env - falling back to the browser login, which expires."
}
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    $railwayStatus = & railway status 2>&1
    if ($LASTEXITCODE -eq 0) {
        $railwayOk = $true
    } else {
        Warn "railway status failed: $(($railwayStatus | Out-String).Trim())"
    }
} catch {
    Warn "railway status could not be run: $($_.Exception.Message)"
}
$ErrorActionPreference = $prevEAP
if (-not $railwayOk) {
    Warn "Railway CLI not authenticated or project not linked."
    Warn "Fix: set a persistent RAILWAY_TOKEN in .env, or run: railway login && railway link"
    Warn "Step 8 (redeploy) will be SKIPPED - the DB uploaded in step 6 will NOT go live this run."
}

# ── Step 1: Fetch new bills from Legistar ────────────────────────────────────
if (-not $SkipFetch) {
    Log "Step 1/9 - Fetching new bills from Legistar (incremental)..."
    python scripts/fetch_bills.py
    if ($LASTEXITCODE -ne 0) { Fail "Bill fetch failed. Fix errors above before continuing." }
    Log "Fetch complete."
} else {
    Log "Step 1/9 - Skipping fetch."
}

# ── Step 1b: Upcoming hearings ───────────────────────────────────────────────
# Non-fatal: a Legistar calendar hiccup should not block the publish. It only
# means the hearing banner and reminders show yesterday's schedule.
if (-not $SkipFetch) {
    Log "Step 1b - Refreshing upcoming hearings from the Legistar calendar..."
    python scripts/refresh_hearings.py
    if ($LASTEXITCODE -ne 0) { Log "WARNING: hearing refresh failed; continuing with the previous schedule." }
}

# ── Step 2: Enrich with Ollama ───────────────────────────────────────────────
if (-not $SkipEnrich) {
    Log "Step 2/9 - Running Ollama enrichment pipeline..."
    python scripts/worker.py
    if ($LASTEXITCODE -ne 0) { Fail "Enrichment failed. Fix errors above before continuing." }
    Log "Enrichment complete."
} else {
    Log "Step 2/9 - Skipping enrichment."
}

# ── Step 3: Case for / case against for newly active bills ───────────────────
# Must run after enrichment and before the upload: the generator reads the
# summary that step 2 writes, and the result has to be in the DB that step 6
# ships. Without this a publish puts new bills on the site with an empty
# panel, since the page shows nothing unless a bill has both lanes.
#
# Only bills with no two_lane_state are generated, so this is a few seconds
# when nothing new has landed. Grounding checks are always on -- see
# scripts/two_lane_checks.py and the measured rate in scripts/eval_two_lane.py.
if (-not $SkipTwoLane) {
    Log "Step 3/9 - Generating the case for / against for new bills..."
    python scripts/generate_two_lane.py --all-active --write
    if ($LASTEXITCODE -ne 0) { Fail "Two-lane generation failed." }
    Log "Two-lane complete."
} else {
    Log "Step 3/9 - Skipping two-lane generation."
}

# ── Step 4: Regenerate 26-year legislative narrative ─────────────────────────
if (-not $SkipNarrative) {
    Log "Step 4/9 - Regenerating legislative narrative..."
    python scripts/generate_legislative_narrative.py
    if ($LASTEXITCODE -ne 0) { Fail "Narrative generation failed." }
    Log "Narrative updated."
} else {
    Log "Step 4/9 - Skipping narrative."
}

# ── Step 5: Regenerate sitemap ───────────────────────────────────────────────
Log "Step 5/9 - Regenerating sitemap.xml..."
python scripts/generate_sitemap.py
if ($LASTEXITCODE -ne 0) { Fail "Sitemap generation failed." }
Log "Sitemap updated."

# ── Step 6: Upload DB to Backblaze B2 ────────────────────────────────────────
# ANALYZE first, inside the same DB file that is about to be snapshotted.
#
# ix_legislation_public (migration d9f4b6c80a15) is a partial index, and SQLite
# will only choose it over a plainer index when sqlite_stat1 exists -- without
# statistics the planner reads `analyzed_at IS NOT NULL` as a range scan, picks
# the wrong index, and the /search count stays at ~79ms instead of 0.25ms.
# sqlite_stat1 is an ordinary table, so it rides along inside the snapshot to
# B2 and production inherits whatever was current at upload time. Steps 1-3 add
# bills, which is exactly what makes the old statistics stale, so this belongs
# here rather than in the migration alone.
Log "Step 6/9 - Refreshing query planner statistics (ANALYZE)..."
python -c "import sqlite3; c=sqlite3.connect('common_ground_test.db'); c.execute('ANALYZE'); c.commit(); c.close(); print('ANALYZE complete')"
if ($LASTEXITCODE -ne 0) { Fail "ANALYZE failed." }

Log "Step 6/9 - Uploading DB to Backblaze B2..."
& "C:\tools\litestream.exe" replicate -config "$ROOT\litestream.yml" -once -force-snapshot
if ($LASTEXITCODE -ne 0) { Fail "Litestream upload failed. Check B2 credentials and bucket." }
Log "Upload complete."

# ── Step 7: Git push (Vercel auto-deploys on push) ───────────────────────────
Log "Step 7/9 - Committing and pushing sitemap + narrative to GitHub..."
# All four sitemap files, not just sitemap.xml. generate_sitemap.py now emits a
# sitemap index plus three segments (core / bills / bills-archive); staging only
# the index would push a file whose children were stale or, on a fresh clone,
# absent -- so robots.txt would point Google at an index referencing 404s.
git add frontend/public/sitemap.xml `
        frontend/public/sitemap-core.xml `
        frontend/public/sitemap-bills.xml `
        frontend/public/sitemap-bills-archive.xml `
        frontend/public/data/legislative_history.json
$staged = git diff --cached --name-only
# Data commits belong on main. If the repo is on a feature branch, a plain
# `git push` has no upstream and fails -- which on 2026-10-23 aborted the run
# before step 8, so the uploaded DB never went live. Skip the commit instead;
# the files stay modified and the next publish from main picks them up.
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($staged -and $branch -ne "main") {
    git reset -q -- frontend/public
    Log "WARNING: repo is on '$branch', not main - skipping the sitemap/narrative commit. The data still goes live below."
    $staged = $null
}
if ($staged) {
    $stamp = Get-Date -Format "yyyy-MM-dd"
    git commit -m "Data update ${stamp}: refresh sitemap and legislative narrative"
    if ($LASTEXITCODE -ne 0) { Fail "Git commit failed." }

    # `git push` writes its progress ("To https://github.com/...") to stderr even
    # on success. If this script's own output is redirected or piped -- e.g. run
    # as `.\publish.ps1 2>&1 | Tee-Object` -- that stderr is merged into the
    # pipeline, and under $ErrorActionPreference="Stop" PowerShell turns it into
    # a terminating NativeCommandError. The push succeeds and the script dies
    # anyway, skipping the Railway redeploy, so the new DB never gets restored.
    # Gate on $LASTEXITCODE instead, which is the real result.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        git push
    } finally {
        $ErrorActionPreference = $prevEAP
    }
    # Not fatal: the DB is already uploaded, and failing here would skip the
    # Railway restore below. The commit stays local and goes out next push.
    if ($LASTEXITCODE -ne 0) {
        Log "WARNING: git push failed - sitemap/narrative not deployed yet; continuing so the data still goes live."
    } else {
        Log "Pushed - Vercel will redeploy in ~2 min."
    }
} else {
    Log "No sitemap/narrative changes to push."
}

# ── Step 8: Railway redeploy (picks up new DB from B2) ───────────────────────
# Whether the backend was actually told to restart. Step 9 must not purge the
# edge cache without it: a purge against the still-running old instance refills
# the cache from pre-publish data and pins it there for another hour, which is
# worse than letting it expire on its own.
$redeployOk = $false
if ($railwayOk) {
    Log "Step 8/9 - Triggering Railway redeploy..."
    # Bump DB_RESTORE_VERSION so Railway knows to pull the new DB from B2.
    # Without this, Railway skips the restore on restarts (preserving user accounts).
    $version = Get-Date -Format "yyyyMMdd-HHmmss"
    # Native commands that write to stderr become a terminating
    # NativeCommandError under $ErrorActionPreference="Stop" whenever this
    # script's output is redirected or piped (see the note at step 7). That
    # would abort the run before the deploy and before .last_publish is
    # written, so drop to "Continue" and gate on $LASTEXITCODE, which is the
    # real result.
    # `set` is the current subcommand (the bare `--set` flag is now legacy);
    # --skip-deploys avoids a redundant deploy since we trigger one explicitly below.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    railway variables set "DB_RESTORE_VERSION=$version" --skip-deploys
    if ($LASTEXITCODE -ne 0) {
        Warn "Failed to set DB_RESTORE_VERSION. Backend will NOT restore the new DB this run."
        Warn "Manual fallback:"
        Warn "  railway variables set DB_RESTORE_VERSION=$version --skip-deploys"
        Warn "  railway redeploy --yes"
    } else {
        Log "DB_RESTORE_VERSION set to $version"
        # Retried once. Railway refuses a redeploy while another deployment is
        # in flight, and a publish that follows a `git push` (which triggers
        # its own auto-deploy) hits exactly that window -- observed
        # 2026-10-12, 45s after a push. Transient, so wait and try again
        # rather than leaving the DB unrestored.
        railway redeploy --yes
        if ($LASTEXITCODE -ne 0) {
            Warn "Redeploy refused (a deployment may already be in flight). Retrying in 60s..."
            Start-Sleep 60
            railway redeploy --yes
        }
        if ($LASTEXITCODE -eq 0) {
            $redeployOk = $true
            Log "Railway redeploy triggered - backend updates in ~3 min."
        } else {
            Warn "Railway redeploy failed twice. Manual fallback:"
            Warn "  railway redeploy --yes   (or railway.com -> opencommonground-api -> Redeploy)"
        }
    }
    $ErrorActionPreference = $prevEAP
} else {
    Warn "Step 8/9 - Skipping Railway redeploy (not logged in)."
    Warn "Manual: railway.com -> opencommonground-api -> Redeploy"
}

# ── Step 9: Purge the Cloudflare edge cache ──────────────────────────────────
# Public API reads are cached at the edge for an hour (s-maxage=3600 set in
# main.py). After a publish that cache still holds pre-publish data, so a purge
# is what makes new bills and headlines show up immediately instead of an hour
# later.
$cfToken  = [Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "Process")
$cfZone   = [Environment]::GetEnvironmentVariable("CLOUDFLARE_ZONE_ID", "Process")

# A purge is only safe once the new backend is live. Purging while the OLD
# instance is still serving refills the edge from pre-publish data and pins it
# there for a fresh hour -- strictly worse than letting it expire by itself. So
# a failed redeploy skips the purge rather than racing it.
$purgeBlocked = $railwayOk -and -not $redeployOk

if ($purgeBlocked) {
    Warn "Step 9/9 - NOT purging: the backend was never redeployed, so the edge"
    Warn "would be refilled from pre-publish data and held for another hour."
    Warn "The new DB is already in B2. To finish the publish:"
    Warn "  railway redeploy --yes"
    Warn "  .\publish.ps1 -SkipFetch -SkipEnrich -SkipNarrative -SkipTwoLane"
} elseif ([string]::IsNullOrWhiteSpace($cfToken) -or [string]::IsNullOrWhiteSpace($cfZone)) {
    Warn "Step 9/9 - Skipping cache purge (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID not set in .env)."
    Warn "The edge will expire on its own within an hour."
} else {
    Log "Step 9/9 - Purging Cloudflare cache..."

    # Wait for the backend to report OUR restore version, not merely to be
    # alive. /health now carries db_version, which is the contents of
    # .restore_version -- a file the Railway start command writes only after
    # `litestream restore` succeeds (railway.toml). So a match proves this
    # instance restored the snapshot uploaded minutes ago.
    #
    # The previous loop tested `status -eq "healthy"`, which the OLD container
    # answers identically, so it passed in ~15s regardless and the purge raced
    # the rollout. A version match cannot be satisfied by the old instance.
    if ($railwayOk) {
        Log "Waiting for the backend to report DB version $version..."
        $live = $false
        for ($i = 0; $i -lt 40; $i++) {
            Start-Sleep 15
            try {
                $h = Invoke-RestMethod "https://api.opencommonground.com/health" -TimeoutSec 10
                if ($h.db_version -eq $version) {
                    $live = $true
                    Log "Backend is serving DB version $version (commit $($h.commit))."
                    break
                }
                if ($i -eq 0 -and -not $h.PSObject.Properties.Match('db_version').Count) {
                    # An older build that predates the marker. Fall back to the
                    # liveness behaviour rather than waiting out the full 10
                    # minutes for a field it will never send.
                    Warn "This backend build does not report db_version; falling back to a liveness check."
                    if ($h.status -eq "healthy") { Start-Sleep 45; $live = $true; break }
                }
            } catch {
                # Expected while the instance is restarting.
            }
        }
        if ($live) {
            Log "Letting the rollout settle..."
            Start-Sleep 20
        } else {
            Warn "Backend never reported DB version $version within 10 min."
            Warn "NOT purging - the edge would be refilled from the old instance."
            Warn "Check railway.com -> opencommonground-api -> Deployments, then re-run."
            $purgeBlocked = $true
        }
    }

    if ($purgeBlocked) {
        Warn "Purge skipped. The new DB is in B2 and the version bump is set;"
        Warn "once the backend reports it, run a purge from the Cloudflare"
        Warn "dashboard -> Caching -> Configuration -> Purge Everything, or"
        Warn "simply let the edge expire (s-maxage=3600)."
    } else {
        # Purge-by-hostname is Enterprise-only, so this clears the whole zone.
        # That is harmless: Vercel's assets are content-hashed and re-fetch.
        try {
            $resp = Invoke-RestMethod `
                -Uri "https://api.cloudflare.com/client/v4/zones/$cfZone/purge_cache" `
                -Method POST `
                -Headers @{ "Authorization" = "Bearer $cfToken"; "Content-Type" = "application/json" } `
                -Body '{"purge_everything":true}' `
                -TimeoutSec 30
            if ($resp.success) {
                Log "Cloudflare cache purged."
            } else {
                Warn "Cloudflare purge returned success=false: $($resp.errors | ConvertTo-Json -Compress)"
            }
        } catch {
            Warn "Cloudflare purge failed: $($_.Exception.Message)"
            Warn "Manual fallback: Cloudflare dashboard -> Caching -> Configuration -> Purge Everything"
        }
    }
}

# Did the data actually reach production? Uploading to B2 is not publishing:
# the backend has to restart, restore the snapshot, and report it.
$publishComplete = $railwayOk -and $redeployOk -and -not $purgeBlocked

# .last_publish gates the scheduled run (-MinDaysSinceLastRun). Writing it
# after an incomplete publish would suppress the retry for days, turning a
# recoverable failure into stale production data -- so only a run that got
# the data live counts.
if ($publishComplete) {
    (Get-Date).ToString("o") | Set-Content "$ROOT\.last_publish"
} else {
    Warn "Not recording .last_publish - this publish did not reach production,"
    Warn "so the next scheduled run should retry rather than skip."
}

Log ""
Log "============================================================"
if ($publishComplete) {
    Log " Publish complete!"
} else {
    Log " Publish INCOMPLETE - the new DB is in B2 but may not be live."
}
Log " Vercel (frontend):  picks up new sitemap + narrative in ~2 min"
if (-not $railwayOk) {
    Log " Railway (backend):  SKIPPED - the new DB is in B2 but is NOT live"
} elseif ($redeployOk) {
    Log " Railway (backend):  redeployed and restored from B2"
} else {
    Log " Railway (backend):  REDEPLOY FAILED - the new DB is NOT live"
}
if ($purgeBlocked) {
    Log " Cloudflare:         NOT purged - see the warnings above"
} else {
    Log " Cloudflare:         edge cache purged (or expires within 1h)"
}
Log " Log file:           $LogFile"
Log "============================================================"
try { Stop-Transcript | Out-Null } catch { }
if (-not $publishComplete) { exit 1 }
