# publish.ps1 — Full pipeline: fetch new bills, enrich with Ollama, push to production
#
# Usage: .\publish.ps1
# Optional: .\publish.ps1 -SkipFetch          (skip Legistar scrape)
# Optional: .\publish.ps1 -SkipEnrich         (skip Ollama enrichment)
# Optional: .\publish.ps1 -SkipNarrative      (skip narrative regeneration)
# Optional: .\publish.ps1 -SkipFetch -SkipEnrich  (sitemap + upload only)
#
# Steps:
#  1. scripts/fetch_bills.py          — incremental Legistar scrape (since last ingest date)
#  2. scripts/worker.py               — Ollama enrichment (full_text, analyze, headline, metadata, perspectives)
#  3. scripts/generate_legislative_narrative.py — regenerate 26-year narrative JSON
#  4. scripts/generate_sitemap.py     — regenerate static sitemap.xml
#  5. litestream replicate            — upload DB snapshot to Backblaze B2
#  6. git push                        — Vercel picks up new sitemap.xml + narrative JSON (~2 min)
#  7. railway redeploy                — Railway restores DB from B2 and restarts (~3 min)

param(
    [switch]$SkipFetch,
    [switch]$SkipEnrich,
    [switch]$SkipNarrative
)

$ErrorActionPreference = "Stop"
$ROOT = "C:\Projects\Common_Ground"

function Log($msg) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" -ForegroundColor Cyan
}

function Fail($msg) {
    Write-Host "[ERROR] $msg" -ForegroundColor Red
    exit 1
}

# Load .env
Get-Content "$ROOT\.env" | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
}

Set-Location $ROOT

# Step 1: Fetch new bills from Legistar (incremental — only bills after last ingest date)
if (-not $SkipFetch) {
    Log "Step 1/5 — Fetching new bills from Legistar (incremental)..."
    python scripts/fetch_bills.py
    if ($LASTEXITCODE -ne 0) { Fail "Bill fetch failed. Fix errors above before continuing." }
    Log "Fetch complete."
} else {
    Log "Step 1/5 — Skipping fetch."
}

# Step 2: Enrich with Ollama (full analysis pipeline)
if (-not $SkipEnrich) {
    Log "Step 2/5 — Running Ollama enrichment pipeline..."
    python scripts/worker.py
    if ($LASTEXITCODE -ne 0) { Fail "Enrichment failed. Fix errors above before continuing." }
    Log "Enrichment complete."
} else {
    Log "Step 2/5 — Skipping enrichment."
}

# Step 3: Regenerate 26-year legislative narrative
if (-not $SkipNarrative) {
    Log "Step 3/5 — Regenerating legislative narrative..."
    python scripts/generate_legislative_narrative.py
    if ($LASTEXITCODE -ne 0) { Fail "Narrative generation failed." }
    Log "Narrative updated."
} else {
    Log "Step 3/5 — Skipping narrative."
}

# Step 4: Regenerate static sitemap.xml
Log "Step 4/5 — Regenerating sitemap.xml..."
python scripts/generate_sitemap.py
if ($LASTEXITCODE -ne 0) { Fail "Sitemap generation failed." }
Log "Sitemap updated."

# Step 5: Sync to Backblaze B2
Log "Step 5/5 — Uploading DB to Backblaze B2..."
& "C:\tools\litestream.exe" replicate -config "$ROOT\litestream.yml" -once -force-snapshot
if ($LASTEXITCODE -ne 0) { Fail "Litestream upload failed. Check B2 credentials and bucket." }
Log "Upload complete."

# Step 6: Git push — Vercel picks up sitemap.xml + narrative JSON
Log "Step 6/7 — Committing and pushing sitemap + narrative to GitHub..."
git add frontend/public/sitemap.xml frontend/public/data/legislative_history.json
$staged = git diff --cached --name-only
if ($staged) {
    $stamp = Get-Date -Format "yyyy-MM-dd"
    git commit -m "Data update $stamp`: refresh sitemap and legislative narrative"
    if ($LASTEXITCODE -ne 0) { Fail "Git commit failed." }
    git push
    if ($LASTEXITCODE -ne 0) { Fail "Git push failed." }
    Log "Pushed — Vercel will redeploy in ~2 min."
} else {
    Log "No sitemap/narrative changes to push."
}

# Step 7: Railway redeploy — picks up new DB from B2
Log "Step 7/7 — Triggering Railway redeploy..."
railway redeploy --yes 2>&1
if ($LASTEXITCODE -ne 0) {
    Log "[warn] Railway CLI redeploy failed (may need 'railway link' first)."
    Log "       Manual fallback: railway.com → opencommonground-api → Redeploy"
} else {
    Log "Railway redeploy triggered — production updates in ~3 min."
}

Log ""
Log "============================================================"
Log " Publish complete!"
Log ""
Log " Vercel (frontend):  ~2 min to pick up new sitemap + narrative"
Log " Railway (backend):  ~3 min to restore DB and restart"
Log "============================================================"
